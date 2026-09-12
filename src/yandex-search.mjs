import { parseSearchResults } from './vendor/yandex/search-parse.mjs';
import { fetchWithRetry, safeJsonParse } from './yandex-wordstat.mjs';
const ENDPOINT = 'https://searchapi.api.cloud.yandex.net/v2/web/search';
export async function searchYandex(query, { apiKey = process.env.YANDEX_API_KEY, folderId = process.env.YANDEX_FOLDER_ID } = {}) {
  const body = { query: { searchType: 'SEARCH_TYPE_RU', queryText: query, familyMode: 'FAMILY_MODE_NONE', page: 0, fixTypoMode: 'FIX_TYPO_MODE_ON' }, sortSpec: { sortMode: 'SORT_MODE_BY_RELEVANCE', sortOrder: 'SORT_ORDER_DESC' }, groupSpec: { groupMode: 'GROUP_MODE_DEEP', groupsOnPage: 10, docsInGroup: 1 }, maxPassages: 2, region: '225', l10N: 'LOCALIZATION_RU', folderId, responseFormat: 'FORMAT_XML' };
  const response = await fetchWithRetry(ENDPOINT, { method: 'POST', headers: { Authorization: `Api-Key ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if ([401,403].includes(response.status)) throw new Error('Доступ к Yandex Search API запрещён: проверьте ключ и Folder ID.');
  if (!response.ok) throw new Error(`Yandex Search API: HTTP ${response.status}`);
  const data = await safeJsonParse(response), xml = Buffer.from(data.rawData, 'base64').toString('utf8');
  const parsed = parseSearchResults(xml);
  return { results: parsed.results.slice(0,10).map((item,index) => ({ position:index+1,...item })), rawXml: xml };
}
