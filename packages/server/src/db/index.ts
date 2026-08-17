import { config } from '../config.js';
import type { DbDriver } from './driver.js';
import { createSqliteDriver } from './sqliteDriver.js';
import { createPostgresDriver } from './postgresDriver.js';

let driverPromise: Promise<DbDriver> | null = null;

/** SQLite when unset, Postgres (e.g. Neon) when DATABASE_URL is configured. */
export function getDriver(): Promise<DbDriver> {
  if (!driverPromise) {
    driverPromise = config.databaseUrl
      ? createPostgresDriver(config.databaseUrl)
      : Promise.resolve(createSqliteDriver(config.dbPath));
  }
  return driverPromise;
}

/** For tests: reset the singleton so the next getDriver() call opens fresh. */
export async function closeDriver(): Promise<void> {
  if (!driverPromise) return;
  const driver = await driverPromise;
  driverPromise = null;
  await driver.close();
}
