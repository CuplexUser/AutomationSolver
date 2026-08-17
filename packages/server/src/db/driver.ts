export interface RunResult {
  changes: number;
}

/**
 * Every persistence call in this codebase goes through one of these three
 * methods, all async because Postgres is network I/O even though SQLite
 * isn't — that's what lets repo.ts and every caller be written once against
 * both engines instead of maintaining two call chains.
 */
export interface DbDriver {
  readonly kind: 'sqlite' | 'postgres';
  run(sql: string, params?: unknown[]): Promise<RunResult>;
  get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

/**
 * Every query in this codebase is written with SQLite's native `?`
 * placeholders. Postgres needs `$1, $2, ...` instead, so the Postgres driver
 * rewrites just before executing rather than every call site tracking two
 * placeholder dialects. Safe here because none of this codebase's SQL ever
 * embeds a literal `?` in a string constant.
 */
export function toPositionalPlaceholders(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}
