import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import cors from 'cors';
import { config } from './config.js';
import { getDb } from './db/index.js';
import { configurePassport, passport } from './auth/passport.js';
import { SqliteStore } from './auth/sessionStore.js';
import { authRouter } from './routes/auth.js';
import { puzzlesRouter } from './routes/puzzles.js';
import { progressRouter, settingsRouter } from './routes/misc.js';

export function createApp(): express.Express {
  getDb(); // ensure schema exists
  configurePassport();

  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(cors({ origin: config.clientOrigin, credentials: true }));
  app.use(express.json({ limit: '512kb' }));

  app.use(
    session({
      name: 'as.sid',
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: new SqliteStore(),
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProd,
        maxAge: 1000 * 60 * 60 * 24 * 30,
      },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter);
  app.use('/api', puzzlesRouter);
  app.use('/api', progressRouter);
  app.use('/api', settingsRouter);

  // Fallback 404 for unknown API routes.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Central error handler.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
