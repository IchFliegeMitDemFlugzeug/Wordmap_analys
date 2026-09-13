import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, setMeta } from '../src/db.mjs';
import { ALGORITHM_VERSION } from '../src/config.mjs';
import { findResumableRun } from '../src/run-version.mjs';

test('legacy run is untouched and current algorithm run can resume', () => {
  const root = mkdtempSync(join(tmpdir(), 'wordmap-runs-'));
  const legacy = join(root, '20260101_000000');
  mkdirSync(legacy);
  let db = openDatabase(join(legacy, 'research.sqlite'));
  setMeta(db, 'input_hash', 'same'); setMeta(db, 'status', 'paused'); db.close();
  assert.equal(findResumableRun(root, 'same'), undefined);
  db = openDatabase(join(legacy, 'research.sqlite'));
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='algorithm_version'").get(), undefined); db.close();
  const current = join(root, '20260102_000000');
  mkdirSync(current);
  db = openDatabase(join(current, 'research.sqlite'));
  setMeta(db, 'input_hash', 'same'); setMeta(db, 'status', 'incomplete'); setMeta(db, 'algorithm_version', ALGORITHM_VERSION); db.close();
  assert.equal(findResumableRun(root, 'same'), current);
});
