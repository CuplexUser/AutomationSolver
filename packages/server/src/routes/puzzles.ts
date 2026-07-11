import { Router } from 'express';
import {
  gradeProgram,
  getPuzzle,
  PUZZLES,
  validateProgram,
  type LadderProgram,
} from '@automationsolver/shared';
import { getProgress, getSolution, upsertProgress, upsertSolution } from '../db/repo.js';
import { asyncHandler, requireAuth } from '../http.js';
import { programSchema } from '../validation.js';

export const puzzlesRouter = Router();

function progressMap(userId: number | undefined): Map<string, { status: string; score: number }> {
  const map = new Map<string, { status: string; score: number }>();
  if (userId == null) return map;
  for (const p of getProgress(userId)) map.set(p.puzzle_slug, { status: p.status, score: p.best_score });
  return map;
}

puzzlesRouter.get('/puzzles', (req, res) => {
  const map = progressMap(req.user?.id);
  const list = PUZZLES.map((p) => ({
    slug: p.slug,
    title: p.title,
    difficulty: p.difficulty,
    order: p.order,
    summary: p.summary,
    status: map.get(p.slug)?.status ?? 'unsolved',
    bestScore: map.get(p.slug)?.score ?? 0,
  }));
  res.json({ puzzles: list });
});

puzzlesRouter.get('/puzzles/:slug', (req, res) => {
  const spec = getPuzzle(req.params.slug);
  if (!spec) return res.status(404).json({ error: 'Puzzle not found' });
  const userId = req.user?.id;
  const solution = userId != null ? getSolution(userId, spec.slug) : undefined;
  const prog = userId != null ? progressMap(userId).get(spec.slug) : undefined;
  return res.json({
    puzzle: spec,
    savedProgram: solution ? (JSON.parse(solution.program_json) as LadderProgram) : null,
    progress: prog ? { status: prog.status, bestScore: prog.score } : null,
  });
});

puzzlesRouter.put(
  '/puzzles/:slug/solution',
  requireAuth,
  asyncHandler((req, res) => {
    const spec = getPuzzle(req.params.slug);
    if (!spec) return res.status(404).json({ error: 'Puzzle not found' });
    const parsed = programSchema.safeParse(req.body?.program);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid program', details: parsed.error.flatten() });
    }
    upsertSolution({
      userId: req.user!.id,
      slug: spec.slug,
      programJson: JSON.stringify(parsed.data),
      isSubmitted: false,
    });
    return res.json({ saved: true });
  }),
);

puzzlesRouter.post(
  '/puzzles/:slug/submit',
  requireAuth,
  asyncHandler((req, res) => {
    const spec = getPuzzle(req.params.slug);
    if (!spec) return res.status(404).json({ error: 'Puzzle not found' });
    const parsed = programSchema.safeParse(req.body?.program);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid program', details: parsed.error.flatten() });
    }
    const program = parsed.data as LadderProgram;
    const userId = req.user!.id;

    upsertSolution({
      userId,
      slug: spec.slug,
      programJson: JSON.stringify(program),
      isSubmitted: true,
    });

    const validation = validateProgram(spec, program);
    if (!validation.valid) {
      upsertProgress({ userId, slug: spec.slug, status: 'in_progress', score: 0 });
      return res.json({ validation, grade: null });
    }

    const grade = gradeProgram(spec, program);
    upsertProgress({
      userId,
      slug: spec.slug,
      status: grade.solved ? 'solved' : 'in_progress',
      score: grade.score,
    });
    return res.json({ validation, grade });
  }),
);
