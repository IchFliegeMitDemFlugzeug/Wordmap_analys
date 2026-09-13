import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ALGORITHM_VERSION } from './config.mjs';
import { openDatabase, setMeta } from './db.mjs';
import { generateReport } from './report.mjs';
import { parseInput } from './research.mjs';
import { classifyQuery } from './scoring.mjs';

const RELEVANCE_RANK = Object.freeze({ noise: 0, broad: 1, adjacent: 2, core: 3 });

function strongerClassification(left, right) {
  if (RELEVANCE_RANK[right.relevanceClass] !== RELEVANCE_RANK[left.relevanceClass]) {
    return RELEVANCE_RANK[right.relevanceClass] > RELEVANCE_RANK[left.relevanceClass] ? right : left;
  }
  if (Number(right.recursiveEligible) !== Number(left.recursiveEligible)) return right.recursiveEligible ? right : left;
  return Number(right.deepEligible) > Number(left.deepEligible) ? right : left;
}

export async function reclassifyRun(runDirectory) {
  const runDir = path.resolve(runDirectory);
  const databaseFile = path.join(runDir, 'research.sqlite');
  const inputFile = path.join(runDir, 'input.txt');
  const backupFile = path.join(runDir, 'research.before-reclassify.sqlite');
  if (!existsSync(databaseFile)) throw new Error(`Не найден файл ${databaseFile}`);
  if (!existsSync(inputFile)) throw new Error(`Не найден файл ${inputFile}`);
  if (!existsSync(backupFile)) {
    const source = new Database(databaseFile, { readonly: true });
    try {
      await source.backup(backupFile);
    } finally {
      source.close();
    }
  }
  const { brands, entities } = parseInput(readFileSync(inputFile, 'utf8'));
  const db = openDatabase(databaseFile);
  try {
    const queries = db.prepare('SELECT * FROM queries ORDER BY id').all();
    const parents = db.prepare(`SELECT r.child_query_id,r.relation_type,p.query parent_query
      FROM relations r JOIN queries p ON p.id=r.parent_query_id ORDER BY r.child_query_id,r.parent_query_id`).all();
    const parentsByChild = new Map();
    for (const parent of parents) {
      if (!parentsByChild.has(parent.child_query_id)) parentsByChild.set(parent.child_query_id, []);
      parentsByChild.get(parent.child_query_id).push(parent);
    }
    const update = db.prepare(`UPDATE queries SET relevance_class=?,relevance_reason=?,recursive_eligible=?,deep_eligible=?,
      expansion_status=?,skip_reason=? WHERE id=?`);
    db.transaction(() => {
      for (const query of queries) {
        const contexts = parentsByChild.get(query.id) ?? [{ parent_query: null, relation_type: null }];
        let relevance;
        for (const context of contexts) {
          const candidate = classifyQuery(query.query, {
            parentQuery: context.parent_query,
            rootSeed: query.root_seed,
            brands,
            entities,
            depth: query.depth,
            relationType: context.relation_type,
            manualSeed: Boolean(query.manual_seed),
          });
          relevance = relevance ? strongerClassification(relevance, candidate) : candidate;
        }
        const eligible = relevance.relevanceClass === 'core' || relevance.relevanceClass === 'adjacent';
        const recursiveEligible = eligible && relevance.recursiveEligible;
        const deepEligible = eligible && relevance.deepEligible;
        const expansionStatus = query.manual_seed ? 'manual_preserved' : recursiveEligible ? 'offline_eligible' : 'skipped_relevance';
        update.run(relevance.relevanceClass, JSON.stringify(relevance.reasons), recursiveEligible ? 1 : 0,
          deepEligible ? 1 : 0, expansionStatus, recursiveEligible ? null : 'relevance', query.id);
      }
      setMeta(db, 'algorithm_version', ALGORITHM_VERSION);
    })();
    generateReport(db, runDir);
    return { queries: queries.length, runDir, backupFile };
  } finally {
    db.close();
  }
}
