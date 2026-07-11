import { getDb } from './index.js';

export interface UserRow {
  id: number;
  email: string | null;
  password_hash: string | null;
  display_name: string;
  created_at: number;
}

export interface ProgressRow {
  puzzle_slug: string;
  status: string;
  best_score: number;
  solved_at: number | null;
  updated_at: number;
}

export interface SolutionRow {
  puzzle_slug: string;
  program_json: string;
  is_submitted: number;
  updated_at: number;
}

const now = () => Date.now();

// --- users ----------------------------------------------------------------
export function createUser(input: {
  email: string | null;
  passwordHash: string | null;
  displayName: string;
}): UserRow {
  const db = getDb();
  const res = db
    .prepare(
      'INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(input.email, input.passwordHash, input.displayName, now());
  return findUserById(Number(res.lastInsertRowid))!;
}

export function findUserById(id: number): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function findUserByEmail(email: string): UserRow | undefined {
  return getDb()
    .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE')
    .get(email) as UserRow | undefined;
}

// --- oauth ----------------------------------------------------------------
export function findOrCreateOAuthUser(input: {
  provider: string;
  providerUserId: string;
  email: string | null;
  displayName: string;
}): UserRow {
  const db = getDb();
  const existing = db
    .prepare('SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?')
    .get(input.provider, input.providerUserId) as { user_id: number } | undefined;
  if (existing) return findUserById(existing.user_id)!;

  // Link to an existing account with the same email, if any.
  let user: UserRow | undefined;
  if (input.email) user = findUserByEmail(input.email);
  if (!user) {
    user = createUser({ email: input.email, passwordHash: null, displayName: input.displayName });
  }
  db.prepare(
    'INSERT INTO oauth_accounts (user_id, provider, provider_user_id) VALUES (?, ?, ?)',
  ).run(user.id, input.provider, input.providerUserId);
  return user;
}

// --- progress -------------------------------------------------------------
export function getProgress(userId: number): ProgressRow[] {
  return getDb()
    .prepare(
      'SELECT puzzle_slug, status, best_score, solved_at, updated_at FROM progress WHERE user_id = ?',
    )
    .all(userId) as unknown as ProgressRow[];
}

export function upsertProgress(input: {
  userId: number;
  slug: string;
  status: string;
  score: number;
}): void {
  const db = getDb();
  const solvedAt = input.status === 'solved' ? now() : null;
  db.prepare(
    `INSERT INTO progress (user_id, puzzle_slug, status, best_score, solved_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, puzzle_slug) DO UPDATE SET
       status = CASE WHEN excluded.best_score >= progress.best_score THEN excluded.status ELSE progress.status END,
       best_score = MAX(progress.best_score, excluded.best_score),
       solved_at = COALESCE(progress.solved_at, excluded.solved_at),
       updated_at = excluded.updated_at`,
  ).run(input.userId, input.slug, input.status, input.score, solvedAt, now());
}

// --- solutions ------------------------------------------------------------
export function getSolution(userId: number, slug: string): SolutionRow | undefined {
  return getDb()
    .prepare(
      'SELECT puzzle_slug, program_json, is_submitted, updated_at FROM solutions WHERE user_id = ? AND puzzle_slug = ?',
    )
    .get(userId, slug) as SolutionRow | undefined;
}

export function upsertSolution(input: {
  userId: number;
  slug: string;
  programJson: string;
  isSubmitted: boolean;
}): void {
  getDb()
    .prepare(
      `INSERT INTO solutions (user_id, puzzle_slug, program_json, is_submitted, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, puzzle_slug) DO UPDATE SET
         program_json = excluded.program_json,
         is_submitted = MAX(solutions.is_submitted, excluded.is_submitted),
         updated_at = excluded.updated_at`,
    )
    .run(input.userId, input.slug, input.programJson, input.isSubmitted ? 1 : 0, now());
}

// --- settings -------------------------------------------------------------
export function getSettings(userId: number): Record<string, unknown> {
  const row = getDb()
    .prepare('SELECT settings_json FROM user_settings WHERE user_id = ?')
    .get(userId) as { settings_json: string } | undefined;
  if (!row) return {};
  try {
    return JSON.parse(row.settings_json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function upsertSettings(userId: number, settings: Record<string, unknown>): void {
  getDb()
    .prepare(
      `INSERT INTO user_settings (user_id, settings_json) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json`,
    )
    .run(userId, JSON.stringify(settings));
}
