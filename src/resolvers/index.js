import Resolver from '@forge/resolver';
import { projectDependencies, jiraAccess, calculateTarget, filterClause } from '../runtime/relationship-worker';
import { compileRelationshipPlan, traceRelationshipTargets } from '../runtime/relationship-routing';
import { kvs } from '@forge/kvs';
import api, { route } from '@forge/api';

const resolver = new Resolver();
const POLICIES_KEY = 'field-policies:v1';
const RUNS_KEY = 'policy-runs:v1';
const POLICY_LIMIT = 100;
const RUN_LIMIT = 50;
const MAX_CHAIN_DEPTH = 10;
const RUNTIME_PROPERTY = 'field-orchestrator-runtime-v1';
const BEHAVIOR_TYPES = new Set(['assessment', 'hierarchy', 'relationship']);

const text = (value, limit = 255) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const stringList = (value, limit = 100) => Array.isArray(value)
  ? [...new Set(value.map(item => text(item, 100)).filter(Boolean))].slice(0, limit)
  : [];

const jsonValue = (value, limit = 20) => {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, limit).map(item => jsonValue(item, limit));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, limit).map(([key, item]) => [text(key, 80), jsonValue(item, limit)]));
  return null;
};

const jiraJson = async (request, description, expectJson = true) => {
  const response = await request;
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${description} failed (${response.status})${body ? `: ${body.slice(0, 300)}` : '.'}`);
  }
  // Successful command endpoints can return an empty 200/201 as well as 204.
  // Only data-reading callers require a JSON body; HTTP failures still throw.
  return !expectJson || response.status === 204 ? null : response.json();
};

const isOptionSchema = schema => schema?.type === 'option' || schema?.items === 'option';
const expressionAccess = fieldId => `issue[${JSON.stringify(fieldId)}]`;
const emptyExpression = (access, schema) => schema?.type === 'array'
  ? `(${access} == null || ${access}.length == 0)`
  : `(${access} == null)`;

function comparisonExpression(access, schema, rawValue) {
  if (schema?.type === 'number') return `${access} == ${Number(rawValue)}`;
  const literal = JSON.stringify(String(rawValue));
  if (schema?.type === 'array' && schema?.items === 'option') return `(${access} != null && ${access}.map(item => item.value).includes(${literal}))`;
  if (schema?.type === 'option') return `(${access} != null && ${access}.value == ${literal})`;
  return `${access} == ${literal}`;
}

function compileCondition(condition, schema) {
  const access = expressionAccess(condition.fieldId);
  if (condition.operator === 'isEmpty') return emptyExpression(access, schema);
  if (condition.operator === 'isNotEmpty') return `!${emptyExpression(access, schema)}`;
  const equals = comparisonExpression(access, schema, condition.value);
  return condition.operator === 'notEquals' ? `!(${equals})` : `(${equals})`;
}

function normalizedTargetValue(schema, validatedValue) {
  if (isOptionSchema(schema)) {
    const values = (Array.isArray(validatedValue) ? validatedValue : [validatedValue]).filter(Boolean).map(item => ({ id: String(item.id || '') })).filter(item => item.id);
    if (values.length === 0) throw new Error('Run validation again so Jira option IDs can be compiled before activation.');
    return schema.type === 'array' ? values : values[0];
  }
  if (schema?.type === 'number') {
    const value = Number(validatedValue);
    if (!Number.isFinite(value)) throw new Error('The target value is not a valid number.');
    return value;
  }
  return validatedValue;
}

function dependencyGraph(policies, projectId) {
  const scoped = policies.filter(policy => policy.status === 'active' && policy.projectIds.includes(String(projectId)));
  const edges = new Map(scoped.map(policy => [policy.id, []]));
  for (const source of scoped) {
    for (const consumer of scoped) {
      if (source.id !== consumer.id && consumer.runtime?.dependencyFieldIds?.includes(source.targetFieldId)) {
        edges.get(source.id).push(consumer.id);
      }
    }
  }
  return { scoped, edges };
}

function validateDependencyGraph(policies, projectIds) {
  for (const projectId of projectIds) {
    const { scoped, edges } = dependencyGraph(policies, projectId);
    const names = new Map(scoped.map(policy => [policy.id, policy.name]));
    const visiting = new Set();
    const visited = new Set();
    const path = [];
    const visit = (id, depth) => {
      if (depth > MAX_CHAIN_DEPTH) throw new Error(`The derived-field chain in project ${projectId} exceeds ${MAX_CHAIN_DEPTH} policies.`);
      if (visiting.has(id)) {
        const start = path.indexOf(id);
        const cycle = [...path.slice(start), id].map(item => names.get(item) || item).join(' → ');
        throw new Error(`Activation would create a derived-field cycle in project ${projectId}: ${cycle}.`);
      }
      if (visited.has(id)) return;
      visiting.add(id); path.push(id);
      for (const next of edges.get(id) || []) visit(next, depth + 1);
      path.pop(); visiting.delete(id); visited.add(id);
    };
    for (const policy of scoped) visit(policy.id, 1);
  }
}

// Resolver input is untrusted, even though this function is reached from an
// administrator page. Persist only the small, explicit draft schema that the
// runtime will understand later; never store arbitrary objects from the UI.
function validatePolicy(input) {
  const behaviorType = text(input?.behaviorType, 32);
  const targetFieldId = text(input?.targetFieldId, 100);
  const projectIds = stringList(input?.projectIds);

  if (!targetFieldId || !BEHAVIOR_TYPES.has(behaviorType)) {
    throw new Error('Choose a target field and a supported policy type.');
  }

  if (projectIds.length === 0) {
    throw new Error('Choose at least one Jira or JPD space.');
  }

  const policy = {
    id: text(input?.id, 80) || crypto.randomUUID(),
    name: text(input?.name, 120) || 'Untitled field policy',
    targetFieldId,
    projectIds,
    behaviorType,
    sourceProjectIds: stringList(input?.sourceProjectIds),
    sourceFieldId: text(input?.sourceFieldId, 100),
    linkTypeId: text(input?.linkTypeId, 100),
    relatedIssueTypeIds: stringList(input?.relatedIssueTypeIds, 50),
    hierarchyDepth: Math.min(2, Math.max(0, Number(input?.hierarchyDepth) || 0)),
    aggregation: ['copy', 'sum', 'count', 'min', 'max', 'union'].includes(input?.aggregation) ? input.aggregation : 'copy',
    conditionMatch: input?.conditionMatch === 'OR' ? 'OR' : 'AND',
    conditions: Array.isArray(input?.conditions) ? input.conditions.slice(0, 10).map(condition => ({
      fieldId: text(condition?.fieldId, 100),
      operator: ['equals', 'notEquals', 'isEmpty', 'isNotEmpty'].includes(condition?.operator) ? condition.operator : 'equals',
      value: text(condition?.value, 500)
    })).filter(condition => condition.fieldId) : [],
    // Relationship filters are evaluated against each candidate related work
    // item before its value participates in the rollup. statusCategory is a
    // supported virtual path derived from fields.status.statusCategory.
    filters: Array.isArray(input?.filters) ? input.filters.slice(0, 10).map(filter => ({
      fieldId: text(filter?.fieldId, 100),
      operator: ['equals', 'notEquals', 'isEmpty', 'isNotEmpty'].includes(filter?.operator) ? filter.operator : 'equals',
      value: text(filter?.value, 500)
    })).filter(filter => filter.fieldId) : [],
    resultValue: text(input?.resultValue, 500),
    protect: input?.protect === true,
    revision: crypto.randomUUID(),
    status: 'draft',
    updatedAt: new Date().toISOString()
  };

  if (behaviorType === 'assessment' && policy.conditions.length === 0) {
    throw new Error('Assessment policies need at least one condition.');
  }
  if (behaviorType !== 'assessment' && behaviorType !== 'relationship' && !policy.sourceFieldId) {
    throw new Error('Choose the field to inherit.');
  }
  if (behaviorType === 'relationship' && (!policy.linkTypeId || policy.relatedIssueTypeIds.length === 0 || (policy.aggregation !== 'count' && !policy.sourceFieldId))) {
    throw new Error('Choose a relationship, at least one related work type, and a source field unless the calculation counts work items.');
  }
  if (behaviorType === 'assessment' && !policy.resultValue) {
    throw new Error('Enter the target value for a matching assessment.');
  }

  return policy;
}

async function readPolicies() {
  const value = await kvs.get(POLICIES_KEY);
  return Array.isArray(value) ? value : [];
}

async function diagnosticPolicy(payload) {
  const permission = await jiraJson(api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`, { headers: { Accept: 'application/json' } }), 'Checking administrator permission');
  if (!permission?.permissions?.ADMINISTER?.havePermission) throw new Error('Jira administrator permission is required for diagnostics.');
  const policy = (await readPolicies()).find(item => item.id === payload?.id);
  if (!policy) throw new Error('Policy not found.');
  return policy;
}

resolver.define('setPolicyDiagnostics', async ({ payload }) => {
  const policy = await diagnosticPolicy(payload);
  const setting = { until: payload.enabled === true ? Date.now() + 24 * 60 * 60 * 1000 : 0 };
  await kvs.set(`diagnostics:v1:${policy.id}`, setting);
  return setting;
});

resolver.define('getPolicyDiagnostics', async ({ payload }) => {
  const policy = await diagnosticPolicy(payload);
  const setting = await kvs.get(`diagnostics:v1:${policy.id}`);
  const records = await Promise.all(Array.from({ length: 20 }, (_, slot) => kvs.get(`diagnostic-run:v1:${policy.id}:${slot}`)));
  return { until: setting?.until || 0, status: policy.status, behaviorType: policy.behaviorType,
    records: records.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
});

resolver.define('clearPolicyDiagnostics', async ({ payload }) => {
  const policy = await diagnosticPolicy(payload);
  await kvs.set(`diagnostics:v1:${policy.id}`, { until: 0 });
  await Promise.all(Array.from({ length: 20 }, (_, slot) => kvs.delete(`diagnostic-run:v1:${policy.id}:${slot}`)));
  return { until: 0, records: [] };
});

resolver.define('traceRelationshipSource', async ({ payload }) => {
  const policy = await diagnosticPolicy(payload);
  const key = text(payload?.sourceKey, 80).toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/.test(key)) throw new Error('Enter a source work-item key such as ABC-123.');
  const plan = compileRelationshipPlan(policy);
  let jiraRequests = 0;
  const startedAt = Date.now();
  const readIssue = async (issueKey, fields) => {
    jiraRequests += 1;
    return jiraJson(api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}?fields=${fields.join(',')}`, { headers: { Accept: 'application/json' } }), 'Reading source hierarchy');
  };
  const searchIssues = async (jql, fields, limit) => {
    jiraRequests += 1;
    const result = await jiraJson(api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql, fields, maxResults: limit + 1 })
    }), 'Finding affected targets');
    if (result.nextPageToken || result.isLast === false || (result.issues || []).length > limit) throw new Error('Routing search is incomplete; narrow the policy.');
    return result.issues || [];
  };
  const result = await traceRelationshipTargets(plan, key, { readIssue, searchIssues });
  return { ...result, plan, sourceKey: key, jiraRequests, durationMs: Date.now() - startedAt,
    note: 'Read-only routing from current visible Jira links. This does not activate the policy, write a field, or prove deleted-link or old-parent coverage.' };
});

resolver.define('listPolicies', async () => {
  const policies = await readPolicies();
  return Promise.all(policies.map(async policy => { const latest = await kvs.get(`policy-last-run:v1:${policy.id}`); return latest?.lastRunAt > (policy.lastRunAt || '') ? { ...policy, ...latest } : policy; }));
});

resolver.define('listPolicyRuns', async () => {
  const value = await kvs.get(RUNS_KEY);
  const related = (await readPolicies()).filter(policy => policy.behaviorType === 'relationship' && policy.activatedAt);
  const samples = await Promise.all(related.flatMap(policy => Array.from({ length: 20 }, (_, slot) => kvs.get(`relationship-run:v1:${policy.id}:${slot}`))));
  return [...(Array.isArray(value) ? value : []), ...samples.filter(Boolean)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
});

resolver.define('savePolicy', async ({ payload }) => {
  const policy = validatePolicy(payload);
  const current = await readPolicies();
  const existing = current.find(item => item.id === policy.id);
  if (existing?.status === 'active') throw new Error('Deactivate this policy before editing it.');
  if (!existing && current.length >= POLICY_LIMIT) {
    throw new Error(`The private MVP supports up to ${POLICY_LIMIT} policies.`);
  }

  // Configuration edits must not erase the independently maintained run
  // metadata displayed in the policy list.
  const storedPolicy = existing ? {
    ...policy,
    lastRunAt: existing.lastRunAt,
    lastRunOutcome: existing.lastRunOutcome,
    lastRunTraceId: existing.lastRunTraceId
  } : policy;
  const next = [...current.filter(item => item.id !== policy.id), storedPolicy]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  await kvs.set(POLICIES_KEY, next);
  return storedPolicy;
});

resolver.define('deletePolicy', async ({ payload }) => {
  const id = text(payload?.id, 80);
  if (!id) throw new Error('A policy ID is required.');
  const current = await readPolicies();
  const existing = current.find(item => item.id === id);
  if (existing?.status === 'active') throw new Error('Deactivate the policy before deleting it.');
  const next = current.filter(item => item.id !== id);
  if (next.length === current.length) throw new Error('The policy no longer exists. Refresh the page and try again.');
  await kvs.set(POLICIES_KEY, next);
  return { id };
});

resolver.define('recordPolicyRun', async ({ payload }) => {
  const policyId = text(payload?.policyId, 80);
  const traceId = text(payload?.traceId, 80);
  const policies = await readPolicies();
  const policy = policies.find(item => item.id === policyId);
  if (!policy || !traceId) throw new Error('Save the policy before retaining its validation trace.');
  if (!policy.revision || payload?.policyRevision !== policy.revision) throw new Error('Save and validate the current revision.');
  const configuration = validatePolicy(payload.configuration);
  const keys = Object.keys(configuration).filter(key => !['revision', 'updatedAt', 'status'].includes(key));
  if (keys.some(key => JSON.stringify(configuration[key]) !== JSON.stringify(policy[key]))) throw new Error('Save the edited configuration before validation.');


  const run = {
    traceId,
    policyId,
    policyName: policy.name,
    workItemKey: text(payload?.workItemKey, 40),
    outcome: ['would-change', 'no-change', 'error'].includes(payload?.outcome) ? payload.outcome : 'error',
    durationMs: Math.max(0, Math.min(300000, Number(payload?.durationMs) || 0)),
    jiraRequests: Math.max(0, Math.min(1000, Number(payload?.jiraRequests) || 0)),
    createdAt: new Date().toISOString(),
    kind: 'validation',
    policyRevision: policy.revision
  };

  const currentRuns = await kvs.get(RUNS_KEY);
  const nextRuns = [run, ...(Array.isArray(currentRuns) ? currentRuns : [])].slice(0, RUN_LIMIT);
  const nextPolicies = policies.map(item => item.id === policyId ? {
    ...item,
    lastRunAt: run.createdAt,
    lastRunOutcome: run.outcome,
    lastRunTraceId: run.traceId,
    lastValidatedRevision: run.outcome === 'error' ? null : policy.revision,
    lastValidatedKey: run.outcome === 'error' ? null : run.workItemKey,
    lastValidatedValue: run.outcome === 'error' ? null : jsonValue(payload?.configuredTargetValue)
  } : item);

  await kvs.set(RUNS_KEY, nextRuns);
  await kvs.set(POLICIES_KEY, nextPolicies);
  console.info('Field Orchestrator policy trace.', run);
  return run;
});

async function writeProjectIndex(projectId, policies) {
  const projection = projectDependencies(String(projectId), policies);
  if (!projection.active) {
    const response = await api.asUser().requestJira(route`/rest/api/3/project/${projectId}/properties/${RUNTIME_PROPERTY}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw new Error(`Removing the runtime index for project ${projectId} failed (${response.status}).`);
    return;
  }
  await jiraJson(api.asUser().requestJira(route`/rest/api/3/project/${projectId}/properties/${RUNTIME_PROPERTY}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(projection)
  }), `Updating the runtime index for project ${projectId}`, false);
}

async function prepareActivation(policy, policies) {
  if (!policy) throw new Error('The policy no longer exists.');
  if (!['assessment', 'relationship'].includes(policy.behaviorType)) throw new Error('Hierarchy activation is not implemented.');
  if (!policy.revision || policy.lastValidatedRevision !== policy.revision || !policy.lastValidatedKey) throw new Error('Run a successful validation on a representative work item before activation.');
  const conflict = policies.find(item => item.id !== policy.id && item.status === 'active' && item.targetFieldId === policy.targetFieldId && item.projectIds.some(id => policy.projectIds.includes(id)));
  if (conflict) throw new Error(`“${conflict.name}” already owns this target field in an overlapping space.`);

  const fields = await jiraJson(api.asUser().requestJira(route`/rest/api/3/field`, { headers: { Accept: 'application/json' } }), 'Loading Jira field metadata');
  const schemaById = new Map((Array.isArray(fields) ? fields : []).map(field => [field.id, field.schema || {}]));
  const targetSchema = schemaById.get(policy.targetFieldId) || {};
  if (policy.behaviorType === 'relationship') {
    const permission = await jiraJson(api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`), 'Administrator permission');
    if (!permission.permissions?.ADMINISTER?.havePermission) throw new Error('Jira administrator permission required.');
    if (!['sum', 'count', 'min', 'max'].includes(policy.aggregation) || targetSchema.type !== 'number') throw new Error('The relationship pilot supports numeric targets and sum/count/min/max only.');
    if (policy.aggregation !== 'count' && schemaById.get(policy.sourceFieldId)?.type !== 'number') throw new Error('Choose a numeric source field.');
    const plan = compileRelationshipPlan(policy);
    (policy.filters || []).forEach(filterClause);
    if (plan.sourceFieldIds.includes(policy.targetFieldId)) throw new Error('A relationship target cannot also be its source or filter field.');
    const activeRelations = policies.filter(item => item.id !== policy.id && item.status === 'active' && item.behaviorType === 'relationship');
    if (activeRelations.length >= 5) throw new Error('The private pilot supports at most five active relationship policies.');
    for (const other of policies.filter(item => item.id !== policy.id && item.status === 'active')) {
      const reads = other.runtime?.plan?.sourceFieldIds || other.runtime?.dependencyFieldIds || [];
      if (reads.includes(policy.targetFieldId) || plan.sourceFieldIds.includes(other.targetFieldId)) throw new Error('Relationship chaining is not supported in this pilot. Deactivate the connected policy first.');
    }
    const activePolicy = { ...policy, status: 'active', activatedAt: new Date().toISOString(), runtime: { plan: { ...plan, activationReady: true }, dependencyFieldIds: [...plan.sourceFieldIds, ...plan.targetFieldIds], targetSchema } };
    const jira = jiraAccess(true);
    // Activation validates the representative context; each runtime target is
    // checked independently before writing. Project size is not an eligibility rule.
    const metadata = await jira.editmeta(policy.lastValidatedKey);
    if (metadata.fields?.[policy.targetFieldId]?.schema?.type !== 'number') throw new Error('Target field must be editable and numeric on the representative work item.');
    await calculateTarget(activePolicy, policy.lastValidatedKey, jira);
    return { activePolicy, next: policies.map(item => item.id === policy.id ? activePolicy : item) };
  }
  const unsupportedCondition = policy.conditions.find(condition => ['date', 'datetime'].includes(schemaById.get(condition.fieldId)?.type));
  if (unsupportedCondition) throw new Error('Date and date-time condition comparisons are not activation-ready yet.');
  const pieces = policy.conditions.map(condition => compileCondition(condition, schemaById.get(condition.fieldId) || {}));
  const expression = pieces.map(piece => `(${piece})`).join(policy.conditionMatch === 'OR' ? ' || ' : ' && ');
  const dependencyFieldIds = [...new Set([...policy.conditions.map(condition => condition.fieldId), ...(policy.protect ? [policy.targetFieldId] : [])])];
  if (policies.some(item => item.status === 'active' && item.behaviorType === 'relationship' && (item.runtime.plan.sourceFieldIds.includes(policy.targetFieldId) || dependencyFieldIds.includes(item.targetFieldId)))) throw new Error('Assessment/relationship chaining is not supported in this pilot.');
  const compiledTargetValue = normalizedTargetValue(targetSchema, policy.lastValidatedValue);
  const activatedAt = new Date().toISOString();
  const activePolicy = { ...policy, status: 'active', activatedAt, runtime: { expression, dependencyFieldIds, targetSchema, compiledTargetValue } };
  const next = policies.map(item => item.id === policy.id ? activePolicy : item);
  const directDependency = policy.conditions.some(condition => condition.fieldId === policy.targetFieldId);
  if (directDependency) throw new Error('This policy reads and writes the same field, which would create a direct cycle. Choose a different condition or target field.');
  validateDependencyGraph(next, policy.projectIds);
  return { activePolicy, next };
}

resolver.define('reviewPolicyActivation', async ({ payload }) => {
  const policies = await readPolicies();
  const policy = policies.find(item => item.id === payload.id);
  const { activePolicy } = await prepareActivation(policy, policies);
  const review = { policyId: policy.id, policyRevision: policy.revision, reviewToken: crypto.randomUUID(), expiresAt: Date.now() + 15 * 60 * 1000 };
  await kvs.set(`activation-review:v1:${policy.id}`, review);
  return { ...review, dependencyFieldIds: activePolicy.runtime.dependencyFieldIds, projectIds: policy.projectIds, targetFieldId: policy.targetFieldId, protectionEnabled: policy.protect, createdIssuesIncluded: true, chainLimit: MAX_CHAIN_DEPTH,
    upstreamPolicies: policies.filter(item => item.status === 'active' && item.id !== policy.id && item.projectIds.some(id => policy.projectIds.includes(id)) && activePolicy.runtime.dependencyFieldIds.includes(item.targetFieldId)).map(item => item.name),
    downstreamPolicies: policies.filter(item => item.status === 'active' && item.id !== policy.id && item.projectIds.some(id => policy.projectIds.includes(id)) && item.runtime?.dependencyFieldIds.includes(policy.targetFieldId)).map(item => item.name),
    updateJiraRequests: policy.behaviorType === 'relationship' ? { maximumPerPolicyJob: 250 } : { noMatch: 1, matchNoChange: 2, changed: 3 } };
});

resolver.define('activatePolicy', async ({ payload }) => {
  const policies = await readPolicies();
  const policy = policies.find(item => item.id === payload.id);
  const review = await kvs.get(`activation-review:v1:${payload.id}`);
  if (!policy || !review || review.reviewToken !== payload.reviewToken || review.policyRevision !== policy.revision || payload.policyRevision !== policy.revision || !Number.isFinite(review.expiresAt) || review.expiresAt <= Date.now()) throw new Error('Review the current revision again; activation review is missing or expired.');
  const { activePolicy, next } = await prepareActivation(policy, policies);
  for (const projectId of [...new Set([...policy.projectIds, ...(policy.sourceProjectIds || [])])]) await writeProjectIndex(projectId, next);
  await kvs.set(POLICIES_KEY, next);
  await kvs.delete(`activation-review:v1:${policy.id}`);
  return activePolicy;
});

resolver.define('deactivatePolicy', async ({ payload }) => {
  const policyId = text(payload?.id, 80);
  const policies = await readPolicies();
  const policy = policies.find(item => item.id === policyId);
  if (!policy) throw new Error('The policy no longer exists.');
  const inactive = { ...policy, status: 'validated', deactivatedAt: new Date().toISOString() };
  delete inactive.runtime;
  const next = policies.map(item => item.id === policy.id ? inactive : item);
  for (const projectId of [...new Set([...policy.projectIds, ...(policy.sourceProjectIds || [])])]) await writeProjectIndex(projectId, next);
  await kvs.set(POLICIES_KEY, next);
  return inactive;
});

export const handler = resolver.getDefinitions();
