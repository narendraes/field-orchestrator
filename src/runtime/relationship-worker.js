import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { Queue } from '@forge/events';
import { calculateRelationshipRollup } from './relationship-rollup';
import { traceRelationshipTargets } from './relationship-routing';

const queue = new Queue({ key: 'relationship-jobs' });
const quote = value => JSON.stringify(String(value));
const TARGET_PAGE_SIZE = 25;

// Two property paths are added to the existing active/fieldIds paths: total 4.
// Link keys include the opposite project so unrelated project pairs are rejected.
export function projectDependencies(projectId, policies) {
  const fieldIds = new Set(), linkRoutes = new Set();
  let relationship = false;
  for (const policy of policies.filter(item => item.status === 'active')) {
    if (policy.behaviorType === 'assessment' && policy.projectIds.includes(projectId)) {
      (policy.runtime?.dependencyFieldIds || []).forEach(id => fieldIds.add(id));
    }
    if (policy.behaviorType !== 'relationship') continue;
    const plan = policy.runtime?.plan;
    if (!plan) continue;
    if (plan.sourceProjectIds.includes(projectId)) {
      plan.sourceFieldIds.forEach(id => fieldIds.add(id)); relationship = true;
      plan.targetProjectIds.forEach(id => linkRoutes.add(`${plan.linkTypeId}:${id}`));
    }
    if (plan.targetProjectIds.includes(projectId)) {
      plan.targetFieldIds.forEach(id => fieldIds.add(id)); relationship = true;
      plan.sourceProjectIds.forEach(id => linkRoutes.add(`${plan.linkTypeId}:${id}`));
    }
  }
  return { active: fieldIds.size > 0 || relationship, fieldIds: [...fieldIds], relationship, linkRoutes: [...linkRoutes] };
}

export function jiraAccess(asUser = false) {
  let requests = 0;
  const request = async (path, options = {}) => {
    requests += 1;
    if (requests > 250) throw new Error('Relationship request budget exceeded; narrow the policy.');
    const response = await (asUser ? api.asUser() : api.asApp()).requestJira(path, options);
    if (!response.ok) { const error = new Error(`Jira request failed (${response.status}); no partial total is written.`); error.retryable = response.status === 429 || response.status >= 500; throw error; }
    return response.status === 204 ? null : response.json();
  };
  return {
    requests: () => requests,
    evaluate: async (key, expression) => {
      const result = await request(route`/rest/api/3/expression/evaluate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expression, context: { issue: { key } } }) });
      if (typeof result?.value !== 'boolean') throw new Error('Jira expression did not return a Boolean.');
      return result.value;
    },
    readIssue: (key, fields) => request(route`/rest/api/3/issue/${key}?fields=${fields.join(',')}`),
    editmeta: key => request(route`/rest/api/3/issue/${key}/editmeta`),
    searchTargetPage: async (jql, nextPageToken) => {
      const page = await request(route`/rest/api/3/search/jql`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jql, fields: ['project'], maxResults: TARGET_PAGE_SIZE, ...(nextPageToken ? { nextPageToken } : {}) }) });
      if (page.isLast === false && !page.nextPageToken) throw new Error('Incomplete target search; continuation unavailable.');
      if (nextPageToken && page.nextPageToken === nextPageToken) throw new Error('Target search did not advance.');
      return { targets: page.issues || [], nextPageToken: page.nextPageToken };
    },
    searchIssues: async (jql, fields, limit = 500) => {
      const items = []; let nextPageToken;
      do {
        const page = await request(route`/rest/api/3/search/jql`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jql, fields, maxResults: Math.min(100, limit + 1), ...(nextPageToken ? { nextPageToken } : {}) }) });
        items.push(...(page.issues || [])); nextPageToken = page.nextPageToken;
        if (items.length > limit || (items.length === limit && nextPageToken)) throw new Error('Relationship search exceeds its bound; no partial total is written.');
        if (page.isLast === false && !nextPageToken) throw new Error('Incomplete Jira search.');
      } while (nextPageToken);
      return items;
    },
    write: (key, fieldId, value) => request(route`/rest/api/3/issue/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { [fieldId]: value } }) })
  };
}

export function filterClause(filter) {
  const field = /^customfield_[0-9]+$/.test(filter.fieldId) ? `cf[${filter.fieldId.slice(12)}]` : filter.fieldId;
  if (!/^(cf\[[0-9]+\]|status|statusCategory|issuetype|priority|resolution|labels|assignee)$/.test(field)) throw new Error('This filter field is not supported by the numeric runtime.');
  if (filter.operator === 'isEmpty') return `${field} IS EMPTY`;
  if (filter.operator === 'isNotEmpty') return `${field} IS NOT EMPTY`;
  if (!['equals', 'notEquals'].includes(filter.operator)) throw new Error('Unsupported filter operator.');
  return `${field} ${filter.operator === 'equals' ? '=' : '!='} ${quote(filter.value)}`;
}

export async function calculateTarget(policy, targetKey, jira) {
  const target = await jira.readIssue(targetKey, ['project', 'issuelinks', policy.targetFieldId]);
  if (!policy.projectIds.includes(String(target.fields?.project?.id))) throw new Error('Target moved outside policy scope.');
  const plan = policy.runtime.plan;
  const keys = [...new Set((target.fields?.issuelinks || []).filter(link => String(link.type?.id) === plan.linkTypeId).map(link => link.inwardIssue?.key || link.outwardIssue?.key).filter(Boolean))];
  if (keys.length > 500) throw new Error('Too many linked roots.');
  const scope = `project in (${plan.sourceProjectIds.map(quote).join(',')})`;
  let parents = keys.length ? await jira.searchIssues(`key in (${keys.map(quote).join(',')}) AND ${scope} AND issuetype in (${plan.relatedIssueTypeIds.map(quote).join(',')})`, ['parent']) : [];
  const depths = new Map(parents.map(item => [item.key, 0]));
  for (let depth = 1; depth <= plan.hierarchyDepth && parents.length; depth += 1) {
    parents = await jira.searchIssues(`parent in (${parents.map(item => quote(item.key)).join(',')}) AND ${scope}`, ['parent']);
    for (const item of parents) if (!depths.has(item.key)) depths.set(item.key, depth);
    if (depths.size > 500) throw new Error('Hierarchy exceeds 500 items.');
  }
  const candidates = [];
  const discovered = [...depths.keys()];
  const filters = (policy.filters || []).map(filterClause);
  for (let offset = 0; offset < discovered.length; offset += 50) {
    const jql = `key in (${discovered.slice(offset, offset + 50).map(quote).join(',')}) AND ${scope}${filters.length ? ' AND ' + filters.map(item => `(${item})`).join(' AND ') : ''}`;
    const items = await jira.searchIssues(jql, policy.aggregation === 'count' ? [] : [policy.sourceFieldId]);
    candidates.push(...items.map(item => ({ ...item, depth: depths.get(item.key) })));
  }
  const result = calculateRelationshipRollup({ candidates, sourceFieldId: policy.sourceFieldId, aggregation: policy.aggregation });
  return { current: target.fields?.[policy.targetFieldId] ?? null, value: result.value };
}

async function pushJob(body) {
  try {
    await queue.push({ body, concurrency: { key: 'relationship-writes-v1', limit: 1 }, delayInSeconds: 2 });
  } catch (cause) {
    const error = new Error('Could not queue remaining targets; discovery will retry.');
    error.retryable = true;
    throw error;
  }
}

export async function enqueueRelationshipEvent(event) {
  // Invocation has already passed a manifest gate. Retain identifiers only.
  await queue.push({ body: {
    eventType: event.eventType, key: event.issue?.key || '',
    projectId: String(event.issue?.fields?.project?.id || event.issue?.project?.id || event.sourceProjectId || ''),
    destinationProjectId: String(event.destinationProjectId || ''), linkTypeId: String(event.issueLinkType?.id || ''),
    changedFields: (event.changelog?.items || []).map(item => item.fieldId).filter(Boolean).slice(0, 100)
  }, concurrency: { key: 'relationship-writes-v1', limit: 1 }, delayInSeconds: 2 });
}

export async function runRelationshipJob({ body }) {
  const policies = (await kvs.get('field-policies:v1') || []).filter(policy => policy.status === 'active' && policy.behaviorType === 'relationship');
  for (const policy of policies) {
    if (body.policyId && (policy.id !== body.policyId || policy.revision !== body.policyRevision)) continue;
    const plan = policy.runtime.plan;
    const source = plan.sourceProjectIds.includes(body.projectId), target = plan.targetProjectIds.includes(body.projectId);
    const isLink = body.eventType?.endsWith(':issuelink');
    if (isLink ? !(plan.linkTypeId === body.linkTypeId && ((source && plan.targetProjectIds.includes(body.destinationProjectId)) || (target && plan.sourceProjectIds.includes(body.destinationProjectId)))) : !(source || target)) continue;
    const isUpdate = body.eventType === 'avi:jira:updated:issue';
    if (isUpdate && !(source && plan.sourceFieldIds.some(id => body.changedFields.includes(id))) && !(target && plan.targetFieldIds.some(id => body.changedFields.includes(id)))) continue;
    const started = Date.now(), jira = jiraAccess();
    try {
      // Structural events recalculate the bounded target scope: deletion payloads
      // cannot reliably reveal old parents/links. This covers both old and new totals.
      const structural = !isUpdate || body.changedFields.some(id => ['parent', 'issuetype', 'project'].includes(id));
      let targets;
      if (body.targetKey) targets = [{ key: body.targetKey }];
      else if (structural) {
        // Page discovery and target evaluation are separate jobs. A large project
        // does not exhaust one invocation's request/time budget or cap its scope.
        const page = await jira.searchTargetPage(`project in (${plan.targetProjectIds.map(quote).join(',')}) ORDER BY key`, body.nextPageToken);
        targets = page.targets;
        for (const item of targets) await pushJob({ ...body, policyId: policy.id, policyRevision: policy.revision, targetKey: item.key, nextPageToken: undefined });
        if (page.nextPageToken) await pushJob({ ...body, policyId: policy.id, policyRevision: policy.revision, nextPageToken: page.nextPageToken });
        if (!targets.length) await recordRelationshipRun(policy, body, body.key, 'no-targets', started, jira.requests(), true);
        continue;
      }
      else {
        targets = source ? (await traceRelationshipTargets(plan, body.key, jira)).targets : [];
        if (target && (policy.protect || policy.skipDoneTargets)) targets.push({ key: body.key });
      }
      if (!body.targetKey) {
        for (const key of [...new Set(targets.map(item => item.key))]) await pushJob({ ...body, policyId: policy.id, policyRevision: policy.revision, targetKey: key });
        if (!targets.length) await recordRelationshipRun(policy, body, body.key, 'no-targets', started, jira.requests(), true);
        continue;
      }
      if (!targets.length) await recordRelationshipRun(policy, body, body.key, 'no-targets', started, jira.requests(), true);
      for (const key of [...new Set(targets.map(item => item.key))]) {
        if (policy.skipDoneTargets && !await jira.evaluate(key, "issue.status.category.key != 'done'")) { await recordRelationshipRun(policy, body, key, 'skipped-done', started, jira.requests(), true); continue; }
        const result = await calculateTarget(policy, key, jira);
        if (result.current === result.value) { await recordRelationshipRun(policy, body, key, 'unchanged', started, jira.requests(), true); continue; }
        // Recheck lifecycle immediately before writing. No stored stale revision
        // may continue after a deactivation or edit observed by the worker.
        const latest = (await kvs.get('field-policies:v1') || []).find(item => item.id === policy.id);
        if (latest?.status !== 'active' || latest.revision !== policy.revision) break;
        const metadata = await jira.editmeta(key);
        if (metadata.fields?.[policy.targetFieldId]?.schema?.type !== 'number') throw new Error('Target is not an editable numeric field in this context.');
        if (policy.skipDoneTargets && !await jira.evaluate(key, "issue.status.category.key != 'done'")) continue;
        await jira.write(key, policy.targetFieldId, result.value);
        await recordRelationshipRun(policy, body, key, policy.protect && body.key === key && body.changedFields.includes(policy.targetFieldId) ? 'restored' : 'changed', started, jira.requests());
      }
    } catch (error) {
      await recordRelationshipRun(policy, body, body.key, 'error', started, jira.requests(), false, error.message);
      // Throw so Forge retries transient API/search failures. Every retry reads
      // current values again and suppresses already-applied writes.
      if (error.retryable) throw error;
    }
  }
}

async function recordRelationshipRun(policy, body, key, outcome, started, requests, debugOnly = false, message = '') {
  const record = { traceId: `fo-rel-${crypto.randomUUID()}`, policyId: policy.id, policyName: policy.name,
    workItemKey: key, sourceKey: body.key, outcome, kind: 'runtime', revision: policy.revision,
    changedFieldIds: body.changedFields || [], message: String(message).slice(0, 200), eventType: body.eventType, createdAt: new Date().toISOString(), durationMs: Date.now() - started, jiraRequests: requests };
  try {
    const setting = await kvs.get(`diagnostics:v1:${policy.id}`);
    if (setting?.until > Date.now()) await kvs.set(`diagnostic-run:v1:${policy.id}:${Math.floor(Math.random() * 20)}`, record);
    if (debugOnly) return;
    await kvs.set(`policy-last-run:v1:${policy.id}`, { lastRunAt: record.createdAt, lastRunOutcome: outcome, lastRunTraceId: record.traceId });
    // Independent fixed slots avoid rewriting the policy collection from runtime.
    await kvs.set(`relationship-run:v1:${policy.id}:${Math.floor(Math.random() * 20)}`, record);
    console.info('Field Orchestrator relationship result.', record);
  } catch (_) { console.warn('Relationship trace unavailable.'); }
}
