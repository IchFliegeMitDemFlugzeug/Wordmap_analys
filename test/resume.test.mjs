import test from 'node:test';
import assert from 'node:assert/strict';
import { addQuery, calculateRunStatus, openDatabase } from '../src/db.mjs';

test('run status reflects discovery and persisted analysis stages', () => {
  const db = openDatabase(':memory:');
  const query = addQuery(db, 'seed');
  assert.equal(calculateRunStatus(db), 'incomplete');
  db.prepare("UPDATE queries SET status='done'").run();
  db.prepare('INSERT INTO analysis_status(query_id,updated_at) VALUES(?,?)').run(query.id, new Date().toISOString());
  assert.equal(calculateRunStatus(db), 'incomplete');
  db.prepare("UPDATE analysis_status SET dynamics_status='done',regions_status='done',serp_status='done'").run();
  assert.equal(calculateRunStatus(db), 'completed');
  db.prepare("UPDATE analysis_status SET serp_status='failed'").run();
  assert.equal(calculateRunStatus(db), 'completed_with_errors');
  db.close();
});
