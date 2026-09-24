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
      { key: 'DO-1', depth: 0, statusCategory: 'In Progress', fields: { storyPoints: 8 } },
      { key: 'DO-2', depth: 1, statusCategory: 'To Do', fields: { storyPoints: 3 } },
      { key: 'DO-3', depth: 2, statusCategory: 'To Do', fields: { storyPoints: null } },
      { key: 'DO-4', depth: 3, statusCategory: 'To Do', fields: { storyPoints: 99 } }
    ]
  });
  assert.equal(result.value, 3);
  assert.deepEqual(result.matching.map(item => item.key), ['DO-2', 'DO-3']);
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
  const result = calculateRelationshipRollup({ candidates, sourceFieldId: 'points', aggregation: 'sum' });
  assert.equal(result.matching.length, relationshipLimits.maxCandidates);
  assert.equal(result.value, relationshipLimits.maxCandidates);
});
