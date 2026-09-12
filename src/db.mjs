import Database from 'better-sqlite3';
import { normalizeQuery } from './scoring.mjs';

export function openDatabase(filename) {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(`
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS queries (id INTEGER PRIMARY KEY, query TEXT NOT NULL, normalized TEXT NOT NULL UNIQUE, depth INTEGER NOT NULL, score INTEGER NOT NULL, manual_seed INTEGER NOT NULL DEFAULT 0, brand_seed INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'queued', root_seed TEXT, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS relations (parent_query_id INTEGER REFERENCES queries(id), child_query_id INTEGER REFERENCES queries(id), relation_type TEXT, count INTEGER, created_at TEXT, UNIQUE(parent_query_id, child_query_id, relation_type));
CREATE TABLE IF NOT EXISTS wordstat_top (query_id INTEGER PRIMARY KEY REFERENCES queries(id), total_count INTEGER, response_json TEXT, retrieved_at TEXT);
CREATE TABLE IF NOT EXISTS dynamics (query_id INTEGER REFERENCES queries(id), date TEXT, count INTEGER, share REAL, UNIQUE(query_id,date));
CREATE TABLE IF NOT EXISTS regions (query_id INTEGER REFERENCES queries(id), region_id TEXT, region_name TEXT, count INTEGER, share REAL, affinity_index REAL, UNIQUE(query_id,region_id));
CREATE TABLE IF NOT EXISTS serp (query_id INTEGER REFERENCES queries(id), position INTEGER, url TEXT, normalized_url TEXT, domain TEXT, title TEXT, snippet TEXT, retrieved_at TEXT, UNIQUE(query_id,position));
CREATE TABLE IF NOT EXISTS clusters (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS cluster_queries (cluster_id INTEGER REFERENCES clusters(id), query_id INTEGER REFERENCES queries(id), UNIQUE(cluster_id,query_id));
CREATE TABLE IF NOT EXISTS api_calls (id INTEGER PRIMARY KEY, api TEXT, method TEXT, query_id INTEGER, http_status INTEGER, started_at TEXT, finished_at TEXT, success INTEGER, error TEXT, request_json TEXT, response_json TEXT);
CREATE TABLE IF NOT EXISTS analysis_status (
  query_id INTEGER PRIMARY KEY REFERENCES queries(id),
  dynamics_status TEXT NOT NULL DEFAULT 'pending',
  regions_status TEXT NOT NULL DEFAULT 'pending',
  serp_status TEXT NOT NULL DEFAULT 'pending',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_queries_queue ON queries(status,manual_seed DESC,score DESC,depth,id);
CREATE INDEX IF NOT EXISTS idx_serp_url ON serp(normalized_url);
`);
  const columns = new Set(db.prepare('PRAGMA table_info(api_calls)').all().map((column) => column.name));
  if (!columns.has('request_json')) db.exec('ALTER TABLE api_calls ADD COLUMN request_json TEXT');
  if (!columns.has('response_json')) db.exec('ALTER TABLE api_calls ADD COLUMN response_json TEXT');
  db.exec('DROP INDEX IF EXISTS idx_calls_quota; CREATE INDEX idx_calls_quota ON api_calls(api,started_at)');
  return db;
}

export function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

export function getMeta(db, key) {
  return db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value;
}

export function addQuery(db, query, data = {}) {
  const now = new Date().toISOString();
  const normalized = normalizeQuery(query);
  db.prepare(`INSERT INTO queries(query,normalized,depth,score,manual_seed,brand_seed,status,root_seed,first_seen_at,last_seen_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(normalized) DO UPDATE SET last_seen_at=excluded.last_seen_at,
      manual_seed=MAX(manual_seed,excluded.manual_seed), brand_seed=MAX(brand_seed,excluded.brand_seed),
      score=MAX(score,excluded.score), depth=MIN(depth,excluded.depth)`).run(
    query, normalized, data.depth ?? 0, data.score ?? 0, data.manualSeed ? 1 : 0,
    data.brandSeed ? 1 : 0, data.status ?? 'queued', data.rootSeed ?? query, now, now,
  );
  return db.prepare('SELECT * FROM queries WHERE normalized=?').get(normalized);
}

export function recoverProcessing(db) {
  const now = new Date().toISOString();
  return db.transaction(() => {
    const changes = db.prepare("UPDATE queries SET status='queued' WHERE status='processing'").run().changes;
    for (const stage of ['dynamics_status', 'regions_status', 'serp_status']) {
      db.prepare(`UPDATE analysis_status SET ${stage}='pending', updated_at=? WHERE ${stage}='processing'`).run(now);
    }
    return changes;
  })();
}

export function quotaState(db, now = Date.now()) {
  const cutoff = new Date(now - 3_600_000).toISOString();
  const rows = db.prepare("SELECT started_at FROM api_calls WHERE api='wordstat' AND started_at>=? ORDER BY started_at").all(cutoff);
  return {
    count: rows.length,
    waitMs: rows.length < 95 ? 0 : Math.max(0, Date.parse(rows[0].started_at) + 3_605_000 - now),
  };
}

export function calculateRunStatus(db) {
  const unfinishedQueries = db.prepare("SELECT COUNT(*) count FROM queries WHERE status IN ('queued','processing')").get().count;
  const unfinishedStages = db.prepare(`SELECT COUNT(*) count FROM analysis_status WHERE
    dynamics_status IN ('pending','processing') OR regions_status IN ('pending','processing') OR serp_status IN ('pending','processing')`).get().count;
  if (unfinishedQueries || unfinishedStages) return 'incomplete';
  const failedQueries = db.prepare("SELECT COUNT(*) count FROM queries WHERE status='failed'").get().count;
  const failedStages = db.prepare(`SELECT COUNT(*) count FROM analysis_status WHERE
    dynamics_status='failed' OR regions_status='failed' OR serp_status='failed'`).get().count;
  return failedQueries || failedStages ? 'completed_with_errors' : 'completed';
}
