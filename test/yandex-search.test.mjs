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
  assert.deepEqual(sent.body, { query: { searchType: 'SEARCH_TYPE_RU', queryText: 'мягкий бак', familyMode: 'FAMILY_MODE_NONE', page: '0', fixTypoMode: 'FIX_TYPO_MODE_ON' }, sortSpec: { sortMode: 'SORT_MODE_BY_RELEVANCE', sortOrder: 'SORT_ORDER_DESC' }, groupSpec: { groupMode: 'GROUP_MODE_DEEP', groupsOnPage: '10', docsInGroup: '1' }, region: '225', l10n: 'LOCALIZATION_RU', folderId: 'folder-test', responseFormat: 'FORMAT_XML' });
  assert.equal(sent.body.l10n, 'LOCALIZATION_RU');
  assert.equal(Object.hasOwn(sent.body, 'l10N'), false);
  assert.equal(result.totalResults, 123);
  assert.equal(result.results[0].position, 1);
  assert.equal(result.results[0].url, 'https://example.ru/a');
  db.close();
});

test('XML error 15 is a successful empty result without sleep', async () => {
  const db = openDatabase(':memory:');
  const sleeps = [];
  const client = createSearchClient({ apiKey: 'x', folderId: 'f', db, sleepImpl: async (ms) => sleeps.push(ms), fetchImpl: async () => xmlResponse('<response><error code="15">Нет результатов</error></response>') });
  const result = await client.search('none');
  assert.equal(result.results.length, 0);
  assert.equal(result.totalResults, 0);
  assert.deepEqual(sleeps, []);
  assert.equal(db.prepare('SELECT success FROM api_calls').get().success, 1);
  db.close();
});

for (const [code, delay] of [[20, 60_000], [55, 2_000], [32, 3_600_000]]) {
  test(`transient XML error ${code} waits ${delay} ms and retries`, async () => {
    const db = openDatabase(':memory:');
    const sleeps = [];
    let attempts = 0;
    const client = createSearchClient({ apiKey: 'x', folderId: 'f', db, sleepImpl: async (ms) => sleeps.push(ms), fetchImpl: async () => xmlResponse(attempts++ === 0 ? `<response><error code="${code}">Временная ошибка</error></response>` : normalXml) });
    assert.equal((await client.search('retry')).totalResults, 123);
    assert.deepEqual(sleeps, [delay]);
    assert.deepEqual(db.prepare('SELECT success FROM api_calls ORDER BY id').all().map((row) => row.success), [0, 1]);
    db.close();
  });
}

for (const [code, property] of [[31, 'fatalAuth'], [18, 'permanent'], [999, 'permanent']]) {
  test(`XML error ${code} is rejected as ${property} without retry`, async () => {
    const db = openDatabase(':memory:');
    const sleeps = [];
    let attempts = 0;
    const client = createSearchClient({ apiKey: 'x', folderId: 'f', db, sleepImpl: async (ms) => sleeps.push(ms), fetchImpl: async () => { attempts += 1; return xmlResponse(`<response><error code="${code}">Ошибка</error></response>`); } });
    await assert.rejects(client.search('bad'), (error) => error[property] === true);
    assert.deepEqual(sleeps, []);
    assert.equal(attempts, 1);
    assert.equal(db.prepare('SELECT success FROM api_calls').get().success, 0);
    db.close();
  });
}
