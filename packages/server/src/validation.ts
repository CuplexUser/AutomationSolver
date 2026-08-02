import { z } from 'zod';

export const elementTypeSchema = z.enum([
  'contact-no',
  'contact-nc',
  'contact-rising',
  'contact-falling',
  'compare',
  'hwire',
  'coil-out',
  'coil-set',
  'coil-reset',
  'timer',
  'counter',
  'mov',
  'math',
  'pid',
]);

/**
 * Transport shape only. Whether the operands make sense for the element type is
 * `validateProgram`'s job in shared, which is the single place that rule lives
 * for both the client's live check and the server's authoritative one.
 */
export const elementSchema = z.object({
  type: elementTypeSchema,
  device: z.string().max(8),
  preset: z.number().int().min(0).max(32767).optional(),
  operands: z.array(z.string().max(8)).max(4).optional(),
  op: z.enum(['=', '<>', '>', '<', '>=', '<=', 'add', 'sub', 'mul', 'div']).optional(),
  pid: z
    .object({
      kp: z.number().int().min(0).max(32767),
      ti: z.number().int().min(0).max(600000),
      td: z.number().int().min(0).max(600000),
      sampleMs: z.number().int().min(1).max(60000),
      outMin: z.number().int().min(-32768).max(32767),
      outMax: z.number().int().min(-32768).max(32767),
      reverse: z.boolean().optional(),
    })
    .optional(),
});

export const rungSchema = z.object({
  id: z.string().min(1).max(64),
  rows: z.number().int().min(1).max(12),
  cols: z.number().int().min(1).max(16),
  cells: z.array(z.array(elementSchema.nullable())),
  vlinks: z.array(z.object({ row: z.number().int(), col: z.number().int() })),
  comment: z.string().max(200).optional(),
});

export const programSchema = z.object({
  // Transport ceiling only — the real per-puzzle limit is the spec's `maxRungs`,
  // checked in validateProgram. Keep this at or above the largest maxRungs in
  // content (elevator-full is 32) or those puzzles 400 before they ever grade.
  rungs: z.array(rungSchema).min(1).max(32),
});

export const wireSchema = z.object({
  id: z.string().min(1).max(64),
  from: z.string().min(1).max(64),
  to: z.string().min(1).max(64),
});

/** Cabinet-puzzle "program": the player's wiring document. */
export const wiringSchema = z.object({
  wires: z.array(wireSchema).max(80),
});

export const registerSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(60).optional(),
});

export const emailOnlySchema = z.object({
  email: z.string().email().max(200),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1).max(256),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(256),
  password: z.string().min(8).max(200),
});

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(60),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().min(8).max(200),
});

export const settingsSchema = z.object({
  settings: z.record(z.unknown()),
});

export type ProgramInput = z.infer<typeof programSchema>;
