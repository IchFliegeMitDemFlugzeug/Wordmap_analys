const BASE = 'https://api.wordstat.yandex.net/v1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function fetchWithRetry(url, options, onResponse = async () => {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, options); await onResponse(response);
      if (![500,502,503,504].includes(response.status) || attempt === 4) return response;
    } catch (error) { if (attempt === 4) throw error; }
    await sleep(1000 * (2 ** attempt));
  }
}
export async function safeJsonParse(response) { const text = await response.text(); try { return JSON.parse(text); } catch { throw new Error(`Некорректный JSON API (HTTP ${response.status})`); } }
export function normalizeTree(nodes = []) { return nodes.map((node) => ({ id: String(node.id), name: node.name, type: node.type, children: normalizeTree(node.children ?? []) })); }
export function buildFlatMap(nodes, map = new Map()) { for (const node of nodes) { map.set(String(node.id), node.name); buildFlatMap(node.children ?? [], map); } return map; }
export function createWordstatClient({ apiKey, db }) {
  let lastCall = 0;
  async function request(method, body, queryId = null) {
    const { quotaState } = await import('./db.mjs'); const quota = quotaState(db); if (quota.waitMs) await sleep(quota.waitMs);
    await sleep(Math.max(0, 150 - (Date.now() - lastCall)));
    for (;;) {
      const started = new Date().toISOString(); let response;
      try {
        response = await fetchWithRetry(`${BASE}${method}`, { method: 'POST', headers: { Authorization: `Api-Key ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); lastCall = Date.now();
        const finished = new Date().toISOString(); db.prepare('INSERT INTO api_calls(api,method,query_id,http_status,started_at,finished_at,success,error) VALUES(?,?,?,?,?,?,?,?)').run('wordstat',method,queryId,response.status,started,finished,response.ok ? 1 : 0,response.ok ? null : `HTTP ${response.status}`);
        if ([401,403].includes(response.status)) throw new Error('Доступ к Yandex API запрещён: проверьте ключ и Folder ID.');
        if (response.status === 429) { const retry = Number(response.headers.get('retry-after')); await sleep(Number.isFinite(retry) ? retry * 1000 : 3900000); continue; }
        if (!response.ok) throw new Error(`Wordstat API: HTTP ${response.status}`);
        return safeJsonParse(response);
      } catch (error) { if (response && [401,403].includes(response.status)) throw error; throw error; }
    }
  }
  return {
    getTopRequests: (phrase, queryId) => request('/topRequests', { phrase, numPhrases: 2000, regions: ['225'], devices: ['DEVICE_ALL'] }, queryId),
    getDynamics: (phrase, dates, queryId) => request('/dynamics', { phrase, period: 'PERIOD_MONTHLY', region: '225', device: 'DEVICE_ALL', ...dates }, queryId),
    getRegionsDistribution: (phrase, queryId) => request('/regions', { phrase, regionType: 'REGION_REGIONS', devices: ['DEVICE_ALL'] }, queryId),
    getRegionsTree: () => request('/getRegionsTree', {}),
  };
}
let defaultClient;
export function configureWordstat(options) { defaultClient = createWordstatClient(options); return defaultClient; }
export const getTopRequests = (...args) => defaultClient.getTopRequests(...args);
export const getDynamics = (...args) => defaultClient.getDynamics(...args);
export const getRegionsDistribution = (...args) => defaultClient.getRegionsDistribution(...args);
export const getRegionsTree = (...args) => defaultClient.getRegionsTree(...args);
