import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { LadderElement, LadderProgram, WiringDoc } from '@automationsolver/shared';

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
  it('grades a correct submission as solved and records progress', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ email: 'solver@example.com', password: 'password123' });
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
    await agent.post('/api/auth/register').send({ email: 'wrong@example.com', password: 'password123' });
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
    await agent.post('/api/auth/register').send({ email: 'newbie@example.com', password: 'password123' });

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
    await agent.post('/api/auth/register').send({ email: 'progressor@example.com', password: 'password123' });
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
    await agent.post('/api/auth/register').send({ email: 'sparky@example.com', password: 'password123' });

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
    await agent.post('/api/auth/register').send({ email: 'sparky2@example.com', password: 'password123' });
    const res = await agent
      .post('/api/puzzles/cabinet-lamp/submit')
      .send({ program: { wires: [{ id: 'w1', from: 'PS.L1' }] } });
    expect(res.status).toBe(400);
  });

  it('rejects a ladder program posted to a cabinet slug', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ email: 'sparky3@example.com', password: 'password123' });
    const res = await agent
      .post('/api/puzzles/cabinet-lamp/submit')
      .send({ program: directControlSolution });
    expect(res.status).toBe(400);
  });

  it('a structurally valid but wrong wiring grades as unsolved', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ email: 'sparky4@example.com', password: 'password123' });
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
    await agent.post('/api/auth/register').send({ email: 'slots@example.com', password: 'password123' });

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
    await agent.post('/api/auth/register').send({ email: 'autosave@example.com', password: 'password123' });

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
    await agent.post('/api/auth/register').send({ email: 'settings@example.com', password: 'password123' });
    await agent.put('/api/settings').send({ settings: { theme: 'dark', scanMs: 50 } }).expect(200);
    const res = await agent.get('/api/settings');
    expect(res.body.settings.theme).toBe('dark');
  });
});
