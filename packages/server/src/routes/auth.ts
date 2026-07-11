import { Router } from 'express';
import { config } from '../config.js';
import { createUser, findUserByEmail } from '../db/repo.js';
import { hashPassword } from '../auth/password.js';
import { passport } from '../auth/passport.js';
import { asyncHandler, publicUser } from '../http.js';
import { registerSchema } from '../validation.js';

export const authRouter = Router();

authRouter.post(
  '/register',
  asyncHandler((req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid registration', details: parsed.error.flatten() });
    }
    const { email, password, displayName } = parsed.data;
    if (findUserByEmail(email)) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }
    const user = createUser({
      email,
      passwordHash: hashPassword(password),
      displayName: displayName?.trim() || email.split('@')[0],
    });
    req.login(user, (err) => {
      if (err) return res.status(500).json({ error: 'Login after register failed' });
      return res.status(201).json({ user: publicUser(user) });
    });
  }),
);

authRouter.post('/login', (req, res, next) => {
  passport.authenticate(
    'local',
    (err: unknown, user: Express.User | false, info: { message?: string } | undefined) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ error: info?.message ?? 'Invalid credentials' });
      req.login(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        return res.json({ user: publicUser(user) });
      });
    },
  )(req, res, next);
});

authRouter.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie('as.sid');
      res.status(204).end();
    });
  });
});

authRouter.get('/me', (req, res) => {
  if (req.isAuthenticated() && req.user) {
    res.json({ user: publicUser(req.user) });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

// --- OAuth ----------------------------------------------------------------
authRouter.get('/providers', (_req, res) => {
  res.json({ google: config.google.enabled, github: config.github.enabled });
});

if (config.google.enabled) {
  authRouter.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
  authRouter.get(
    '/google/callback',
    passport.authenticate('google', { failureRedirect: `${config.clientOrigin}/login?error=oauth` }),
    (_req, res) => res.redirect(config.clientOrigin),
  );
}

if (config.github.enabled) {
  authRouter.get('/github', passport.authenticate('github', { scope: ['user:email'] }));
  authRouter.get(
    '/github/callback',
    passport.authenticate('github', { failureRedirect: `${config.clientOrigin}/login?error=oauth` }),
    (_req, res) => res.redirect(config.clientOrigin),
  );
}
