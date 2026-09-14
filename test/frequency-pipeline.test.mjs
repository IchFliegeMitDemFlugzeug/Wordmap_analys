import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addQuery, openDatabase } from '../src/db.mjs';
import { clusterPartialSerp, runResearch } from '../src/research.mjs';
import { classifyQuery } from '../src/scoring.mjs';

function directory() {
  const value = mkdtempSync(join(tmpdir(), 'wordmap-frequency-'));
  mkdirSync(join(value, 'raw'));
  return value;
}

function client(counter) {
  return {
    getRegionsTree: async () => ({ regions: [] }),
    getTopRequests: async () => ({ totalCount: 1000, results: [], associations: [], raw: {} }),
    measureFrequencies: async () => { counter.calls += 1; return { broadCount: 1000, quotedCount: 30, exactCount: 10, broadExactRatio: 100, isPhantom: true, threshold: 10 }; },
    getDynamics: async () => ({ results: [] }),
    getRegionsDistribution: async () => ({ results: [] }),
    search: async () => ({ results: [], rawXml: '<response/>' }),
  };
}

test('frequency stage persists quoted data and a done stage is resumable without another call', async () => {
  const db = openDatabase(':memory:');
  const query = 'мягкий топливный бак';
  addQuery(db, query, { manualSeed: true, ...classifyQuery(query, { rootSeed: query }), status: 'done' });
  const counter = { calls: 0 };
  const mock = client(counter);
  await runResearch({ db, client: mock, runDir: directory() });
  assert.deepEqual(db.prepare('SELECT broad_count,quoted_count,exact_count,is_phantom FROM wordstat_frequency_validation').get(), { broad_count: 1000, quoted_count: 30, exact_count: 10, is_phantom: 1 });
  assert.equal(db.prepare('SELECT frequency_status FROM analysis_status').get().frequency_status, 'done');
  await runResearch({ db, client: mock, runDir: directory() });
  assert.equal(counter.calls, 1);
  db.close();
});

test('partial SERP clustering can run during graceful shutdown and isolates errors', () => {
  const db = openDatabase(':memory:');
  const ids = ['one', 'two'].map((query) => addQuery(db, query, { status: 'done' }).id);
  for (const [index, id] of ids.entries()) for (let position = 1; position <= 3; position += 1) {
    const url = `https://example${position}.test/page`;
    db.prepare('INSERT INTO serp VALUES(?,?,?,?,?,?,?,?)').run(id, position, url, url, `example${position}.test`, `title ${index}`, '', new Date().toISOString());
  }
  assert.equal(clusterPartialSerp(db).length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM cluster_queries').get().count, 2);
  let errorSeen = false;
  assert.deepEqual(clusterPartialSerp({ exec: () => { throw new Error('broken'); } }, () => { errorSeen = true; }), []);
  assert.equal(errorSeen, true);
  db.close();
});
