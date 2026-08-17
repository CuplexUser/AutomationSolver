import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../packages/server/src/app.js';

// Vercel keeps warm instances alive between invocations, so the Express app
// (and its DB driver / schema-check) is built once per instance, not per
// request. A failed build must not be cached, or every request on this
// instance would fail until it cycles.
let appPromise: ReturnType<typeof createApp> | undefined;

async function getApp() {
  if (!appPromise) {
    appPromise = createApp().catch((err: unknown) => {
      appPromise = undefined;
      throw err;
    });
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  app(req, res);
}
