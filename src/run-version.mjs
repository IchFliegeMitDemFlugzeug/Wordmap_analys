import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ALGORITHM_VERSION, CONFIG_FINGERPRINT } from './config.mjs';

// Read-only probing guarantees that legacy runs are neither migrated nor otherwise modified.
export function findResumableRun(root, inputHash, algorithmVersion = ALGORITHM_VERSION, configFingerprint = CONFIG_FINGERPRINT) {
  if (!existsSync(root)) return undefined;
  for (const name of readdirSync(root).sort().reverse()) {
    const file = path.join(root, name, 'research.sqlite');
    if (!existsSync(file)) continue;
    const probe = new Database(file, { readonly: true });
    try {
      const rows = probe.prepare("SELECT key,value FROM meta WHERE key IN ('input_hash','algorithm_version','config_fingerprint','status','resume_disabled')").all();
      const meta = Object.fromEntries(rows.map((row) => [row.key, row.value]));
      if (meta.resume_disabled !== '1' && meta.input_hash === inputHash && meta.algorithm_version === String(algorithmVersion) && meta.config_fingerprint === configFingerprint &&
          (!meta.status || ['running', 'paused', 'incomplete'].includes(meta.status))) return path.join(root, name);
    } finally {
      probe.close();
    }
  }
  return undefined;
}
