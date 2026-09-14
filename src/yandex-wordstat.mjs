import { quotaState } from './db.mjs';
import { log } from './logger.mjs';
import { PHANTOM_RATIO_THRESHOLD } from './config.mjs';
import { toExactForm, toQuotedForm } from './wordstat-operators.mjs';

const BASE_URL = 'https://searchapi.api.cloud.yandex.net/v2/wordstat';
const TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);
const RETRY_DELAYS = [1_000, 2_000, 4_000, 8_000];
const MAX_ERROR_BODY = 100_000;

export const defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function flattenRegions(nodes, map = new Map()) {
  for (const node of nodes ?? []) {
    map.set(String(node.id), node.label);
    flattenRegions(node.children, map);
  }
  return map;
}

export function collectDescendantIds(nodes, targetId) {
  const result = new Set();
  const collect = (node) => {
    result.add(String(node.id));
    for (const child of node.children ?? []) collect(child);
  };
  const find = (items) => {
    for (const node of items ?? []) {
      if (String(node.id) === String(targetId)) { collect(node); return true; }
      if (find(node.children)) return true;
    }
    return false;
  };
  find(nodes);
  return result;
}

export function createWordstatClient({ apiKey, folderId, db, fetchImpl = globalThis.fetch, sleepImpl = defaultSleep, nowImpl = Date.now }) {
  let lastSentAt = null;
  let regionsTree = null;
  let regionNames = null;
  let russiaRegionIds = null;

  const recordAttempt = ({ method, queryId, status, startedAt, success, error, requestBody, responseBody }) => {
    db.prepare(`INSERT INTO api_calls(api,method,query_id,http_status,started_at,finished_at,success,error,request_json,response_json)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      'wordstat', method.replace(/^\//u, ''), queryId, status, startedAt,
      new Date(nowImpl()).toISOString(), success ? 1 : 0, error,
      JSON.stringify(requestBody), responseBody?.slice(0, MAX_ERROR_BODY) ?? null,
    );
  };

  async function waitBeforeAttempt() {
    const quota = quotaState(db, nowImpl());
    if (quota.waitMs > 0) {
      log('info', `Wordstat quota wait: ${quota.waitMs} ms`);
      await sleepImpl(quota.waitMs);
    }
    if (lastSentAt !== null) await sleepImpl(Math.max(0, 150 - (nowImpl() - lastSentAt)));
  }

  async function request(endpoint, body, queryId = null) {
    const requestBody = { ...body, folderId };
    let transientAttempt = 0;
    for (;;) {
      await waitBeforeAttempt();
      const startedAt = new Date(nowImpl()).toISOString();
      lastSentAt = nowImpl();
      let response;
      try {
        response = await fetchImpl(`${BASE_URL}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Api-Key ${apiKey}` },
          body: JSON.stringify(requestBody),
        });
      } catch (error) {
        recordAttempt({ method: endpoint, queryId, status: null, startedAt, success: false, error: error.message, requestBody });
        const delay = RETRY_DELAYS[transientAttempt++] ?? 60_000;
        if (delay === 60_000) { log('error', 'Wordstat network/server wait: 60 sec'); transientAttempt = 0; }
        await sleepImpl(delay);
        continue;
      }

      const responseText = await response.text();
      if (response.ok) {
        let data;
        try { data = responseText ? JSON.parse(responseText) : {}; }
        catch { data = null; }
        if (data === null) {
          recordAttempt({ method: endpoint, queryId, status: response.status, startedAt, success: false, error: 'Некорректный JSON API', requestBody, responseBody: responseText });
          const error = new Error(`Некорректный JSON API (HTTP ${response.status})`);
          error.permanent = true;
          throw error;
        }
        recordAttempt({ method: endpoint, queryId, status: response.status, startedAt, success: true, error: null, requestBody, responseBody: responseText });
        return data;
      }

      recordAttempt({ method: endpoint, queryId, status: response.status, startedAt, success: false, error: `HTTP ${response.status}`, requestBody, responseBody: responseText });
      if (response.status === 429) {
        const delay = parseRetryAfter(response.headers.get('retry-after'), nowImpl()) ?? 3_900_000;
        log('error', `Wordstat HTTP 429; wait: ${delay} ms`);
        transientAttempt = 0;
        await sleepImpl(delay);
        continue;
      }
      if (TRANSIENT_STATUSES.has(response.status)) {
        const delay = RETRY_DELAYS[transientAttempt++] ?? 60_000;
        if (delay === 60_000) { log('error', 'Wordstat network/server wait: 60 sec'); transientAttempt = 0; }
        await sleepImpl(delay);
        continue;
      }
      const error = new Error(`Wordstat API: HTTP ${response.status}${responseText ? ` — ${responseText.slice(0, 500)}` : ''}`);
      if (response.status === 401 || response.status === 403) error.fatalAuth = true;
      else if (response.status >= 400 && response.status < 500) error.permanent = true;
      throw error;
    }
  }

  async function getTopRequests(phrase, queryId) {
    const data = await request('/topRequests', { phrase, numPhrases: '2000', regions: ['225'], devices: ['DEVICE_ALL'] }, queryId);
    const normalize = (item) => ({ phrase: item.phrase, count: Number(item.count) });
    return { totalCount: Number(data.totalCount ?? 0), results: (data.results ?? []).map(normalize), associations: (data.associations ?? []).map(normalize), raw: data };
  }

  async function getTotalCount(phrase, queryId) {
    const data = await request('/topRequests', { phrase, numPhrases: '1', regions: ['225'], devices: ['DEVICE_ALL'] }, queryId);
    return Number(data.totalCount ?? 0);
  }

  async function measureFrequencies(phrase, queryId, knownBroad = null) {
    const broadCount = knownBroad == null ? await getTotalCount(phrase, queryId) : Number(knownBroad);
    const quotedCount = await getTotalCount(toQuotedForm(phrase), queryId);
    const exactCount = await getTotalCount(toExactForm(phrase), queryId);
    const broadExactRatio = exactCount > 0 ? broadCount / exactCount : null;
    const isPhantom = (broadCount > 0 && exactCount === 0) || (exactCount > 0 && broadExactRatio >= PHANTOM_RATIO_THRESHOLD);
    return { broadCount, quotedCount, exactCount, broadExactRatio, isPhantom, threshold: PHANTOM_RATIO_THRESHOLD };
  }

  async function getDynamics(phrase, dates, queryId) {
    const data = await request('/dynamics', {
      phrase, period: 'PERIOD_MONTHLY', fromDate: `${dates.fromDate}T00:00:00Z`, toDate: `${dates.toDate}T00:00:00Z`,
      regions: ['225'], devices: ['DEVICE_ALL'],
    }, queryId);
    return { results: (data.results ?? []).map((item) => ({ date: String(item.date).split('T')[0], count: Number(item.count ?? 0), share: finiteOrNull(item.share) })), raw: data };
  }

  async function getRegionsTree() {
    if (regionsTree) return { regions: regionsTree, regionNames, russiaRegionIds, raw: { regions: regionsTree } };
    const raw = await request('/getRegionsTree', {});
    regionsTree = raw.regions ?? [];
    regionNames = flattenRegions(regionsTree);
    russiaRegionIds = collectDescendantIds(regionsTree, '225');
    return { regions: regionsTree, regionNames, russiaRegionIds, raw };
  }

  async function getRegionsDistribution(phrase, queryId) {
    await getRegionsTree();
    const data = await request('/regions', { phrase, region: 'REGION_REGIONS', devices: ['DEVICE_ALL'] }, queryId);
    const results = (data.results ?? []).filter((item) => russiaRegionIds.has(String(item.region))).map((item) => ({
      regionId: String(item.region), regionName: regionNames.get(String(item.region)) ?? `Region ${item.region}`,
      count: Number(item.count ?? 0), share: finiteOrNull(item.share), affinityIndex: finiteOrNull(item.affinityIndex),
    }));
    return { results, raw: data };
  }

  return { getTopRequests, getTotalCount, measureFrequencies, getDynamics, getRegionsDistribution, getRegionsTree };
}
