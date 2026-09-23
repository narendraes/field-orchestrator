import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, ButtonGroup, Checkbox, DynamicTable, Heading, HelperMessage, Inline,
  Label, Lozenge, SectionMessage, Select, Stack, Text, Textfield, xcss
} from '@forge/react';
import { invoke, requestJira } from '@forge/bridge';

const choice = (label, value = label) => ({ label, value });
const choices = values => values.map(value => choice(value));
const behaviorOptions = [
  choice('Field assessment', 'assessment'),
  choice('Hierarchy inheritance', 'hierarchy'),
  choice('Relationship rollup', 'relationship')
];
const aggregationOptions = [
  choice('Copy value', 'copy'), choice('Sum', 'sum'), choice('Count work items', 'count'),
  choice('Minimum', 'min'), choice('Maximum', 'max'), choice('Unique values', 'union')
];
const operatorOptions = [
  choice('equals', 'equals'), choice('does not equal', 'notEquals'),
  choice('is empty', 'isEmpty'), choice('is not empty', 'isNotEmpty')
];
const projectTypeName = type => ({
  software: 'Jira Software',
  service_desk: 'Jira Service Management',
  business: 'Jira Business',
  product_discovery: 'Jira Product Discovery'
}[type] || type || 'Other Jira');

// UI Kit primitives keep the layout native to Jira while allowing related
// controls to share a row. The minimum width makes each group wrap cleanly in
// a narrow admin panel instead of compressing its field beyond usability.
const cardStyles = xcss({
  backgroundColor: 'elevation.surface.raised',
  boxShadow: 'elevation.shadow.raised',
  borderRadius: 'border.radius',
  padding: 'space.200'
});
const columnStyles = xcss({
  display: 'block',
  flexGrow: 1,
  width: '48%',
  minWidth: '320px'
});
const compactColumnStyles = xcss({
  display: 'block',
  flexGrow: 1,
  width: '30%',
  minWidth: '240px'
});

function displayValue(value) {
  if (value === null || value === undefined || value === '') return 'Empty';
  if (Array.isArray(value)) return value.map(displayValue).join(', ') || 'Empty';
  if (typeof value === 'object') return value.name || value.value || value.key || JSON.stringify(value);
  return String(value);
}

function comparableValue(value) {
  return displayValue(value).trim().toLowerCase();
}

function issueFieldValue(issue, fieldId, statusCategories = {}) {
  if (fieldId === 'statusCategory') {
    const status = issue?.fields?.status;
    return status?.statusCategory?.name || statusCategories[String(status?.id)] || '';
  }
  return issue?.fields?.[fieldId];
}

function filterMatches(issue, filter, statusCategories = {}) {
  const value = issueFieldValue(issue, filter.fieldId, statusCategories);
  const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
  if (filter.operator === 'isEmpty') return empty;
  if (filter.operator === 'isNotEmpty') return !empty;
  const matches = comparableValue(value) === comparableValue(filter.value);
  return filter.operator === 'notEquals' ? !matches : matches;
}

function jqlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function jqlField(fieldId) {
  const customMatch = /^customfield_(\d+)$/.exec(fieldId);
  return customMatch ? `cf[${customMatch[1]}]` : fieldId;
}

function filterJql(filter) {
  const fieldId = jqlField(filter.fieldId);
  if (filter.operator === 'isEmpty') return `${fieldId} IS EMPTY`;
  if (filter.operator === 'isNotEmpty') return `${fieldId} IS NOT EMPTY`;
  return `${fieldId} ${filter.operator === 'notEquals' ? '!=' : '='} ${jqlString(filter.value)}`;
}

const blankPolicy = () => ({
  id: '', name: '', targetFieldId: '', projectIds: [], behaviorType: 'assessment',
  sourceFieldId: '', linkTypeId: '', relatedIssueTypeIds: [], hierarchyDepth: 0,
  aggregation: 'copy', conditionMatch: 'AND',
  conditions: [{ fieldId: '', operator: 'equals', value: '' }],
  filters: [],
  resultValue: '', protect: false, status: 'draft'
});

const hasCurrentValidation = policy => Boolean(policy.revision && policy.lastValidatedRevision === policy.revision && policy.lastValidatedKey);

function App() {
  const [page, setPage] = useState('Policies');
  const [fields, setFields] = useState([]);
  const [projects, setProjects] = useState([]);
  const [linkTypes, setLinkTypes] = useState([]);
  const [issueTypes, setIssueTypes] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [runs, setRuns] = useState([]);
  const [activationReview, setActivationReview] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [testKey, setTestKey] = useState('');
  const [targetOptions, setTargetOptions] = useState([]);
  const [targetOptionsLoading, setTargetOptionsLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [search, setSearch] = useState('');
  const [projectTypeFilter, setProjectTypeFilter] = useState('all');
  const [projectCategoryFilter, setProjectCategoryFilter] = useState('all');
  const [attempt, setAttempt] = useState(0);

  const field = id => fields.find(item => item.value === id);
  const fieldName = id => id === 'statusCategory' ? 'Status category' : field(id)?.name || id || '[field]';
  const projectName = id => projects.find(item => item.value === id)?.name || id;
  const selectValue = (items, value) => items.find(item => item.value === value) || null;
  const change = patch => {
    if (saving || previewing || draft?.status === 'active') return;
    setActivationReview(null); setPreview(null);
    setDraft(current => ({ ...current, ...patch, lastValidatedRevision: null }));
  };

  useEffect(() => {
    let cancelled = false;
    async function loadProjects() {
      const result = [];
      let startAt = 0;
      do {
        const response = await requestJira(`/rest/api/3/project/search?startAt=${startAt}&maxResults=50&orderBy=name`, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`Jira spaces returned ${response.status}.`);
        const data = await response.json();
        result.push(...(data.values || []));
        startAt += data.maxResults || 50;
        if (data.isLast || startAt >= (data.total || result.length)) break;
      } while (result.length < 500);
      return result;
    }
    async function loadFields() {
      const fieldResponse = await requestJira('/rest/api/3/field', { headers: { Accept: 'application/json' } });
      if (!fieldResponse.ok) throw new Error(`Jira fields returned ${fieldResponse.status}.`);
      const generallyVisible = await fieldResponse.json();

      // Jira's non-paginated field endpoint omits a newly created custom field
      // until it is associated with a used screen or field configuration. The
      // paginated custom-field endpoint includes those unused fields, so merge
      // both sources by stable field ID.
      const customFields = [];
      let startAt = 0;
      do {
        const response = await requestJira(`/rest/api/3/field/search?type=custom&startAt=${startAt}&maxResults=100&orderBy=name`, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`Jira custom fields returned ${response.status}.`);
        const data = await response.json();
        customFields.push(...(data.values || []));
        startAt += data.maxResults || 100;
        if (data.isLast || startAt >= (data.total || customFields.length)) break;
      } while (customFields.length < 1000);

      return [...new Map([...(Array.isArray(generallyVisible) ? generallyVisible : []), ...customFields]
        .filter(item => item?.id)
        .map(item => [item.id, item])).values()];
    }
    async function load() {
      setLoading(true); setError('');
      try {
        const [fieldData, projectData, linkResponse, issueTypeResponse, saved, savedRuns] = await Promise.all([
          loadFields(),
          loadProjects(),
          requestJira('/rest/api/3/issueLinkType', { headers: { Accept: 'application/json' } }),
          requestJira('/rest/api/3/issuetype', { headers: { Accept: 'application/json' } }),
          invoke('listPolicies'),
          invoke('listPolicyRuns')
        ]);
        if (!linkResponse.ok) throw new Error(`Jira link types returned ${linkResponse.status}.`);
        if (!issueTypeResponse.ok) throw new Error(`Jira work types returned ${issueTypeResponse.status}.`);
        const linkData = await linkResponse.json();
        const issueTypeData = await issueTypeResponse.json();
        const loadedFields = (Array.isArray(fieldData) ? fieldData : []).filter(item => item.id && item.name).map(item => ({
          value: item.id, name: item.name, custom: item.custom === true, schema: item.schema || {},
          label: `${item.name} · ${item.custom ? 'custom' : 'system'} · ${item.id}`
        })).sort((a, b) => Number(b.custom) - Number(a.custom) || a.name.localeCompare(b.name));
        const loadedProjects = projectData.map(item => ({
          value: item.id, name: item.name, key: item.key, type: item.projectTypeKey,
          typeName: projectTypeName(item.projectTypeKey),
          category: item.projectCategory?.name || 'No category',
          label: `${item.name} (${item.key}) · ${projectTypeName(item.projectTypeKey)} · ${item.projectCategory?.name || 'No category'}`
        }));
        const loadedLinks = (linkData.issueLinkTypes || []).map(item => ({
          ...item,
          value: item.id,
          // Jira's internal link-type name is primarily an administrator
          // concept. Show the relationship wording that users see in JQL and
          // REST data, while continuing to persist the stable type ID.
          label: item.outward === item.inward ? item.outward : `${item.outward} / ${item.inward}`
        }));
        const loadedIssueTypes = (Array.isArray(issueTypeData) ? issueTypeData : []).filter(item => item.id && item.name && !item.subtask).map(item => ({ value: item.id, name: item.name, label: item.name })).sort((a, b) => a.name.localeCompare(b.name));
        if (!cancelled) {
          setFields(loadedFields); setProjects(loadedProjects); setLinkTypes(loadedLinks); setIssueTypes(loadedIssueTypes);
          setPolicies(Array.isArray(saved) ? saved : []);
          setRuns(Array.isArray(savedRuns) ? savedRuns : []);
        }
      } catch (exception) {
        if (!cancelled) setError(exception.message || 'The Jira configuration could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [attempt]);

  function summary(policy) {
    const target = fieldName(policy.targetFieldId);
    if (policy.behaviorType === 'hierarchy') {
      return `Keep parent ${target} aligned from child ${fieldName(policy.sourceFieldId)}, one level up, using ${policy.aggregation}.`;
    }
    if (policy.behaviorType === 'relationship') {
      const link = linkTypes.find(item => item.id === policy.linkTypeId);
      const relation = link ? (link.outward === link.inward ? link.outward : `${link.outward} / ${link.inward}`) : '[relationship]';
      const workTypes = (policy.relatedIssueTypeIds || []).map(id => issueTypes.find(item => item.value === id)?.name || id).join(', ') || '[work type]';
      const depth = Number(policy.hierarchyDepth) === 2 ? 'including children and grandchildren' : Number(policy.hierarchyDepth) === 1 ? 'including children' : 'linked work items only';
      const source = policy.aggregation === 'count' ? 'work items' : fieldName(policy.sourceFieldId);
      const filters = (policy.filters || []).map(item => `${fieldName(item.fieldId)} ${item.operator}${['isEmpty', 'isNotEmpty'].includes(item.operator) ? '' : ` “${item.value || '[value]'}”`}`).join(' AND ');
      return `Set ${target} from the ${policy.aggregation} of ${source} on related ${workTypes} work using “${relation}” links in either direction, ${depth}${filters ? `, including only work where ${filters}` : ''}.`;
    }
    const conditions = policy.conditions.map(item => {
      const needsValue = !['isEmpty', 'isNotEmpty'].includes(item.operator);
      return `${fieldName(item.fieldId)} ${item.operator}${needsValue ? ` “${item.value || '[value]'}”` : ''}`;
    }).join(` ${policy.conditionMatch} `);
    return `Set ${target} to “${policy.resultValue || '[value]'}” when ${conditions || '[condition]'}.`;
  }

  function validate() {
    if (!draft.name.trim() || !draft.targetFieldId || draft.projectIds.length === 0) return 'Name the policy and choose a target field and at least one Jira or JPD space.';
    if (draft.behaviorType === 'assessment') {
      if (!draft.resultValue.trim() || draft.conditions.some(item => !item.fieldId || (!['isEmpty', 'isNotEmpty'].includes(item.operator) && !item.value.trim()))) return 'Complete every assessment condition and the target result.';
      if (draft.conditions.some(item => item.fieldId === draft.targetFieldId)) return 'A policy cannot read and write the same field. This would create a direct derived-field cycle.';
      const targetType = field(draft.targetFieldId)?.schema?.type;
      if (targetType === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(draft.resultValue)) return 'Date targets use YYYY-MM-DD, for example 2026-09-18.';
      if (targetType === 'datetime' && Number.isNaN(Date.parse(draft.resultValue))) return 'Date-time targets need a valid date and time with a timezone.';
    }
    if (draft.behaviorType === 'hierarchy' && !draft.sourceFieldId) return 'Choose the child field to inherit.';
    if (draft.behaviorType === 'relationship' && (!draft.linkTypeId || (draft.relatedIssueTypeIds || []).length === 0 || (draft.aggregation !== 'count' && !draft.sourceFieldId))) return 'Choose the relationship, related work type, and source field for this rollup.';
    if (draft.behaviorType === 'relationship' && (draft.filters || []).some(item => !item.fieldId || (!['isEmpty', 'isNotEmpty'].includes(item.operator) && !item.value.trim()))) return 'Complete every related-work filter or remove the unfinished filter.';
    if (['sum', 'min', 'max'].includes(draft.aggregation) && field(draft.sourceFieldId)?.schema?.type !== 'number') return 'Sum, minimum, and maximum require a numeric source field.';
    return '';
  }

  async function save() {
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const saved = await invoke('savePolicy', draft);
      setPolicies(current => [saved, ...current.filter(item => item.id !== saved.id)]);
      setDraft(saved); setPreview(null); setActivationReview(null); setNotice('Draft saved. Test and validate here before activation.');
    } catch (exception) {
      setError(exception.message || 'The draft could not be saved.');
    } finally { setSaving(false); }
  }

  async function removePolicy() {
    if (!deleteCandidate) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await invoke('deletePolicy', { id: deleteCandidate.id });
      setPolicies(current => current.filter(item => item.id !== deleteCandidate.id));
      setNotice(`Deleted “${deleteCandidate.name}”.`);
      setDeleteCandidate(null);
    } catch (exception) {
      setError(exception.message || 'The policy could not be deleted.');
    } finally { setSaving(false); }
  }

  async function setActivation(policy, active) {
    setSaving(true); setError(''); setNotice('');
    try {
      const updated = await invoke(active ? 'activatePolicy' : 'deactivatePolicy', active ? { id: policy.id, policyRevision: activationReview?.policyRevision, reviewToken: activationReview?.reviewToken } : { id: policy.id });
      setDraft(current => current?.id === updated.id ? updated : current);
      setActivationReview(null);
      setPolicies(current => current.map(item => item.id === updated.id ? updated : item));
      setNotice(active
        ? `“${updated.name}” is active. Qualifying Jira updates will now enforce it in the selected spaces.`
        : `“${updated.name}” is inactive. Its configuration and validation history were retained.`);
    } catch (exception) {
      setError(exception.message || `The policy could not be ${active ? 'activated' : 'deactivated'}.`);
    } finally { setSaving(false); }
  }

  async function jiraJson(path, metrics) {
    if (metrics) metrics.jiraRequests += 1;
    const response = await requestJira(path, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      const details = response.status === 404 ? 'Work item not found or not visible to you.' : `Jira returned ${response.status}.`;
      throw new Error(details);
    }
    return response.json();
  }

  async function searchIssues(jql, fieldIds, metrics) {
    const issues = [];
    let nextPageToken = '';
    do {
      const token = nextPageToken ? `&nextPageToken=${encodeURIComponent(nextPageToken)}` : '';
      const path = `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=100&fields=${encodeURIComponent(fieldIds.join(','))}${token}`;
      const data = await jiraJson(path, metrics);
      issues.push(...(Array.isArray(data.issues) ? data.issues : []));
      nextPageToken = data.nextPageToken || '';
    } while (nextPageToken && issues.length < 500);
    return issues;
  }

  async function loadTargetOptions() {
    const key = testKey.trim().toUpperCase();
    if (!key) { setError('Enter a representative work-item key before loading target options.'); return; }
    if (!draft?.targetFieldId) { setError('Choose a target field before loading options.'); return; }
    setTargetOptionsLoading(true); setError('');
    try {
      const editMetadata = await jiraJson(`/rest/api/3/issue/${encodeURIComponent(key)}/editmeta`);
      const metadata = editMetadata.fields?.[draft.targetFieldId];
      if (!metadata) throw new Error(`${fieldName(draft.targetFieldId)} is not editable or has no applicable context for ${key}.`);
      const allowedValues = Array.isArray(metadata.allowedValues) ? metadata.allowedValues : [];
      const loaded = allowedValues.map(option => ({
        value: String(option.id ?? option.value ?? option.name ?? option.label),
        label: String(option.value ?? option.name ?? option.label ?? option.id),
        optionId: option.id
      })).filter(option => option.value && option.label);
      setTargetOptions(loaded);
      if (loaded.length === 0) throw new Error(`Jira returned no allowed options for ${fieldName(draft.targetFieldId)} on ${key}.`);
    } catch (exception) {
      setTargetOptions([]);
      setError(exception.message || 'The target options could not be loaded.');
    } finally {
      setTargetOptionsLoading(false);
    }
  }

  function previewFields(policy) {
    const ids = new Set(['summary', 'project', 'issuetype', 'status', 'parent', 'issuelinks', policy.targetFieldId]);
    if (policy.sourceFieldId) ids.add(policy.sourceFieldId);
    [...(policy.conditions || []), ...(policy.filters || [])].forEach(item => {
      if (item.fieldId && item.fieldId !== 'statusCategory') ids.add(item.fieldId);
    });
    return [...ids];
  }

  async function resolveAssessmentTargetValue(issueKey, policy, metrics) {
    const schema = field(policy.targetFieldId)?.schema || {};
    const optionTarget = schema.type === 'option' || schema.items === 'option';
    if (!optionTarget) return policy.resultValue;

    const editMetadata = await jiraJson(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/editmeta`, metrics);
    const targetMetadata = editMetadata.fields?.[policy.targetFieldId];
    if (!targetMetadata) {
      throw new Error(`${fieldName(policy.targetFieldId)} is not editable or has no applicable context for ${issueKey}.`);
    }

    const allowedValues = Array.isArray(targetMetadata.allowedValues) ? targetMetadata.allowedValues : [];
    if (allowedValues.length === 0) {
      throw new Error(`Jira returned no allowed options for ${fieldName(policy.targetFieldId)} on ${issueKey}.`);
    }

    // The draft schema stores selected option labels as comma-separated text
    // for backward compatibility. Validation always resolves those labels
    // back to option IDs in the tested Jira context before accepting them.
    const requested = policy.resultValue.split(',').map(value => value.trim()).filter(Boolean);
    if (requested.length === 0) {
      throw new Error(`Enter at least one allowed ${fieldName(policy.targetFieldId)} option.`);
    }
    if (schema.type !== 'array' && requested.length !== 1) {
      throw new Error(`${fieldName(policy.targetFieldId)} accepts one option; enter exactly one allowed value.`);
    }

    const optionText = option => String(option?.value ?? option?.name ?? option?.label ?? option?.id ?? '').trim();
    const selected = requested.map(requestedValue => allowedValues.find(option =>
      [option?.id, option?.value, option?.name, option?.label]
        .filter(value => value !== null && value !== undefined)
        .some(value => String(value).trim().toLowerCase() === requestedValue.toLowerCase())
    ));
    const invalid = requested.filter((value, index) => !selected[index]);
    if (invalid.length > 0) {
      const examples = allowedValues.slice(0, 10).map(optionText).filter(Boolean).join(', ');
      throw new Error(`Invalid ${fieldName(policy.targetFieldId)} option: ${invalid.join(', ')}. Allowed values include: ${examples || 'none returned by Jira'}.`);
    }

    const normalized = selected.map(option => ({ id: option.id, value: option.value ?? option.name ?? option.label }));
    return schema.type === 'array' ? normalized : normalized[0];
  }

  function aggregateCandidates(policy, candidates) {
    const included = candidates.filter(item => item.included);
    if (policy.aggregation === 'count') return included.length;
    const values = included.map(item => item.rawValue).filter(value => value !== null && value !== undefined && value !== '');
    if (policy.aggregation === 'sum') return values.reduce((total, value) => total + (Number(value) || 0), 0);
    if (policy.aggregation === 'min') return values.length ? Math.min(...values.map(Number)) : null;
    if (policy.aggregation === 'max') return values.length ? Math.max(...values.map(Number)) : null;
    if (policy.aggregation === 'union') {
      const flattened = values.flatMap(value => Array.isArray(value) ? value : [value]);
      return [...new Map(flattened.map(value => [displayValue(value), value])).values()];
    }
    return values[0] ?? null;
  }

  async function runPreview() {
    if (!testKey.trim()) { setError('Enter a work-item key before testing.'); return; }
    const problem = validate();
    if (problem) { setError(problem); return; }
    if (draft.status === 'active') return;
    setSaving(true); setError(''); setNotice(''); setActivationReview(null);
    try {
      // Pass the saved snapshot directly; React state still holds the old revision.
      const saved = await invoke('savePolicy', draft);
      setDraft(saved);
      setPolicies(current => [saved, ...current.filter(item => item.id !== saved.id)]);
      await evaluatePreview(saved);
    } catch (exception) { setError(exception.message || 'Could not save and test.'); }
    finally { setSaving(false); }
  }

  async function evaluatePreview(draft) {
    const key = testKey.trim().toUpperCase();
    if (!key) { setPreview({ error: 'Enter a Jira or JPD work-item key.' }); return; }
    const configurationError = validate();
    if (configurationError) { setPreview({ error: `Complete the policy first: ${configurationError}` }); return; }
    const metrics = { startedAt: Date.now(), jiraRequests: 0 };
    const traceId = `fo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const showPreview = async result => {
      const validationMetrics = {
        durationMs: Date.now() - metrics.startedAt,
        jiraRequests: metrics.jiraRequests
      };
      setPreview({ ...result, metrics: validationMetrics, traceId, traceRetained: draft.id ? null : false });
      if (draft.id) {
        // Display the calculated result immediately. Trace persistence completes before activation readiness is granted;
        // the calculated preview can be displayed while that request finishes.
        await invoke('recordPolicyRun', {
            policyId: draft.id,
            policyRevision: draft.revision,
            configuration: draft,
            traceId,
            workItemKey: result.sourceKey || key,
            outcome: result.error ? 'error' : result.wouldChange ? 'would-change' : 'no-change',
            configuredTargetValue: result.configuredTargetValue,
            ...validationMetrics
          }).then(async run => {
          setRuns(current => [run, ...current.filter(item => item.traceId !== run.traceId)].slice(0, 50));
          setPolicies(current => current.map(item => item.id === draft.id && item.revision === run.policyRevision ? {
            ...item,
            lastRunAt: run.createdAt,
            lastRunOutcome: run.outcome,
            lastRunTraceId: run.traceId,
            lastValidatedRevision: run.outcome === 'error' ? null : run.policyRevision,
            lastValidatedKey: run.outcome === 'error' ? null : (result.sourceKey || key),
            lastValidatedValue: run.outcome === 'error' ? null : result.configuredTargetValue
          } : item));
          setPreview(current => current?.traceId === traceId ? { ...current, traceRetained: true } : current);
          const validated = { ...draft, lastValidatedRevision: result.error ? null : run.policyRevision, lastValidatedKey: result.error ? null : key };
          setDraft(current => current?.revision === run.policyRevision ? validated : current);
          if (!result.error && draft.behaviorType === 'assessment') {
            try {
              const review = await invoke('reviewPolicyActivation', { id: draft.id });
              setActivationReview(review);
            } catch (exception) { setError(exception.message || 'Activation readiness check failed.'); }
          }
        }).catch(() => {
          // A validation result remains useful even if its optional trace
          // cannot be retained. Surface this state beside the trace ID.
          setPreview(current => current?.traceId === traceId ? { ...current, traceRetained: false, traceFailed: true } : current);
        });
      }
    };
    setPreviewing(true); setPreview(null);
    try {
      const fieldIds = previewFields(draft);
      const source = await jiraJson(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${encodeURIComponent(fieldIds.join(','))}`, metrics);
      if (!draft.projectIds.includes(String(source.fields?.project?.id))) {
        await showPreview({ error: `${source.key} is outside this policy's selected Jira/JPD spaces.` });
        return;
      }

      if (draft.behaviorType === 'assessment') {
        const configuredTargetValue = await resolveAssessmentTargetValue(source.key, draft, metrics);
        const checks = draft.conditions.map(condition => ({
          label: `${fieldName(condition.fieldId)} ${condition.operator}${['isEmpty', 'isNotEmpty'].includes(condition.operator) ? '' : ` “${condition.value}”`}`,
          matched: filterMatches(source, condition),
          actual: displayValue(issueFieldValue(source, condition.fieldId))
        }));
        const matched = draft.conditionMatch === 'OR' ? checks.some(item => item.matched) : checks.every(item => item.matched);
        const currentValue = issueFieldValue(source, draft.targetFieldId);
        const computedValue = matched ? configuredTargetValue : currentValue;
        await showPreview({ type: 'assessment', sourceKey: source.key, affectedKey: source.key, checks, matched, currentValue, computedValue, configuredTargetValue, wouldChange: matched && comparableValue(currentValue) !== comparableValue(computedValue) });
        return;
      }

      if (draft.behaviorType === 'hierarchy') {
        const parentKey = source.fields?.parent?.key;
        if (!parentKey) { await showPreview({ error: `${source.key} has no direct parent to update.` }); return; }
        const parent = await jiraJson(`/rest/api/3/issue/${encodeURIComponent(parentKey)}?fields=${encodeURIComponent(fieldIds.join(','))}`, metrics);
        const sourceValue = issueFieldValue(source, draft.sourceFieldId);
        const currentValue = issueFieldValue(parent, draft.targetFieldId);
        const computedValue = draft.aggregation === 'union'
          ? [...new Map([...(Array.isArray(currentValue) ? currentValue : currentValue ? [currentValue] : []), ...(Array.isArray(sourceValue) ? sourceValue : sourceValue ? [sourceValue] : [])].map(value => [displayValue(value), value])).values()]
          : sourceValue;
        await showPreview({ type: 'hierarchy', sourceKey: source.key, affectedKey: parent.key, currentValue, computedValue, wouldChange: comparableValue(currentValue) !== comparableValue(computedValue) });
        return;
      }

      const linkedKeys = [...new Set((source.fields?.issuelinks || []).filter(link => String(link.type?.id) === String(draft.linkTypeId)).map(link => link.inwardIssue?.key || link.outwardIssue?.key).filter(Boolean))];
      const rootTypeClause = `issuetype in (${draft.relatedIssueTypeIds.map(jqlString).join(',')})`;
      const roots = linkedKeys.length ? await searchIssues(`key in (${linkedKeys.map(jqlString).join(',')}) AND ${rootTypeClause}`, ['issuetype', 'parent'], metrics) : [];
      const discovered = roots.map(issue => ({ issue, depth: 0 }));
      let parents = roots;
      for (let depth = 1; depth <= Number(draft.hierarchyDepth) && parents.length; depth += 1) {
        const parentKeys = parents.map(issue => jqlString(issue.key)).join(',');
        const children = await searchIssues(`parent in (${parentKeys})`, ['issuetype', 'parent'], metrics);
        discovered.push(...children.map(issue => ({ issue, depth })));
        parents = children;
      }
      const depthByKey = new Map(discovered.map(item => [item.issue.key, item.depth]));
      const discoveredKeys = [...depthByKey.keys()];
      const configuredFilters = (draft.filters || []).map(filterJql);
      const filterClause = configuredFilters.length ? ` AND ${configuredFilters.map(clause => `(${clause})`).join(' AND ')}` : '';
      const keyChunks = [];
      for (let index = 0; index < discoveredKeys.length; index += 50) keyChunks.push(discoveredKeys.slice(index, index + 50));
      const matchingGroups = await Promise.all(keyChunks.map(keys => searchIssues(`key in (${keys.map(jqlString).join(',')})${filterClause}`, fieldIds, metrics)));
      const matchingIssues = matchingGroups.flat();
      const candidates = matchingIssues.map(issue => {
        const rawValue = draft.aggregation === 'count' ? 1 : issueFieldValue(issue, draft.sourceFieldId);
        return { key: issue.key, workType: issue.fields?.issuetype?.name || '', depth: depthByKey.get(issue.key) || 0, included: true, rawValue, value: displayValue(rawValue) };
      });
      const currentValue = issueFieldValue(source, draft.targetFieldId);
      const computedValue = aggregateCandidates(draft, candidates);
      const contributingCount = candidates.filter(item => item.rawValue !== null && item.rawValue !== undefined && item.rawValue !== '').length;
      await showPreview({ type: 'relationship', aggregation: draft.aggregation, sourceKey: source.key, affectedKey: source.key, linkedCount: linkedKeys.length, rootCount: roots.length, traversedCount: discoveredKeys.length, candidates, contributingCount, currentValue, computedValue, wouldChange: comparableValue(currentValue) !== comparableValue(computedValue) });
    } catch (exception) {
      await showPreview({ error: exception.message || 'The policy test could not be completed.' });
    } finally { setPreviewing(false); }
  }

  function start(policy) {
    setActivationReview(null);
    setDraft(policy ? { ...policy, conditions: policy.conditions.map(item => ({ ...item })), filters: (policy.filters || []).map(item => ({ ...item })) } : blankPolicy());
    setError(''); setNotice(''); setTestKey(''); setPreview(null);
    setTargetOptions([]);
  }

  const customCount = fields.filter(item => item.custom).length;
  const targetField = draft ? field(draft.targetFieldId) : null;
  const targetIsOption = targetField?.schema?.type === 'option' || targetField?.schema?.items === 'option';
  const configuredTargetOptionNames = draft?.resultValue ? draft.resultValue.split(',').map(value => value.trim()).filter(Boolean) : [];
  const configuredTargetOptions = configuredTargetOptionNames.map(name => targetOptions.find(option => option.label.toLowerCase() === name.toLowerCase()) || choice(name));
  const projectTypeOptions = [choice('All types', 'all'), ...[...new Map(projects.map(project => [project.type, choice(project.typeName, project.type)])).values()].sort((a, b) => a.label.localeCompare(b.label))];
  const projectCategoryOptions = [choice('All categories', 'all'), ...[...new Set(projects.map(project => project.category))].sort().map(category => choice(category))];
  const filteredProjects = projects.filter(project =>
    (projectTypeFilter === 'all' || project.type === projectTypeFilter)
    && (projectCategoryFilter === 'all' || project.category === projectCategoryFilter)
  );
  const visiblePolicies = policies.filter(item => `${item.name} ${fieldName(item.targetFieldId)}`.toLowerCase().includes(search.toLowerCase()));
  const depthOptions = [choice('Linked work only', 0), choice('Children', 1), choice('Children and grandchildren', 2)];
  const filterFields = [{ value: 'statusCategory', name: 'Status category', custom: false, schema: { type: 'string' }, label: 'Status category · derived from Status' }, ...fields];

  return <Stack space="space.200">
    <Heading as="h1">Field Orchestrator</Heading>
    <Text>Define the desired state of a Jira or JPD field from conditions, hierarchy, or linked work.</Text>
    <SectionMessage title="Private runtime pilot" appearance="information"><Text>Validated field-assessment policies can be activated. Active policies use manifest filtering and Jira expressions, suppress unchanged writes, and record changes or errors. Hierarchy and relationship policies remain read-only drafts.</Text></SectionMessage>
    {notice && <SectionMessage title="Saved" appearance="success"><Text>{notice}</Text></SectionMessage>}
    {loading && <Text>Loading Jira and JPD configuration…</Text>}
    {!loading && error && !draft && <SectionMessage title="Could not load configuration" appearance="error"><Text>{error}</Text><Button onClick={() => setAttempt(value => value + 1)}>Retry</Button></SectionMessage>}
    {!loading && !error && <Inline alignBlock="center" spread="space-between"><Text>{customCount} custom fields, {projects.length} spaces, and {linkTypes.length} relationship types are available.</Text><Button onClick={() => setAttempt(value => value + 1)}>Refresh Jira metadata</Button></Inline>}
    <ButtonGroup>{['Policies', 'Executions', 'Settings'].map(name => <Button key={name} isDisabled={saving || previewing} appearance={page === name ? 'primary' : 'default'} onClick={() => { setPage(name); setActivationReview(null); setDraft(null); setDeleteCandidate(null); setError(''); }}>{name}</Button>)}</ButtonGroup>

    {draft ? <Stack space="space.200">
      <Inline alignBlock="center" spread="space-between"><Heading as="h2">{draft.id ? 'Edit field policy' : 'New field policy'}</Heading><Lozenge appearance={draft.status === 'active' ? 'success' : 'new'} isBold>{draft.status === 'active' ? 'Active' : hasCurrentValidation(draft) ? 'Validated' : 'Draft'}</Lozenge></Inline>
      <Box xcss={cardStyles}>
        <Stack space="space.150">
          <Inline alignBlock="center" space="space.100"><Lozenge appearance="moved">Step 1</Lozenge><Heading as="h3">Target and scope</Heading></Inline>
          <Text>Choose the field this policy owns and the Jira or JPD spaces where it applies.</Text>
          <Inline grow="fill" shouldWrap space="space.200" rowSpace="space.150">
            <Box xcss={columnStyles}><Label labelFor="policy-name">Policy name</Label><Textfield id="policy-name" value={draft.name} onChange={event => change({ name: event.target.value })} /><HelperMessage>Use a purpose-based name, such as “To-do points from delivery work”.</HelperMessage></Box>
            <Box xcss={columnStyles}><Label labelFor="target-field">Target field</Label><Select inputId="target-field" options={fields} value={selectValue(fields, draft.targetFieldId)} placeholder="Custom fields appear first" onChange={value => { setTargetOptions([]); change({ targetFieldId: value?.value || '', sourceFieldId: draft.sourceFieldId || value?.value || '', resultValue: '' }); }} /><HelperMessage>{targetField ? `${targetField.custom ? 'Custom' : 'System'} field · ${targetField.schema?.type || 'unknown'} value` : 'This is the field the policy will calculate or protect.'}</HelperMessage></Box>
          </Inline>
          <Inline grow="fill" shouldWrap space="space.200" rowSpace="space.150">
            <Box xcss={columnStyles}><Label labelFor="space-type-filter">Filter spaces by type</Label><Select inputId="space-type-filter" options={projectTypeOptions} value={selectValue(projectTypeOptions, projectTypeFilter)} onChange={value => setProjectTypeFilter(value?.value || 'all')} /></Box>
            <Box xcss={columnStyles}><Label labelFor="space-category-filter">Filter spaces by category</Label><Select inputId="space-category-filter" options={projectCategoryOptions} value={selectValue(projectCategoryOptions, projectCategoryFilter)} onChange={value => setProjectCategoryFilter(value?.value || 'all')} /></Box>
          </Inline>
          <Box><Label labelFor="spaces">Jira and JPD spaces</Label><Select inputId="spaces" isMulti options={filteredProjects} value={projects.filter(item => draft.projectIds.includes(item.value))} onChange={values => { const visibleIds = new Set(filteredProjects.map(item => item.value)); const hiddenSelections = draft.projectIds.filter(id => !visibleIds.has(id)); change({ projectIds: [...new Set([...hiddenSelections, ...(values || []).map(item => item.value)])] }); }} /><HelperMessage>Showing {filteredProjects.length} of {projects.length} spaces. Each option includes its type and category. Existing selections remain selected when filters change.</HelperMessage></Box>
        </Stack>
      </Box>

      <Box xcss={cardStyles}>
        <Stack space="space.150">
          <Inline alignBlock="center" space="space.100"><Lozenge appearance="inprogress">Step 2</Lozenge><Heading as="h3">Source path and evaluation</Heading></Inline>
          <Inline grow="fill" shouldWrap space="space.200" rowSpace="space.150">
            <Box xcss={columnStyles}><Label labelFor="behavior">Policy type</Label><Select inputId="behavior" options={behaviorOptions} value={selectValue(behaviorOptions, draft.behaviorType)} onChange={value => change({ behaviorType: value.value, aggregation: value.value === 'assessment' ? 'copy' : draft.aggregation })} /><HelperMessage>Controls whether the value comes from conditions, hierarchy, or related work.</HelperMessage></Box>
            {draft.behaviorType === 'relationship' && <Box xcss={columnStyles}><Label labelFor="link-type">Relationship type</Label><Select inputId="link-type" options={linkTypes} value={selectValue(linkTypes, draft.linkTypeId)} onChange={value => change({ linkTypeId: value?.value || '' })} /><HelperMessage>Matches this Jira link type in either direction.</HelperMessage></Box>}
          </Inline>

      {draft.behaviorType === 'assessment' && <Stack space="space.150">
        <SectionMessage appearance="discovery" title="How assessment works"><Text>The current work item is checked whenever one of the fields used below changes.</Text></SectionMessage>
        <Box xcss={columnStyles}><Label labelFor="condition-match">Combine conditions</Label><Select inputId="condition-match" options={choices(['AND', 'OR'])} value={choice(draft.conditionMatch)} onChange={value => change({ conditionMatch: value.value })} /><HelperMessage>AND requires every condition; OR requires any one condition.</HelperMessage></Box>
        {draft.conditions.map((condition, index) => <Stack key={index} space="space.100">
          <Inline grow="fill" shouldWrap space="space.150" rowSpace="space.100">
            <Box xcss={compactColumnStyles}><Label labelFor={`condition-field-${index}`}>Condition {index + 1} field</Label><Select inputId={`condition-field-${index}`} options={fields} value={selectValue(fields, condition.fieldId)} onChange={value => change({ conditions: draft.conditions.map((item, itemIndex) => itemIndex === index ? { ...item, fieldId: value?.value || '' } : item) })} /></Box>
            <Box xcss={compactColumnStyles}><Label labelFor={`operator-${index}`}>Operator</Label><Select inputId={`operator-${index}`} options={operatorOptions} value={selectValue(operatorOptions, condition.operator)} onChange={value => change({ conditions: draft.conditions.map((item, itemIndex) => itemIndex === index ? { ...item, operator: value.value } : item) })} /></Box>
            {!['isEmpty', 'isNotEmpty'].includes(condition.operator) && <Box xcss={compactColumnStyles}><Label labelFor={`condition-value-${index}`}>Comparison value</Label><Textfield id={`condition-value-${index}`} value={condition.value} onChange={event => change({ conditions: draft.conditions.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item) })} /></Box>}
            <Button appearance="subtle" aria-label={`Remove condition ${index + 1}`} isDisabled={draft.conditions.length === 1} onClick={() => change({ conditions: draft.conditions.filter((item, itemIndex) => itemIndex !== index) })}>✕</Button>
          </Inline>
        </Stack>)}
        <Button isDisabled={draft.conditions.length >= 10} onClick={() => change({ conditions: [...draft.conditions, { fieldId: '', operator: 'equals', value: '' }] })}>Add condition</Button>
        {targetIsOption ? <Stack space="space.100">
          <Inline grow="fill" shouldWrap space="space.150" rowSpace="space.100" alignBlock="end">
            <Box xcss={columnStyles}><Label labelFor="option-context-key">Representative work-item key</Label><Textfield id="option-context-key" placeholder="For example, ABC-123" value={testKey} onChange={event => { setTestKey(event.target.value); setTargetOptions([]); setPreview(null); }} /><HelperMessage>Jira option choices depend on the work item's project, type, and field context.</HelperMessage></Box>
            <Button isDisabled={targetOptionsLoading} onClick={loadTargetOptions}>{targetOptionsLoading ? 'Loading…' : 'Load allowed options'}</Button>
          </Inline>
          <Box xcss={columnStyles}><Label labelFor="result-value-options">Target value when conditions match</Label><Select inputId="result-value-options" isMulti={targetField?.schema?.type === 'array'} options={targetOptions} value={targetField?.schema?.type === 'array' ? configuredTargetOptions : configuredTargetOptions[0] || null} placeholder={targetOptions.length ? 'Choose allowed value' : 'Load allowed options first'} onChange={value => { const selected = targetField?.schema?.type === 'array' ? (value || []) : value ? [value] : []; change({ resultValue: selected.map(item => item.label).join(', ') }); }} /><HelperMessage>{targetField?.schema?.type === 'array' ? 'This multi-select target accepts one or more values from the tested Jira context.' : 'This single-select target accepts exactly one value from the tested Jira context.'}</HelperMessage></Box>
        </Stack> : <Box xcss={columnStyles}><Label labelFor="result-value">Target value when conditions match</Label><Textfield id="result-value" value={draft.resultValue} onChange={event => change({ resultValue: event.target.value })} /><HelperMessage>The value that will be written after all configured checks pass.</HelperMessage></Box>}
        {targetField?.schema?.type === 'date' && <Text>Use YYYY-MM-DD. Runtime date functions and relative dates will be added before activation.</Text>}
        {targetField?.schema?.type === 'datetime' && <Text>Use a date and time with a timezone, such as 2026-09-18T09:00:00-05:00.</Text>}
      </Stack>}

      {draft.behaviorType === 'hierarchy' && <Stack space="space.150">
        <SectionMessage appearance="discovery" title="How hierarchy inheritance works"><Text>When a child changes, the policy updates its direct parent. The MVP supports one parent level.</Text></SectionMessage>
        <Inline grow="fill" shouldWrap space="space.200" rowSpace="space.150">
          <Box xcss={columnStyles}><Label labelFor="hierarchy-source">Child source field</Label><Select inputId="hierarchy-source" options={fields} value={selectValue(fields, draft.sourceFieldId)} onChange={value => change({ sourceFieldId: value?.value || '' })} /><HelperMessage>The value is read from the changed child.</HelperMessage></Box>
          <Box xcss={columnStyles}><Label labelFor="hierarchy-evaluation">Evaluation</Label><Select inputId="hierarchy-evaluation" options={aggregationOptions.filter(item => ['copy', 'union'].includes(item.value))} value={selectValue(aggregationOptions, draft.aggregation)} onChange={value => change({ aggregation: value.value })} /><HelperMessage>Copy replaces the value; unique values combines list entries.</HelperMessage></Box>
        </Inline>
      </Stack>}

      {draft.behaviorType === 'relationship' && <Stack space="space.150">
        <SectionMessage appearance="discovery" title="How relationship rollups work"><Text>Find linked work of the selected type on either side of the relationship, optionally traverse its hierarchy, filter candidates, then calculate the target value.</Text></SectionMessage>
        <Inline grow="fill" shouldWrap space="space.200" rowSpace="space.150">
          <Box xcss={columnStyles}><Label labelFor="related-work-types">Related work type</Label><Select inputId="related-work-types" isMulti options={issueTypes} value={issueTypes.filter(item => (draft.relatedIssueTypeIds || []).includes(item.value))} onChange={values => change({ relatedIssueTypeIds: (values || []).map(item => item.value) })} /><HelperMessage>Only linked roots with these Jira work types start the traversal.</HelperMessage></Box>
          <Box xcss={columnStyles}><Label labelFor="depth">Hierarchy beneath linked work</Label><Select inputId="depth" options={depthOptions} value={depthOptions.find(item => item.value === Number(draft.hierarchyDepth))} onChange={value => change({ hierarchyDepth: value.value })} /><HelperMessage>Choose whether to include the linked root, children, or grandchildren.</HelperMessage></Box>
        </Inline>
        <Inline grow="fill" shouldWrap space="space.200" rowSpace="space.150">
          <Box xcss={columnStyles}><Label labelFor="aggregation">Evaluation</Label><Select inputId="aggregation" options={aggregationOptions} value={selectValue(aggregationOptions, draft.aggregation)} onChange={value => change({ aggregation: value.value })} /><HelperMessage>Sum is appropriate for Story Points; count ignores the source field.</HelperMessage></Box>
          {draft.aggregation !== 'count' && <Box xcss={columnStyles}><Label labelFor="rollup-source">Source field on related work</Label><Select inputId="rollup-source" options={fields} value={selectValue(fields, draft.sourceFieldId)} onChange={value => change({ sourceFieldId: value?.value || '' })} /><HelperMessage>This value is read from each candidate included in the calculation.</HelperMessage></Box>}
        </Inline>
        <Inline alignBlock="center" space="space.100"><Heading as="h3">Related-work filters</Heading><Lozenge>{String((draft.filters || []).length)} filters</Lozenge></Inline>
        <Text>Filters run before aggregation. With no filters, every candidate work item is included.</Text>
        {(draft.filters || []).map((filter, index) => <Stack key={index} space="space.100">
          <Inline grow="fill" shouldWrap space="space.150" rowSpace="space.100">
            <Box xcss={compactColumnStyles}><Label labelFor={`filter-field-${index}`}>Filter {index + 1} field</Label><Select inputId={`filter-field-${index}`} options={filterFields} value={selectValue(filterFields, filter.fieldId)} onChange={value => change({ filters: draft.filters.map((item, itemIndex) => itemIndex === index ? { ...item, fieldId: value?.value || '' } : item) })} /></Box>
            <Box xcss={compactColumnStyles}><Label labelFor={`filter-operator-${index}`}>Operator</Label><Select inputId={`filter-operator-${index}`} options={operatorOptions} value={selectValue(operatorOptions, filter.operator)} onChange={value => change({ filters: draft.filters.map((item, itemIndex) => itemIndex === index ? { ...item, operator: value.value } : item) })} /></Box>
            {!['isEmpty', 'isNotEmpty'].includes(filter.operator) && <Box xcss={compactColumnStyles}><Label labelFor={`filter-value-${index}`}>Filter value</Label>{filter.fieldId === 'statusCategory' ? <Select inputId={`filter-value-${index}`} options={choices(['To Do', 'In Progress', 'Done'])} value={filter.value ? choice(filter.value) : null} onChange={value => change({ filters: draft.filters.map((item, itemIndex) => itemIndex === index ? { ...item, value: value?.value || '' } : item) })} /> : <Textfield id={`filter-value-${index}`} value={filter.value} onChange={event => change({ filters: draft.filters.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item) })} />}</Box>}
            <Button appearance="subtle" aria-label={`Remove filter ${index + 1}`} onClick={() => change({ filters: draft.filters.filter((item, itemIndex) => itemIndex !== index) })}>✕</Button>
          </Inline>
        </Stack>)}
        <Button isDisabled={(draft.filters || []).length >= 10} onClick={() => change({ filters: [...(draft.filters || []), { fieldId: '', operator: 'equals', value: '' }] })}>Add related-work filter</Button>
      </Stack>}
        </Stack>
      </Box>

      <Box xcss={cardStyles}>
        <Stack space="space.150">
          <Inline alignBlock="center" space="space.100"><Lozenge appearance="success">Step 3</Lozenge><Heading as="h3">Enforcement and review</Heading></Inline>
          <Checkbox label="Protect the computed target from external changes" isChecked={draft.protect} onChange={event => change({ protect: event.target.checked })} />
          <HelperMessage>For active assessment policies, an external target edit is restored when the configured conditions still match. If they do not match, the app leaves the value unchanged.</HelperMessage>
          <SectionMessage title="Policy summary" appearance="information"><Text>{summary(draft)}</Text><Text>Scope: {draft.projectIds.map(projectName).join(', ') || 'choose at least one space'}.</Text></SectionMessage>
          <Inline alignBlock="center" space="space.100"><Heading as="h3">Test policy</Heading><Lozenge appearance="inprogress">Read only</Lozenge></Inline>
          <Text>Enter a representative Jira or JPD key to calculate the outcome using live data. Testing saves your draft first and does not update Jira work items.</Text>
          <Inline grow="fill" shouldWrap space="space.150" rowSpace="space.100" alignBlock="end">
            <Box xcss={columnStyles}><Label labelFor="test-key">Work-item key</Label><Textfield id="test-key" placeholder="For example, ABC-123" value={testKey} onChange={event => { setTestKey(event.target.value); setTargetOptions([]); setPreview(null); }} /><HelperMessage>The work item must be in one of the selected spaces and visible to you.</HelperMessage></Box>
            <Button appearance="primary" isDisabled={previewing || saving || draft.status === 'active'} onClick={runPreview}>{previewing || saving ? 'Validating…' : 'Save & validate'}</Button>
          </Inline>
          {preview?.error && <SectionMessage title="Validation could not run" appearance="error"><Text>{preview.error}</Text></SectionMessage>}
          {preview && !preview.error && <Stack space="space.150">
            <SectionMessage title={preview.wouldChange ? 'Validation passed — value would change' : 'Validation passed — no change needed'} appearance={preview.wouldChange ? 'warning' : 'success'}>
              <Text>Tested: {preview.sourceKey}. Affected work item: {preview.affectedKey}.</Text>
              {preview.type === 'relationship' && <Text>Found {preview.linkedCount} matching links and {preview.rootCount} matching related roots. Traversed {preview.traversedCount} keys with minimal fields; Jira returned {preview.candidates.length} work items matching the configured filters.</Text>}
              {preview.type === 'relationship' && preview.aggregation !== 'count' && preview.candidates.length > 0 && preview.contributingCount === 0 && <Text>The matching work items have no source-field value, so the calculated sum is 0.</Text>}
              {preview.type === 'relationship' && preview.candidates.length > 10 && <Text>Showing the first 10 matches. Refine the policy filters to inspect a smaller result set.</Text>}
              {preview.type === 'assessment' && <Text>Conditions {preview.matched ? 'matched' : 'did not match'}.</Text>}
              <Text>Current target: {displayValue(preview.currentValue)}. Calculated target: {displayValue(preview.computedValue)}.</Text>
            </SectionMessage>
            {preview.type === 'relationship' && <DynamicTable head={{ cells: ['Matching work item', 'Type', 'Depth', 'Source value'].map(item => ({ key: item, content: item })) }} rows={preview.candidates.slice(0, 10).map(item => ({ key: item.key, cells: [
              { content: item.key }, { content: item.workType }, { content: item.depth === 0 ? 'Linked root' : item.depth === 1 ? 'Child' : 'Grandchild' }, { content: item.value }
            ] }))} emptyView={<Text>No work items matched the configured filters.</Text>} rowsPerPage={10} />}
            {preview.type === 'assessment' && <DynamicTable head={{ cells: ['Condition', 'Actual value', 'Outcome'].map(item => ({ key: item, content: item })) }} rows={preview.checks.map((item, index) => ({ key: String(index), cells: [
              { content: item.label }, { content: item.actual }, { content: <Lozenge appearance={item.matched ? 'success' : 'removed'}>{item.matched ? 'Matched' : 'Not matched'}</Lozenge> }
            ] }))} rowsPerPage={10} />}
          </Stack>}
          {preview?.metrics && <SectionMessage title="Validation usage" appearance="information"><Text>Response time: {(preview.metrics.durationMs / 1000).toFixed(2)} seconds. Jira REST requests: {preview.metrics.jiraRequests}. Trace ID: {preview.traceId}.</Text><Text>{preview.traceRetained === true ? 'This trace is retained in Executions and emitted to Forge logs.' : preview.traceRetained === null ? 'The result is complete; its trace is being retained in the background.' : preview.traceFailed ? 'The result is complete, but its trace could not be retained.' : 'Save the policy before testing to retain its trace in Executions and Forge logs.'}</Text><Text>Estimated Forge charge: $0.00 while this app remains within its monthly free allowances. A retained test uses one resolver invocation, two KVS reads, two KVS writes, and one small log record; it does not invoke the policy event runtime or write Jira data.</Text></SectionMessage>}
        </Stack>
      </Box>
      {draft.status === 'active' && <SectionMessage title="Active policy" appearance="success"><Text>Deactivate this policy before changing its configuration.</Text></SectionMessage>}
      {activationReview && <SectionMessage title="Ready to activate" appearance="success"><Text>Dependencies: {activationReview.dependencyFieldIds.map(fieldName).join(', ')}. New work items are included. Estimated Jira requests per policy evaluation: 1–3.</Text><Text>Upstream policies: {activationReview.upstreamPolicies.join(', ') || 'None'}. Downstream policies: {activationReview.downstreamPolicies.join(', ') || 'None'}. Review expires after 15 minutes.</Text></SectionMessage>}
      {error && <SectionMessage title="Check the policy" appearance="error"><Text>{error}</Text></SectionMessage>}
      <ButtonGroup>
        <Button isDisabled={saving || previewing || draft.status === 'active'} onClick={save}>Save draft</Button>
        <Button appearance="primary" isDisabled={saving || previewing || draft.status === 'active'} onClick={runPreview}>Save & validate</Button>
        {draft.status === 'active' ? <Button isDisabled={saving || previewing} onClick={() => setActivation(draft, false)}>Deactivate</Button> : <Button appearance="primary" isDisabled={saving || previewing || !activationReview || !hasCurrentValidation(draft)} onClick={() => setActivation(draft, true)}>Activate</Button>}
        <Button isDisabled={saving || previewing} onClick={() => { setDraft(null); setError(''); setActivationReview(null); }}>Back to policies</Button>
      </ButtonGroup>
    </Stack> : page === 'Policies' ? <Stack space="space.200">
      <Heading as="h2">Field policies</Heading>
      <Text>Create and manage every field rule from one place. Each row shows its target, scope, protection, and lifecycle status.</Text>
      <SectionMessage title="Example policies to try" appearance="discovery">
        <Text>JPD rollup: set a JPD number field to the sum of Story Points from “implements / is implemented by” Features, include children, and filter Status category = To Do. Test with the JPD idea key.</Text>
        <Text>Parent inheritance: copy Fix Version from a Story to its direct parent. Test with a Story key that has a parent and a Fix Version.</Text>
        <Text>Health assessment: set a custom Health field to “At Risk” when Flagged equals Impediment or a PDLC phase field is empty. Test with a work item that meets the condition.</Text>
      </SectionMessage>
      <Button appearance="primary" onClick={() => start(null)}>Create field policy</Button>
      <Textfield aria-label="Search policies" placeholder="Search by policy or target field" value={search} onChange={event => setSearch(event.target.value)} />
      <DynamicTable head={{ cells: ['Policy', 'Target field', 'Type', 'Spaces', 'Protection', 'Status', 'Last run', 'Last change', 'Actions'].map(item => ({ key: item, content: item })) }} rows={visiblePolicies.map(policy => ({ key: policy.id, cells: [
        { content: policy.name }, { content: fieldName(policy.targetFieldId) }, { content: behaviorOptions.find(item => item.value === policy.behaviorType)?.label || policy.behaviorType },
        { content: String(policy.projectIds.length) }, { content: policy.protect ? 'Restore' : 'Off' }, { content: <Lozenge appearance={policy.status === 'active' ? 'success' : hasCurrentValidation(policy) ? 'inprogress' : 'default'}>{policy.status === 'active' ? 'Active' : hasCurrentValidation(policy) ? 'Validated' : 'Draft'}</Lozenge> },
        { content: policy.lastRunAt ? new Date(policy.lastRunAt).toLocaleString() : 'Never' },
        { content: new Date(policy.updatedAt).toLocaleString() }, { content: <ButtonGroup><Button onClick={() => start(policy)}>{policy.status === 'active' ? 'Open' : 'Edit'}</Button><Button appearance="danger" isDisabled={policy.status === 'active'} onClick={() => { setDeleteCandidate(policy); setError(''); }}>Delete</Button></ButtonGroup> }

      ] }))} emptyView={<Text>No saved policies match this view.</Text>} rowsPerPage={10} />
      {deleteCandidate && <SectionMessage title="Delete this policy?" appearance="warning"><Text>“{deleteCandidate.name}” will be permanently removed from this private app installation.</Text><ButtonGroup><Button appearance="danger" isDisabled={saving} onClick={removePolicy}>{saving ? 'Deleting…' : 'Confirm delete'}</Button><Button onClick={() => setDeleteCandidate(null)}>Cancel</Button></ButtonGroup></SectionMessage>}
      {error && <SectionMessage title="Policy action failed" appearance="error"><Text>{error}</Text></SectionMessage>}
    </Stack> : page === 'Executions' ? <Stack space="space.150"><Heading as="h2">Executions</Heading><Text>Saved validation traces and automatic runtime changes, restorations, and errors appear here. Unchanged runtime outcomes are intentionally not stored.</Text><DynamicTable head={{ cells: ['Time', 'Policy', 'Work item', 'Outcome', 'Response', 'Jira requests', 'Trace ID'].map(item => ({ key: item, content: item })) }} rows={runs.map(run => ({ key: run.traceId, cells: [
      { content: new Date(run.createdAt).toLocaleString() }, { content: run.policyName }, { content: run.workItemKey || '—' }, { content: run.outcome }, { content: `${(run.durationMs / 1000).toFixed(2)} s` }, { content: String(run.jiraRequests) }, { content: run.traceId }
    ] }))} emptyView={<Text>No retained validation traces yet. Save a policy, open it, and run validation.</Text>} rowsPerPage={10} /><Text>History is bounded to the latest 50 traces. Search the Forge development logs for a Trace ID to correlate the backend record.</Text></Stack> : <Stack space="space.150"><Heading as="h2">Settings</Heading><Text>Private development app. Public distribution remains disabled.</Text><Text>Goal, OKR, and pull-request integrations are parked for a later release.</Text><Text>Free usage remains a design target; activation requires measured event volume and storage use.</Text></Stack>}
  </Stack>;
}

ForgeReconciler.render(<App />);
