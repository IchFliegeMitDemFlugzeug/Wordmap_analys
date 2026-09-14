import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, setMeta } from '../src/db.mjs';
import { ALGORITHM_VERSION, CONFIG_FINGERPRINT, createConfigFingerprint } from '../src/config.mjs';
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
  setMeta(db, 'input_hash', 'same'); setMeta(db, 'status', 'incomplete'); setMeta(db, 'algorithm_version', ALGORITHM_VERSION); setMeta(db, 'config_fingerprint', CONFIG_FINGERPRINT); db.close();
  assert.equal(findResumableRun(root, 'same'), current);
});

const exploreConfig = {
  RESEARCH_PROFILE: 'explore',
  MAX_DEPTH: 2,
  MAX_AUTO_EXPANSIONS_PER_ROOT: 8,
  MAX_AUTO_EXPANSIONS_PER_RUN: 1000,
  MAX_AUTO_DEEP_QUERIES: 300,
  MAX_FREQUENCY_VALIDATIONS: 100,
  PHANTOM_RATIO_THRESHOLD: 10,
};

function createRun(root, fingerprint) {
  const run = join(root, '20260101_000000');
  mkdirSync(run);
  const db = openDatabase(join(run, 'research.sqlite'));
  setMeta(db, 'input_hash', 'same');
  setMeta(db, 'status', 'paused');
  setMeta(db, 'algorithm_version', ALGORITHM_VERSION);
  setMeta(db, 'config_fingerprint', fingerprint);
  db.close();
  return run;
}

test('resume rejects a profile change from explore to final', () => {
  const root = mkdtempSync(join(tmpdir(), 'wordmap-profile-'));
  createRun(root, createConfigFingerprint(exploreConfig));
  const finalFingerprint = createConfigFingerprint({ ...exploreConfig, RESEARCH_PROFILE: 'final', MAX_DEPTH: 1, MAX_AUTO_EXPANSIONS_PER_ROOT: 4, MAX_AUTO_EXPANSIONS_PER_RUN: 500, MAX_AUTO_DEEP_QUERIES: 500, MAX_FREQUENCY_VALIDATIONS: 500 });
  assert.equal(findResumableRun(root, 'same', ALGORITHM_VERSION, finalFingerprint), undefined);
});

test('resume rejects every changed MAX override', () => {
  for (const key of ['MAX_DEPTH', 'MAX_AUTO_EXPANSIONS_PER_ROOT', 'MAX_AUTO_EXPANSIONS_PER_RUN', 'MAX_AUTO_DEEP_QUERIES', 'MAX_FREQUENCY_VALIDATIONS']) {
    const root = mkdtempSync(join(tmpdir(), 'wordmap-override-'));
    createRun(root, createConfigFingerprint(exploreConfig));
    const changed = createConfigFingerprint({ ...exploreConfig, [key]: exploreConfig[key] + 1 });
    assert.equal(findResumableRun(root, 'same', ALGORITHM_VERSION, changed), undefined, key);
  }
});

test('resume accepts a completely identical effective config', () => {
  const root = mkdtempSync(join(tmpdir(), 'wordmap-identical-'));
  const fingerprint = createConfigFingerprint(exploreConfig);
  const run = createRun(root, fingerprint);
  assert.equal(findResumableRun(root, 'same', ALGORITHM_VERSION, fingerprint), run);
});
