import path from 'node:path';

function bool(v: string | undefined): boolean {
  return v === '1' || v?.toLowerCase() === 'true';
}

const googleClientID = process.env.GOOGLE_CLIENT_ID ?? '';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
const githubClientID = process.env.GITHUB_CLIENT_ID ?? '';
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET ?? '';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  isProd: process.env.NODE_ENV === 'production',
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-insecure-secret-change-me',
  dbPath: process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'automationsolver.sqlite'),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  serverOrigin: process.env.SERVER_ORIGIN ?? 'http://localhost:4000',
  google: {
    clientID: googleClientID,
    clientSecret: googleClientSecret,
    enabled: Boolean(googleClientID && googleClientSecret),
  },
  github: {
    clientID: githubClientID,
    clientSecret: githubClientSecret,
    enabled: Boolean(githubClientID && githubClientSecret),
  },
  trustProxy: bool(process.env.TRUST_PROXY),
};

export type AppConfig = typeof config;
