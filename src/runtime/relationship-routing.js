// Pure compilation and bounded reverse traversal shared by diagnostic routing
// and the future event worker. This module never activates policies or writes Jira.
const unique = values => [...new Set(values.map(String))];
const quote = value => JSON.stringify(String(value));

export function compileRelationshipPlan(policy) {
  if (policy.behaviorType !== 'relationship') throw new Error('Choose a relationship policy.');
  if (!policy.sourceProjectIds?.length || !policy.projectIds?.length) throw new Error('Select source and target spaces.');
  if (!policy.linkTypeId || !policy.relatedIssueTypeIds?.length) throw new Error('Select a relationship and root work types.');
  if (!Number.isInteger(policy.hierarchyDepth) || policy.hierarchyDepth < 0 || policy.hierarchyDepth > 2) throw new Error('Hierarchy depth must be 0, 1 or 2.');
  if (policy.aggregation !== 'count' && !policy.sourceFieldId) throw new Error('Choose a source field.');
  const sourceFieldIds = unique([
    ...(policy.aggregation === 'count' ? [] : [policy.sourceFieldId]),
    ...(policy.filters || []).map(filter => filter.fieldId === 'statusCategory' ? 'status' : filter.fieldId),
    'parent', 'issuetype'
  ].filter(Boolean));
  return { policyId: policy.id, policyRevision: policy.revision,
    targetFieldId: policy.targetFieldId, linkTypeId: String(policy.linkTypeId),
    sourceProjectIds: unique(policy.sourceProjectIds), targetProjectIds: unique(policy.projectIds),
    relatedIssueTypeIds: unique(policy.relatedIssueTypeIds), hierarchyDepth: policy.hierarchyDepth,
    sourceFieldIds, targetFieldIds: policy.protect ? [policy.targetFieldId] : [],
    // Link events resolve source-side project properties. Index both endpoint
    // scopes so either direction of the relationship is covered.
    linkProjectIds: unique([...policy.sourceProjectIds, ...policy.projectIds]),
    maxTargets: 50, activationReady: false };
}

export async function traceRelationshipTargets(plan, sourceKey, { readIssue, searchIssues }) {
  const ancestors = [];
  const visited = new Set();
  let key = sourceKey;
  // Do not apply source-value or status filters during reverse routing: a work
  // item leaving a filter still requires recalculation of its former aggregate.
  for (let depth = 0; key && depth <= plan.hierarchyDepth; depth += 1) {
    if (visited.has(key)) throw new Error('Cyclic hierarchy encountered; routing incomplete.');
    visited.add(key);
    const issue = await readIssue(key, ['project', 'parent', 'issuelinks']);
    if (!plan.sourceProjectIds.includes(String(issue.fields?.project?.id))) {
      if (depth === 0) throw new Error('The source item is outside the selected source spaces.');
      break;
    }
    ancestors.push({ ...issue, depth });
    key = issue.fields?.parent?.key;
  }
  if (!ancestors.length) return { ancestors: [], targets: [] };
  // Root type filtering is evaluated by Jira, not by a field-value JavaScript gate.
  const roots = await searchIssues(`key in (${ancestors.map(item => quote(item.key)).join(',')}) AND issuetype in (${plan.relatedIssueTypeIds.map(quote).join(',')})`, ['project'], 3);
  const rootKeys = new Set(roots.map(item => item.key));
  const targetRoots = new Map();
  for (const ancestor of ancestors.filter(item => rootKeys.has(item.key))) {
    for (const link of ancestor.fields?.issuelinks || []) {
      if (String(link.type?.id) !== plan.linkTypeId) continue;
      const targetKey = link.inwardIssue?.key || link.outwardIssue?.key;
      if (!targetKey) continue;
      if (!targetRoots.has(targetKey)) targetRoots.set(targetKey, []);
      targetRoots.get(targetKey).push({ key: ancestor.key, depth: ancestor.depth });
    }
  }
  // Fail rather than certify partial routing. This also bounds query size.
  if (targetRoots.size > plan.maxTargets) throw new Error('More than 50 linked targets; narrow the policy.');
  const targets = targetRoots.size ? await searchIssues(`key in (${[...targetRoots.keys()].map(quote).join(',')}) AND project in (${plan.targetProjectIds.map(quote).join(',')})`, ['project'], plan.maxTargets) : [];
  return { ancestors: ancestors.map(item => ({ key: item.key, depth: item.depth })),
    targets: targets.map(item => ({ key: item.key, projectId: String(item.fields?.project?.id), roots: targetRoots.get(item.key) })) };
}
