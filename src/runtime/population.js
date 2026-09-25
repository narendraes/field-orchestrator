import { kvs } from '@forge/kvs';
import { Queue } from '@forge/events';
import { jiraAccess, calculateTarget } from './relationship-worker';

const queue = new Queue({ key: 'population-jobs' });
const runKey = id => `population:v1:${id}`;
const pageKey = (id, page) => `population-page:v1:${id}:${page}`;
const pointerKey = id => `population-current:v1:${id}`;
const quote = value => JSON.stringify(String(value));
export const readPopulation = id => kvs.get(runKey(id));
export async function latestPopulation(policyId) {
  const id = await kvs.get(pointerKey(policyId));
  return id ? readPopulation(id) : null;
}
export async function queuePopulation(id, extra = {}) {
  await queue.push({ body: { populationId: id, ...extra }, concurrency: { key: 'relationship-writes-v1', limit: 1 }, delayInSeconds: 2 });
}

// Structured selections prevent arbitrary JQL injection. Dates refer to creation
// of the target (not its linked source), using Jira's querying timezone.
export function populationSelection(policy, input = {}) {
  if (!['all', 'keys', 'dates'].includes(input.mode)) throw new Error('Choose all targets, target keys, or a creation-date range.');
  const clauses = [`project in (${policy.projectIds.map(quote).join(',')})`];
  if (input.mode === 'keys') {
    const keys = [...new Set(String(input.keys || '').toUpperCase().split(/[\s,]+/).filter(Boolean))];
    if (!keys.length || keys.length > 100 || keys.some(key => !/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/.test(key))) throw new Error('Enter 1–100 valid target keys separated by spaces or commas.');
    clauses.push(`key in (${keys.map(quote).join(',')})`);
  }
  if (input.mode === 'dates') {
    const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if (!valid(input.from) || !valid(input.to) || input.from > input.to) throw new Error('Enter a valid inclusive creation-date range (YYYY-MM-DD).');
    const exclusiveEnd = new Date(Date.parse(input.to) + 86400000).toISOString().slice(0, 10);
    clauses.push(`created >= ${quote(input.from)} AND created < ${quote(exclusiveEnd)}`);
  }
  const excludeDone = policy.skipDoneTargets === true || input.includeDone !== true;
  if (excludeDone) clauses.push('statusCategory != Done');
  return { jql: clauses.join(' AND ') + ' ORDER BY key', excludeDone };
}

export async function createPopulation(policy, input) {
  const selection = populationSelection(policy, input);
  const previous = await latestPopulation(policy.id);
  const run = { id: crypto.randomUUID(), policyId: policy.id, revision: policy.revision, ...selection,
    phase: 'preparing', total: 0, pages: 0, page: 0, offset: 0, updated: 0, unchanged: 0, skipped: 0,
    createdAt: new Date().toISOString(), expiresAt: Date.now() + 60 * 60 * 1000 };
  await kvs.set(runKey(run.id), run);
  await kvs.set(pointerKey(policy.id), run.id);
  try {
    if (previous) await queuePopulation(previous.id, { cleanup: true, cleanupPage: 0 });
    await queuePopulation(run.id);
  } catch (_) { run.phase = 'error'; run.resumePhase = 'preparing'; run.error = 'Could not start preparation. Retry remaining.'; await kvs.set(runKey(run.id), run); }
  return run;
}

export async function startPopulation(run) {
  const policy = (await kvs.get('field-policies:v1') || []).find(item => item.id === run.policyId);
  run.activatedAt = policy?.activatedAt || '';
  run.phase = 'running';
  await kvs.set(runKey(run.id), run);
  try { await queuePopulation(run.id); }
  catch (_) { run.phase = 'error'; run.resumePhase = 'running'; run.error = 'Could not queue population. Use Retry remaining.'; await kvs.set(runKey(run.id), run); }
  return run;
}

const comparable = value => {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(comparable).sort().join('|');
  if (typeof value === 'object') return String(value.id ?? value.value ?? value.name ?? JSON.stringify(value));
  return String(value);
};

export async function runPopulationJob({ body }) {
  const run = await readPopulation(body.populationId);
  if (!run) return;
  if (body.cleanup) {
    if (await kvs.get(pointerKey(run.policyId)) === run.id) return;
    const page = body.cleanupPage || 0;
    // Delete obsolete snapshots in small batches, without touching current runs.
    for (let index = page; index < Math.min(page + 25, run.pages); index += 1) await kvs.delete(pageKey(run.id, index));
    if (page + 25 < run.pages) await queuePopulation(run.id, { cleanup: true, cleanupPage: page + 25 });
    else await kvs.delete(runKey(run.id));
    return;
  }
  if (!['preparing', 'running'].includes(run.phase)) return;
  if (await kvs.get(pointerKey(run.policyId)) !== run.id) return;
  const policy = (await kvs.get('field-policies:v1') || []).find(item => item.id === run.policyId);
  if (!policy || policy.revision !== run.revision || (run.phase === 'running' && (policy.status !== 'active' || (policy.activatedAt || '') !== run.activatedAt))) {
    run.phase = 'cancelled'; await kvs.set(runKey(run.id), run); return;
  }
  const jira = jiraAccess();
  try {
    if (run.phase === 'preparing') {
      if (Date.now() > run.expiresAt) throw new Error('Preparation expired. Prepare the selection again.');
      const page = await jira.searchTargetPage(run.jql, run.nextPageToken);
      await kvs.set(pageKey(run.id, run.pages), page.targets.map(item => item.key));
      run.pages += 1; run.total += page.targets.length; run.nextPageToken = page.nextPageToken || null;
      if (!run.nextPageToken) run.phase = 'ready';
    } else {
      const keys = await kvs.get(pageKey(run.id, run.page));
      if (!Array.isArray(keys)) throw new Error('Prepared target list unavailable. Prepare a new run.');
      const key = keys[run.offset];
      if (key) {
        run.currentKey = key;
        const eligibility = `${JSON.stringify(policy.projectIds)}.includes((issue.project.id + ''))${run.excludeDone || policy.skipDoneTargets ? " && issue.status.category.key != 'done'" : ''}`;
        // Jira evaluates scope and Done exclusions server-side, returning a Boolean.
        if (!await jira.evaluate(key, eligibility)) run.skipped += 1;
        else {
          let current, value, matches = true;
          if (policy.behaviorType === 'relationship') ({ current, value } = await calculateTarget(policy, key, jira));
          else {
            matches = await jira.evaluate(key, policy.runtime.expression);
            if (matches) { current = (await jira.readIssue(key, [policy.targetFieldId])).fields?.[policy.targetFieldId]; value = policy.runtime.compiledTargetValue; }
          }
          if (!matches) run.skipped += 1;
          else if (comparable(current) === comparable(value)) run.unchanged += 1;
          else {
            const metadata = await jira.editmeta(key);
            if (!metadata.fields?.[policy.targetFieldId]) throw new Error(`Target field is not editable on ${key}.`);
            const latest = (await kvs.get('field-policies:v1') || []).find(item => item.id === policy.id);
            if (latest?.status !== 'active' || latest.revision !== run.revision || (latest.activatedAt || '') !== run.activatedAt) { run.phase = 'cancelled'; await kvs.set(runKey(run.id), run); return; }
            // Recheck immediately before writing because scope/status can change.
            if (!await jira.evaluate(key, eligibility)) run.skipped += 1;
            else { await jira.write(key, policy.targetFieldId, value); run.updated += 1; }
          }
        }
        run.offset += 1;
      }
      if (run.offset >= keys.length) { run.page += 1; run.offset = 0; }
      if (run.page >= run.pages) run.phase = 'complete';
    }
    run.error = ''; run.lastUpdatedAt = new Date().toISOString();
    await kvs.set(runKey(run.id), run);
    if (['running', 'preparing'].includes(run.phase)) await queuePopulation(run.id);
  } catch (error) {
    // Pause at the failed target; retry resumes with current Jira values. State
    // and Jira writes cannot be transactional, so a retry may report unchanged.
    run.resumePhase = run.phase; run.phase = 'error'; run.error = String(error.message).slice(0, 300);
    await kvs.set(runKey(run.id), run);
  }
}
