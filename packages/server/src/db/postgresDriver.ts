import pg from 'pg';
import type { DbDriver } from './driver.js';
import { toPositionalPlaceholders } from './driver.js';

const { Pool } = pg;

// Mirrors sqliteDriver's SCHEMA table-for-table. Timestamps stay BIGINT epoch
// milliseconds (not timestamptz) and booleans stay INTEGER 0/1 (not BOOLEAN) so
// the values repo.ts reads and writes are identical on both engines — no
// per-driver value conversion anywhere above this file. Ids stay SERIAL
// (not uuid) so client/server types and every `number` id in this codebase
// need no migration.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT,
  display_name TEXT NOT NULL,
  email_verified_at BIGINT,
  created_at BIGINT NOT NULL
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at BIGINT;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  UNIQUE(provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS progress (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puzzle_slug TEXT NOT NULL,
  status TEXT NOT NULL,
  best_score INTEGER NOT NULL DEFAULT 0,
  solved_at BIGINT,
  updated_at BIGINT NOT NULL,
  UNIQUE(user_id, puzzle_slug)
);

CREATE TABLE IF NOT EXISTS solutions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puzzle_slug TEXT NOT NULL,
  program_json TEXT NOT NULL,
  is_submitted INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  UNIQUE(user_id, puzzle_slug)
);

CREATE TABLE IF NOT EXISTS solution_slots (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puzzle_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  program_json TEXT NOT NULL,
  is_submitted INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_solution_slots_user_puzzle ON solution_slots(user_id, puzzle_slug);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expire BIGINT NOT NULL
);
`;

export async function createPostgresDriver(connectionString: string): Promise<DbDriver> {
  const pool = new Pool({
    connectionString,
    // Neon (and most managed Postgres) terminate TLS with a chain that
    // node's default strict verification rejects; `sslmode=require` in the
    // connection string already guarantees the connection is encrypted.
    ssl: { rejectUnauthorized: false },
  });
  await pool.query(SCHEMA);

  return {
    kind: 'postgres',
    async run(sql, params = []) {
      const res = await pool.query(toPositionalPlaceholders(sql), params);
      return { changes: res.rowCount ?? 0 };
    },
    async get<T>(sql: string, params: unknown[] = []) {
      const res = await pool.query(toPositionalPlaceholders(sql), params);
      return res.rows[0] as T | undefined;
    },
    async all<T>(sql: string, params: unknown[] = []) {
      const res = await pool.query(toPositionalPlaceholders(sql), params);
      return res.rows as T[];
    },
    async close() {
      await pool.end();
    },
  };
}
