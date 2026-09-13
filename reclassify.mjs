import { reclassifyRun } from './src/reclassify-run.mjs';

const runDirectory = process.argv[2];
if (!runDirectory) {
  console.error('Использование: npm run reclassify -- "<путь-к-run>"');
  process.exitCode = 1;
} else {
  try {
    const result = reclassifyRun(runDirectory);
    console.log(`Переклассифицировано запросов: ${result.queries}. Отчёт: ${result.runDir}/report.html`);
  } catch (error) {
    console.error(`Ошибка переклассификации: ${error.message}`);
    process.exitCode = 1;
  }
}
