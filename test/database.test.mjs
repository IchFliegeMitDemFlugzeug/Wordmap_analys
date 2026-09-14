import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addQuery, calculateRunStatus, openDatabase, quotaState, recoverProcessing } from '../src/db.mjs';

test('schema, dedup and recovery', () => {
  const db = openDatabase(':memory:');
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='analysis_status'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='wordstat_frequency_validation'").get());
  const query = addQuery(db, 'Ёж', { score: 1 });
  addQuery(db, ' еж ', { score: 2 });
  assert.equal(db.prepare('SELECT count(*) n FROM queries').get().n, 1);
  db.prepare("UPDATE queries SET status='processing'").run();
  db.prepare("INSERT INTO analysis_status(query_id,dynamics_status,regions_status,serp_status,frequency_status,updated_at) VALUES(?,?,?,?,?,?)").run(query.id, 'processing', 'processing', 'processing', 'processing', new Date().toISOString());
  assert.equal(recoverProcessing(db), 1);
  assert.equal(db.prepare('SELECT status FROM queries').get().status, 'queued');
  assert.deepEqual(db.prepare('SELECT dynamics_status,regions_status,serp_status FROM analysis_status').get(), { dynamics_status: 'pending', regions_status: 'pending', serp_status: 'pending' });
  assert.equal(db.prepare('SELECT frequency_status FROM analysis_status').get().frequency_status, 'pending');
  db.close();
});

test('unplanned frequency validation does not keep a completed run incomplete', () => {
  const db = openDatabase(':memory:');
  const query = addQuery(db, 'stored broad query', { status: 'stored' });
  db.prepare("INSERT INTO analysis_status(query_id,dynamics_status,regions_status,serp_status,frequency_status,updated_at) VALUES(?,?,?,?,?,?)")
    .run(query.id, 'done', 'done', 'done', null, new Date().toISOString());
  assert.equal(calculateRunStatus(db), 'completed');
  db.close();
});

test('rolling quota counts every Wordstat attempt by started_at', () => {
  const db = openDatabase(':memory:');
  const now = Date.parse('2026-09-12T12:00:00Z');
  for (let index = 0; index < 95; index += 1) db.prepare('INSERT INTO api_calls(api,http_status,success,started_at,finished_at) VALUES(?,?,?,?,?)').run('wordstat', [200, 429, 500][index % 3], index % 3 === 0 ? 1 : 0, new Date(now - 1_000).toISOString(), new Date(now - 7_200_000).toISOString());
  db.prepare('INSERT INTO api_calls(api,started_at) VALUES(?,?)').run('wordstat', new Date(now - 3_700_000).toISOString());
  db.prepare('INSERT INTO api_calls(api,started_at) VALUES(?,?)').run('search', new Date(now - 1_000).toISOString());
  assert.equal(quotaState(db, now).count, 95);
  assert.ok(quotaState(db, now).waitMs > 0);
  db.close();
});

test('opening a legacy database adds relevance columns idempotently', () => {
  const filename = join(mkdtempSync(join(tmpdir(), 'wordmap-migration-')), 'legacy.sqlite');
  const legacy = new Database(filename);
  legacy.exec("CREATE TABLE queries (id INTEGER PRIMARY KEY, query TEXT NOT NULL, normalized TEXT NOT NULL UNIQUE, depth INTEGER NOT NULL, score INTEGER NOT NULL, manual_seed INTEGER NOT NULL DEFAULT 0, brand_seed INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'queued', root_seed TEXT, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)");
  legacy.close();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const db = openDatabase(filename);
    const columns = new Set(db.prepare('PRAGMA table_info(queries)').all().map((column) => column.name));
    for (const name of ['relevance_class', 'relevance_reason', 'recursive_eligible', 'deep_eligible', 'expansion_status', 'skip_reason']) assert.ok(columns.has(name));
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='wordstat_frequency_validation'").get());
    assert.ok(new Set(db.prepare('PRAGMA table_info(analysis_status)').all().map((column) => column.name)).has('frequency_status'));
    db.close();
  }
});

test('deduplication preserves or promotes one internally consistent relevance decision', () => {
  const db = openDatabase(':memory:');
  addQuery(db, 'same query', { relevanceClass: 'core', reasons: ['core first'], recursiveEligible: true, deepEligible: true });
  addQuery(db, 'same query', { relevanceClass: 'noise', reasons: ['noise later'], recursiveEligible: false, deepEligible: false });
  let row = db.prepare("SELECT relevance_class,relevance_reason,recursive_eligible,deep_eligible FROM queries WHERE normalized='same query'").get();
  assert.deepEqual(row, { relevance_class: 'core', relevance_reason: '["core first"]', recursive_eligible: 1, deep_eligible: 1 });
  addQuery(db, 'another query', { relevanceClass: 'noise', reasons: ['noise first'], recursiveEligible: false, deepEligible: false });
  addQuery(db, 'another query', { relevanceClass: 'adjacent', reasons: ['adjacent later'], recursiveEligible: true, deepEligible: true });
  row = db.prepare("SELECT relevance_class,relevance_reason,recursive_eligible,deep_eligible FROM queries WHERE normalized='another query'").get();
  assert.deepEqual(row, { relevance_class: 'adjacent', relevance_reason: '["adjacent later"]', recursive_eligible: 1, deep_eligible: 1 });
  addQuery(db, 'forward order', { relevanceClass: 'core', reasons: ['not recursive'], recursiveEligible: false, deepEligible: true });
  addQuery(db, 'forward order', { relevanceClass: 'core', reasons: ['recursive'], recursiveEligible: true, deepEligible: true });
  addQuery(db, 'reverse order', { relevanceClass: 'core', reasons: ['recursive'], recursiveEligible: true, deepEligible: true });
  addQuery(db, 'reverse order', { relevanceClass: 'core', reasons: ['not recursive'], recursiveEligible: false, deepEligible: true });
  for (const normalized of ['forward order', 'reverse order']) {
    row = db.prepare('SELECT relevance_class,relevance_reason,recursive_eligible,deep_eligible FROM queries WHERE normalized=?').get(normalized);
    assert.deepEqual(row, { relevance_class: 'core', relevance_reason: '["recursive"]', recursive_eligible: 1, deep_eligible: 1 });
  }
  db.close();
});
