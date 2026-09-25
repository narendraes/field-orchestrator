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
    let response;
    try { response = await (asUser ? api.asUser() : api.asApp()).requestJira(path, options); }
    catch (error) { error.retryable = true; throw error; }
    if (!response.ok) { const error = new Error(`Jira request failed (${response.status}); no partial total is written.`); error.retryable = response.status === 429 || response.status >= 500; throw error; }
    if (response.status === 204 || options.method === 'PUT') return null;
    try { return await response.json(); }
    catch (error) { error.retryable = true; throw error; }
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
    writeFields: (key, fields) => request(route`/rest/api/3/issue/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) }),
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
  // No artificial delay: the shared concurrency key still serializes writers.
  try {
    await queue.push({ body, concurrency: { key: 'relationship-writes-v1', limit: 1 } });
  } catch (cause) {
    const error = new Error('Could not queue remaining targets; discovery will retry.');
    error.retryable = true;
    throw error;
  }
}

export async function enqueueRelationshipEvent(event) {
  // Invocation has already passed a manifest gate. Retain identifiers only.
  await queue.push({ body: {
    receivedAt: Date.now(), eventType: event.eventType, key: event.issue?.key || '',
    projectId: String(event.issue?.fields?.project?.id || event.issue?.project?.id || event.sourceProjectId || ''),
    destinationProjectId: String(event.destinationProjectId || ''), linkTypeId: String(event.issueLinkType?.id || ''),
    changedFields: (event.changelog?.items || []).map(item => item.fieldId).filter(Boolean).slice(0, 100)
  }, concurrency: { key: 'relationship-writes-v1', limit: 1 } });
}

// Only workers using the shared installation concurrency key may mutate these
// records. Ingress never performs a racing read/modify/write. Queue ordering is
// deliberately irrelevant: whichever discoveries arrive before flush are merged.
const permanentError = message => Object.assign(new Error(message), { retryable: false });
const pendingKey = key => `relationship-pending:v1:${key}`;

async function scheduleTarget(key, policy, body) {
  const storageKey = pendingKey(key);
  const pending = await kvs.get(storageKey) || { token: crypto.randomUUID(), refs: {}, count: 0, receivedAt: body.receivedAt || Date.now(), scheduled: false };
  pending.receivedAt = Math.min(pending.receivedAt, body.receivedAt || Date.now());
  pending.count += 1;
  const previous = pending.refs[policy.id];
  pending.refs[policy.id] = {
    revision: policy.revision, activatedAt: policy.activatedAt || '',
    key: body.key || '', eventType: body.eventType,
    changedFields: body.changedFields || [],
    restore: !!(policy.protect && body.key === key && body.changedFields?.includes(policy.targetFieldId)) ||
      !!(previous?.revision === policy.revision && previous?.activatedAt === (policy.activatedAt || '') && previous?.restore)
  };
  await kvs.set(storageKey, pending);
  if (!pending.scheduled || Date.now() - (pending.scheduledAt || 0) > 5 * 60 * 1000) {
    // Persist before enqueue; on enqueue failure a retried discovery can schedule
    // the unscheduled record. A crash after enqueue may duplicate flushes, which
    // are harmless because each flush checks its generation token.
    await pushJob({ flushTarget: key, token: pending.token });
    pending.scheduled = true;
    pending.scheduledAt = Date.now();
    await kvs.set(storageKey, pending);
  }
}

function sharedReads(jira, target, key) {
  const searches = new Map();
  return { ...jira,
    readIssue: (itemKey, fields) => itemKey === key ? Promise.resolve(target) : jira.readIssue(itemKey, fields),
    searchIssues: (jql, fields, limit = 500) => {
      const signature = JSON.stringify([jql, fields, limit]);
      if (!searches.has(signature)) searches.set(signature, jira.searchIssues(jql, fields, limit));
      return searches.get(signature);
    }
  };
}

async function flushTarget(body, allPolicies) {
  const key = body.flushTarget, storageKey = pendingKey(key);
  const pending = await kvs.get(storageKey);
  if (!pending || pending.token !== body.token) return;
  const policies = allPolicies.filter(policy => {
    const ref = pending.refs[policy.id];
    return ref && ref.revision === policy.revision && ref.activatedAt === (policy.activatedAt || '');
  });
  const started = Date.now(), jira = jiraAccess();
  const batchId = `fo-batch-${crypto.randomUUID()}`;
  const outcomes = new Map();
  const traceBody = policy => ({ ...body, ...pending.refs[policy.id], receivedAt: pending.receivedAt,
    batchId, batchPolicyCount: policies.length, mergedSignals: pending.count });
  try {
    if (policies.length) {
      const target = await jira.readIssue(key, ['project', 'issuelinks', ...new Set(policies.map(policy => policy.targetFieldId))]);
      const shared = sharedReads(jira, target, key);
      const needsDone = policies.some(policy => policy.skipDoneTargets);
      const notDone = !needsDone || await jira.evaluate(key, "issue.status.category.key != 'done'");
      const fields = {}, owners = new Set();
      for (const policy of policies) {
        // Independent owners of the same field are invalid even if their current
        // values happen to match. Never let ordering silently decide ownership.
        if (owners.has(policy.targetFieldId)) throw permanentError('Conflicting target field owners; consolidated write cancelled.');
        owners.add(policy.targetFieldId);
        if (policy.skipDoneTargets && !notDone) { outcomes.set(policy.id, 'skipped-done'); continue; }
        let result;
        try { result = await calculateTarget(policy, key, shared); }
        catch (error) { if (error.retryable === undefined) error.retryable = false; throw error; }
        if (result.current === result.value) { outcomes.set(policy.id, 'unchanged'); continue; }
        fields[policy.targetFieldId] = result.value;
        outcomes.set(policy.id, pending.refs[policy.id].restore ? 'restored' : 'changed');
      }
      if (Object.keys(fields).length) {
        const metadata = await jira.editmeta(key);
        for (const fieldId of Object.keys(fields)) {
          if (metadata.fields?.[fieldId]?.schema?.type !== 'number') throw permanentError('Target is not an editable numeric field in this context; consolidated write cancelled.');
        }
        // Fresh Boolean guards and lifecycle checks are intentionally not cached.
        // Abort the complete write if any member changed while calculating.
        if (needsDone && notDone && !await jira.evaluate(key, "issue.status.category.key != 'done'")) {
          const error = new Error('Target status changed during calculation; retrying consolidated write.'); error.retryable = true; throw error;
        }
        const scopeExpression = policies.map(policy => `${JSON.stringify(policy.projectIds)}.includes(issue.project.id + '')`).join(' && ');
        if (!await jira.evaluate(key, scopeExpression)) throw permanentError('Target moved outside policy scope; consolidated write cancelled.');
        const latest = await kvs.get('field-policies:v1') || [];
        if (policies.some(policy => !latest.some(item => item.id === policy.id && item.status === 'active' && item.revision === policy.revision && (item.activatedAt || '') === (policy.activatedAt || '')))) {
          for (const policy of policies) outcomes.set(policy.id, 'cancelled');
        } else {
          // A single Jira edit carries all changed fields. No field is written
          // until every participating calculation and editable-field check passed.
          await jira.writeFields(key, fields);
        }
      }
      for (const policy of policies) {
        const outcome = outcomes.get(policy.id);
        await recordRelationshipRun(policy, traceBody(policy), key, outcome, started, jira.requests(), !['changed', 'restored'].includes(outcome));
      }
    }
    await kvs.delete(storageKey);
  } catch (error) {
    for (const policy of policies) await recordRelationshipRun(policy, traceBody(policy), key, 'error', started, jira.requests(), false, error.message);
    // API transients and storage/checkpoint failures must keep the dirty record
    // and retry. A permanent calculation/API failure is visible and a later event
    // can start a fresh batch. Unknown failures are not silently discarded.
    if (error.retryable !== false) throw error;
    await kvs.delete(storageKey);
  }
}

export async function runRelationshipJob({ body }) {
  body = { ...body, jobStartedAt: Date.now() };
  const policies = (await kvs.get('field-policies:v1') || []).filter(policy => policy.status === 'active' && policy.behaviorType === 'relationship');
  if (body.flushTarget) return flushTarget(body, policies);
  const jira = jiraAccess(), routes = new Map();
  for (const policy of policies) {
    if (body.policyId && (policy.id !== body.policyId || policy.revision !== body.policyRevision)) continue;
    const plan = policy.runtime.plan;
    const source = plan.sourceProjectIds.includes(body.projectId), target = plan.targetProjectIds.includes(body.projectId);
    const isLink = body.eventType?.endsWith(':issuelink');
    if (isLink ? !(plan.linkTypeId === body.linkTypeId && ((source && plan.targetProjectIds.includes(body.destinationProjectId)) || (target && plan.sourceProjectIds.includes(body.destinationProjectId)))) : !(source || target)) continue;
    const isUpdate = body.eventType === 'avi:jira:updated:issue';
    if (isUpdate && !(source && plan.sourceFieldIds.some(id => body.changedFields.includes(id))) && !(target && plan.targetFieldIds.some(id => body.changedFields.includes(id)))) continue;
    const started = Date.now();
    try {
      const structural = !isUpdate || body.changedFields.some(id => ['parent', 'issuetype', 'project'].includes(id));
      let targets;
      if (body.targetKey) targets = [{ key: body.targetKey }]; // Drain pre-upgrade jobs safely.
      else if (structural) {
        const signature = JSON.stringify([plan.targetProjectIds, body.nextPageToken]);
        if (!routes.has(signature)) routes.set(signature, jira.searchTargetPage(`project in (${plan.targetProjectIds.map(quote).join(',')}) ORDER BY key`, body.nextPageToken));
        const page = await routes.get(signature);
        targets = page.targets;
        if (page.nextPageToken) await pushJob({ ...body, policyId: policy.id, policyRevision: policy.revision, nextPageToken: page.nextPageToken });
      } else {
        if (source) {
          const signature = JSON.stringify([plan.sourceProjectIds, plan.targetProjectIds, plan.linkTypeId, plan.relatedIssueTypeIds, plan.hierarchyDepth, plan.maxTargets, body.key]);
          if (!routes.has(signature)) routes.set(signature, traceRelationshipTargets(plan, body.key, jira));
          targets = [...(await routes.get(signature)).targets];
        } else targets = [];
        if (target && (policy.protect || policy.skipDoneTargets)) targets.push({ key: body.key });
      }
      for (const key of [...new Set(targets.map(item => item.key))]) await scheduleTarget(key, policy, body);
      if (!targets.length) await recordRelationshipRun(policy, body, body.key, 'no-targets', started, jira.requests(), true);
    } catch (error) {
      await recordRelationshipRun(policy, body, body.key, 'error', started, jira.requests(), false, error.message);
      // Storage and dispatch errors must retry, or dirty work could be stranded.
      if (error.retryable !== false) throw error;
    }
  }
}

async function recordRelationshipRun(policy, body, key, outcome, started, requests, debugOnly = false, message = '') {
  const record = { traceId: `fo-rel-${crypto.randomUUID()}`, policyId: policy.id, policyName: policy.name,
    workItemKey: key, sourceKey: body.key, outcome, kind: 'runtime', revision: policy.revision,
    ...(body.batchId ? { batchId: body.batchId, batchPolicyCount: body.batchPolicyCount, mergedSignals: body.mergedSignals, requestCountScope: 'shared-target-batch' } : {}),
    changedFieldIds: body.changedFields || [], message: String(message).slice(0, 200), eventType: body.eventType, createdAt: new Date().toISOString(), durationMs: Date.now() - started, jiraRequests: requests,
    ...(Number.isFinite(body.receivedAt) ? { sinceIngressMs: Date.now() - body.receivedAt, beforeJobMs: body.jobStartedAt - body.receivedAt } : {}) };
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
