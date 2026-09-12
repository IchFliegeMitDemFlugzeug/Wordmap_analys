import test from 'node:test';
import assert from 'node:assert/strict';
import { addQuery, openDatabase, quotaState, recoverProcessing } from '../src/db.mjs';

test('schema, dedup and recovery', () => {
  const db = openDatabase(':memory:');
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='analysis_status'").get());
  const query = addQuery(db, 'Ёж', { score: 1 });
  addQuery(db, ' еж ', { score: 2 });
  assert.equal(db.prepare('SELECT count(*) n FROM queries').get().n, 1);
  db.prepare("UPDATE queries SET status='processing'").run();
  db.prepare("INSERT INTO analysis_status(query_id,dynamics_status,regions_status,serp_status,updated_at) VALUES(?,?,?,?,?)").run(query.id, 'processing', 'processing', 'processing', new Date().toISOString());
  assert.equal(recoverProcessing(db), 1);
  assert.equal(db.prepare('SELECT status FROM queries').get().status, 'queued');
  assert.deepEqual(db.prepare('SELECT dynamics_status,regions_status,serp_status FROM analysis_status').get(), { dynamics_status: 'pending', regions_status: 'pending', serp_status: 'pending' });
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
