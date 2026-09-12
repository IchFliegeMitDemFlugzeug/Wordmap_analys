import { writeFileSync } from 'node:fs';
import { getMeta } from './db.mjs';

export function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[;"\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const csv = (headers, rows) => `\uFEFF${[headers, ...rows.map((row) => headers.map((header) => row[header]))].map((row) => row.map(csvEscape).join(';')).join('\r\n')}\r\n`;
const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function generateReport(db, runDir) {
  const queryHeaders = ['id', 'query', 'normalized', 'depth', 'score', 'manual_seed', 'brand_seed', 'status', 'root_seed', 'top_total_count', 'discovered_count_max', 'dynamics_status', 'regions_status', 'serp_status'];
  const queries = db.prepare(`SELECT q.id,q.query,q.normalized,q.depth,q.score,q.manual_seed,q.brand_seed,q.status,q.root_seed,
    w.total_count top_total_count,(SELECT MAX(r.count) FROM relations r WHERE r.child_query_id=q.id) discovered_count_max,
    a.dynamics_status,a.regions_status,a.serp_status FROM queries q
    LEFT JOIN wordstat_top w ON w.query_id=q.id LEFT JOIN analysis_status a ON a.query_id=q.id ORDER BY q.score DESC,q.id`).all();
  writeFileSync(`${runDir}/queries.csv`, csv(queryHeaders, queries));

  const specifications = [
    ['relations', ['parent_query', 'child_query', 'relation_type', 'count'], `SELECT parent.query parent_query,child.query child_query,r.relation_type,r.count FROM relations r JOIN queries parent ON parent.id=r.parent_query_id JOIN queries child ON child.id=r.child_query_id ORDER BY parent.query,r.relation_type,r.count DESC`],
    ['clusters', ['id', 'name', 'query', 'score'], 'SELECT c.id,c.name,q.query,q.score FROM clusters c JOIN cluster_queries cq ON cq.cluster_id=c.id JOIN queries q ON q.id=cq.query_id'],
    ['serp', ['query', 'position', 'url', 'normalized_url', 'domain', 'title', 'snippet'], 'SELECT q.query,s.position,s.url,s.normalized_url,s.domain,s.title,s.snippet FROM serp s JOIN queries q ON q.id=s.query_id'],
    ['dynamics', ['query', 'date', 'count', 'share'], 'SELECT q.query,d.date,d.count,d.share FROM dynamics d JOIN queries q ON q.id=d.query_id'],
    ['regions', ['query', 'region_id', 'region_name', 'count', 'share', 'affinity_index'], 'SELECT q.query,r.region_id,r.region_name,r.count,r.share,r.affinity_index FROM regions r JOIN queries q ON q.id=r.query_id'],
  ];
  const data = {};
  for (const [name, headers, sql] of specifications) {
    data[name] = db.prepare(sql).all();
    writeFileSync(`${runDir}/${name}.csv`, csv(headers, data[name]));
  }

  const section = (title, rows, columns = ['query', 'score', 'top_total_count']) => `<section><h2>${title}</h2><table><thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column])}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`;
  const queryCounts = Object.fromEntries(['queued', 'processing', 'stored', 'done', 'failed'].map((status) => [status, queries.filter((query) => query.status === status).length]));
  const stageCounts = (stage) => Object.fromEntries(['pending', 'processing', 'done', 'failed'].map((status) => [status, queries.filter((query) => query[`${stage}_status`] === status).length]));
  const dynamics = stageCounts('dynamics');
  const regions = stageCounts('regions');
  const serp = stageCounts('serp');
  const direct = data.relations.filter((row) => row.relation_type === 'DIRECT').length;
  const associations = data.relations.filter((row) => row.relation_type === 'ASSOCIATION').length;
  const clustersCount = new Set(data.clusters.map((row) => row.id)).size;
  const statuses = (counts) => `pending ${counts.pending} / processing ${counts.processing} / done ${counts.done} / failed ${counts.failed}`;
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Wordmap — отчёт</title><style>body{font:15px system-ui;margin:2rem;color:#172033;background:#f5f7fb}h1,h2{color:#183b70}section{background:white;padding:1rem;margin:1rem 0;border-radius:10px;box-shadow:0 2px 8px #0001;overflow:auto}.note{border-left:5px solid #d98300}table{border-collapse:collapse;width:100%}th,td{padding:.45rem;border-bottom:1px solid #ddd;text-align:left}th{background:#eef3fa}</style><body><h1>Исследование поисковых запросов</h1>
  <section><b>Run status:</b> ${escapeHtml(getMeta(db, 'status') ?? '')}<br><b>Всего queries:</b> ${queries.length}; queued ${queryCounts.queued}; processing ${queryCounts.processing}; stored ${queryCounts.stored}; done ${queryCounts.done}; failed ${queryCounts.failed}<br><b>manual seeds:</b> ${queries.filter((query) => query.manual_seed).length}<br><b>DIRECT relations:</b> ${direct}; <b>ASSOCIATION relations:</b> ${associations}<br><b>Dynamics:</b> ${statuses(dynamics)}<br><b>Regions:</b> ${statuses(regions)}<br><b>SERP:</b> ${statuses(serp)}<br><b>Clusters count:</b> ${clustersCount}</section>
  <section class="note">Частотности Wordstat пересекаются и не являются количеством уникальных пользователей. Суммировать их напрямую нельзя.</section>
  ${section('Manual seeds', queries.filter((query) => query.manual_seed))}${section('HIGH priority', queries.filter((query) => query.score >= 6))}${section('Commercial', queries.filter((query) => /(купить|цена|заказ|производ|поставщик|продажа)/iu.test(query.query)))}${section('Брендовые', queries.filter((query) => query.brand_seed))}${section('Haoye', queries.filter((query) => /haoye/iu.test(query.query)))}${section('Кластеры', data.clusters, ['id', 'name', 'query', 'score'])}${section('SERP domains', data.serp, ['query', 'position', 'domain', 'url'])}${section('Dynamics', data.dynamics, ['query', 'date', 'count', 'share'])}${section('Regions', data.regions, ['query', 'region_name', 'count', 'share', 'affinity_index'])}${section('Noise', queries.filter((query) => query.score < 3))}${section('Relations / происхождение запросов', data.relations, ['parent_query', 'child_query', 'relation_type', 'count'])}</body></html>`;
  writeFileSync(`${runDir}/report.html`, html);
}
