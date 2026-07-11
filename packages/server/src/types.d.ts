import type { UserRow } from './db/repo.js';

declare global {
  namespace Express {
    // Make req.user carry our user row shape.
    interface User extends UserRow {}
  }
}

export {};
