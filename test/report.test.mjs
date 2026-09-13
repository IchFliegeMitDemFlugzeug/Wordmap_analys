import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, addQuery } from '../src/db.mjs';
import { csvEscape, generateReport } from '../src/report.mjs';

test('CSV escaping', () => assert.equal(csvEscape('a;"b'), '"a;""b"'));

test('report generation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wordmap-'));
  const db = openDatabase(':memory:');
  addQuery(db, 'seed', { manualSeed: true, score: 100 });
  generateReport(db, dir);
  assert.ok(readFileSync(join(dir, 'queries.csv')).toString().startsWith('\ufeff'));
  assert.match(readFileSync(join(dir, 'report.html'), 'utf8'), /Суммировать их напрямую нельзя/u);
  db.close();
});

test('HTML filters analytical sections while CSV keeps core and noise raw data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wordmap-report-filter-'));
  const db = openDatabase(':memory:');
  const core = addQuery(db, 'core analytical query', { relevanceClass: 'core', recursiveEligible: true, deepEligible: true });
  const noise = addQuery(db, 'noise raw query', { relevanceClass: 'noise' });
  db.prepare('INSERT INTO serp VALUES(?,?,?,?,?,?,?,?)').run(core.id, 1, 'https://core.example/', 'https://core.example/', 'core.example', 'core', '', 'now');
  db.prepare('INSERT INTO serp VALUES(?,?,?,?,?,?,?,?)').run(noise.id, 1, 'https://noise.example/', 'https://noise.example/', 'noise.example', 'noise', '', 'now');
  db.prepare('INSERT INTO dynamics VALUES(?,?,?,?)').run(core.id, '2026-01-01', 10, 1);
  db.prepare('INSERT INTO dynamics VALUES(?,?,?,?)').run(noise.id, '2026-01-01', 20, 1);
  db.prepare('INSERT INTO regions VALUES(?,?,?,?,?,?)').run(core.id, '1', 'core region', 10, 1, 1);
  db.prepare('INSERT INTO regions VALUES(?,?,?,?,?,?)').run(noise.id, '2', 'noise region', 20, 1, 1);
  const coreCluster = db.prepare('INSERT INTO clusters(name) VALUES(?)').run('core cluster').lastInsertRowid;
  const noiseCluster = db.prepare('INSERT INTO clusters(name) VALUES(?)').run('noise cluster').lastInsertRowid;
  db.prepare('INSERT INTO cluster_queries VALUES(?,?)').run(coreCluster, core.id);
  db.prepare('INSERT INTO cluster_queries VALUES(?,?)').run(noiseCluster, noise.id);
  db.prepare('INSERT INTO relations VALUES(?,?,?,?,?)').run(core.id, noise.id, 'DIRECT', 1, 'now');
  generateReport(db, dir);
  for (const filename of ['queries.csv', 'serp.csv', 'dynamics.csv', 'regions.csv', 'clusters.csv', 'relations.csv']) {
    const contents = readFileSync(join(dir, filename), 'utf8');
    assert.match(contents, /core/u, filename);
    assert.match(contents, /noise/u, filename);
  }
  const html = readFileSync(join(dir, 'report.html'), 'utf8');
  const section = (title) => html.match(new RegExp(`<section><h2>${title}</h2>[\\s\\S]*?</section>`, 'u'))?.[0] ?? '';
  for (const title of ['Кластеры', 'SERP domains', 'Dynamics', 'Regions']) {
    assert.match(section(title), /core/u, title);
    assert.doesNotMatch(section(title), /noise/u, title);
  }
  assert.match(section('Примеры NOISE'), /noise raw query/u);
  db.close();
});
