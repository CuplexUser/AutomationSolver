import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { LadderElement, LadderProgram, WiringDoc } from '@automationsolver/shared';

// Use an isolated in-memory DB for the test run.
process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'test-secret';

function extractToken(text: string): string {
  const match = /token=([0-9a-f]+)/.exec(text);
  if (!match) throw new Error(`no token found in email text: ${text}`);
  return match[1];
}

/** Registration test fixture: register + verify-email, leaving the agent logged in. */
async function registerAndLogin(
  agent: ReturnType<typeof request.agent>,
  email: string,
  password: string,
): Promise<void> {
  await agent.post('/api/auth/register').send({ email, password }).expect(201);
  const token = extractToken(outbox.find((m) => m.to === email)!.text);
  await agent.post('/api/auth/verify-email').send({ token }).expect(200);
}

const no = (d: string): LadderElement => ({ type: 'contact-no', device: d });
const nc = (d: string): LadderElement => ({ type: 'contact-nc', device: d });
const out = (d: string): LadderElement => ({ type: 'coil-out', device: d });

function grid(
  rows: number,
  cols: number,
  map: Record<string, LadderElement>,
): (LadderElement | null)[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => map[`${r},${c}`] ?? null),
  );
}

const directControlSolution: LadderProgram = {
  rungs: [{ id: 'r1', rows: 1, cols: 2, cells: grid(1, 2, { '0,0': no('X0'), '0,1': out('Y0') }), vlinks: [] }],
};

const sealInSolution: LadderProgram = {
  rungs: [
    {
      id: 'r1',
      rows: 2,
      cols: 3,
      cells: grid(2, 3, { '0,0': no('X0'), '1,0': no('Y0'), '0,1': nc('X1'), '0,2': out('Y0') }),
      vlinks: [{ row: 0, col: 1 }],
    },
  ],
};

const wrongSolution: LadderProgram = {
  rungs: [
    { id: 'r1', rows: 1, cols: 2, cells: grid(1, 2, { '0,0': no('X0'), '0,1': out('Y0') }), vlinks: [] },
  ],
};

// Canonical wiring for the cabinet tutorial (see gradeCabinet.test.ts in shared).
const cabinetLampSolution: WiringDoc = {
  wires: [
    { id: 'w1', from: 'PS.L1', to: 'S1.13' },
    { id: 'w2', from: 'S1.14', to: 'H1.X1' },
    { id: 'w3', from: 'H1.X2', to: 'PS.N' },
  ],
};

let app: Express;
let outbox: { to: string; subject: string; text: string }[];
let getDb: (typeof import('./db/index.js'))['getDb'];
let findOrCreateOAuthUser: (typeof import('./db/repo.js'))['findOrCreateOAuthUser'];
let hashToken: (typeof import('./auth/tokens.js'))['hashToken'];

beforeAll(async () => {
  const mod = await import('./app.js');
  app = mod.createApp();
  ({ outbox } = await import('./email/mailer.js'));
  ({ getDb } = await import('./db/index.js'));
  ({ findOrCreateOAuthUser } = await import('./db/repo.js'));
  ({ hashToken } = await import('./auth/tokens.js'));
});

describe('health & puzzles (public)', () => {
  it('responds to health check', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('lists puzzles without auth', async () => {
    const res = await request(app).get('/api/puzzles');
    expect(res.status).toBe(200);
    expect(res.body.puzzles.length).toBeGreaterThanOrEqual(5);
    expect(res.body.puzzles[0].slug).toBe('direct-control');
  });

  it('returns full puzzle detail', async () => {
    const res = await request(app).get('/api/puzzles/direct-control');
    expect(res.status).toBe(200);
    expect(res.body.puzzle.slug).toBe('direct-control');
    expect(res.body.puzzle.devices.length).toBeGreaterThan(0);
  });
});

describe('auth flow', () => {
  it('rejects protected routes when logged out', async () => {
    const res = await request(app).get('/api/progress');
    expect(res.status).toBe(401);
  });

  it('registers without auto-login, verifies via emailed link, then logs in and out', async () => {
    const agent = request.agent(app);
    const reg = await agent
      .post('/api/auth/register')
      .send({ email: 'pilot@example.com', password: 'supersecret', displayName: 'Pilot' });
    expect(reg.status).toBe(201);
    expect(reg.body.message).toMatch(/check your email/i);

    // No session established yet.
    const before = await agent.get('/api/auth/me');
    expect(before.status).toBe(401);

    const sent = outbox.find((m) => m.to === 'pilot@example.com');
    expect(sent).toBeDefined();
    const token = extractToken(sent!.text);

    const verify = await agent.post('/api/auth/verify-email').send({ token });
    expect(verify.status).toBe(200);
    expect(verify.body.user.displayName).toBe('Pilot');

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.displayName).toBe('Pilot');

    await agent.post('/api/auth/logout').expect(204);
    const after = await agent.get('/api/auth/me');
    expect(after.status).toBe(401);
  });

  it('blocks login before verification, then logs back in with correct credentials and rejects wrong ones', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/register')
      .send({ email: 'ada@example.com', password: 'password123' })
      .expect(201);

    const unverified = await agent
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'password123' });
    expect(unverified.status).toBe(401);
    expect(unverified.body.code).toBe('EMAIL_NOT_VERIFIED');

    const token = extractToken(outbox.find((m) => m.to === 'ada@example.com')!.text);
    await agent.post('/api/auth/verify-email').send({ token }).expect(200);
    await agent.post('/api/auth/logout').expect(204);

    const bad = await agent.post('/api/auth/login').send({ email: 'ada@example.com', password: 'nope' });
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBeUndefined();

    const good = await agent
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'password123' });
    expect(good.status).toBe(200);
  });

  it('prevents duplicate email registration', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ email: 'dup@example.com', password: 'password123' });
    const second = await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@example.com', password: 'password123' });
    expect(second.status).toBe(409);
  });
});

async function registerAndVerify(email: string, password: string): Promise<void> {
  await request(app).post('/api/auth/register').send({ email, password }).expect(201);
  const token = extractToken(outbox.find((m) => m.to === email)!.text);
  await request(app).post('/api/auth/verify-email').send({ token }).expect(200);
}

describe('resend verification', () => {
  it('issues a fresh token that invalidates the old one', async () => {
    const email = 'resend@example.com';
    await request(app).post('/api/auth/register').send({ email, password: 'password123' }).expect(201);
    const firstToken = extractToken(outbox.find((m) => m.to === email)!.text);

    const resend = await request(app).post('/api/auth/resend-verification').send({ email });
    expect(resend.status).toBe(200);
    const matches = outbox.filter((m) => m.to === email);
    expect(matches.length).toBe(2);
    const secondToken = extractToken(matches[1].text);
    expect(secondToken).not.toBe(firstToken);

    const oldFails = await request(app).post('/api/auth/verify-email').send({ token: firstToken });
    expect(oldFails.status).toBe(400);

    const newWorks = await request(app).post('/api/auth/verify-email').send({ token: secondToken });
    expect(newWorks.status).toBe(200);
  });

  it('does not leak whether an email exists or is already verified', async () => {
    const before = outbox.length;
    const res = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'nobody-here@example.com' });
    expect(res.status).toBe(200);
    expect(outbox.length).toBe(before);
  });
});

describe('password reset', () => {
  it('resets via the emailed link and logs in with the new password', async () => {
    const email = 'reset@example.com';
    await registerAndVerify(email, 'oldpassword1');

    const forgot = await request(app).post('/api/auth/forgot-password').send({ email });
    expect(forgot.status).toBe(200);
    const token = extractToken(outbox.find((m) => m.to === email && m.subject.includes('Reset'))!.text);

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'newpassword2' });
    expect(reset.status).toBe(200);
    expect(reset.body.user.email).toBe(email);

    const oldFails = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'oldpassword1' });
    expect(oldFails.status).toBe(401);

    const newWorks = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'newpassword2' });
    expect(newWorks.status).toBe(200);
  });

  it('rejects a reused reset token', async () => {
    const email = 'reset-reuse@example.com';
    await registerAndVerify(email, 'oldpassword1');
    await request(app).post('/api/auth/forgot-password').send({ email });
    const token = extractToken(outbox.find((m) => m.to === email && m.subject.includes('Reset'))!.text);

    await request(app).post('/api/auth/reset-password').send({ token, password: 'newpassword2' }).expect(200);
    const replay = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'thirdpassword3' });
    expect(replay.status).toBe(400);
  });

  it('rejects an invalid or expired token', async () => {
    const garbage = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'a'.repeat(64), password: 'whatever12' });
    expect(garbage.status).toBe(400);

    const email = 'reset-expired@example.com';
    await registerAndVerify(email, 'oldpassword1');
    await request(app).post('/api/auth/forgot-password').send({ email });
    const token = extractToken(outbox.find((m) => m.to === email && m.subject.includes('Reset'))!.text);

    // Backdate this token's expiry directly to simulate it having timed out.
    getDb()
      .prepare('UPDATE password_reset_tokens SET expires_at = ? WHERE token_hash = ?')
      .run(Date.now() - 1000, hashToken(token));
    const expired = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'newpassword2' });
    expect(expired.status).toBe(400);
  });

  it('does not leak whether an email exists', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody-here-either@example.com' });
    expect(res.status).toBe(200);
  });
});

describe('oauth accounts', () => {
  it('are pre-verified on creation, and linking verifies an existing unverified account', async () => {
    const created = findOrCreateOAuthUser({
      provider: 'google',
      providerUserId: 'g-123',
      email: 'oauth-fresh@example.com',
      displayName: 'OAuth Fresh',
    });
    expect(created.email_verified_at).not.toBeNull();

    const email = 'link-me@example.com';
    await request(app).post('/api/auth/register').send({ email, password: 'password123' }).expect(201);

    const linked = findOrCreateOAuthUser({
      provider: 'github',
      providerUserId: 'gh-456',
      email,
      displayName: 'Link Me',
    });
    expect(linked.email_verified_at).not.toBeNull();
  });
});

describe('solutions & grading', () => {
  it('grades a correct submission as solved and records progress', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, 'solver@example.com', 'password123');
    await agent.post('/api/puzzles/direct-control/submit').send({ program: directControlSolution });

    const submit = await agent.post('/api/puzzles/seal-in/submit').send({ program: sealInSolution });
    expect(submit.status).toBe(200);
    expect(submit.body.validation.valid).toBe(true);
    expect(submit.body.grade.solved).toBe(true);
    expect(submit.body.grade.score).toBe(100);

    const progress = await agent.get('/api/progress');
    const seal = progress.body.progress.find((p: { slug: string }) => p.slug === 'seal-in');
    expect(seal.status).toBe('solved');
  });

  it('grades a wrong submission as not solved', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, 'wrong@example.com', 'password123');
    await agent.post('/api/puzzles/direct-control/submit').send({ program: directControlSolution });
    const submit = await agent.post('/api/puzzles/seal-in/submit').send({ program: wrongSolution });
    expect(submit.status).toBe(200);
    expect(submit.body.grade.solved).toBe(false);
  });

  it('requires auth to submit', async () => {
    const res = await request(app).post('/api/puzzles/seal-in/submit').send({ program: sealInSolution });
    expect(res.status).toBe(401);
  });
});

describe('puzzle-map locking', () => {
  it('locks every puzzle but the first for a fresh user', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, 'newbie@example.com', 'password123');

    const list = await agent.get('/api/puzzles');
    const bySlug = new Map(list.body.puzzles.map((p: { slug: string; locked: boolean }) => [p.slug, p.locked]));
    expect(bySlug.get('direct-control')).toBe(false);
    expect(bySlug.get('seal-in')).toBe(true);

    const detail = await agent.get('/api/puzzles/seal-in');
    expect(detail.status).toBe(403);
    expect(detail.body.error).toBe('locked');
    expect(detail.body.requiresSlug).toBe('direct-control');

    const submit = await agent.post('/api/puzzles/seal-in/submit').send({ program: sealInSolution });
    expect(submit.status).toBe(403);
    expect(submit.body.error).toBe('locked');
  });

  it('unlocks the next puzzle in the category once the previous one is solved', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, 'progressor@example.com', 'password123');
    await agent.post('/api/puzzles/direct-control/submit').send({ program: directControlSolution }).expect(200);

    const list = await agent.get('/api/puzzles');
    const bySlug = new Map(list.body.puzzles.map((p: { slug: string; locked: boolean }) => [p.slug, p.locked]));
    expect(bySlug.get('seal-in')).toBe(false);
    // Solving a Basics puzzle must not ripple into other categories.
    expect(bySlug.get('batch-counter')).toBe(true);

    const detail = await agent.get('/api/puzzles/seal-in');
    expect(detail.status).toBe(200);
  });

  it('anonymous visitors see exactly the first puzzle of each category unlocked', async () => {
    const res = await request(app).get('/api/puzzles');
    const puzzles = res.body.puzzles as { slug: string; category: string; locked: boolean }[];
    const firstOfCategory = new Set<string>();
    for (const p of puzzles) {
      if (!firstOfCategory.has(p.category)) {
        firstOfCategory.add(p.category);
        expect({ slug: p.slug, locked: p.locked }).toEqual({ slug: p.slug, locked: false });
      } else if (p.locked === false) {
        throw new Error(`${p.slug} should be locked (not first of ${p.category})`);
      }
    }
    expect(firstOfCategory.size).toBeGreaterThanOrEqual(4);

    const detail = await request(app).get('/api/puzzles/seal-in');
    expect(detail.status).toBe(403);
  });
});

describe('cabinet puzzles', () => {
  it('grades a correct wiring as solved and persists progress', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, 'sparky@example.com', 'password123');

    const res = await agent
      .post('/api/puzzles/cabinet-lamp/submit')
      .send({ program: cabinetLampSolution });
    expect(res.status).toBe(200);
    expect(res.body.validation.valid).toBe(true);
    expect(res.body.grade.solved).toBe(true);
    expect(res.body.grade.score).toBe(100);

    const list = await agent.get('/api/puzzles');
    const lamp = list.body.puzzles.find((p: { slug: string }) => p.slug === 'cabinet-lamp');
    expect(lamp.status).toBe('solved');
    // Solving the first cabinet puzzle unlocks the second.
    const dol = list.body.puzzles.find((p: { slug: string }) => p.slug === 'cabinet-dol');
    expect(dol.locked).toBe(false);
  });

  it('the first cabinet puzzle is unlocked for a fresh user', async () => {
    const res = await request(app).get('/api/puzzles');
    const bySlug = new Map(res.body.puzzles.map((p: { slug: string; locked: boolean }) => [p.slug, p.locked]));
    expect(bySlug.get('cabinet-lamp')).toBe(false);
    expect(bySlug.get('cabinet-dol')).toBe(true);
  });

  it('rejects a malformed wiring body', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, 'sparky2@example.com', 'password123');
    const res = await agent
      .post('/api/puzzles/cabinet-lamp/submit')
      .send({ program: { wires: [{ id: 'w1', from: 'PS.L1' }] } });
    expect(res.status).toBe(400);
  });

  it('rejects a ladder program posted to a cabinet slug', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, 'sparky3@example.com', 'password123');
    const res = await agent
      .post('/api/puzzles/cabinet-lamp/submit')
      .send({ program: directControlSolution });
    expect(res.status).toBe(400);
  });

  it('a structurally valid but wrong wiring grades as unsolved', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, 'sparky4@example.com', 'password123');
    const res = await agent
      .post('/api/puzzles/cabinet-lamp/submit')
      .send({ program: { wires: [{ id: 'w1', from: 'PS.L1', to: 'H1.X1' }] } });
    expect(res.status).toBe(200);
    expect(res.body.validation.valid).toBe(true);
    expect(res.body.grade.solved).toBe(false);
  });
});

describe('save slots', () => {
  it('creates, lists, loads, renames and deletes slots', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, 'slots@example.com', 'password123');

    const create = await agent
      .post('/api/puzzles/direct-control/slots')
      .send({ program: directControlSolution, name: 'My first try' });
    expect(create.status).toBe(201);
    expect(create.body.name).toBe('My first try');

    const create2 = await agent.post('/api/puzzles/direct-control/slots').send({ program: directControlSolution });
    expect(create2.status).toBe(201);
    expect(create2.body.name).toBe('Slot 2');

    const list = await agent.get('/api/puzzles/direct-control/slots');
    expect(list.status).toBe(200);
    expect(list.body.slots.length).toBe(2);

    const detail = await agent.get('/api/puzzles/direct-control');
    expect(detail.body.slots.length).toBe(2);

    const loaded = await agent.get(`/api/puzzles/direct-control/slots/${create.body.id}`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.program.rungs.length).toBe(1);

    const renamed = await agent
      .put(`/api/puzzles/direct-control/slots/${create.body.id}`)
      .send({ name: 'Renamed' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Renamed');

    const del = await agent.delete(`/api/puzzles/direct-control/slots/${create2.body.id}`);
    expect(del.status).toBe(204);

    const listAfter = await agent.get('/api/puzzles/direct-control/slots');
    expect(listAfter.body.slots.length).toBe(1);
  });

  it('submit saves the program into the active slot without creating duplicates', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, 'autosave@example.com', 'password123');

    await agent.post('/api/puzzles/direct-control/submit').send({ program: directControlSolution }).expect(200);
    await agent.post('/api/puzzles/direct-control/submit').send({ program: directControlSolution }).expect(200);

    const list = await agent.get('/api/puzzles/direct-control/slots');
    expect(list.body.slots.length).toBe(1);
    expect(list.body.slots[0].isSubmitted).toBe(true);
  });

  it('requires auth for slot routes', async () => {
    const res = await request(app)
      .post('/api/puzzles/direct-control/slots')
      .send({ program: directControlSolution });
    expect(res.status).toBe(401);
  });
});

describe('settings', () => {
  it('round-trips user settings', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, 'settings@example.com', 'password123');
    await agent.put('/api/settings').send({ settings: { theme: 'dark', scanMs: 50 } }).expect(200);
    const res = await agent.get('/api/settings');
    expect(res.body.settings.theme).toBe('dark');
  });
});
