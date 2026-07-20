import { Router } from 'express';
import { config } from '../config.js';
import {
  createUser,
  findUserByEmail,
  markEmailVerified,
  updatePasswordHash,
  updateDisplayName,
  createEmailVerificationToken,
  findValidEmailVerificationToken,
  consumeEmailVerificationToken,
  createPasswordResetToken,
  findValidPasswordResetToken,
  consumePasswordResetToken,
  findUserById,
} from '../db/repo.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { generateToken, hashToken } from '../auth/tokens.js';
import { passport } from '../auth/passport.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../email/mailer.js';
import { asyncHandler, publicUser, requireAuth } from '../http.js';
import {
  registerSchema,
  emailOnlySchema,
  verifyEmailSchema,
  resetPasswordSchema,
  updateProfileSchema,
  changePasswordSchema,
} from '../validation.js';

export const authRouter = Router();

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
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
    const token = generateToken();
    createEmailVerificationToken(user.id, hashToken(token), VERIFY_TOKEN_TTL_MS);
    await sendVerificationEmail(email, token);
    return res
      .status(201)
      .json({ message: 'Account created. Check your email to verify your account before signing in.' });
  }),
);

authRouter.post('/login', (req, res, next) => {
  passport.authenticate(
    'local',
    (
      err: unknown,
      user: Express.User | false,
      info: { message?: string; code?: string } | undefined,
    ) => {
      if (err) return next(err);
      if (!user) {
        return res
          .status(401)
          .json({ error: info?.message ?? 'Invalid credentials', ...(info?.code ? { code: info.code } : {}) });
      }
      req.login(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        return res.json({ user: publicUser(user) });
      });
    },
  )(req, res, next);
});

authRouter.post(
  '/verify-email',
  asyncHandler((req, res) => {
    const parsed = verifyEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid or expired verification link' });
    }
    const record = findValidEmailVerificationToken(hashToken(parsed.data.token));
    if (!record) {
      return res.status(400).json({ error: 'Invalid or expired verification link' });
    }
    consumeEmailVerificationToken(hashToken(parsed.data.token));
    markEmailVerified(record.user_id);
    const user = findUserById(record.user_id)!;
    req.login(user, (err) => {
      if (err) return res.status(500).json({ error: 'Login after verification failed' });
      return res.json({ user: publicUser(user) });
    });
  }),
);

authRouter.post(
  '/resend-verification',
  asyncHandler(async (req, res) => {
    const parsed = emailOnlySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    const user = findUserByEmail(parsed.data.email);
    if (user && !user.email_verified_at) {
      const token = generateToken();
      createEmailVerificationToken(user.id, hashToken(token), VERIFY_TOKEN_TTL_MS);
      await sendVerificationEmail(parsed.data.email, token);
    }
    return res.json({ message: 'If an account exists for that email, a verification link has been sent.' });
  }),
);

authRouter.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const parsed = emailOnlySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    const user = findUserByEmail(parsed.data.email);
    if (user) {
      const token = generateToken();
      createPasswordResetToken(user.id, hashToken(token), RESET_TOKEN_TTL_MS);
      await sendPasswordResetEmail(parsed.data.email, token);
    }
    return res.json({ message: 'If an account exists for that email, a reset link has been sent.' });
  }),
);

authRouter.post(
  '/reset-password',
  asyncHandler((req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }
    const record = findValidPasswordResetToken(hashToken(parsed.data.token));
    if (!record) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }
    consumePasswordResetToken(hashToken(parsed.data.token));
    updatePasswordHash(record.user_id, hashPassword(parsed.data.password));
    const user = findUserById(record.user_id)!;
    if (!user.email_verified_at) markEmailVerified(user.id);
    const verifiedUser = findUserById(record.user_id)!;
    req.login(verifiedUser, (err) => {
      if (err) return res.status(500).json({ error: 'Login after reset failed' });
      return res.json({ user: publicUser(verifiedUser) });
    });
  }),
);

authRouter.patch(
  '/profile',
  requireAuth,
  asyncHandler((req, res) => {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid display name' });
    }
    updateDisplayName(req.user!.id, parsed.data.displayName.trim());
    const user = findUserById(req.user!.id)!;
    return res.json({ user: publicUser(user) });
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  asyncHandler((req, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid password' });
    }
    const user = req.user!;
    if (user.password_hash) {
      if (
        !parsed.data.currentPassword ||
        !verifyPassword(parsed.data.currentPassword, user.password_hash)
      ) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }
    updatePasswordHash(user.id, hashPassword(parsed.data.newPassword));
    return res.json({ message: 'Password updated.' });
  }),
);

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
