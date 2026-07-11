import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
// passport-github2 ships loose types; import via require-style default.
import { Strategy as GitHubStrategy } from 'passport-github2';
import { config } from '../config.js';
import { findOrCreateOAuthUser, findUserById, findUserByEmail } from '../db/repo.js';
import { verifyPassword } from './password.js';

let configured = false;

export function configurePassport(): void {
  if (configured) return;
  configured = true;
  passport.serializeUser<number>((user, done) => {
    done(null, (user as { id: number }).id);
  });

  passport.deserializeUser<number>((id, done) => {
    try {
      const user = findUserById(id);
      done(null, user ?? false);
    } catch (err) {
      done(err);
    }
  });

  passport.use(
    new LocalStrategy({ usernameField: 'email' }, (email, password, done) => {
      try {
        const user = findUserByEmail(email);
        if (!user || !verifyPassword(password, user.password_hash)) {
          return done(null, false, { message: 'Invalid email or password' });
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }),
  );

  if (config.google.enabled) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: config.google.clientID,
          clientSecret: config.google.clientSecret,
          callbackURL: `${config.serverOrigin}/api/auth/google/callback`,
        },
        (_accessToken, _refreshToken, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value ?? null;
            const user = findOrCreateOAuthUser({
              provider: 'google',
              providerUserId: profile.id,
              email,
              displayName: profile.displayName || email || 'Player',
            });
            done(null, user);
          } catch (err) {
            done(err as Error);
          }
        },
      ),
    );
  }

  if (config.github.enabled) {
    passport.use(
      new GitHubStrategy(
        {
          clientID: config.github.clientID,
          clientSecret: config.github.clientSecret,
          callbackURL: `${config.serverOrigin}/api/auth/github/callback`,
        },
        (
          _accessToken: string,
          _refreshToken: string,
          profile: {
            id: string;
            displayName?: string;
            username?: string;
            emails?: { value: string }[];
          },
          done: (err: unknown, user?: Express.User | false) => void,
        ) => {
          try {
            const email = profile.emails?.[0]?.value ?? null;
            const user = findOrCreateOAuthUser({
              provider: 'github',
              providerUserId: profile.id,
              email,
              displayName: profile.displayName || profile.username || email || 'Player',
            });
            done(null, user);
          } catch (err) {
            done(err);
          }
        },
      ),
    );
  }
}

export { passport };
