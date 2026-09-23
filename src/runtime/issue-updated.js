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
  const [storedRuns, policies] = await Promise.all([kvs.get(RUNS_KEY), kvs.get(POLICIES_KEY)]);
  await Promise.all([
    kvs.set(RUNS_KEY, [run, ...(Array.isArray(storedRuns) ? storedRuns : [])].slice(0, RUN_LIMIT)),
    kvs.set(POLICIES_KEY, (Array.isArray(policies) ? policies : []).map(item => item.id === policy.id ? { ...item, lastRunAt: createdAt, lastRunOutcome: outcome, lastRunTraceId: run.traceId } : item))
  ]);
  console.info('Field Orchestrator runtime trace.', run);
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
    if (evaluation?.value !== true) return false;

    jiraRequests += 1;
    const issue = await jiraJson(api.asApp().requestJira(route`/rest/api/3/issue/${event.issue.key}?fields=${policy.targetFieldId}`, { headers: { Accept: 'application/json' } }), 'Target value read');
    const currentValue = issue?.fields?.[policy.targetFieldId];
    const nextValue = policy.runtime.compiledTargetValue;
    if (displayValue(currentValue) === displayValue(nextValue)) return false;

    jiraRequests += 1;
    await jiraJson(api.asApp().requestJira(route`/rest/api/3/issue/${event.issue.key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ fields: { [policy.targetFieldId]: nextValue } })
    }), 'Target field update');
    await retainRun(policy, event, policy.protect ? 'restored' : 'changed', startedAt, jiraRequests, `${policy.targetFieldId} updated after Jira expression matched.`);
    return true;
  } catch (error) {
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
  const policies = (Array.isArray(stored) ? stored : []).filter(policy =>
    policy.status === 'active'
    && policy.behaviorType === 'assessment'
    && policy.projectIds.includes(projectId)
  );
  try {
    for (const policy of topologicalPolicies(policies)) {
      if (!policy.runtime?.dependencyFieldIds?.some(fieldId => changedFieldIds.has(fieldId))) continue;
      if (await processPolicy(policy, event)) changedFieldIds.add(policy.targetFieldId);
    }
  } catch (error) {
    console.error('Field Orchestrator rejected an invalid runtime dependency graph.', { projectId, message: error.message });
  }
}
