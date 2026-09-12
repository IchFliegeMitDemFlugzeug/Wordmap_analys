# Wordmap analys

Локальная программа исследует семантику через официальные API Яндекса, хранит данные в SQLite и создаёт автономный HTML-отчёт.

## Запуск

1. Установите Node.js 22.
2. Выполните `npm install`.
3. Выполните `copy .env.example .env`.
4. Заполните в `.env` Yandex Cloud API key и Folder ID.
5. Измените `input.txt`.
6. Выполните `node main.mjs` (в Windows можно открыть `START.cmd`).
7. Откройте `results/<timestamp>/report.html`.

Проверка доступа к API: `npm run smoke`.

Ответ HTTP 429 программа пережидает сама. `Ctrl+C` безопасен: состояние сохраняется. Повторный `node main.mjs` продолжает незавершённое исследование с тем же `input.txt`.
