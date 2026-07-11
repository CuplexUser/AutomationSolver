import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { LadderElement, LadderProgram } from '@automationsolver/shared';

// Use an isolated in-memory DB for the test run.
process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'test-secret';

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

let app: Express;

beforeAll(async () => {
  const mod = await import('./app.js');
  app = mod.createApp();
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
    const res = await request(app).get('/api/puzzles/seal-in');
    expect(res.status).toBe(200);
    expect(res.body.puzzle.slug).toBe('seal-in');
    expect(res.body.puzzle.devices.length).toBe(3);
  });
});

describe('auth flow', () => {
  it('rejects protected routes when logged out', async () => {
    const res = await request(app).get('/api/progress');
    expect(res.status).toBe(401);
  });

  it('registers, stays logged in, and logs out', async () => {
    const agent = request.agent(app);
    const reg = await agent
      .post('/api/auth/register')
      .send({ email: 'pilot@example.com', password: 'supersecret', displayName: 'Pilot' });
    expect(reg.status).toBe(201);
    expect(reg.body.user.email).toBe('pilot@example.com');

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.displayName).toBe('Pilot');

    await agent.post('/api/auth/logout').expect(204);
    const after = await agent.get('/api/auth/me');
    expect(after.status).toBe(401);
  });

  it('logs back in with correct credentials and rejects wrong ones', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/register')
      .send({ email: 'ada@example.com', password: 'password123' })
      .expect(201);
    await agent.post('/api/auth/logout').expect(204);

    const bad = await agent.post('/api/auth/login').send({ email: 'ada@example.com', password: 'nope' });
    expect(bad.status).toBe(401);

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

describe('solutions & grading', () => {
  it('saves a draft and returns it on reload', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ email: 'draft@example.com', password: 'password123' });

    const save = await agent.put('/api/puzzles/seal-in/solution').send({ program: sealInSolution });
    expect(save.status).toBe(200);
    expect(save.body.saved).toBe(true);

    const detail = await agent.get('/api/puzzles/seal-in');
    expect(detail.body.savedProgram).not.toBeNull();
    expect(detail.body.savedProgram.rungs.length).toBe(1);
  });

  it('grades a correct submission as solved and records progress', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ email: 'solver@example.com', password: 'password123' });

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
    await agent.post('/api/auth/register').send({ email: 'wrong@example.com', password: 'password123' });
    const submit = await agent.post('/api/puzzles/seal-in/submit').send({ program: wrongSolution });
    expect(submit.status).toBe(200);
    expect(submit.body.grade.solved).toBe(false);
  });

  it('requires auth to submit', async () => {
    const res = await request(app).post('/api/puzzles/seal-in/submit').send({ program: sealInSolution });
    expect(res.status).toBe(401);
  });
});

describe('settings', () => {
  it('round-trips user settings', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ email: 'settings@example.com', password: 'password123' });
    await agent.put('/api/settings').send({ settings: { theme: 'dark', scanMs: 50 } }).expect(200);
    const res = await agent.get('/api/settings');
    expect(res.body.settings.theme).toBe('dark');
  });
});
