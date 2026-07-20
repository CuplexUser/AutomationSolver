import { z } from 'zod';

export const elementTypeSchema = z.enum([
  'contact-no',
  'contact-nc',
  'contact-rising',
  'contact-falling',
  'hwire',
  'coil-out',
  'coil-set',
  'coil-reset',
  'timer',
  'counter',
]);

export const elementSchema = z.object({
  type: elementTypeSchema,
  device: z.string().max(8),
  preset: z.number().int().min(0).max(32767).optional(),
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
  rungs: z.array(rungSchema).min(1).max(24),
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

export const settingsSchema = z.object({
  settings: z.record(z.unknown()),
});

export type ProgramInput = z.infer<typeof programSchema>;
