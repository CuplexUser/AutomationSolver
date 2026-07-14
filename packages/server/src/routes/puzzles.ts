import { Router } from 'express';
import {
  gradeProgram,
  gradeWiring,
  getPuzzle,
  PUZZLES,
  validateProgram,
  validateWiring,
  type LadderProgram,
  type PuzzleCategory,
  type PuzzleSpec,
  type WiringDoc,
} from '@automationsolver/shared';
import {
  createSlot,
  deleteSlot,
  getProgress,
  getSettings,
  getSlot,
  listSlots,
  updateSlot,
  upsertProgress,
  upsertSettings,
  type SolutionSlotRow,
} from '../db/repo.js';
import { config } from '../config.js';
import { asyncHandler, requireAuth } from '../http.js';
import { programSchema, wiringSchema } from '../validation.js';

function slotSummary(s: SolutionSlotRow) {
  return { id: s.id, name: s.name, updatedAt: s.updated_at, isSubmitted: s.is_submitted === 1 };
}

type ParsedProgram =
  | { ok: true; json: string; program: LadderProgram | WiringDoc }
  | { ok: false; details: unknown };

/** Parse a submitted program body with the schema matching the puzzle kind. */
function parseProgramBody(spec: PuzzleSpec, body: unknown): ParsedProgram {
  const schema = spec.kind === 'cabinet' ? wiringSchema : programSchema;
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, details: parsed.error.flatten() };
  return { ok: true, json: JSON.stringify(parsed.data), program: parsed.data as LadderProgram | WiringDoc };
}

export const puzzlesRouter = Router();

function progressMap(userId: number | undefined): Map<string, { status: string; score: number }> {
  const map = new Map<string, { status: string; score: number }>();
  if (userId == null) return map;
  for (const p of getProgress(userId)) map.set(p.puzzle_slug, { status: p.status, score: p.best_score });
  return map;
}

interface LockEntry {
  locked: boolean;
  requiresSlug?: string;
  requiresTitle?: string;
}

/**
 * Per-category sequential gating: the first puzzle of each category is always
 * unlocked; within a category, a puzzle is locked unless its predecessor is
 * solved. A puzzle that's already solved is never locked, even if a neighbor
 * isn't — otherwise a solve that predates this feature (or an out-of-order
 * solve) would flip a puzzle from solved to locked.
 *
 * Dev unlock: outside production, a user can flip `devUnlockAll` in settings
 * to bypass this entirely (all puzzles open). Gated on !config.isProd so it
 * can't be used to skip progression in a real deployment.
 */
function lockInfo(userId: number | undefined): Map<string, LockEntry> {
  const map = new Map<string, LockEntry>();
  if (!config.isProd && userId != null && getSettings(userId).devUnlockAll === true) {
    for (const p of PUZZLES) map.set(p.slug, { locked: false });
    return map;
  }
  const progress = progressMap(userId);
  const prevByCategory = new Map<PuzzleCategory, { slug: string; title: string; solved: boolean }>();
  for (const p of PUZZLES) {
    const prev = prevByCategory.get(p.category);
    const solved = progress.get(p.slug)?.status === 'solved';
    const locked = prev != null && !prev.solved && !solved;
    map.set(
      p.slug,
      locked ? { locked: true, requiresSlug: prev.slug, requiresTitle: prev.title } : { locked: false },
    );
    prevByCategory.set(p.category, { slug: p.slug, title: p.title, solved });
  }
  return map;
}

puzzlesRouter.get('/puzzles', (req, res) => {
  const map = progressMap(req.user?.id);
  const locks = lockInfo(req.user?.id);
  const list = PUZZLES.map((p) => {
    const lock = locks.get(p.slug);
    return {
      slug: p.slug,
      title: p.title,
      difficulty: p.difficulty,
      order: p.order,
      category: p.category,
      summary: p.summary,
      status: map.get(p.slug)?.status ?? 'unsolved',
      bestScore: map.get(p.slug)?.score ?? 0,
      locked: lock?.locked ?? false,
      requiresTitle: lock?.requiresTitle,
    };
  });
  res.json({ puzzles: list });
});

puzzlesRouter.get('/puzzles/:slug', (req, res) => {
  const spec = getPuzzle(req.params.slug);
  if (!spec) return res.status(404).json({ error: 'Puzzle not found' });
  const lock = lockInfo(req.user?.id).get(spec.slug);
  if (lock?.locked) {
    return res
      .status(403)
      .json({ error: 'locked', requiresSlug: lock.requiresSlug, requiresTitle: lock.requiresTitle });
  }
  const userId = req.user?.id;
  const slots = userId != null ? listSlots(userId, spec.slug) : [];
  const prog = userId != null ? progressMap(userId).get(spec.slug) : undefined;
  return res.json({
    puzzle: spec,
    slots: slots.map(slotSummary),
    progress: prog ? { status: prog.status, bestScore: prog.score } : null,
  });
});

puzzlesRouter.get(
  '/puzzles/:slug/slots',
  requireAuth,
  asyncHandler((req, res) => {
    const spec = getPuzzle(req.params.slug);
    if (!spec) return res.status(404).json({ error: 'Puzzle not found' });
    const slots = listSlots(req.user!.id, spec.slug);
    return res.json({ slots: slots.map(slotSummary) });
  }),
);

puzzlesRouter.post(
  '/puzzles/:slug/slots',
  requireAuth,
  asyncHandler((req, res) => {
    const spec = getPuzzle(req.params.slug);
    if (!spec) return res.status(404).json({ error: 'Puzzle not found' });
    const parsed = parseProgramBody(spec, req.body?.program);
    if (!parsed.ok) {
      return res.status(400).json({ error: 'Invalid program', details: parsed.details });
    }
    const userId = req.user!.id;
    const existing = listSlots(userId, spec.slug);
    const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const name = rawName ? rawName.slice(0, 60) : `Slot ${existing.length + 1}`;
    const slot = createSlot({ userId, slug: spec.slug, name, programJson: parsed.json });
    return res.status(201).json(slotSummary(slot));
  }),
);

puzzlesRouter.get(
  '/puzzles/:slug/slots/:id',
  requireAuth,
  asyncHandler((req, res) => {
    const spec = getPuzzle(req.params.slug);
    if (!spec) return res.status(404).json({ error: 'Puzzle not found' });
    const slot = getSlot(req.user!.id, spec.slug, Number(req.params.id));
    if (!slot) return res.status(404).json({ error: 'Slot not found' });
    return res.json({
      ...slotSummary(slot),
      program: JSON.parse(slot.program_json) as LadderProgram | WiringDoc,
    });
  }),
);

puzzlesRouter.put(
  '/puzzles/:slug/slots/:id',
  requireAuth,
  asyncHandler((req, res) => {
    const spec = getPuzzle(req.params.slug);
    if (!spec) return res.status(404).json({ error: 'Puzzle not found' });
    let programJson: string | undefined;
    if (req.body?.program !== undefined) {
      const parsed = parseProgramBody(spec, req.body.program);
      if (!parsed.ok) {
        return res.status(400).json({ error: 'Invalid program', details: parsed.details });
      }
      programJson = parsed.json;
    }
    const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const slot = updateSlot({
      userId: req.user!.id,
      slug: spec.slug,
      id: Number(req.params.id),
      name: rawName || undefined,
      programJson,
    });
    if (!slot) return res.status(404).json({ error: 'Slot not found' });
    return res.json(slotSummary(slot));
  }),
);

puzzlesRouter.delete(
  '/puzzles/:slug/slots/:id',
  requireAuth,
  asyncHandler((req, res) => {
    const spec = getPuzzle(req.params.slug);
    if (!spec) return res.status(404).json({ error: 'Puzzle not found' });
    const ok = deleteSlot(req.user!.id, spec.slug, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Slot not found' });
    return res.status(204).end();
  }),
);

/**
 * Writes a program into whichever slot is "active" for this user+puzzle
 * (per user_settings.activeSlot), creating a first slot if none exists yet —
 * this is what guarantees a submit never loses work, same as the old
 * single-draft flow.
 */
function saveToActiveSlot(userId: number, slug: string, programJson: string, isSubmitted: boolean): void {
  const settings = getSettings(userId);
  const activeSlotMap = { ...((settings.activeSlot as Record<string, number> | undefined) ?? {}) };
  const activeId = activeSlotMap[slug];
  const target = (activeId != null ? getSlot(userId, slug, activeId) : undefined) ?? listSlots(userId, slug)[0];
  const slotId = target
    ? (updateSlot({ userId, slug, id: target.id, programJson, isSubmitted })?.id ?? target.id)
    : createSlot({ userId, slug, name: 'Slot 1', programJson, isSubmitted }).id;
  if (activeSlotMap[slug] !== slotId) {
    upsertSettings(userId, { ...settings, activeSlot: { ...activeSlotMap, [slug]: slotId } });
  }
}

puzzlesRouter.post(
  '/puzzles/:slug/submit',
  requireAuth,
  asyncHandler((req, res) => {
    const spec = getPuzzle(req.params.slug);
    if (!spec) return res.status(404).json({ error: 'Puzzle not found' });
    const userId = req.user!.id;
    const lock = lockInfo(userId).get(spec.slug);
    if (lock?.locked) {
      return res
        .status(403)
        .json({ error: 'locked', requiresSlug: lock.requiresSlug, requiresTitle: lock.requiresTitle });
    }
    const parsed = parseProgramBody(spec, req.body?.program);
    if (!parsed.ok) {
      return res.status(400).json({ error: 'Invalid program', details: parsed.details });
    }

    saveToActiveSlot(userId, spec.slug, parsed.json, true);

    const validation =
      spec.kind === 'cabinet'
        ? validateWiring(spec, parsed.program as WiringDoc)
        : validateProgram(spec, parsed.program as LadderProgram);
    if (!validation.valid) {
      upsertProgress({ userId, slug: spec.slug, status: 'in_progress', score: 0 });
      return res.json({ validation, grade: null });
    }

    const grade =
      spec.kind === 'cabinet'
        ? gradeWiring(spec, parsed.program as WiringDoc)
        : gradeProgram(spec, parsed.program as LadderProgram);
    upsertProgress({
      userId,
      slug: spec.slug,
      status: grade.solved ? 'solved' : 'in_progress',
      score: grade.score,
    });
    return res.json({ validation, grade });
  }),
);
