import { describe, expect, it } from 'vitest';
import type { LadderElement, LadderProject, Rung, VarDecl } from '../ladder/types.js';
import { PUZZLES } from './content/index.js';
import { assembleProject, initialProject, playerPouIds } from './project.js';
import {
  allocateAddress,
  buildSymbolTable,
  deriveSymbol,
  isValidVarName,
  missingDeclarations,
  plantSymbols,
  resolveName,
  resolveProject,
  runnableProject,
  takenAddresses,
  validateDeclarations,
} from './symbols.js';
import { filterChoices, symbolChoicesFor } from './symbolChoices.js';
import { validateProgram } from './validate.js';
import type { LadderPuzzleSpec, PuzzleDevice } from './types.js';

// --- Fixtures -----------------------------------------------------------------

const devices: PuzzleDevice[] = [
  { address: 'X0', label: 'Start', io: 'input', widget: 'momentary' },
  { address: 'X1', label: 'Frame Blank Ready', io: 'input', widget: 'sensor' },
  { address: 'Y0', label: 'Torch', io: 'output', widget: 'motor' },
  { address: 'Y1', label: 'Clamp', io: 'output', widget: 'motor' },
];

const rung = (id: string, device: string, coil: string): Rung => ({
  id,
  rows: 1,
  cols: 2,
  cells: [
    [
      { type: 'contact-no', device },
      { type: 'coil-out', device: coil },
    ],
  ],
  vlinks: [],
});

function spec(over: Partial<LadderPuzzleSpec> = {}): LadderPuzzleSpec {
  return {
    kind: 'ladder',
    slug: 'test',
    title: 'Test',
    category: 'factory',
    difficulty: 'medium',
    summary: '',
    briefing: '',
    devices,
    allowedInstructions: ['contact-no', 'contact-nc', 'coil-out', 'coil-set', 'timer', 'mov', 'hwire'],
    processId: 'passthrough',
    scenarios: [],
    ...over,
  } as LadderPuzzleSpec;
}

const project = (pous: LadderProject['pous'], globals?: VarDecl[]): LadderProject => ({
  pous,
  tasks: [{ id: 'MAIN', name: 'MAIN', priority: 0, pous: pous.map((p) => p.id) }],
  ...(globals ? { globals } : {}),
});

// --- Deriving names -----------------------------------------------------------

describe('symbols — deriving a name from a device label', () => {
  it('pascal-cases a label', () => {
    expect(deriveSymbol('Frame Blank Ready')).toBe('FrameBlankReady');
    expect(deriveSymbol('Emergency Stop')).toBe('EmergencyStop');
    expect(deriveSymbol('Torch')).toBe('Torch');
  });

  it('strips punctuation a label may carry', () => {
    expect(deriveSymbol('Pick / Place')).toBe('PickPlace');
    expect(deriveSymbol('Lane 1 Count')).toBe('Lane1Count');
  });

  it('never starts an identifier with a digit', () => {
    expect(deriveSymbol('1st Pass Done')).toBe('_1stPassDone');
  });

  it('prefers an explicit symbol over the derived one', () => {
    const table = plantSymbols(
      spec({
        devices: [{ address: 'X0', label: 'Start', io: 'input', widget: 'momentary', symbol: 'StartPB' }],
      }),
    );
    expect(table.get('startpb')?.address).toBe('X0');
    expect(table.has('start')).toBe(false);
  });
});

describe('symbols — what makes a usable name', () => {
  it('accepts identifiers', () => {
    expect(isValidVarName('ZoneClear')).toBe(true);
    expect(isValidVarName('_step2')).toBe(true);
  });

  it('rejects anything that reads as an address', () => {
    // Otherwise the literal fallback could not tell a name from the thing it
    // falls back to.
    expect(isValidVarName('M40')).toBe(false);
    expect(isValidVarName('d10')).toBe(false);
    expect(isValidVarName('Y0')).toBe(false);
  });

  it('rejects names that are not identifiers at all', () => {
    expect(isValidVarName('2fast')).toBe(false);
    expect(isValidVarName('has space')).toBe(false);
    expect(isValidVarName('')).toBe(false);
  });
});

// --- Scope --------------------------------------------------------------------

describe('symbols — scope resolution', () => {
  const s = spec({ symbols: 'optional' });

  const proj = project(
    [
      {
        id: 'A',
        name: 'A',
        rungs: [],
        vars: [{ name: 'Step', kind: 'bool', address: 'M10' }],
      },
      {
        id: 'B',
        name: 'B',
        rungs: [],
        vars: [{ name: 'Step', kind: 'bool', address: 'M20' }],
      },
    ],
    [{ name: 'Running', kind: 'bool', address: 'M0' }],
  );
  const table = buildSymbolTable(s, proj);

  it('gives each POU its own Step', () => {
    expect(resolveName('Step', 'A', table)).toEqual({ address: 'M10', origin: 'local' });
    expect(resolveName('Step', 'B', table)).toEqual({ address: 'M20', origin: 'local' });
  });

  it('shares a global with every POU', () => {
    expect(resolveName('Running', 'A', table)?.address).toBe('M0');
    expect(resolveName('Running', 'B', table)?.address).toBe('M0');
  });

  it('reaches the plant by the device symbol', () => {
    expect(resolveName('FrameBlankReady', 'A', table)).toEqual({ address: 'X1', origin: 'plant' });
  });

  it('matches case-insensitively, the way a real tool does', () => {
    expect(resolveName('running', 'A', table)?.address).toBe('M0');
    expect(resolveName('FRAMEBLANKREADY', 'A', table)?.address).toBe('X1');
  });

  it('prefers a local over a global of the same name', () => {
    const shadowed = project(
      [{ id: 'A', name: 'A', rungs: [], vars: [{ name: 'Busy', kind: 'bool', address: 'M11' }] }],
      [{ name: 'Busy', kind: 'bool', address: 'M1' }],
    );
    const t = buildSymbolTable(s, shadowed);
    expect(resolveName('Busy', 'A', t)).toEqual({ address: 'M11', origin: 'local' });
  });

  it('falls back to the address itself', () => {
    expect(resolveName('M40', 'A', table)).toEqual({ address: 'M40', origin: 'literal' });
  });

  it('returns null for a name that is neither declared nor an address', () => {
    expect(resolveName('Nonsense', 'A', table)).toBeNull();
  });
});

// --- Resolving ----------------------------------------------------------------

describe('symbols — resolveProject', () => {
  it('does nothing at all when symbols are off', () => {
    const p = project([{ id: 'A', name: 'A', rungs: [rung('r1', 'X0', 'Y0')] }]);
    const out = resolveProject(spec(), p);
    // Same object back, not merely an equal one: this is the path 46 puzzles
    // take and it must not cost them a walk of every rung.
    expect(out.project).toBe(p);
    expect(out.issues).toEqual([]);
  });

  it('rewrites names to addresses', () => {
    const p = project(
      [
        {
          id: 'A',
          name: 'A',
          rungs: [rung('r1', 'FrameBlankReady', 'Latch')],
          vars: [{ name: 'Latch', kind: 'bool', address: 'M10' }],
        },
      ],
    );
    const { project: out, issues } = resolveProject(spec({ symbols: 'optional' }), p);
    expect(issues).toEqual([]);
    const cells = out.pous[0].rungs[0].cells[0];
    expect(cells[0]?.device).toBe('X1');
    expect(cells[1]?.device).toBe('M10');
  });

  it('rewrites word operands but leaves constants alone', () => {
    const p = project([
      {
        id: 'A',
        name: 'A',
        rungs: [
          {
            id: 'r1',
            rows: 1,
            cols: 2,
            cells: [
              [
                { type: 'compare', device: '', op: '>', operands: ['Level', 'K500'] },
                { type: 'mov', device: 'Target', operands: ['Level'] },
              ],
            ],
            vlinks: [],
          },
        ],
        vars: [
          { name: 'Level', kind: 'int', address: 'D30' },
          { name: 'Target', kind: 'int', address: 'D31' },
        ],
      },
    ]);
    const { project: out } = resolveProject(spec({ symbols: 'optional' }), p);
    const cells = out.pous[0].rungs[0].cells[0];
    expect(cells[0]?.operands).toEqual(['D30', 'K500']);
    expect(cells[1]?.operands).toEqual(['D30']);
    expect(cells[1]?.device).toBe('D31');
  });

  it('reports an undeclared name', () => {
    const p = project([{ id: 'A', name: 'A', rungs: [rung('r1', 'X0', 'Mystery')] }]);
    const { issues } = resolveProject(spec({ symbols: 'optional' }), p);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ name: 'Mystery', reason: 'undeclared', pouId: 'A' });
  });

  it('reports a bare address only in strict player code', () => {
    const p = project([
      { id: 'FIX', name: 'FIX', rungs: [rung('r1', 'M5', 'M6')] },
      { id: 'MINE', name: 'MINE', rungs: [rung('r1', 'M7', 'M8')] },
    ]);
    const { issues } = resolveProject(spec({ symbols: 'required' }), p, new Set(['MINE']));
    // The fixture is content, not an answer, so it is always resolved leniently.
    expect(issues.every((i) => i.pouId === 'MINE')).toBe(true);
    expect(issues.map((i) => i.name).sort()).toEqual(['M7', 'M8']);
    expect(issues[0].reason).toBe('bare-address');
  });
});

// --- Allocation ---------------------------------------------------------------

describe('symbols — allocation', () => {
  const s = spec({
    symbols: 'optional',
    memoryPools: { bool: 'M0-M9', int: 'D20-D29', timer: 'T0-T4', counter: 'C0-C4' },
  });

  it('takes the lowest free index in the pool', () => {
    const empty = project([{ id: 'A', name: 'A', rungs: [] }]);
    expect(allocateAddress(s, empty, 'bool')).toBe('M0');
    expect(allocateAddress(s, empty, 'int')).toBe('D20');
    expect(allocateAddress(s, empty, 'timer')).toBe('T0');
  });

  it('skips what is already declared, wherever it was declared', () => {
    const p = project(
      [
        { id: 'A', name: 'A', rungs: [], vars: [{ name: 'X', kind: 'bool', address: 'M0' }] },
        { id: 'B', name: 'B', rungs: [], vars: [{ name: 'Y', kind: 'bool', address: 'M2' }] },
      ],
      [{ name: 'G', kind: 'bool', address: 'M1' }],
    );
    // Locals in different POUs still take distinct addresses: names are scoped,
    // memory is not, and one bit answering to two names is the bug this exists
    // to prevent.
    expect(allocateAddress(s, p, 'bool')).toBe('M3');
  });

  it('never hands out a plant address', () => {
    const withD = spec({
      symbols: 'optional',
      memoryPools: { int: 'D0-D3' },
      devices: [
        ...devices,
        { address: 'D0', label: 'Level', io: 'input', widget: 'bar', signal: 'analog',
          range: { countMin: 0, countMax: 4000, min: 0, max: 100, units: '%' } },
      ],
    });
    expect(takenAddresses(withD, project([]))).toContain('D0');
    expect(allocateAddress(withD, project([]), 'int')).toBe('D1');
  });

  it('returns null when the pool is exhausted or absent', () => {
    const full = project([
      {
        id: 'A',
        name: 'A',
        rungs: [],
        vars: Array.from({ length: 5 }, (_, i) => ({
          name: `T${i}`,
          kind: 'timer' as const,
          address: `T${i}`,
        })),
      },
    ]);
    expect(allocateAddress(s, full, 'timer')).toBeNull();
    expect(allocateAddress(spec({ symbols: 'optional' }), project([]), 'bool')).toBeNull();
  });
});

// --- Declaration rules --------------------------------------------------------

describe('symbols — the rules a submitted declaration is held to', () => {
  const s = spec({ symbols: 'optional', memoryPools: { bool: 'M0-M9', int: 'D20-D29' } });

  const errorsFor = (p: LadderProject): string[] => {
    const errors: string[] = [];
    validateDeclarations(s, p, errors);
    return errors;
  };

  it('accepts a clean set', () => {
    expect(
      errorsFor(
        project([{ id: 'A', name: 'A', rungs: [], vars: [{ name: 'Step', kind: 'bool', address: 'M3' }] }]),
      ),
    ).toEqual([]);
  });

  it('rejects an address outside the pool', () => {
    const e = errorsFor(
      project([{ id: 'A', name: 'A', rungs: [], vars: [{ name: 'Step', kind: 'bool', address: 'M50' }] }]),
    );
    expect(e).toHaveLength(1);
    expect(e[0]).toContain('outside the bool pool');
  });

  it('rejects two declarations on one address, across POUs', () => {
    const e = errorsFor(
      project([
        { id: 'A', name: 'A', rungs: [], vars: [{ name: 'Step', kind: 'bool', address: 'M3' }] },
        { id: 'B', name: 'B', rungs: [], vars: [{ name: 'Other', kind: 'bool', address: 'M3' }] },
      ]),
    );
    expect(e).toHaveLength(1);
    expect(e[0]).toContain('already used by');
  });

  it('rejects a declaration aimed at a plant device', () => {
    // The security rule: without it a payload could name Y0 and drive the torch
    // from a section with no business doing so.
    const e = errorsFor(
      project([{ id: 'A', name: 'A', rungs: [], vars: [{ name: 'Torchy', kind: 'bool', address: 'Y0' }] }]),
    );
    expect(e).toHaveLength(1);
    expect(e[0]).toContain('is a plant device');
  });

  it('rejects a kind that does not match its family', () => {
    const e = errorsFor(
      project([{ id: 'A', name: 'A', rungs: [], vars: [{ name: 'Step', kind: 'bool', address: 'D20' }] }]),
    );
    expect(e[0]).toContain('lives in M');
  });

  it('rejects a name that reads as an address', () => {
    const e = errorsFor(
      project([{ id: 'A', name: 'A', rungs: [], vars: [{ name: 'M40', kind: 'bool', address: 'M3' }] }]),
    );
    expect(e.some((m) => m.includes('not a usable name'))).toBe(true);
  });

  it('does nothing when symbols are off', () => {
    const errors: string[] = [];
    validateDeclarations(
      spec(),
      project([{ id: 'A', name: 'A', rungs: [], vars: [{ name: 'M40', kind: 'bool', address: 'Y0' }] }]),
      errors,
    );
    expect(errors).toEqual([]);
  });
});

// --- Declare-from-error -------------------------------------------------------

describe('symbols — what is used but not declared', () => {
  /** One rung holding a single element, so the guess has something to read. */
  const holding = (id: string, el: LadderElement): Rung => ({
    id,
    rows: 1,
    cols: 1,
    cells: [[el]],
    vlinks: [],
  });

  const withRungs = (...rungs: Rung[]) =>
    project([{ id: 'MINE', name: 'MINE', rungs }]);

  it('reads the kind off the element that used the name', () => {
    const out = missingDeclarations(
      spec({ symbols: 'optional' }),
      withRungs(
        holding('r1', { type: 'coil-out', device: 'OutfeedBusy' }),
        holding('r2', { type: 'timer', device: 'Dwell', preset: 30 }),
        holding('r3', { type: 'counter', device: 'Made', preset: 5 }),
        holding('r4', { type: 'mov', device: 'Target', operands: ['K10'] }),
      ),
    );
    expect(out.map((m) => [m.name, m.kind])).toEqual([
      ['OutfeedBusy', 'bool'],
      ['Dwell', 'timer'],
      ['Made', 'counter'],
      ['Target', 'int'],
    ]);
  });

  it('treats a word operand as a value whatever the block writes', () => {
    const out = missingDeclarations(
      spec({ symbols: 'optional' }),
      withRungs(holding('r1', { type: 'mov', device: 'D30', operands: ['Measured'] })),
    );
    expect(out).toEqual([{ pouId: 'MINE', name: 'Measured', kind: 'int', rung: 1 }]);
  });

  it('offers a name once per program, at the rung that first wanted it', () => {
    const out = missingDeclarations(
      spec({ symbols: 'optional' }),
      withRungs(
        holding('r1', { type: 'contact-no', device: 'Ready' }),
        holding('r2', { type: 'coil-out', device: 'Ready' }),
      ),
    );
    expect(out).toEqual([{ pouId: 'MINE', name: 'Ready', kind: 'bool', rung: 1 }]);
  });

  it('leaves out anything a declaration could not fix', () => {
    // A quick fix that cannot be applied is worse than none; the validation
    // message already says the right thing about these.
    const out = missingDeclarations(
      spec({ symbols: 'optional' }),
      withRungs(holding('r1', { type: 'coil-out', device: 'has space' })),
    );
    expect(out).toEqual([]);
  });

  it('says nothing about names that already resolve, or about a raw-address puzzle', () => {
    const declared = project([
      {
        id: 'MINE',
        name: 'MINE',
        rungs: [holding('r1', { type: 'coil-out', device: 'OutfeedBusy' })],
        vars: [{ name: 'OutfeedBusy', kind: 'bool', address: 'M5' }],
      },
    ]);
    expect(missingDeclarations(spec({ symbols: 'optional' }), declared)).toEqual([]);
    // Plant names and bare addresses both resolve too.
    expect(
      missingDeclarations(
        spec({ symbols: 'optional' }),
        withRungs(holding('r1', { type: 'coil-out', device: 'Torch' }), holding('r2', { type: 'coil-out', device: 'M9' })),
      ),
    ).toEqual([]);
    // And `off` never walks a rung at all.
    expect(
      missingDeclarations(spec(), withRungs(holding('r1', { type: 'coil-out', device: 'Nope' }))),
    ).toEqual([]);
  });
});

// --- Assembly -----------------------------------------------------------------

describe('symbols — assembling a player-authored project', () => {
  const base = spec({
    symbols: 'optional',
    pouAuthoring: 'player',
    memoryPools: { bool: 'M0-M99' },
    pous: [
      { id: 'FIX', name: 'FIX', title: 'Fixture', editable: false, program: [rung('f1', 'X0', 'Y0')] },
      { id: 'MINE', name: 'MINE', title: 'Mine', editable: true },
    ],
    tasks: [{ id: 'MAIN', name: 'MAIN', priority: 0, pous: ['FIX', 'MINE'] }],
    globals: [{ name: 'Running', kind: 'bool', address: 'M0', fixed: true }],
  });

  it('keeps POUs the player added', () => {
    const out = assembleProject(base, {
      pous: [
        { id: 'MINE', name: 'MINE', rungs: [rung('m1', 'X0', 'Y1')] },
        { id: 'EXTRA', name: 'PORTAL', rungs: [rung('e1', 'X1', 'Y1')] },
      ],
      tasks: [],
    });
    expect(out.pous.map((p) => p.id)).toEqual(['FIX', 'MINE', 'EXTRA']);
    expect(out.pous[2].name).toBe('PORTAL');
  });

  it('calls an added POU from the first task, in the order it was added', () => {
    // The spec's tasks cannot name a section the player invented afterwards, so
    // without this every program they make is one no task calls — added, shown
    // in the tree, and never run.
    const out = assembleProject(base, {
      pous: [
        { id: 'MINE', name: 'MINE', rungs: [] },
        { id: 'SORT', name: 'SORT', rungs: [] },
        { id: 'PORTAL', name: 'PORTAL', rungs: [] },
      ],
      tasks: [],
    });
    expect(out.tasks[0].pous).toEqual(['FIX', 'MINE', 'SORT', 'PORTAL']);
  });

  it('appends nothing when the schedule is the player’s to write', () => {
    // Then a program in no task is a choice, and `checkTasks` already warns.
    const out = assembleProject(
      { ...base, taskAssignment: 'player' },
      {
        pous: [{ id: 'SORT', name: 'SORT', rungs: [] }],
        tasks: [{ id: 'MAIN', name: 'MAIN', priority: 0, pous: ['FIX', 'MINE'] }],
      },
    );
    expect(out.tasks[0].pous).toEqual(['FIX', 'MINE']);
  });

  it('will not let a player POU displace a shipped section', () => {
    const out = assembleProject(base, {
      pous: [{ id: 'FIX', name: 'HIJACK', rungs: [rung('h1', 'X0', 'Y1')] }],
      tasks: [],
    });
    expect(out.pous[0].name).toBe('FIX');
    expect(out.pous[0].rungs[0].id).toBe('f1');
  });

  it('ignores added POUs when authoring is fixed', () => {
    const fixed = { ...base, pouAuthoring: 'fixed' as const };
    const out = assembleProject(fixed, {
      pous: [{ id: 'EXTRA', name: 'EXTRA', rungs: [rung('e1', 'X0', 'Y1')] }],
      tasks: [],
    });
    expect(out.pous.map((p) => p.id)).toEqual(['FIX', 'MINE']);
  });

  it('takes shipped globals from the spec and merges the player’s on top', () => {
    const out = assembleProject(base, {
      pous: [],
      tasks: [],
      globals: [
        // Trying to move the bit it is graded against.
        { name: 'Running', kind: 'bool', address: 'M77' },
        { name: 'SpineReady', kind: 'bool', address: 'M5' },
      ],
    });
    expect(out.globals).toEqual([
      { name: 'Running', kind: 'bool', address: 'M0', fixed: true },
      { name: 'SpineReady', kind: 'bool', address: 'M5' },
    ]);
  });

  it('carries a section’s locals with its rungs', () => {
    const out = assembleProject(base, {
      pous: [
        {
          id: 'MINE',
          name: 'MINE',
          rungs: [rung('m1', 'X0', 'Y1')],
          vars: [{ name: 'Step', kind: 'bool', address: 'M9' }],
        },
      ],
      tasks: [],
    });
    expect(out.pous[1].vars).toEqual([{ name: 'Step', kind: 'bool', address: 'M9' }]);
  });

  it('counts the fixture out of the player’s POUs', () => {
    const assembled = assembleProject(base, {
      pous: [{ id: 'EXTRA', name: 'EXTRA', rungs: [] }],
      tasks: [],
    });
    expect([...playerPouIds(base, assembled)].sort()).toEqual(['EXTRA', 'MINE']);
  });
});

// --- End to end through the validator -----------------------------------------

describe('symbols — through validateProgram', () => {
  const s = spec({
    symbols: 'required',
    memoryPools: { bool: 'M0-M99' },
    writableOutputs: ['Y1'],
    pous: [{ id: 'MINE', name: 'MINE', title: 'Mine', editable: true }],
    tasks: [{ id: 'MAIN', name: 'MAIN', priority: 0, pous: ['MINE'] }],
  });

  const submit = (rungs: Rung[], vars?: VarDecl[]) =>
    validateProgram(s, { pous: [{ id: 'MINE', name: 'MINE', rungs, ...(vars ? { vars } : {}) }], tasks: [] });

  it('passes a program written in names', () => {
    const r = submit([rung('r1', 'Start', 'Latch')], [{ name: 'Latch', kind: 'bool', address: 'M0' }]);
    expect(r.errors).toEqual([]);
  });

  it('refuses a bare address, and says why once', () => {
    const r = submit([rung('r1', 'X0', 'M1')]);
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveLength(2);
    expect(r.errors.every((e) => e.includes('written in variables'))).toBe(true);
  });

  it('reports an undeclared name without also complaining about the address', () => {
    // One mistake, one error: the address check would otherwise fire on a string
    // the player never typed as an address.
    const r = submit([rung('r1', 'Start', 'Nowhere')]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('"Nowhere" is not declared here');
  });

  it('refuses to drive an actuator the puzzle did not hand over', () => {
    const r = submit([rung('r1', 'Start', 'Torch')]);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('does not hand over'))).toBe(true);
  });

  it('refuses to write a field input', () => {
    const r = submit([rung('r1', 'Start', 'FrameBlankReady')]);
    expect(r.errors.some((e) => e.includes('is a field input'))).toBe(true);
  });
});

// --- The compatibility guarantee ----------------------------------------------

describe('symbols — every shipped puzzle resolves to itself', () => {
  const ladderPuzzles = PUZZLES.filter((p): p is LadderPuzzleSpec => p.kind === 'ladder');

  it('covers the whole library', () => {
    expect(ladderPuzzles.length).toBeGreaterThan(40);
  });

  it.each(ladderPuzzles.map((p) => [p.slug, p] as const))(
    '%s is byte-identical after assembly and resolution',
    (_slug, puzzle) => {
      // The literal-address fallback is the compatibility hinge: a program with
      // no declarations is a program of bare addresses, and resolving it has to
      // give back exactly what went in — otherwise every saved solution slot in
      // the database would need migrating.
      const initial = initialProject(puzzle);
      const assembled = assembleProject(puzzle, initial);
      const runnable = runnableProject(puzzle, initial);
      expect(runnable).toEqual(assembled);
    },
  );

  it('leaves programs untouched by reference where symbols are off', () => {
    for (const puzzle of ladderPuzzles) {
      if ((puzzle.symbols ?? 'off') !== 'off') continue;
      const assembled = assembleProject(puzzle, initialProject(puzzle));
      expect(resolveProject(puzzle, assembled).project).toBe(assembled);
    }
  });
});

// --- The picker's view of the table -------------------------------------------

describe('symbolChoicesFor', () => {
  const picker = spec({ symbols: 'required' });
  const two: LadderProject = {
    pous: [
      { id: 'A', name: 'A', rungs: [], vars: [{ name: 'Step', kind: 'bool', address: 'M10' }] },
      { id: 'B', name: 'B', rungs: [], vars: [{ name: 'Step', kind: 'bool', address: 'M20' }] },
    ],
    tasks: [],
    globals: [
      { name: 'Running', kind: 'bool', address: 'M0' },
      { name: 'Level', kind: 'int', address: 'D30', comment: 'tank level' },
    ],
  };

  it('offers nothing at all when the puzzle is written in addresses', () => {
    expect(symbolChoicesFor(spec(), two, 'A')).toEqual([]);
  });

  it('lists locals, then globals, then the plant — resolution order', () => {
    expect(symbolChoicesFor(picker, two, 'A').map((c) => c.origin)).toEqual([
      'local',
      'global',
      'global',
      'plant',
      'plant',
      'plant',
      'plant',
    ]);
  });

  it('gives each POU its own local of the same name', () => {
    expect(symbolChoicesFor(picker, two, 'A')[0].address).toBe('M10');
    expect(symbolChoicesFor(picker, two, 'B')[0].address).toBe('M20');
  });

  it('offers only the name that would actually resolve when one shadows another', () => {
    const shadowed: LadderProject = {
      pous: [
        { id: 'A', name: 'A', rungs: [], vars: [{ name: 'Busy', kind: 'bool', address: 'M9' }] },
      ],
      tasks: [],
      globals: [{ name: 'Busy', kind: 'bool', address: 'M1' }],
    };
    const busy = symbolChoicesFor(picker, shadowed, 'A').filter((c) => c.name === 'Busy');
    expect(busy).toHaveLength(1);
    expect(busy[0]).toMatchObject({ address: 'M9', origin: 'local' });
  });

  it('flags a field input as read-only', () => {
    const choices = symbolChoicesFor(picker, two, 'A');
    expect(choices.find((c) => c.name === 'FrameBlankReady')).toMatchObject({
      address: 'X1',
      origin: 'plant',
      readOnly: true,
    });
    expect(choices.find((c) => c.name === 'Torch')?.readOnly).toBe(false);
  });

  it('carries a comment through as the detail line', () => {
    expect(symbolChoicesFor(picker, two, 'A').find((c) => c.name === 'Level')?.detail).toBe(
      'tank level',
    );
  });

  describe('filtering', () => {
    const choices = symbolChoicesFor(picker, two, 'A');

    it('returns everything for an empty query', () => {
      expect(filterChoices(choices, '  ')).toHaveLength(choices.length);
    });

    it('ranks a prefix match above one in the middle', () => {
      // "Ready" appears inside FrameBlankReady; "Running" starts with it.
      const hits = filterChoices(choices, 'r').map((c) => c.name);
      expect(hits[0]).toBe('Running');
      expect(hits).toContain('FrameBlankReady');
    });

    it('matches case-insensitively', () => {
      expect(filterChoices(choices, 'TORCH').map((c) => c.name)).toEqual(['Torch']);
    });

    it('finds a name by the address it sits on', () => {
      // Halfway to a rename: you remember where it is, not what you called it.
      expect(filterChoices(choices, 'D30').map((c) => c.name)).toEqual(['Level']);
    });

    it('returns nothing for a query that matches nothing', () => {
      expect(filterChoices(choices, 'zzz')).toEqual([]);
    });
  });
});
