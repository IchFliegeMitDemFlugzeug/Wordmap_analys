import 'dotenv/config';
import { openDatabase } from './src/db.mjs';
import { createSearchClient } from './src/yandex-search.mjs';
import { createWordstatClient } from './src/yandex-wordstat.mjs';

if (!process.env.YANDEX_API_KEY || !process.env.YANDEX_FOLDER_ID) {
  console.error('Ошибка: заполните YANDEX_API_KEY и YANDEX_FOLDER_ID в файле .env');
  process.exitCode = 1;
} else {
  const db = openDatabase(':memory:');
  try {
    const options = { apiKey: process.env.YANDEX_API_KEY, folderId: process.env.YANDEX_FOLDER_ID, db };
    const wordstat = createWordstatClient(options);
    const search = createSearchClient(options);
    const top = await wordstat.getTopRequests('мягкий топливный бак');
    console.log(`WORDSTAT OK\ntotalCount: ${top.totalCount}\nresults: ${top.results.length}\nassociations: ${top.associations.length}`);
    const frequency = await wordstat.measureFrequencies(
      'мягкий топливный бак',
      null,
      top.totalCount,
    );
    console.log(
      `WORDSTAT FREQUENCY OK\n` +
      `broad: ${frequency.broadCount}\n` +
      `quoted: ${frequency.quotedCount}\n` +
      `exact: ${frequency.exactCount}\n` +
      `ratio: ${frequency.broadExactRatio}\n` +
      `phantom: ${frequency.isPhantom}`
    );
    const serp = await search.search('мягкий топливный бак');
    console.log(`SEARCH OK\nresults: ${serp.results.length}\ntotalResults: ${serp.totalResults}`);
  } finally {
    db.close();
  }
}
