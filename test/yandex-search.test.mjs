import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.mjs';
import { createSearchClient } from '../src/yandex-search.mjs';

const xmlResponse = (xml) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ rawData: Buffer.from(xml).toString('base64') }) });
const normalXml = '<response><found priority="all">123</found><found-human>нашлось 123</found-human><group><doc><url>https://example.ru/a</url><domain>example.ru</domain><title>Тест</title><passage>Описание</passage></doc></group></response>';

test('Search sends exact v2 body and parses TOP result', async () => {
  const db = openDatabase(':memory:');
  let sent;
  const client = createSearchClient({ apiKey: 'secret', folderId: 'folder-test', db, sleepImpl: async () => {}, fetchImpl: async (url, options) => { sent = { url, body: JSON.parse(options.body) }; return xmlResponse(normalXml); } });
  const result = await client.search('мягкий бак', 7);
  assert.equal(sent.url, 'https://searchapi.api.cloud.yandex.net/v2/web/search');
  assert.deepEqual(sent.body, { query: { searchType: 'SEARCH_TYPE_RU', queryText: 'мягкий бак', familyMode: 'FAMILY_MODE_NONE', page: '0', fixTypoMode: 'FIX_TYPO_MODE_ON' }, sortSpec: { sortMode: 'SORT_MODE_BY_RELEVANCE', sortOrder: 'SORT_ORDER_DESC' }, groupSpec: { groupMode: 'GROUP_MODE_DEEP', groupsOnPage: '10', docsInGroup: '1' }, region: '225', l10N: 'LOCALIZATION_RU', folderId: 'folder-test', responseFormat: 'FORMAT_XML' });
  assert.equal(result.totalResults, 123);
  assert.equal(result.results[0].position, 1);
  assert.equal(result.results[0].url, 'https://example.ru/a');
  db.close();
});

test('XML error 15 is empty, another XML error is retried', async () => {
  const emptyDb = openDatabase(':memory:');
  const empty = createSearchClient({ apiKey: 'x', folderId: 'f', db: emptyDb, sleepImpl: async () => {}, fetchImpl: async () => xmlResponse('<response><error code="15">Нет результатов</error></response>') });
  assert.deepEqual(await empty.search('none'), { results: [], rawXml: '<response><error code="15">Нет результатов</error></response>', totalResults: 0 });
  emptyDb.close();
  const retryDb = openDatabase(':memory:');
  const sleeps = [];
  let attempts = 0;
  const retry = createSearchClient({ apiKey: 'x', folderId: 'f', db: retryDb, sleepImpl: async (ms) => sleeps.push(ms), fetchImpl: async () => xmlResponse(attempts++ === 0 ? '<response><error code="20">System error</error></response>' : normalXml) });
  assert.equal((await retry.search('retry')).totalResults, 123);
  assert.deepEqual(sleeps, [60_000]);
  retryDb.close();
});
