import { writeFileSync } from 'node:fs';
import { addQuery, setMeta } from './db.mjs';
import { MAX_AUTO_DEEP_QUERIES, MAX_AUTO_EXPANSIONS_PER_ROOT, MAX_AUTO_EXPANSIONS_PER_RUN, MAX_DEPTH } from './config.mjs';
import { log } from './logger.mjs';
import { classifyQuery, normalizeUrl } from './scoring.mjs';
import { alignDates, formatDate } from './vendor/yandex/wordstat-dates.mjs';

export { MAX_DEPTH } from './config.mjs';
export const BRAND_TERMS = ['', 'fuel tank', 'fuel fitting', 'fuel clunk', 'fuel filter', 'fuel valve', 'fuel tubing', 'топливный бак', 'штуцер', 'топливный штуцер', 'топливный фильтр', 'топливный клапан', 'топливная трубка'];

export function parseInput(text) {
  const seeds = [];
  const brands = [];
  const explicitEntities = [];
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^@brand\s+/iu.test(line)) brands.push(line.replace(/^@brand\s+/iu, '').trim());
    else if (/^@entity\s+/iu.test(line)) explicitEntities.push(line.replace(/^@entity\s+/iu, '').trim());
    else seeds.push(line);
  }
  return { seeds, brands, entities: [...new Set([...brands, ...explicitEntities])] };
}

export function expandBrands(brands) {
  return brands.flatMap((brand) => BRAND_TERMS.map((term) => !term ? brand : /[а-яё]/iu.test(term) ? `${term} ${brand}` : `${brand} ${term}`));
}

export function selectRecursiveChildren(children) {
  const rank = { core: 0, adjacent: 1 };
  return children.filter((item) => item.recursiveEligible).sort((a, b) =>
    rank[a.relevanceClass] - rank[b.relevanceClass] || b.score - a.score || b.count - a.count);
}

export function getLast24CompletedMonths(now = new Date()) {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 23, 1));
  return alignDates('monthly', formatDate(from), formatDate(to), now);
}

export function intersectionSize(a, b) {
  let count = 0;
  for (const value of a) if (b.has(value)) count += 1;
  return count;
}

export function connectedComponents(items, edges) {
  const graph = new Map(items.map((item) => [item, new Set()]));
  for (const [a, b] of edges) { graph.get(a)?.add(b); graph.get(b)?.add(a); }
  const seen = new Set();
  const output = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    const stack = [item];
    const part = [];
    seen.add(item);
    while (stack.length) {
      const current = stack.pop();
      part.push(current);
      for (const adjacent of graph.get(current)) if (!seen.has(adjacent)) { seen.add(adjacent); stack.push(adjacent); }
    }
    output.push(part);
  }
  return output;
}

function setStage(db, queryId, stage, status) {
  db.prepare(`UPDATE analysis_status SET ${stage}_status=?, updated_at=? WHERE query_id=?`).run(status, new Date().toISOString(), queryId);
}

async function runStage({ db, q, stage, execute, save, generateReport }) {
  if (q[`${stage}_status`] !== 'pending') return;
  setStage(db, q.id, stage, 'processing');
  try {
    const data = await execute();
    db.transaction(() => { save(data); setStage(db, q.id, stage, 'done'); })();
    log('info', `Deep stage done: ${stage}, query ${q.id}`);
    await generateReport?.();
  } catch (error) {
    if (error.fatalAuth) { setStage(db, q.id, stage, 'pending'); throw error; }
    if (error.permanent) {
      setStage(db, q.id, stage, 'failed');
      log('error', `Deep stage failed: ${stage}, query ${q.id}: ${error.message}`);
      return;
    }
    setStage(db, q.id, stage, 'pending');
    throw error;
  }
}

export async function runResearch({ db, client, runDir, brands = [], entities = brands, generateReport }) {
  const tree = await client.getRegionsTree();
  setMeta(db, 'regions_tree', JSON.stringify(tree.regions));
  for (;;) {
    const parent = db.prepare("SELECT * FROM queries WHERE status='queued' AND depth<=? ORDER BY manual_seed DESC,score DESC,depth ASC,id ASC LIMIT 1").get(MAX_DEPTH);
    if (!parent) break;
    db.prepare("UPDATE queries SET status='processing' WHERE id=?").run(parent.id);
    try {
      const raw = await client.getTopRequests(parent.query, parent.id);
      db.prepare('INSERT OR REPLACE INTO wordstat_top VALUES(?,?,?,?)').run(parent.id, raw.totalCount, JSON.stringify(raw.raw), new Date().toISOString());
      const all = [
        ...raw.results.map((item) => ({ ...item, type: 'DIRECT' })),
        ...raw.associations.map((item) => ({ ...item, type: 'ASSOCIATION' })),
      ];
      const candidates = [];
      for (const item of all) {
        if (!item.phrase) continue;
        const relevance = classifyQuery(item.phrase, { parentQuery: parent.query, rootSeed: parent.root_seed, brands, entities, depth: parent.depth + 1, relationType: item.type });
        const initialExpansion = relevance.recursiveEligible ? 'candidate' : 'skipped_relevance';
        const child = addQuery(db, item.phrase, { depth: parent.depth + 1, ...relevance, status: 'stored', rootSeed: parent.root_seed, expansionStatus: initialExpansion, skipReason: relevance.recursiveEligible ? null : 'relevance' });
        db.prepare('INSERT OR REPLACE INTO relations VALUES(?,?,?,?,?)').run(parent.id, child.id, item.type, item.count, new Date().toISOString());
        candidates.push({ id: child.id, type: item.type, count: item.count, ...relevance });
      }
      for (const child of selectRecursiveChildren(candidates)) {
        if (parent.depth + 1 > MAX_DEPTH) {
          db.prepare("UPDATE queries SET expansion_status='skipped_depth',skip_reason='depth' WHERE id=? AND status='stored'").run(child.id);
          continue;
        }
        const globalUsed = db.prepare("SELECT COUNT(*) count FROM queries WHERE manual_seed=0 AND expansion_status IN ('queued','expanded')").get().count;
        if (globalUsed >= MAX_AUTO_EXPANSIONS_PER_RUN) {
          db.prepare("UPDATE queries SET expansion_status='skipped_global_budget',skip_reason='global_budget' WHERE id=? AND status='stored'").run(child.id);
          continue;
        }
        const rootUsed = db.prepare("SELECT COUNT(*) count FROM queries WHERE manual_seed=0 AND root_seed=? AND expansion_status IN ('queued','expanded')").get(parent.root_seed).count;
        if (rootUsed >= MAX_AUTO_EXPANSIONS_PER_ROOT) {
          db.prepare("UPDATE queries SET expansion_status='skipped_root_budget',skip_reason='root_budget' WHERE id=? AND status='stored'").run(child.id);
          continue;
        }
        db.prepare("UPDATE queries SET status='queued',expansion_status='queued',skip_reason=NULL WHERE id=? AND status='stored'").run(child.id);
      }
      db.prepare("UPDATE queries SET status='done',expansion_status='expanded' WHERE id=?").run(parent.id);
      log('info', `Query discovery completed: ${parent.id} «${parent.query}»`);
      await generateReport?.();
    } catch (error) {
      if (error.fatalAuth) { db.prepare("UPDATE queries SET status='queued' WHERE id=?").run(parent.id); throw error; }
      if (error.permanent) {
        db.prepare("UPDATE queries SET status='failed' WHERE id=?").run(parent.id);
        log('error', `Query discovery failed: ${parent.id} «${parent.query}»: ${error.message}`);
        continue;
      }
      db.prepare("UPDATE queries SET status='queued' WHERE id=?").run(parent.id);
      throw error;
    }
  }

  const timestamp = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO analysis_status(query_id,updated_at) SELECT id,? FROM queries WHERE manual_seed=1').run(timestamp);
  const autoDeep = db.prepare(`SELECT q.id FROM queries q LEFT JOIN wordstat_top w ON w.query_id=q.id
    WHERE q.manual_seed=0 AND q.deep_eligible=1 AND q.relevance_class IN ('core','adjacent')
    ORDER BY CASE q.relevance_class WHEN 'core' THEN 0 ELSE 1 END,q.score DESC,
      COALESCE(w.total_count,(SELECT MAX(r.count) FROM relations r WHERE r.child_query_id=q.id),0) DESC,q.id LIMIT ?`).all(MAX_AUTO_DEEP_QUERIES);
  const insertDeep = db.prepare('INSERT OR IGNORE INTO analysis_status(query_id,updated_at) VALUES(?,?)');
  for (const item of autoDeep) insertDeep.run(item.id, timestamp);
  const dates = getLast24CompletedMonths();
  const deep = db.prepare(`SELECT q.*,a.dynamics_status,a.regions_status,a.serp_status FROM queries q
    JOIN analysis_status a ON a.query_id=q.id ORDER BY q.id`).all();
  for (const q of deep) {
    await runStage({ db, q, stage: 'dynamics', execute: () => client.getDynamics(q.query, dates, q.id), generateReport,
      save: (data) => { db.prepare('DELETE FROM dynamics WHERE query_id=?').run(q.id); for (const item of data.results) db.prepare('INSERT INTO dynamics VALUES(?,?,?,?)').run(q.id, item.date, item.count, item.share); } });
    await runStage({ db, q, stage: 'regions', execute: () => client.getRegionsDistribution(q.query, q.id), generateReport,
      save: (data) => { db.prepare('DELETE FROM regions WHERE query_id=?').run(q.id); for (const item of data.results) db.prepare('INSERT INTO regions VALUES(?,?,?,?,?,?)').run(q.id, item.regionId, item.regionName, item.count, item.share, item.affinityIndex); } });
    await runStage({ db, q, stage: 'serp', execute: () => client.search(q.query, q.id), generateReport,
      save: (data) => { writeFileSync(`${runDir}/raw/serp_${q.id}.xml`, data.rawXml); db.prepare('DELETE FROM serp WHERE query_id=?').run(q.id); for (const item of data.results) db.prepare('INSERT INTO serp VALUES(?,?,?,?,?,?,?,?)').run(q.id, item.position, item.url, normalizeUrl(item.url), item.domain, item.title, item.snippet, new Date().toISOString()); } });
  }
}

export function clusterSerp(db) {
  db.exec('DELETE FROM cluster_queries; DELETE FROM clusters');
  const rows = db.prepare(`SELECT q.id,q.query,q.score,COALESCE(w.total_count,(SELECT MAX(r.count) FROM relations r WHERE r.child_query_id=q.id),0) popularity,s.normalized_url
    FROM queries q JOIN serp s ON s.query_id=q.id LEFT JOIN wordstat_top w ON w.query_id=q.id`).all();
  const map = new Map();
  for (const row of rows) { if (!map.has(row.id)) map.set(row.id, { ...row, urls: new Set() }); map.get(row.id).urls.add(row.normalized_url); }
  const ids = [...map.keys()];
  const edges = [];
  for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) if (intersectionSize(map.get(ids[i]).urls, map.get(ids[j]).urls) >= 3) edges.push([ids[i], ids[j]]);
  const components = connectedComponents(ids, edges);
  for (const part of components) {
    const best = part.map((id) => map.get(id)).sort((a, b) => b.score - a.score || b.popularity - a.popularity)[0];
    const info = db.prepare('INSERT INTO clusters(name) VALUES(?)').run(best.query);
    for (const id of part) db.prepare('INSERT INTO cluster_queries VALUES(?,?)').run(info.lastInsertRowid, id);
  }
  return components;
}
