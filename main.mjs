import 'dotenv/config';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { addQuery, getMeta, openDatabase, recoverProcessing, setMeta } from './src/db.mjs';
import { scoreQuery } from './src/scoring.mjs';
import { clusterSerp, expandBrands, parseInput, runResearch } from './src/research.mjs';
import { configureWordstat } from './src/yandex-wordstat.mjs';
import { searchYandex } from './src/yandex-search.mjs';
import { generateReport } from './src/report.mjs';
if(!process.env.YANDEX_API_KEY||!process.env.YANDEX_FOLDER_ID){console.error('Ошибка: заполните YANDEX_API_KEY и YANDEX_FOLDER_ID в файле .env');process.exitCode=1;}else{
 const input=readFileSync('input.txt','utf8'),hash=createHash('sha256').update(input).digest('hex'),root='results';mkdirSync(root,{recursive:true});let runDir;
 for(const name of readdirSync(root).sort().reverse()){const file=path.join(root,name,'research.sqlite');if(!existsSync(file))continue;const probe=new Database(file,{readonly:true});const same=probe.prepare("SELECT value FROM meta WHERE key='input_hash'").get()?.value===hash,status=probe.prepare("SELECT value FROM meta WHERE key='status'").get()?.value;probe.close();if(same&&status!=='completed'){runDir=path.join(root,name);break;}}
 if(!runDir){const d=new Date(),stamp=d.toISOString().replace(/[-:]/gu,'').replace('T','_').slice(0,15);runDir=path.join(root,stamp);mkdirSync(path.join(runDir,'raw'),{recursive:true});mkdirSync(path.join(runDir,'logs'),{recursive:true});copyFileSync('input.txt',path.join(runDir,'input.txt'));}
 const db=openDatabase(path.join(runDir,'research.sqlite'));setMeta(db,'input_hash',hash);setMeta(db,'status','running');recoverProcessing(db);const stop=()=>{db.close();console.log('\nИсследование приостановлено. Следующий запуск продолжит его.');process.exit(130);};process.once('SIGINT',stop);
 try{const {seeds,brands}=parseInput(input);for(const seed of seeds)addQuery(db,seed,{depth:0,score:scoreQuery(seed,{brands,manualSeed:true}),manualSeed:true});for(const seed of expandBrands(brands))addQuery(db,seed,{depth:0,score:scoreQuery(seed,{brands,manualSeed:true}),manualSeed:true,brandSeed:true});const wordstat=configureWordstat({apiKey:process.env.YANDEX_API_KEY,db});let last=0;const report=async()=>{const count=db.prepare('SELECT COUNT(*) n FROM api_calls WHERE success=1').get().n;if(count>=last+25){generateReport(db,runDir,{intermediate:true});last=count;}};await runResearch({db,client:{...wordstat,search:(q)=>searchYandex(q)},runDir,brands,generateReport:report});clusterSerp(db);generateReport(db,runDir);setMeta(db,'status','completed');console.log(`Готово: ${path.resolve(runDir,'report.html')}`);}finally{process.removeListener('SIGINT',stop);db.close();}
}
