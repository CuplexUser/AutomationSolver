import { Router } from 'express';
import { getProgress, getSettings, upsertSettings } from '../db/repo.js';
import { asyncHandler, requireAuth } from '../http.js';
import { settingsSchema } from '../validation.js';

export const progressRouter = Router();

progressRouter.get(
  '/progress',
  requireAuth,
  asyncHandler((req, res) => {
    const rows = getProgress(req.user!.id).map((p) => ({
      slug: p.puzzle_slug,
      status: p.status,
      bestScore: p.best_score,
      solvedAt: p.solved_at,
      updatedAt: p.updated_at,
    }));
    res.json({ progress: rows });
  }),
);

export const settingsRouter = Router();

settingsRouter.get(
  '/settings',
  requireAuth,
  asyncHandler((req, res) => {
    res.json({ settings: getSettings(req.user!.id) });
  }),
);

settingsRouter.put(
  '/settings',
  requireAuth,
  asyncHandler((req, res) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid settings' });
    }
    upsertSettings(req.user!.id, parsed.data.settings);
    return res.json({ settings: parsed.data.settings });
  }),
);
