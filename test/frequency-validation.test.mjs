import test from 'node:test';
import assert from 'node:assert/strict';
import { createWordstatClient } from '../src/yandex-wordstat.mjs';
import { classifyQuery } from '../src/scoring.mjs';

function fakeDb() {
  return { prepare: () => ({ all: () => [], run: () => ({ changes: 1 }) }) };
}

async function measure(broad, quoted, exact) {
  const counts = [quoted, exact];
  const client = createWordstatClient({ apiKey: 'x', folderId: 'y', db: fakeDb(), sleepImpl: async () => {},
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ totalCount: counts.shift() }), headers: { get: () => null } }) });
  return client.measureFrequencies('мягкий топливный бак', 1, broad);
}

test('three-frequency validation computes phantom without changing semantics', async () => {
  const cases = [[1000, 400, 10, 100, true], [500, 350, 300, 500 / 300, false], [80, 9, 0, null, true], [0, 0, 0, null, false]];
  for (const [broad, quoted, exact, ratio, phantom] of cases) {
    const result = await measure(broad, quoted, exact);
    assert.equal(result.quotedCount, quoted);
    assert.equal(result.broadExactRatio, ratio);
    assert.equal(result.isPhantom, phantom);
  }
  const before = classifyQuery('мягкий топливный бак');
  await measure(1000, 100, 10);
  assert.deepEqual(classifyQuery('мягкий топливный бак'), before);
});
