import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addQuery, openDatabase } from '../src/db.mjs';
import { runResearch } from '../src/research.mjs';
import { classifyQuery } from '../src/scoring.mjs';

function runDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'wordmap-discovery-'));
  mkdirSync(join(directory, 'raw'));
  return directory;
}

function mockClient(firstResults) {
  const topCalls = [];
  return {
    topCalls,
    getRegionsTree: async () => ({ regions: [] }),
    getTopRequests: async (query) => {
      topCalls.push(query);
      return topCalls.length === 1 ? { totalCount: 1, results: firstResults, associations: [], raw: {} } : { totalCount: 0, results: [], associations: [], raw: {} };
    },
    getDynamics: async () => ({ results: [] }),
    getRegionsDistribution: async () => ({ results: [] }),
    search: async () => ({ results: [], rawXml: '<response/>' }),
  };
}

test('mocked discovery stores the full tail but only expands relevant budgeted children', async () => {
  const db = openDatabase(':memory:');
  const root = 'топливный бак БПЛА';
  addQuery(db, root, { manualSeed: true, ...classifyQuery(root, { rootSeed: root, manualSeed: true }) });
  const relevant = [...Array(10)].map((_, index) => ({ phrase: `UAV fuel tank model${index}`, count: 100 - index }));
  const noise = ['топливный насос вебасто', 'фильтр для бассейна bestway', 'москва баку авиабилеты', 'топливный фильтр toyota'].map((phrase) => ({ phrase, count: 500 }));
  const client = mockClient([...relevant, ...noise]);
  await runResearch({ db, client, runDir: runDirectory() });
  assert.equal(db.prepare('SELECT COUNT(*) count FROM relations').get().count, 14);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM queries WHERE expansion_status='expanded' AND manual_seed=0").get().count, 8);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM queries WHERE expansion_status='skipped_root_budget'").get().count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM queries WHERE relevance_class='noise' AND expansion_status='skipped_relevance'").get().count, 4);
  assert.equal(client.topCalls.length, 9);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM analysis_status a JOIN queries q ON q.id=a.query_id WHERE q.relevance_class IN ('broad','noise') AND q.manual_seed=0").get().count, 0);
  db.close();
});

test('global expansion budget prevents another automatic Wordstat call', async () => {
  const db = openDatabase(':memory:');
  for (let index = 0; index < 1000; index += 1) addQuery(db, `already expanded ${index}`, { status: 'stored', expansionStatus: 'expanded' });
  const root = 'UAV fuel tank';
  addQuery(db, root, { manualSeed: true, ...classifyQuery(root, { rootSeed: root, manualSeed: true }) });
  const client = mockClient([{ phrase: 'UAV fuel tank freshmodel', count: 50 }]);
  await runResearch({ db, client, runDir: runDirectory() });
  assert.equal(client.topCalls.length, 1);
  assert.equal(db.prepare("SELECT expansion_status FROM queries WHERE query='UAV fuel tank freshmodel'").get().expansion_status, 'skipped_global_budget');
  db.close();
});
