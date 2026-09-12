import { appendFileSync } from 'node:fs';

let logFile = null;

export function configureLogger(filename) {
  logFile = filename;
}

export function log(level, message) {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}`;
  if (level === 'error') console.error(line);
  else console.log(line);
  if (logFile) appendFileSync(logFile, `${line}\n`, 'utf8');
}
