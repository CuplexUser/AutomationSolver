import { getDriver } from './index.js';

export interface UserRow {
  id: number;
  email: string | null;
  password_hash: string | null;
  display_name: string;
  email_verified_at: number | null;
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
export async function createUser(input: {
  email: string | null;
  passwordHash: string | null;
  displayName: string;
  emailVerifiedAt?: number | null;
}): Promise<UserRow> {
  const db = await getDriver();
  const { id } = (await db.get<{ id: number }>(
    'INSERT INTO users (email, password_hash, display_name, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
    [input.email, input.passwordHash, input.displayName, input.emailVerifiedAt ?? null, now()],
  ))!;
  return (await findUserById(id))!;
}

export async function findUserById(id: number): Promise<UserRow | undefined> {
  return (await getDriver()).get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
}

export async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  return (await getDriver()).get<UserRow>('SELECT * FROM users WHERE lower(email) = lower(?)', [email]);
}

export async function markEmailVerified(userId: number): Promise<void> {
  await (await getDriver()).run('UPDATE users SET email_verified_at = ? WHERE id = ?', [now(), userId]);
}

export async function updatePasswordHash(userId: number, passwordHash: string): Promise<void> {
  await (await getDriver()).run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
}

export async function updateDisplayName(userId: number, displayName: string): Promise<void> {
  await (await getDriver()).run('UPDATE users SET display_name = ? WHERE id = ?', [displayName, userId]);
}

// --- oauth ----------------------------------------------------------------
export async function findOrCreateOAuthUser(input: {
  provider: string;
  providerUserId: string;
  email: string | null;
  displayName: string;
}): Promise<UserRow> {
  const db = await getDriver();
  const existing = await db.get<{ user_id: number }>(
    'SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?',
    [input.provider, input.providerUserId],
  );
  if (existing) return (await findUserById(existing.user_id))!;

  // Link to an existing account with the same email, if any.
  let user: UserRow | undefined;
  if (input.email) user = await findUserByEmail(input.email);
  if (!user) {
    user = await createUser({
      email: input.email,
      passwordHash: null,
      displayName: input.displayName,
      emailVerifiedAt: now(),
    });
  } else if (!user.email_verified_at) {
    // A successful OAuth login is proof of inbox ownership too.
    await markEmailVerified(user.id);
    user = (await findUserById(user.id))!;
  }
  await db.run('INSERT INTO oauth_accounts (user_id, provider, provider_user_id) VALUES (?, ?, ?)', [
    user.id,
    input.provider,
    input.providerUserId,
  ]);
  return user;
}

export async function getOAuthProviders(userId: number): Promise<string[]> {
  const rows = await (await getDriver()).all<{ provider: string }>(
    'SELECT provider FROM oauth_accounts WHERE user_id = ?',
    [userId],
  );
  return rows.map((row) => row.provider);
}

// --- email verification tokens ---------------------------------------------
export async function createEmailVerificationToken(
  userId: number,
  tokenHash: string,
  ttlMs: number,
): Promise<void> {
  const db = await getDriver();
  await db.run('DELETE FROM email_verification_tokens WHERE user_id = ?', [userId]);
  await db.run(
    'INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)',
    [userId, tokenHash, now() + ttlMs, now()],
  );
}

export async function findValidEmailVerificationToken(
  tokenHash: string,
): Promise<{ user_id: number } | undefined> {
  return (await getDriver()).get<{ user_id: number }>(
    'SELECT user_id FROM email_verification_tokens WHERE token_hash = ? AND expires_at > ?',
    [tokenHash, now()],
  );
}

export async function consumeEmailVerificationToken(tokenHash: string): Promise<void> {
  await (await getDriver()).run('DELETE FROM email_verification_tokens WHERE token_hash = ?', [tokenHash]);
}

// --- password reset tokens --------------------------------------------------
export async function createPasswordResetToken(
  userId: number,
  tokenHash: string,
  ttlMs: number,
): Promise<void> {
  const db = await getDriver();
  await db.run('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);
  await db.run(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)',
    [userId, tokenHash, now() + ttlMs, now()],
  );
}

export async function findValidPasswordResetToken(
  tokenHash: string,
): Promise<{ user_id: number } | undefined> {
  return (await getDriver()).get<{ user_id: number }>(
    'SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND expires_at > ?',
    [tokenHash, now()],
  );
}

export async function consumePasswordResetToken(tokenHash: string): Promise<void> {
  await (await getDriver()).run('DELETE FROM password_reset_tokens WHERE token_hash = ?', [tokenHash]);
}

// --- progress -------------------------------------------------------------
export async function getProgress(userId: number): Promise<ProgressRow[]> {
  return (await getDriver()).all<ProgressRow>(
    'SELECT puzzle_slug, status, best_score, solved_at, updated_at FROM progress WHERE user_id = ?',
    [userId],
  );
}

export async function upsertProgress(input: {
  userId: number;
  slug: string;
  status: string;
  score: number;
}): Promise<void> {
  const db = await getDriver();
  const solvedAt = input.status === 'solved' ? now() : null;
  await db.run(
    `INSERT INTO progress (user_id, puzzle_slug, status, best_score, solved_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, puzzle_slug) DO UPDATE SET
       status = CASE WHEN excluded.best_score >= progress.best_score THEN excluded.status ELSE progress.status END,
       best_score = CASE WHEN progress.best_score >= excluded.best_score THEN progress.best_score ELSE excluded.best_score END,
       solved_at = COALESCE(progress.solved_at, excluded.solved_at),
       updated_at = excluded.updated_at`,
    [input.userId, input.slug, input.status, input.score, solvedAt, now()],
  );
}

// --- solutions (legacy single-draft table, read-only now) -----------------
// Kept only so listSlots() can lazily migrate a pre-slots draft into "Slot 1"
// the first time a returning player opens a puzzle; nothing writes here anymore.
export async function getSolution(userId: number, slug: string): Promise<SolutionRow | undefined> {
  return (await getDriver()).get<SolutionRow>(
    'SELECT puzzle_slug, program_json, is_submitted, updated_at FROM solutions WHERE user_id = ? AND puzzle_slug = ?',
    [userId, slug],
  );
}

// --- solution slots ---------------------------------------------------------
async function getSlotById(id: number): Promise<SolutionSlotRow | undefined> {
  return (await getDriver()).get<SolutionSlotRow>('SELECT * FROM solution_slots WHERE id = ?', [id]);
}

export async function getSlot(
  userId: number,
  slug: string,
  id: number,
): Promise<SolutionSlotRow | undefined> {
  return (await getDriver()).get<SolutionSlotRow>(
    'SELECT * FROM solution_slots WHERE id = ? AND user_id = ? AND puzzle_slug = ?',
    [id, userId, slug],
  );
}

export async function createSlot(input: {
  userId: number;
  slug: string;
  name: string;
  programJson: string;
  isSubmitted?: boolean;
}): Promise<SolutionSlotRow> {
  const db = await getDriver();
  const ts = now();
  const { id } = (await db.get<{ id: number }>(
    `INSERT INTO solution_slots (user_id, puzzle_slug, name, program_json, is_submitted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [input.userId, input.slug, input.name, input.programJson, input.isSubmitted ? 1 : 0, ts, ts],
  ))!;
  return (await getSlotById(id))!;
}

/** All slots for a puzzle, newest-first. Lazily migrates a legacy single draft into "Slot 1". */
export async function listSlots(userId: number, slug: string): Promise<SolutionSlotRow[]> {
  const rows = await (await getDriver()).all<SolutionSlotRow>(
    'SELECT * FROM solution_slots WHERE user_id = ? AND puzzle_slug = ? ORDER BY updated_at DESC',
    [userId, slug],
  );
  if (rows.length > 0) return rows;

  const legacy = await getSolution(userId, slug);
  if (!legacy) return [];
  return [
    await createSlot({
      userId,
      slug,
      name: 'Slot 1',
      programJson: legacy.program_json,
      isSubmitted: legacy.is_submitted === 1,
    }),
  ];
}

export async function updateSlot(input: {
  userId: number;
  slug: string;
  id: number;
  name?: string;
  programJson?: string;
  isSubmitted?: boolean;
}): Promise<SolutionSlotRow | undefined> {
  const existing = await getSlot(input.userId, input.slug, input.id);
  if (!existing) return undefined;
  await (await getDriver()).run(
    `UPDATE solution_slots SET name = ?, program_json = ?, is_submitted = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND puzzle_slug = ?`,
    [
      input.name ?? existing.name,
      input.programJson ?? existing.program_json,
      input.isSubmitted != null ? (input.isSubmitted ? 1 : 0) : existing.is_submitted,
      now(),
      input.id,
      input.userId,
      input.slug,
    ],
  );
  return getSlotById(input.id);
}

export async function deleteSlot(userId: number, slug: string, id: number): Promise<boolean> {
  const res = await (await getDriver()).run(
    'DELETE FROM solution_slots WHERE id = ? AND user_id = ? AND puzzle_slug = ?',
    [id, userId, slug],
  );
  return res.changes > 0;
}

// --- settings -------------------------------------------------------------
export async function getSettings(userId: number): Promise<Record<string, unknown>> {
  const row = await (await getDriver()).get<{ settings_json: string }>(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    [userId],
  );
  if (!row) return {};
  try {
    return JSON.parse(row.settings_json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function upsertSettings(userId: number, settings: Record<string, unknown>): Promise<void> {
  await (await getDriver()).run(
    `INSERT INTO user_settings (user_id, settings_json) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json`,
    [userId, JSON.stringify(settings)],
  );
}
