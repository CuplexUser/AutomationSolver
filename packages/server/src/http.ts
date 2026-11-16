import type { NextFunction, Request, Response } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import { getOAuthProviders, type UserRow } from './db/repo.js';

export interface PublicUser {
  id: number;
  email: string | null;
  displayName: string;
  hasPassword: boolean;
  oauthProviders: string[];
}

export async function publicUser(user: UserRow): Promise<PublicUser> {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    hasPassword: user.password_hash != null,
    oauthProviders: await getOAuthProviders(user.id),
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.isAuthenticated?.() && req.user) {
    next();
    return;
  }
  res.status(401).json({ error: 'Authentication required' });
}

/**
 * Wrap an async handler so thrown errors reach the error middleware.
 *
 * Generic over the route params so Express can still infer `{ slug: string }`
 * from a path like `/puzzles/:slug` through the wrapper. Without that, Express
 * 5's types fall back to `string | string[]` for every param.
 */
export function asyncHandler<P = ParamsDictionary>(
  fn: (req: Request<P>, res: Response, next: NextFunction) => Promise<unknown> | unknown,
) {
  return (req: Request<P>, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
