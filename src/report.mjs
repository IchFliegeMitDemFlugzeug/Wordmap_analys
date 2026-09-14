import { writeFileSync } from 'node:fs';
import { getMeta } from './db.mjs';

export function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[;"\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const csv = (headers, rows) => `\uFEFF${[headers, ...rows.map((row) => headers.map((header) => row[header]))].map((row) => row.map(csvEscape).join(';')).join('\r\n')}\r\n`;
const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function generateReport(db, runDir) {
  const queryHeaders = ['id', 'query', 'normalized', 'depth', 'score', 'relevance_class', 'relevance_reason', 'recursive_eligible', 'deep_eligible', 'expansion_status', 'skip_reason', 'manual_seed', 'brand_seed', 'status', 'root_seed', 'top_total_count', 'discovered_count_max', 'validated_broad_count', 'quoted_count', 'exact_count', 'broad_exact_ratio', 'is_phantom', 'latest_count', 'avg_last_12m', 'avg_prev_12m', 'growth_12m_pct', 'peak_24m', 'frequency_status', 'dynamics_status', 'regions_status', 'serp_status'];
  const queries = db.prepare(`SELECT q.id,q.query,q.normalized,q.depth,q.score,q.relevance_class,q.relevance_reason,q.recursive_eligible,q.deep_eligible,q.expansion_status,q.skip_reason,q.manual_seed,q.brand_seed,q.status,q.root_seed,
    w.total_count top_total_count,(SELECT MAX(r.count) FROM relations r WHERE r.child_query_id=q.id) discovered_count_max,
    f.broad_count validated_broad_count,f.quoted_count,f.exact_count,f.broad_exact_ratio,f.is_phantom,
    a.frequency_status,a.dynamics_status,a.regions_status,a.serp_status FROM queries q
    LEFT JOIN wordstat_top w ON w.query_id=q.id LEFT JOIN wordstat_frequency_validation f ON f.query_id=q.id
    LEFT JOIN analysis_status a ON a.query_id=q.id ORDER BY q.score DESC,q.id`).all();
  const dynamicsByQuery = new Map();
  for (const row of db.prepare('SELECT query_id,date,count FROM dynamics ORDER BY query_id,date').all()) {
    if (!dynamicsByQuery.has(row.query_id)) dynamicsByQuery.set(row.query_id, []);
    dynamicsByQuery.get(row.query_id).push(Number(row.count));
  }
  const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  for (const query of queries) {
    const values = (dynamicsByQuery.get(query.id) ?? []).slice(-24);
    const last = values.slice(-12);
    const previous = values.slice(-24, -12);
    query.latest_count = values.length ? values.at(-1) : null;
    query.avg_last_12m = average(last);
    query.avg_prev_12m = average(previous);
    query.growth_12m_pct = query.avg_prev_12m > 0 ? (query.avg_last_12m / query.avg_prev_12m - 1) * 100 : null;
    query.peak_24m = values.length ? Math.max(...values) : null;
  }
  writeFileSync(`${runDir}/queries.csv`, csv(queryHeaders, queries));

  const specifications = [
    ['relations', ['parent_query', 'child_query', 'relation_type', 'count'], `SELECT parent.query parent_query,child.query child_query,r.relation_type,r.count FROM relations r JOIN queries parent ON parent.id=r.parent_query_id JOIN queries child ON child.id=r.child_query_id ORDER BY parent.query,r.relation_type,r.count DESC`],
    ['clusters', ['id', 'name', 'query', 'score'], 'SELECT c.id,c.name,q.query,q.score FROM clusters c JOIN cluster_queries cq ON cq.cluster_id=c.id JOIN queries q ON q.id=cq.query_id'],
    ['serp', ['query', 'position', 'url', 'normalized_url', 'domain', 'title', 'snippet'], 'SELECT q.query,s.position,s.url,s.normalized_url,s.domain,s.title,s.snippet FROM serp s JOIN queries q ON q.id=s.query_id'],
    ['dynamics', ['query', 'date', 'count', 'share'], 'SELECT q.query,d.date,d.count,d.share FROM dynamics d JOIN queries q ON q.id=d.query_id'],
    ['regions', ['query', 'region_id', 'region_name', 'count', 'share', 'affinity_index'], 'SELECT q.query,r.region_id,r.region_name,r.count,r.share,r.affinity_index FROM regions r JOIN queries q ON q.id=r.query_id'],
    ['frequency_validation', ['query', 'relevance_class', 'manual_seed', 'broad_count', 'quoted_count', 'exact_count', 'broad_exact_ratio', 'is_phantom', 'threshold', 'retrieved_at'], 'SELECT q.query,q.relevance_class,q.manual_seed,f.broad_count,f.quoted_count,f.exact_count,f.broad_exact_ratio,f.is_phantom,f.threshold,f.retrieved_at FROM wordstat_frequency_validation f JOIN queries q ON q.id=f.query_id ORDER BY q.score DESC,q.id'],
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
  const frequency = stageCounts('frequency');
  const direct = data.relations.filter((row) => row.relation_type === 'DIRECT').length;
  const associations = data.relations.filter((row) => row.relation_type === 'ASSOCIATION').length;
  const clustersCount = new Set(data.clusters.map((row) => row.id)).size;
  const relevanceCounts = Object.fromEntries(['core', 'adjacent', 'broad', 'noise'].map((value) => [value, queries.filter((query) => query.relevance_class === value).length]));
  const expansionCount = (value) => queries.filter((query) => query.expansion_status === value).length;
  const popularity = (row) => row.top_total_count ?? row.discovered_count_max ?? 0;
  const priorityRows = (kind, limit = 30) => queries.filter((query) => query.relevance_class === kind).sort((a, b) => popularity(b) - popularity(a)).slice(0, limit);
  const relevantAnalyticalQueries = new Set(queries.filter((query) => ['core', 'adjacent'].includes(query.relevance_class)).map((query) => query.query));
  const analyticalRows = (rows) => rows.filter((row) => relevantAnalyticalQueries.has(row.query));
  const statuses = (counts) => `pending ${counts.pending} / processing ${counts.processing} / done ${counts.done} / failed ${counts.failed}`;
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Wordmap — отчёт</title><style>body{font:15px system-ui;margin:2rem;color:#172033;background:#f5f7fb}h1,h2{color:#183b70}section{background:white;padding:1rem;margin:1rem 0;border-radius:10px;box-shadow:0 2px 8px #0001;overflow:auto}.note{border-left:5px solid #d98300}table{border-collapse:collapse;width:100%}th,td{padding:.45rem;border-bottom:1px solid #ddd;text-align:left}th{background:#eef3fa}</style><body><h1>Исследование поисковых запросов</h1>
  <section><b>Run status:</b> ${escapeHtml(getMeta(db, 'status') ?? '')}; <b>algorithm:</b> ${escapeHtml(getMeta(db, 'algorithm_version') ?? 'legacy')}; <b>profile:</b> ${escapeHtml(getMeta(db, 'research_profile') ?? 'legacy')}<br><b>Всего queries:</b> ${queries.length}; queued ${queryCounts.queued}; processing ${queryCounts.processing}; stored ${queryCounts.stored}; done ${queryCounts.done}; failed ${queryCounts.failed}<br><b>Relevance:</b> core ${relevanceCounts.core}; adjacent ${relevanceCounts.adjacent}; broad ${relevanceCounts.broad}; noise ${relevanceCounts.noise}<br><b>Expansion:</b> expanded ${expansionCount('expanded')}; skipped by relevance ${expansionCount('skipped_relevance')}; skipped by root budget ${expansionCount('skipped_root_budget')}; skipped by global budget ${expansionCount('skipped_global_budget')}<br><b>Deep analysis candidates:</b> ${queries.filter((query) => query.dynamics_status != null).length}<br><b>manual seeds:</b> ${queries.filter((query) => query.manual_seed).length}<br><b>DIRECT relations:</b> ${direct}; <b>ASSOCIATION relations:</b> ${associations}<br><b>Frequency validation:</b> ${statuses(frequency)} / planned ${queries.filter((query) => query.frequency_status != null).length}<br><b>Dynamics:</b> ${statuses(dynamics)}<br><b>Regions:</b> ${statuses(regions)}<br><b>SERP:</b> ${statuses(serp)}<br><b>Clusters count:</b> ${clustersCount}</section>
  <section class="note">Частотности Wordstat пересекаются и не являются количеством уникальных пользователей. Суммировать их напрямую нельзя.</section>
  <section class="note">Broad — широкий спрос, включающий хвост. Quoted — фраза без дополнительных слов. Exact — фраза с фиксированными словоформами. Phantom — эвристический флаг broad/exact, не автоматический признак нерелевантности.</section>
  ${section('Manual seeds', queries.filter((query) => query.manual_seed))}${section('CORE', priorityRows('core'))}${section('ADJACENT', priorityRows('adjacent'))}${section('Проверенная частотность', data.frequency_validation.filter((row) => ['core', 'adjacent'].includes(row.relevance_class)), ['query', 'relevance_class', 'broad_count', 'quoted_count', 'exact_count', 'broad_exact_ratio', 'is_phantom'])}${section('Наиболее популярные BROAD', priorityRows('broad', 40))}${section('Примеры NOISE', priorityRows('noise', 25))}${section('Брендовые', queries.filter((query) => query.brand_seed))}${section('Кластеры', analyticalRows(data.clusters), ['id', 'name', 'query', 'score'])}${section('SERP domains', analyticalRows(data.serp), ['query', 'position', 'domain', 'url'])}${section('Dynamics', analyticalRows(data.dynamics), ['query', 'date', 'count', 'share'])}${section('Regions', analyticalRows(data.regions), ['query', 'region_name', 'count', 'share', 'affinity_index'])}${section('Relations / происхождение запросов', data.relations.slice(0, 500), ['parent_query', 'child_query', 'relation_type', 'count'])}</body></html>`;
  writeFileSync(`${runDir}/report.html`, html);
}
