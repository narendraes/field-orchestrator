import { enqueueRelationshipEvent } from './relationship-worker';
import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';

const POLICIES_KEY = 'field-policies:v1';
const RUNS_KEY = 'policy-runs:v1';
const RUN_LIMIT = 50;

const displayValue = value => {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return value.map(displayValue).sort().join('|');
  if (typeof value === 'object') return String(value.id ?? value.value ?? value.name ?? value.key ?? JSON.stringify(value));
  return String(value);
};

async function jiraJson(request, description) {
  const response = await request;
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${description} failed (${response.status})${body ? `: ${body.slice(0, 300)}` : '.'}`);
  }
  return response.status === 204 ? null : response.json();
}

async function retainRun(policy, event, outcome, startedAt, jiraRequests, message) {
  const createdAt = new Date().toISOString();
  const run = {
    traceId: `fo-runtime-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    policyId: policy.id,
    policyName: policy.name,
    workItemKey: event.issue?.key || '',
    outcome,
    durationMs: Date.now() - startedAt,
    jiraRequests,
    createdAt,
    kind: 'runtime',
    message: String(message || '').slice(0, 300)
  };
  try {
    const storedRuns = await kvs.get(RUNS_KEY);
    await kvs.set(RUNS_KEY, [run, ...(Array.isArray(storedRuns) ? storedRuns : [])].slice(0, RUN_LIMIT));
    await kvs.set(`policy-last-run:v1:${policy.id}`, { lastRunAt: createdAt, lastRunOutcome: outcome, lastRunTraceId: run.traceId });
  } catch (_) { console.warn('Execution history unavailable.'); }
  console.info('Field Orchestrator runtime trace.', run);
}

// Diagnostics are optional and must never change the result of a Jira write.
// Fixed slots bound storage without rewriting policy configuration or a shared history array.
async function diagnostic(policy, event, outcome, startedAt, jiraRequests) {
  try {
    const setting = await kvs.get(`diagnostics:v1:${policy.id}`);
    if (!setting || setting.until <= Date.now()) return;
    const traceId = `fo-debug-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const slot = Math.floor(Math.random() * 20);
    const record = { traceId, policyId: policy.id, revision: policy.revision || '',
      createdAt: new Date().toISOString(), workItemKey: event.issue?.key || '',
      eventType: event.eventType || 'avi:jira:updated:issue', outcome,
      durationMs: Date.now() - startedAt, jiraRequests,
      changedFieldIds: [...new Set((event.changelog?.items || []).map(item => item.fieldId).filter(Boolean))].slice(0, 30) };
    await kvs.set(`diagnostic-run:v1:${policy.id}:${slot}`, record);
    console.info('Field Orchestrator diagnostic.', record);
  } catch (_) {
    // Telemetry outages must not suppress downstream derived-field processing.
    console.warn('Field Orchestrator diagnostic unavailable.');
  }
}

async function processPolicy(policy, event) {
  const startedAt = Date.now();
  let jiraRequests = 0;
  try {
    jiraRequests += 1;
    const evaluation = await jiraJson(api.asApp().requestJira(route`/rest/api/3/expression/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ expression: policy.runtime.expression, context: { issue: { key: event.issue.key } } })
    }), 'Jira expression evaluation');
    if (evaluation?.value !== true) { await diagnostic(policy, event, 'no-match', startedAt, jiraRequests); return false; }

    jiraRequests += 1;
    const issue = await jiraJson(api.asApp().requestJira(route`/rest/api/3/issue/${event.issue.key}?fields=${policy.targetFieldId}`, { headers: { Accept: 'application/json' } }), 'Target value read');
    const currentValue = issue?.fields?.[policy.targetFieldId];
    const nextValue = policy.runtime.compiledTargetValue;
    if (displayValue(currentValue) === displayValue(nextValue)) { await diagnostic(policy, event, 'unchanged', startedAt, jiraRequests); return false; }

    jiraRequests += 1;
    await jiraJson(api.asApp().requestJira(route`/rest/api/3/issue/${event.issue.key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ fields: { [policy.targetFieldId]: nextValue } })
    }), 'Target field update');
    await diagnostic(policy, event, 'write-succeeded', startedAt, jiraRequests);
    await retainRun(policy, event, policy.protect && event.changelog?.items?.some(item => item.fieldId === policy.targetFieldId) ? 'restored' : 'changed', startedAt, jiraRequests, `${policy.targetFieldId} updated after Jira expression matched.`);
    return true;
  } catch (error) {
    await diagnostic(policy, event, 'evaluation-error', startedAt, jiraRequests);
    await retainRun(policy, event, 'error', startedAt, jiraRequests, error.message);
    return false;
  }
}

function topologicalPolicies(policies) {
  const byId = new Map(policies.map(policy => [policy.id, policy]));
  const outgoing = new Map(policies.map(policy => [policy.id, []]));
  const indegree = new Map(policies.map(policy => [policy.id, 0]));
  for (const source of policies) {
    for (const consumer of policies) {
      if (source.id !== consumer.id && consumer.runtime?.dependencyFieldIds?.includes(source.targetFieldId)) {
        outgoing.get(source.id).push(consumer.id);
        indegree.set(consumer.id, indegree.get(consumer.id) + 1);
      }
    }
  }
  const queue = policies.filter(policy => indegree.get(policy.id) === 0).map(policy => policy.id);
  const ordered = [];
  while (queue.length) {
    const id = queue.shift();
    ordered.push(byId.get(id));
    for (const next of outgoing.get(id) || []) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  if (ordered.length !== policies.length) throw new Error('Active policy dependency graph contains a cycle. Deactivate the affected policies.');
  return ordered;
}

/** Receives only events that passed the project-property manifest filter. */
export async function handleFilteredIssueUpdate(event) {
  const changedFieldIds = new Set(event.changelog?.items?.map(item => item.fieldId).filter(Boolean) || []);
  const projectId = String(event.issue?.fields?.project?.id || event.issue?.project?.id || '');
  const stored = await kvs.get(POLICIES_KEY);
  const relationshipPolicies = (Array.isArray(stored) ? stored : []).filter(policy => policy.status === 'active' && policy.behaviorType === 'relationship');
  if (relationshipPolicies.some(policy => {
    const plan = policy.runtime.plan;
    const source = plan.sourceProjectIds.includes(projectId), target = plan.targetProjectIds.includes(projectId);
    return event.eventType === 'avi:jira:created:issue' ? source || target :
      (source && plan.sourceFieldIds.some(id => changedFieldIds.has(id))) || (target && plan.targetFieldIds.some(id => changedFieldIds.has(id)));
  })) await enqueueRelationshipEvent(event);
  const policies = (Array.isArray(stored) ? stored : []).filter(policy =>
    policy.status === 'active'
    && policy.behaviorType === 'assessment'
    && policy.projectIds.includes(projectId)
  );
  if (event.eventType === 'avi:jira:created:issue') {
    policies.forEach(policy => policy.runtime?.dependencyFieldIds?.forEach(id => changedFieldIds.add(id)));
  }
  try {
    for (const policy of topologicalPolicies(policies)) {
      if (!policy.runtime?.dependencyFieldIds?.some(fieldId => changedFieldIds.has(fieldId))) {
        await diagnostic(policy, event, 'unrelated-dependency', Date.now(), 0);
        continue;
      }
      if (await processPolicy(policy, event)) changedFieldIds.add(policy.targetFieldId);
    }
  } catch (error) {
    for (const policy of policies) await diagnostic(policy, event, 'dependency-graph-error', Date.now(), 0);
    console.error('Field Orchestrator rejected an invalid runtime dependency graph.', { projectId, message: error.message });
  }
}
