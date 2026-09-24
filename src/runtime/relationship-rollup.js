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
  return filters.slice(0, MAX_FILTERS).every(filter => {
    const actual = fieldValue(candidate, filter.fieldId);
    if (filter.operator === 'isEmpty') return isEmpty(actual);
    if (filter.operator === 'isNotEmpty') return !isEmpty(actual);
    const matched = equals(actual, filter.value);
    return filter.operator === 'notEquals' ? !matched : matched;
  });
}

export function calculateRelationshipRollup({ candidates = [], filters = [], sourceFieldId, aggregation = 'sum' }) {
  const bounded = candidates.filter(candidate => Number(candidate.depth ?? 0) <= MAX_DEPTH).slice(0, MAX_CANDIDATES);
  const matching = bounded.filter(candidate => candidateMatches(candidate, filters));
  const values = matching.map(candidate => fieldValue(candidate, sourceFieldId));
  const numeric = values.filter(value => !isEmpty(value)).map(Number).filter(Number.isFinite);

  if (aggregation === 'count') return { matching, contributingCount: matching.length, value: matching.length };
  if (aggregation === 'copy') {
    const value = values.find(item => !isEmpty(item));
    return { matching, contributingCount: value === undefined ? 0 : 1, value: value ?? null };
  }
  if (aggregation === 'min') return { matching, contributingCount: numeric.length, value: numeric.length ? Math.min(...numeric) : 0 };
  if (aggregation === 'max') return { matching, contributingCount: numeric.length, value: numeric.length ? Math.max(...numeric) : 0 };
  if (aggregation === 'union') {
    const unique = [...new Set(values.flatMap(value => Array.isArray(value) ? value.map(displayValue) : [displayValue(value)]).filter(Boolean))];
    return { matching, contributingCount: unique.length, value: unique };
  }
  return { matching, contributingCount: numeric.length, value: numeric.reduce((total, value) => total + value, 0) };
}

export const relationshipLimits = Object.freeze({
  maxFilters: MAX_FILTERS,
  maxCandidates: MAX_CANDIDATES,
  maxDepth: MAX_DEPTH
});
