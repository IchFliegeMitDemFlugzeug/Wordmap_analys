import { log } from './logger.mjs';
import { defaultSleep, parseRetryAfter } from './yandex-wordstat.mjs';
import { EMPTY_RESULT_ERROR_CODES, parseError, parseFound, parseSearchResults } from './vendor/yandex/search-parse.mjs';

const ENDPOINT = 'https://searchapi.api.cloud.yandex.net/v2/web/search';
const TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);
const TRANSIENT_XML_ERROR_CODES = new Set([20, 32, 55]);
const FATAL_XML_ERROR_CODES = new Set([31, 33, 42, 44, 48]);
const PERMANENT_XML_ERROR_CODES = new Set([1, 2, 18, 19, 37, 100, 10002]);
const XML_RETRY_DELAYS = new Map([[20, 60_000], [32, 3_600_000], [55, 2_000]]);
const RETRY_DELAYS = [1_000, 2_000, 4_000, 8_000];
const MAX_ERROR_BODY = 100_000;

export function createSearchClient({ apiKey, folderId, db, fetchImpl = globalThis.fetch, sleepImpl = defaultSleep }) {
  const recordAttempt = ({ queryId, status, startedAt, success, error, body, responseBody }) => {
    db.prepare(`INSERT INTO api_calls(api,method,query_id,http_status,started_at,finished_at,success,error,request_json,response_json)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      'search', 'web/search', queryId, status, startedAt, new Date().toISOString(), success ? 1 : 0,
      error, JSON.stringify(body), responseBody?.slice(0, MAX_ERROR_BODY) ?? null,
    );
  };

  async function search(query, queryId) {
    const body = {
      query: { searchType: 'SEARCH_TYPE_RU', queryText: query, familyMode: 'FAMILY_MODE_NONE', page: '0', fixTypoMode: 'FIX_TYPO_MODE_ON' },
      sortSpec: { sortMode: 'SORT_MODE_BY_RELEVANCE', sortOrder: 'SORT_ORDER_DESC' },
      groupSpec: { groupMode: 'GROUP_MODE_DEEP', groupsOnPage: '10', docsInGroup: '1' },
      region: '225', l10n: 'LOCALIZATION_RU', folderId, responseFormat: 'FORMAT_XML',
    };
    let transientAttempt = 0;
    for (;;) {
      const startedAt = new Date().toISOString();
      let response;
      try {
        response = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Api-Key ${apiKey}` },
          body: JSON.stringify(body),
        });
      } catch (error) {
        recordAttempt({ queryId, status: null, startedAt, success: false, error: error.message, body });
        const delay = RETRY_DELAYS[transientAttempt++] ?? 60_000;
        if (delay === 60_000) { log('error', 'Search network/server wait: 60 sec'); transientAttempt = 0; }
        await sleepImpl(delay);
        continue;
      }
      const responseText = await response.text();
      if (response.status === 429) {
        recordAttempt({ queryId, status: response.status, startedAt, success: false, error: 'HTTP 429', body, responseBody: responseText });
        const delay = parseRetryAfter(response.headers.get('retry-after')) ?? 60_000;
        log('error', `Search HTTP 429; wait: ${delay} ms`);
        transientAttempt = 0;
        await sleepImpl(delay);
        continue;
      }
      if (TRANSIENT_STATUSES.has(response.status)) {
        recordAttempt({ queryId, status: response.status, startedAt, success: false, error: `HTTP ${response.status}`, body, responseBody: responseText });
        const delay = RETRY_DELAYS[transientAttempt++] ?? 60_000;
        if (delay === 60_000) { log('error', 'Search network/server wait: 60 sec'); transientAttempt = 0; }
        await sleepImpl(delay);
        continue;
      }
      if (!response.ok) {
        recordAttempt({ queryId, status: response.status, startedAt, success: false, error: `HTTP ${response.status}`, body, responseBody: responseText });
        const error = new Error(`Yandex Search API: HTTP ${response.status}${responseText ? ` — ${responseText.slice(0, 500)}` : ''}`);
        if (response.status === 401 || response.status === 403) error.fatalAuth = true;
        else if (response.status >= 400 && response.status < 500) error.permanent = true;
        throw error;
      }
      let data;
      try { data = responseText ? JSON.parse(responseText) : {}; }
      catch {
        recordAttempt({ queryId, status: response.status, startedAt, success: false, error: 'Некорректный JSON API', body, responseBody: responseText });
        const error = new Error(`Некорректный JSON API (HTTP ${response.status})`);
        error.permanent = true;
        throw error;
      }
      if (!data.rawData) {
        recordAttempt({ queryId, status: response.status, startedAt, success: true, error: null, body, responseBody: responseText });
        return { results: [], rawXml: '', totalResults: 0 };
      }
      const xml = Buffer.from(data.rawData, 'base64').toString('utf8');
      const apiError = parseError(xml);
      if (apiError && !EMPTY_RESULT_ERROR_CODES.has(apiError.code)) {
        recordAttempt({ queryId, status: response.status, startedAt, success: false, error: `XML error ${apiError.code}: ${apiError.message}`, body, responseBody: responseText });
        const error = new Error(`Yandex Search XML: ${apiError.message} (${apiError.code})`);
        if (TRANSIENT_XML_ERROR_CODES.has(apiError.code)) {
          const delay = XML_RETRY_DELAYS.get(apiError.code);
          log('error', `Search XML error ${apiError.code}; retry in ${delay} ms`);
          await sleepImpl(delay);
          transientAttempt = 0;
          continue;
        }
        if (FATAL_XML_ERROR_CODES.has(apiError.code)) error.fatalAuth = true;
        else if (PERMANENT_XML_ERROR_CODES.has(apiError.code)) error.permanent = true;
        else error.permanent = true;
        throw error;
      }
      if (apiError) {
        recordAttempt({ queryId, status: response.status, startedAt, success: true, error: null, body, responseBody: responseText });
        return { results: [], rawXml: xml, totalResults: 0 };
      }
      const { total } = parseFound(xml);
      const results = parseSearchResults(xml);
      recordAttempt({ queryId, status: response.status, startedAt, success: true, error: null, body, responseBody: responseText });
      return { results: results.slice(0, 10), rawXml: xml, totalResults: total ?? results.length };
    }
  }
  return { search };
}
