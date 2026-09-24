const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function load() {
  const context = vm.createContext({});
  const module = new vm.SourceTextModule(fs.readFileSync('src/runtime/relationship-rollup.js', 'utf8'), { context });
  await module.link(() => {});
  await module.evaluate();
  return module.namespace;
}

test('rolls up only To Do Features through bounded descendants', async () => {
  const { calculateRelationshipRollup } = await load();
  const result = calculateRelationshipRollup({
    filters: [{ fieldId: 'statusCategory', operator: 'equals', value: 'To Do' }],
    sourceFieldId: 'storyPoints',
    aggregation: 'sum',
    candidates: [
      { key: 'ABC-1', depth: 0, statusCategory: 'In Progress', fields: { storyPoints: 8 } },
      { key: 'ABC-2', depth: 1, statusCategory: 'To Do', fields: { storyPoints: 3 } },
      { key: 'ABC-3', depth: 2, statusCategory: 'To Do', fields: { storyPoints: null } }
    ]
  });
  assert.equal(result.value, 3);
  assert.deepEqual(Array.from(result.matching, item => item.key), ['ABC-2', 'ABC-3']);
  assert.equal(result.contributingCount, 1);
});

test('empty numeric values contribute zero and count still counts candidates', async () => {
  const { calculateRelationshipRollup } = await load();
  const candidates = [
    { depth: 1, fields: { storyPoints: null } },
    { depth: 2, fields: { storyPoints: '' } }
  ];
  assert.deepEqual(calculateRelationshipRollup({ candidates, sourceFieldId: 'storyPoints', aggregation: 'sum' }).value, 0);
  assert.equal(calculateRelationshipRollup({ candidates, sourceFieldId: 'storyPoints', aggregation: 'count' }).value, 2);
});

test('multi-select and empty filters use typed values', async () => {
  const { candidateMatches } = await load();
  assert.equal(candidateMatches({ fields: { labels: [{ value: 'blocked' }, { value: 'p1' }] } }, [{ fieldId: 'labels', operator: 'equals', value: 'blocked' }]), true);
  assert.equal(candidateMatches({ fields: { labels: [] } }, [{ fieldId: 'labels', operator: 'isEmpty' }]), true);
  assert.equal(candidateMatches({ fields: { labels: [{ value: 'p1' }] } }, [{ fieldId: 'labels', operator: 'notEquals', value: 'blocked' }]), true);
});

test('relationship evaluation is bounded', async () => {
  const { calculateRelationshipRollup, relationshipLimits } = await load();
  const candidates = Array.from({ length: relationshipLimits.maxCandidates + 5 }, (_, index) => ({ depth: 1, fields: { points: 1 }, key: 'ABC-' + index }));
  assert.throws(() => calculateRelationshipRollup({ candidates, sourceFieldId: 'points', aggregation: 'sum' }), /500 candidates/);
});

test('rejects unsupported depth, nonnumeric values and ambiguous copy', async () => {
  const { calculateRelationshipRollup: calculate } = await load();
  assert.throws(() => calculate({ candidates: [{ depth: 3 }] }), /depth/);
  assert.throws(() => calculate({ candidates: [{ fields: { x: 'oops' } }], sourceFieldId: 'x' }), /not numeric/);
  assert.throws(() => calculate({ candidates: [{ fields: { x: 1 } }, { fields: { x: 2 } }], sourceFieldId: 'x', aggregation: 'copy' }), /multiple/);
});
test('deduplicates linked candidates and preserves typed union objects', async () => {
  const { calculateRelationshipRollup: calculate } = await load();
  const item = { key: 'ABC-1', fields: { x: 3 } };
  assert.equal(calculate({ candidates: [item, item], sourceFieldId: 'x' }).value, 3);
  const result = calculate({ candidates: [{ fields: { x: [{ id: '7', value: 'Risk' }] } }], sourceFieldId: 'x', aggregation: 'union' });
  assert.equal(result.value[0].id, '7');
  assert.equal(calculate({ candidates: [], aggregation: 'min' }).value, null);
});
