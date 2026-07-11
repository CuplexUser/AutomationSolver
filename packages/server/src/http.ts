import type { NextFunction, Request, Response } from 'express';
import type { UserRow } from './db/repo.js';

export interface PublicUser {
  id: number;
  email: string | null;
  displayName: string;
}

export function publicUser(user: UserRow): PublicUser {
  return { id: user.id, email: user.email, displayName: user.display_name };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.isAuthenticated?.() && req.user) {
    next();
    return;
  }
  res.status(401).json({ error: 'Authentication required' });
}

/** Wrap an async handler so thrown errors reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
