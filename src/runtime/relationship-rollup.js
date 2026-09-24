const MAX_FILTERS = 10;
const MAX_CANDIDATES = 500;
const MAX_DEPTH = 2;

const displayValue = value => {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return value.map(displayValue).sort().join('|');
  if (typeof value === 'object') return String(value.id ?? value.value ?? value.name ?? value.key ?? JSON.stringify(value));
  return String(value);
};

const fieldValue = (candidate, fieldId) => fieldId === 'statusCategory'
  ? candidate.statusCategory ?? candidate.fields?.status?.statusCategory?.name ?? candidate.fields?.status?.statusCategory?.key
  : candidate.fields?.[fieldId];

const isEmpty = value => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);

const equals = (actual, expected) => Array.isArray(actual)
  ? actual.map(displayValue).includes(String(expected))
  : displayValue(actual) === String(expected);

export function candidateMatches(candidate, filters = []) {
  if (filters.length > MAX_FILTERS) throw new Error('Too many relationship filters.');
  return filters.every(filter => {
    if (!['equals', 'notEquals', 'isEmpty', 'isNotEmpty'].includes(filter.operator)) throw new Error('Unsupported relationship filter operator.');
    const actual = fieldValue(candidate, filter.fieldId);
    if (filter.operator === 'isEmpty') return isEmpty(actual);
    if (filter.operator === 'isNotEmpty') return !isEmpty(actual);
    const matched = equals(actual, filter.value);
    return filter.operator === 'notEquals' ? !matched : matched;
  });
}

export function calculateRelationshipRollup({ candidates = [], filters = [], sourceFieldId, aggregation = 'sum' }) {
  // Never certify a partial total: bounds violations stop evaluation.
  if (candidates.length > MAX_CANDIDATES) throw new Error('Relationship exceeds 500 candidates; narrow the scope.');
  if (candidates.some(candidate => !Number.isInteger(candidate.depth ?? 0) || (candidate.depth ?? 0) < 0 || (candidate.depth ?? 0) > MAX_DEPTH)) throw new Error('Unsupported hierarchy depth.');
  if (!['sum', 'count', 'copy', 'min', 'max', 'union'].includes(aggregation)) throw new Error('Unsupported aggregation.');
  const bounded = [...new Map(candidates.map((candidate, index) => [candidate.key || index, candidate])).values()];
  const matching = bounded.filter(candidate => candidateMatches(candidate, filters));
  const values = matching.map(candidate => fieldValue(candidate, sourceFieldId));
  const present = values.filter(value => !isEmpty(value));
  const numeric = present.map(value => typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN);
  if (['sum', 'min', 'max'].includes(aggregation) && numeric.some(value => !Number.isFinite(value))) throw new Error('A source value is not numeric; no total was calculated.');

  if (aggregation === 'count') return { matching, contributingCount: matching.length, value: matching.length };
  if (aggregation === 'copy') {
    if (new Set(present.map(displayValue)).size > 1) throw new Error('Copy has multiple different values. Choose an aggregation.');
    const value = present[0];
    return { matching, contributingCount: value === undefined ? 0 : 1, value: value ?? null };
  }
  if (aggregation === 'min') return { matching, contributingCount: numeric.length, value: numeric.length ? Math.min(...numeric) : null };
  if (aggregation === 'max') return { matching, contributingCount: numeric.length, value: numeric.length ? Math.max(...numeric) : null };
  if (aggregation === 'union') {
    const unique = [...new Map(present.flatMap(value => Array.isArray(value) ? value : [value]).map(value => [displayValue(value), value])).values()];
    return { matching, contributingCount: unique.length, value: unique };
  }
  const total = numeric.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total)) throw new Error('Numeric rollup overflow.');
  return { matching, contributingCount: numeric.length, value: total };
}

export const relationshipLimits = Object.freeze({
  maxFilters: MAX_FILTERS,
  maxCandidates: MAX_CANDIDATES,
  maxDepth: MAX_DEPTH
});
