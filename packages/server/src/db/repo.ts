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

export interface SolutionSlotRow {
  id: number;
  puzzle_slug: string;
  name: string;
  program_json: string;
  is_submitted: number;
  created_at: number;
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

// --- solutions (legacy single-draft table, read-only now) -----------------
// Kept only so listSlots() can lazily migrate a pre-slots draft into "Slot 1"
// the first time a returning player opens a puzzle; nothing writes here anymore.
export function getSolution(userId: number, slug: string): SolutionRow | undefined {
  return getDb()
    .prepare(
      'SELECT puzzle_slug, program_json, is_submitted, updated_at FROM solutions WHERE user_id = ? AND puzzle_slug = ?',
    )
    .get(userId, slug) as SolutionRow | undefined;
}

// --- solution slots ---------------------------------------------------------
function getSlotById(id: number): SolutionSlotRow | undefined {
  return getDb().prepare('SELECT * FROM solution_slots WHERE id = ?').get(id) as SolutionSlotRow | undefined;
}

export function getSlot(userId: number, slug: string, id: number): SolutionSlotRow | undefined {
  return getDb()
    .prepare('SELECT * FROM solution_slots WHERE id = ? AND user_id = ? AND puzzle_slug = ?')
    .get(id, userId, slug) as SolutionSlotRow | undefined;
}

export function createSlot(input: {
  userId: number;
  slug: string;
  name: string;
  programJson: string;
  isSubmitted?: boolean;
}): SolutionSlotRow {
  const db = getDb();
  const ts = now();
  const res = db
    .prepare(
      `INSERT INTO solution_slots (user_id, puzzle_slug, name, program_json, is_submitted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.userId, input.slug, input.name, input.programJson, input.isSubmitted ? 1 : 0, ts, ts);
  return getSlotById(Number(res.lastInsertRowid))!;
}

/** All slots for a puzzle, newest-first. Lazily migrates a legacy single draft into "Slot 1". */
export function listSlots(userId: number, slug: string): SolutionSlotRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM solution_slots WHERE user_id = ? AND puzzle_slug = ? ORDER BY updated_at DESC')
    .all(userId, slug) as unknown as SolutionSlotRow[];
  if (rows.length > 0) return rows;

  const legacy = getSolution(userId, slug);
  if (!legacy) return [];
  return [
    createSlot({
      userId,
      slug,
      name: 'Slot 1',
      programJson: legacy.program_json,
      isSubmitted: legacy.is_submitted === 1,
    }),
  ];
}

export function updateSlot(input: {
  userId: number;
  slug: string;
  id: number;
  name?: string;
  programJson?: string;
  isSubmitted?: boolean;
}): SolutionSlotRow | undefined {
  const existing = getSlot(input.userId, input.slug, input.id);
  if (!existing) return undefined;
  getDb()
    .prepare(
      `UPDATE solution_slots SET name = ?, program_json = ?, is_submitted = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND puzzle_slug = ?`,
    )
    .run(
      input.name ?? existing.name,
      input.programJson ?? existing.program_json,
      input.isSubmitted != null ? (input.isSubmitted ? 1 : 0) : existing.is_submitted,
      now(),
      input.id,
      input.userId,
      input.slug,
    );
  return getSlotById(input.id);
}

export function deleteSlot(userId: number, slug: string, id: number): boolean {
  const res = getDb()
    .prepare('DELETE FROM solution_slots WHERE id = ? AND user_id = ? AND puzzle_slug = ?')
    .run(id, userId, slug);
  return Number(res.changes) > 0;
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
