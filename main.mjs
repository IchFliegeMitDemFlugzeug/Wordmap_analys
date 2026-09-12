import 'dotenv/config';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { addQuery, calculateRunStatus, getMeta, openDatabase, recoverProcessing, setMeta } from './src/db.mjs';
import { configureLogger, log } from './src/logger.mjs';
import { generateReport } from './src/report.mjs';
import { clusterSerp, expandBrands, parseInput, runResearch } from './src/research.mjs';
import { scoreQuery } from './src/scoring.mjs';
import { createSearchClient } from './src/yandex-search.mjs';
import { createWordstatClient } from './src/yandex-wordstat.mjs';

async function main() {
  if (!process.env.YANDEX_API_KEY || !process.env.YANDEX_FOLDER_ID) {
    console.error('Ошибка: заполните YANDEX_API_KEY и YANDEX_FOLDER_ID в файле .env');
    process.exitCode = 1;
    return;
  }
  const input = readFileSync('input.txt', 'utf8');
  const hash = createHash('sha256').update(input).digest('hex');
  const root = 'results';
  mkdirSync(root, { recursive: true });
  let runDir;
  let resumed = false;
  for (const name of readdirSync(root).sort().reverse()) {
    const file = path.join(root, name, 'research.sqlite');
    if (!existsSync(file)) continue;
    const probe = new Database(file, { readonly: true });
    const same = probe.prepare("SELECT value FROM meta WHERE key='input_hash'").get()?.value === hash;
    const status = probe.prepare("SELECT value FROM meta WHERE key='status'").get()?.value;
    probe.close();
    if (same && (!status || ['running', 'paused', 'incomplete'].includes(status))) { runDir = path.join(root, name); resumed = true; break; }
  }
  if (!runDir) {
    const stamp = new Date().toISOString().replace(/[-:]/gu, '').replace('T', '_').slice(0, 15);
    runDir = path.join(root, stamp);
    mkdirSync(path.join(runDir, 'raw'), { recursive: true });
    mkdirSync(path.join(runDir, 'logs'), { recursive: true });
    copyFileSync('input.txt', path.join(runDir, 'input.txt'));
  } else {
    mkdirSync(path.join(runDir, 'raw'), { recursive: true });
    mkdirSync(path.join(runDir, 'logs'), { recursive: true });
  }
  configureLogger(path.join(runDir, 'logs', 'research.log'));
  const db = openDatabase(path.join(runDir, 'research.sqlite'));
  setMeta(db, 'input_hash', hash);
  setMeta(db, 'status', 'running');
  recoverProcessing(db);
  log('info', `Run ${resumed ? 'resume' : 'start'}: ${path.basename(runDir)}`);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    log('info', 'Ctrl+C');
    setMeta(db, 'status', 'paused');
    recoverProcessing(db);
    try { generateReport(db, runDir); } catch (error) { log('error', `Не удалось обновить отчёт при остановке: ${error.message}`); }
    db.close();
    console.log('Исследование приостановлено. Следующий запуск продолжит его.');
    process.exit(130);
  };
  process.once('SIGINT', stop);
  try {
    const { seeds, brands } = parseInput(input);
    for (const seed of seeds) addQuery(db, seed, { depth: 0, score: scoreQuery(seed, { brands, manualSeed: true }), manualSeed: true });
    for (const seed of expandBrands(brands)) addQuery(db, seed, { depth: 0, score: scoreQuery(seed, { brands, manualSeed: true }), manualSeed: true, brandSeed: true });
    const wordstat = createWordstatClient({ apiKey: process.env.YANDEX_API_KEY, folderId: process.env.YANDEX_FOLDER_ID, db });
    const search = createSearchClient({ apiKey: process.env.YANDEX_API_KEY, folderId: process.env.YANDEX_FOLDER_ID, db });
    let lastReportCount = db.prepare('SELECT COUNT(*) count FROM api_calls WHERE success=1').get().count;
    const report = async () => {
      const count = db.prepare('SELECT COUNT(*) count FROM api_calls WHERE success=1').get().count;
      if (count >= lastReportCount + 25) { generateReport(db, runDir, { intermediate: true }); lastReportCount = count; }
    };
    await runResearch({ db, client: { ...wordstat, search: search.search }, runDir, brands, generateReport: report });
    clusterSerp(db);
    const status = calculateRunStatus(db);
    setMeta(db, 'status', status);
    generateReport(db, runDir);
    log('info', `Run completed: ${status}`);
    console.log(`Готово: ${path.resolve(runDir, 'report.html')}`);
  } catch (error) {
    recoverProcessing(db);
    if (error.fatalAuth) { setMeta(db, 'status', 'paused'); log('error', `Fatal auth: ${error.message}`); }
    else { setMeta(db, 'status', 'incomplete'); log('error', `Unexpected error: ${error.stack ?? error.message}`); }
    try { generateReport(db, runDir); } catch (reportError) { log('error', `Не удалось обновить отчёт: ${reportError.message}`); }
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', stop);
    if (db.open) db.close();
  }
}

await main();
