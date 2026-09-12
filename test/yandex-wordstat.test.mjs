import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.mjs';
import { createWordstatClient } from '../src/yandex-wordstat.mjs';

const response = (data) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(data) });

test('Wordstat v2 sends exact bodies and normalizes responses', async () => {
  const db = openDatabase(':memory:');
  const calls = [];
  const replies = [
    { totalCount: '8', results: [{ phrase: 'a', count: '4' }], associations: [{ phrase: 'b', count: '2' }] },
    { results: [{ date: '2026-01-01T00:00:00Z', count: '3', share: '0.5' }] },
    { regions: [{ id: 225, label: 'Россия', children: [{ id: 1, label: 'Москва' }] }] },
    { results: [{ region: 1, count: '7', share: '0.2', affinityIndex: '1.1' }, { region: 999, count: 9 }] },
  ];
  const client = createWordstatClient({ apiKey: 'secret', folderId: 'folder-test', db, sleepImpl: async () => {}, nowImpl: () => Date.parse('2026-09-12T00:00:00Z'), fetchImpl: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return response(replies.shift()); } });
  const top = await client.getTopRequests('мягкий бак');
  const dynamics = await client.getDynamics('мягкий бак', { fromDate: '2024-01-01', toDate: '2025-12-31' });
  const tree = await client.getRegionsTree();
  const regions = await client.getRegionsDistribution('мягкий бак');
  assert.match(calls[0].url, /\/v2\/wordstat\/topRequests$/u);
  assert.deepEqual(calls[0].body, { phrase: 'мягкий бак', numPhrases: '2000', regions: ['225'], devices: ['DEVICE_ALL'], folderId: 'folder-test' });
  assert.deepEqual(calls[1].body, { phrase: 'мягкий бак', period: 'PERIOD_MONTHLY', fromDate: '2024-01-01T00:00:00Z', toDate: '2025-12-31T00:00:00Z', regions: ['225'], devices: ['DEVICE_ALL'], folderId: 'folder-test' });
  assert.deepEqual(calls[2].body, { folderId: 'folder-test' });
  assert.deepEqual(calls[3].body, { phrase: 'мягкий бак', region: 'REGION_REGIONS', devices: ['DEVICE_ALL'], folderId: 'folder-test' });
  assert.equal(top.totalCount, 8);
  assert.deepEqual(dynamics.results[0], { date: '2026-01-01', count: 3, share: 0.5 });
  assert.equal(tree.regionNames.get('1'), 'Москва');
  assert.deepEqual(regions.results, [{ regionId: '1', regionName: 'Москва', count: 7, share: 0.2, affinityIndex: 1.1 }]);
  assert.equal(calls.length, 4, 'tree is cached for regions request');
  db.close();
});
