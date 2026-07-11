import { Store, type SessionData } from 'express-session';
import { getDb } from '../db/index.js';

/** Minimal express-session store backed by the shared node:sqlite database. */
export class SqliteStore extends Store {
  get(sid: string, cb: (err: unknown, session?: SessionData | null) => void): void {
    try {
      const row = getDb()
        .prepare('SELECT sess, expire FROM sessions WHERE sid = ?')
        .get(sid) as { sess: string; expire: number } | undefined;
      if (!row) return cb(null, null);
      if (row.expire < Date.now()) {
        this.destroy(sid, () => undefined);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess) as SessionData);
    } catch (err) {
      cb(err);
    }
  }

  set(sid: string, session: SessionData, cb?: (err?: unknown) => void): void {
    try {
      const maxAge = session.cookie?.maxAge ?? 1000 * 60 * 60 * 24 * 30;
      const expire = Date.now() + maxAge;
      getDb()
        .prepare(
          `INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`,
        )
        .run(sid, JSON.stringify(session), expire);
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }

  destroy(sid: string, cb?: (err?: unknown) => void): void {
    try {
      getDb().prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }

  touch(sid: string, session: SessionData, cb?: (err?: unknown) => void): void {
    try {
      const maxAge = session.cookie?.maxAge ?? 1000 * 60 * 60 * 24 * 30;
      getDb()
        .prepare('UPDATE sessions SET expire = ? WHERE sid = ?')
        .run(Date.now() + maxAge, sid);
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }
}
