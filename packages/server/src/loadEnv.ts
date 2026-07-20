import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Minimal .env loader (pure JS, no dependency) — populates process.env from
// packages/server/.env before config.ts reads process.env.* at import time.
// Real environment variables always win; this only fills in what's unset.
const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');

try {
  const raw = readFileSync(envPath, 'utf-8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
} catch {
  // No .env file — fine, config.ts falls back to defaults / disabled providers.
}
