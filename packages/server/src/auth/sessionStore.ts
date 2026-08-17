import { Store, type SessionData } from 'express-session';
import { getDriver } from '../db/index.js';

/** Minimal express-session store backed by the driver from db/index.ts (SQLite or Postgres). */
export class SessionStore extends Store {
  get(sid: string, cb: (err: unknown, session?: SessionData | null) => void): void {
    (async () => {
      const row = await (await getDriver()).get<{ sess: string; expire: number }>(
        'SELECT sess, expire FROM sessions WHERE sid = ?',
        [sid],
      );
      if (!row) return cb(null, null);
      if (row.expire < Date.now()) {
        this.destroy(sid, () => undefined);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess) as SessionData);
    })().catch((err: unknown) => cb(err));
  }

  set(sid: string, session: SessionData, cb?: (err?: unknown) => void): void {
    (async () => {
      const maxAge = session.cookie?.maxAge ?? 1000 * 60 * 60 * 24 * 30;
      const expire = Date.now() + maxAge;
      await (await getDriver()).run(
        `INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`,
        [sid, JSON.stringify(session), expire],
      );
      cb?.();
    })().catch((err: unknown) => cb?.(err));
  }

  destroy(sid: string, cb?: (err?: unknown) => void): void {
    (async () => {
      await (await getDriver()).run('DELETE FROM sessions WHERE sid = ?', [sid]);
      cb?.();
    })().catch((err: unknown) => cb?.(err));
  }

  touch(sid: string, session: SessionData, cb?: (err?: unknown) => void): void {
    (async () => {
      const maxAge = session.cookie?.maxAge ?? 1000 * 60 * 60 * 24 * 30;
      await (await getDriver()).run('UPDATE sessions SET expire = ? WHERE sid = ?', [
        Date.now() + maxAge,
        sid,
      ]);
      cb?.();
    })().catch((err: unknown) => cb?.(err));
  }
}
