/**
 * The landing page's playable rung.
 *
 * Only the drawing is local. The logic underneath is the shipped engine: the
 * same `SimEngine` the game animates with, the same `validateProgram` /
 * `gradeProgram` pair the server grades with, and work order 02's real
 * `PuzzleSpec` with its real scenarios. The page used to carry a hand-ported
 * miniature solver, which could quietly drift from the engine it was there to
 * advertise.
 *
 * The scaffold — guides, rails, click targets and branch dots — is built once
 * and then only repainted. Tearing the SVG down every scan destroyed the very
 * rect the pointer was pressing on, and a click only fires when press and
 * release land on the same node, so most clicks were swallowed.
 */
import {
  DEFAULT_POU_ID,
  GRADE_DT,
  SimEngine,
  getPuzzle,
  gradeProgram,
  makeEmptyRung,
  validateProgram,
  type ElementType,
  type LadderProgram,
  type LadderPuzzleSpec,
  type Rung,
} from '@automationsolver/shared';

const ROWS = 3;
const COLS = 5;
const CW = 68;
const CH = 54;
const PADX = 20;
const PADY = 16;

const spec = getPuzzle('seal-in') as LadderPuzzleSpec;
const rung: Rung = makeEmptyRung('r1', ROWS, COLS);
const program: LadderProgram = { rungs: [rung] };
const engine = new SimEngine(program);
const held: Record<string, boolean> = { X0: false, X1: false };

type ToolType = ElementType | 'erase';

interface Tool {
  id: string;
  type: ToolType;
  device: string;
  glyph: string;
  label: string;
  tipTitle: string;
  tip: string;
}

const TOOLS: Tool[] = [
  {
    id: 'no-x0',
    type: 'contact-no',
    device: 'X0',
    glyph: '┤ ├',
    label: 'X0',
    tipTitle: 'Normally open contact · X0',
    tip: 'Conducts only while the START button is held. Let go and the rung goes dead again, which is the whole problem to solve.',
  },
  {
    id: 'no-y0',
    type: 'contact-no',
    device: 'Y0',
    glyph: '┤ ├',
    label: 'Y0',
    tipTitle: 'Normally open contact · Y0',
    tip: 'The motor output read back as an input. Put it in parallel with START and the rung seals itself in.',
  },
  {
    id: 'nc-x1',
    type: 'contact-nc',
    device: 'X1',
    glyph: '┤/├',
    label: 'X1',
    tipTitle: 'Normally closed contact · X1',
    tip: 'Conducts until STOP is pressed, then opens. In series it breaks the whole rung, so the stop always wins.',
  },
  {
    id: 'coil',
    type: 'coil-out',
    device: 'Y0',
    glyph: '( )',
    label: 'Y0',
    tipTitle: 'Output coil · Y0',
    tip: 'Energizes the motor when power reaches it. Its far lead runs on to the right rail on its own.',
  },
  {
    id: 'wire',
    type: 'hwire',
    device: '',
    glyph: '──',
    label: 'Wire',
    tipTitle: 'Link',
    tip: 'A plain conductor. Carries power straight across the cell so a branch can reach further right.',
  },
  {
    id: 'erase',
    type: 'erase',
    device: '',
    glyph: '⌧',
    label: 'Erase',
    tipTitle: 'Eraser',
    tip: 'Empties the cell you click. Right-clicking any cell erases it too, whichever tool is selected.',
  },
];

let tool = TOOLS[0];

// ---- geometry --------------------------------------------------------
const W = PADX * 2 + COLS * CW;
const H = PADY * 2 + ROWS * CH;

const cx = (col: number): number => PADX + col * CW;
const cy = (row: number): number => PADY + row * CH + CH / 2;
/** Node numbering has to match the solver's: row-major over column boundaries. */
const nodeId = (row: number, nodeCol: number): number => row * (COLS + 1) + nodeCol;

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// ---- rendering -------------------------------------------------------
const svg = document.getElementById('ladder') as unknown as SVGSVGElement;
svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

let cellLayer: SVGGElement;
const branchPts = new Map<string, { g: SVGGElement; dot: SVGCircleElement; row: number; col: number }>();
const cellNodes = new Map<string, { g: SVGGElement; type: ElementType; row: number; col: number }>();

function drawElement(g: SVGGElement, type: ElementType, device: string, row: number, col: number): void {
  const x = cx(col);
  const y = cy(row);
  const mid = x + CW / 2;
  if (type === 'hwire') {
    g.appendChild(el('path', { d: `M${x} ${y} H${x + CW}`, class: 'el' }));
    return;
  }
  if (type === 'coil-out') {
    g.appendChild(el('path', { d: `M${x} ${y} H${mid - 11}`, class: 'el' }));
    g.appendChild(el('path', { d: `M${mid - 8} ${y - 11} A 15 15 0 0 0 ${mid - 8} ${y + 11}`, class: 'el' }));
    g.appendChild(el('path', { d: `M${mid + 8} ${y - 11} A 15 15 0 0 1 ${mid + 8} ${y + 11}`, class: 'el' }));
    g.appendChild(el('path', { d: `M${mid + 11} ${y} H${x + CW}`, class: 'el' }));
    // A coil's far side always lands on the right rail, however many empty
    // cells sit between them: that lead is the return path, not a wire the
    // player has to draw.
    if (col < COLS - 1) {
      g.appendChild(el('path', { d: `M${x + CW} ${y} H${W - PADX}`, class: 'el' }));
    }
  } else {
    g.appendChild(el('path', { d: `M${x} ${y} H${mid - 7}`, class: 'el' }));
    g.appendChild(el('path', { d: `M${mid - 7} ${y - 11} V${y + 11}`, class: 'el' }));
    g.appendChild(el('path', { d: `M${mid + 7} ${y - 11} V${y + 11}`, class: 'el' }));
    g.appendChild(el('path', { d: `M${mid + 7} ${y} H${x + CW}`, class: 'el' }));
    if (type === 'contact-nc') {
      g.appendChild(el('path', { d: `M${mid - 9} ${y + 12} L${mid + 9} ${y - 12}`, class: 'el' }));
    }
  }
  const text = el('text', { x: mid, y: y - 16, class: 'addr' });
  text.textContent = device;
  g.appendChild(text);
}

/** Builds every node that outlives a scan. Called exactly once. */
function buildScaffold(): void {
  const guides = el('g');
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      // faint cell guides so empty cells read as placeable
      guides.appendChild(
        el('rect', {
          x: cx(col),
          y: PADY + row * CH,
          width: CW,
          height: CH,
          class: 'grid-line',
          fill: 'none',
        }),
      );
    }
  }
  // The left rail is the source: it is live whenever the controller is, which
  // is the point of drawing it hot rather than a state to be computed.
  guides.appendChild(el('line', { x1: PADX, y1: PADY + 4, x2: PADX, y2: H - PADY - 4, class: 'rail hot' }));
  guides.appendChild(el('line', { x1: W - PADX, y1: PADY + 4, x2: W - PADX, y2: H - PADY - 4, class: 'rail' }));
  svg.appendChild(guides);

  cellLayer = el('g');
  svg.appendChild(cellLayer);

  const hits = el('g');
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const hit = el('rect', {
        x: cx(col) + 3,
        y: PADY + row * CH + 3,
        width: CW - 6,
        height: CH - 6,
        class: 'hit',
        role: 'button',
        tabindex: '0',
        'aria-label': `Cell row ${row + 1} column ${col + 1}`,
      });
      const key = `${row},${col}`;
      hit.addEventListener('click', (e) => {
        e.preventDefault();
        placeAt(key, false);
      });
      hit.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        placeAt(key, true);
      });
      hit.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          placeAt(key, false);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          placeAt(key, true);
        }
      });
      hits.appendChild(hit);
    }
  }
  svg.appendChild(hits);

  // Branch dots sit above the cell hit rects: a dot lands on the corner where
  // four cells meet, and it needs a target bigger than its own 5 px.
  const branches = el('g');
  for (let row = 0; row < ROWS - 1; row++) {
    for (let col = 1; col < COLS; col++) {
      const x = cx(col);
      const my = (cy(row) + cy(row + 1)) / 2;
      const g = el('g', {
        class: 'branchpt',
        role: 'button',
        tabindex: '0',
        'aria-label': `Branch link, rows ${row + 1} and ${row + 2}, column ${col}`,
      });
      g.appendChild(el('path', { d: `M${x} ${cy(row)} V${cy(row + 1)}`, class: 'el vlink' }));
      const dot = el('circle', { cx: x, cy: my, r: 5.5, class: 'branch' });
      g.appendChild(dot);
      g.appendChild(el('path', { d: `M${x - 2.5} ${my} H${x + 2.5}`, class: 'plus' }));
      g.appendChild(el('path', { d: `M${x} ${my - 2.5} V${my + 2.5}`, class: 'plus' }));
      g.appendChild(el('circle', { cx: x, cy: my, r: 9, class: 'branch-hit' }));
      const toggle = (e: Event): void => {
        e.preventDefault();
        toggleLink(row, col);
      };
      g.addEventListener('click', toggle);
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') toggle(e);
      });
      branchPts.set(`${row},${col}`, { g, dot, row, col });
      branches.appendChild(g);
    }
  }
  svg.appendChild(branches);
}

/** Redraws the placed elements. Called only when the program changes. */
function rebuildCells(): void {
  while (cellLayer.firstChild) cellLayer.removeChild(cellLayer.firstChild);
  cellNodes.clear();
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = rung.cells[row][col];
      if (!cell) continue;
      const g = el('g', { class: 'cell' });
      drawElement(g, cell.type, cell.device, row, col);
      cellLayer.appendChild(g);
      cellNodes.set(`${row},${col}`, { g, type: cell.type, row, col });
    }
  }
}

/** One scan's worth of state, as class flips on nodes that already exist. */
function paint(): void {
  const res = engine.resultsFor(DEFAULT_POU_ID)[0];
  if (!res) return;
  for (const [, node] of cellNodes) {
    const powered = res.energizedNodes.has(nodeId(node.row, node.col));
    // A contact is only drawn hot when it is both closed and carrying power;
    // an output lights from its own left node.
    const live =
      node.type === 'coil-out'
        ? powered
        : powered && res.liveCells.has(`${node.row}:${node.col}`);
    node.g.classList.toggle('live', live);
  }
  for (const [, bp] of branchPts) {
    const on = rung.vlinks.some((l) => l.row === bp.row && l.col === bp.col);
    bp.g.classList.toggle('on', on);
    bp.g.classList.toggle('live', on && res.energizedNodes.has(nodeId(bp.row, bp.col)));
    bp.g.setAttribute('aria-pressed', String(on));
    bp.dot.setAttribute('r', on ? '4' : '5.5');
  }
}

// ---- editing ---------------------------------------------------------
// Placing is idempotent: clicking a cell that already holds the selected
// instruction leaves it alone rather than toggling it away, so a double click
// cannot undo itself. Erasing is the eraser tool, a right click, or Delete.
function placeAt(key: string, erase: boolean): void {
  const [row, col] = key.split(',').map(Number);
  const cur = rung.cells[row][col];
  if (erase || tool.type === 'erase') {
    if (!cur) return;
    rung.cells[row][col] = null;
  } else {
    if (cur && cur.type === tool.type && cur.device === tool.device) return;
    rung.cells[row][col] = { type: tool.type as ElementType, device: tool.device };
  }
  programChanged();
}

function toggleLink(row: number, col: number): void {
  const at = rung.vlinks.findIndex((l) => l.row === row && l.col === col);
  if (at >= 0) rung.vlinks.splice(at, 1);
  else rung.vlinks.push({ row, col });
  programChanged();
}

/** Editing restarts the sim, exactly as downloading a new program would. */
function programChanged(): void {
  engine.reset();
  hideResults();
  rebuildCells();
  scan();
}

// ---- live scan -------------------------------------------------------
function scan(): void {
  engine.setInputs(held);
  engine.scan(GRADE_DT);
  paint();
  const running = engine.getBit('Y0');
  byId('lamp').classList.toggle('on', running);
  byId('lamp-state').textContent = running ? 'RUN' : 'OFF';
}

// ---- submit ----------------------------------------------------------
const results = byId('results');
const resultsList = byId('results-list');
const resultsScore = byId('results-score');
byId('results-title').textContent = `${spec.title} · ${spec.scenarios.length} scenarios`;

function hideResults(): void {
  results.classList.remove('shown');
}

function addResult(passed: boolean, label: string, detail?: string): void {
  const li = document.createElement('li');
  li.className = passed ? 'ok' : 'no';
  const mark = document.createElement('span');
  mark.className = 'mark';
  mark.textContent = passed ? '✔' : '✖';
  const body = document.createElement('span');
  body.textContent = label;
  if (detail) {
    const small = document.createElement('small');
    small.textContent = detail;
    body.appendChild(small);
  }
  li.appendChild(mark);
  li.appendChild(body);
  resultsList.appendChild(li);
}

/**
 * The same two phases the server runs on submit: structure first, then every
 * scenario through the engine.
 */
function showResults(): void {
  while (resultsList.firstChild) resultsList.removeChild(resultsList.firstChild);
  const check = validateProgram(spec, program);
  if (!check.valid) {
    for (const message of check.errors) addResult(false, message);
    resultsScore.textContent = 'Rejected';
    results.classList.remove('pass');
    results.classList.add('fail', 'shown');
    return;
  }

  const graded = gradeProgram(spec, program);
  for (const scenario of graded.scenarios) {
    const failed = scenario.steps.find((s) => !s.passed);
    addResult(scenario.passed, scenario.name, failed && (failed.failures[0] ?? failed.label));
  }
  resultsScore.textContent = graded.solved
    ? `Solved · ${graded.score} / 100`
    : `${graded.scenarios.filter((s) => s.passed).length}/${graded.scenarios.length} scenarios`;
  results.classList.toggle('pass', graded.solved);
  results.classList.toggle('fail', !graded.solved);
  results.classList.add('shown');
}

// ---- palette + controls ----------------------------------------------
const palette = byId('palette');
const demo = byId('try');

// One tooltip element, moved and clamped inside the demo panel, so the outer
// tools do not push their text off the edge of the card.
const tipBox = document.createElement('div');
tipBox.className = 'tip';
tipBox.id = 'tool-tip';
tipBox.setAttribute('role', 'tooltip');
tipBox.hidden = true;
demo.appendChild(tipBox);

function showTip(button: HTMLElement, t: Tool): void {
  while (tipBox.firstChild) tipBox.removeChild(tipBox.firstChild);
  const head = document.createElement('b');
  head.textContent = t.tipTitle;
  tipBox.appendChild(head);
  tipBox.appendChild(document.createTextNode(t.tip));
  tipBox.hidden = false;
  const box = demo.getBoundingClientRect();
  const b = button.getBoundingClientRect();
  const left = b.left - box.left + b.width / 2 - tipBox.offsetWidth / 2;
  tipBox.style.left = `${Math.max(10, Math.min(left, box.width - tipBox.offsetWidth - 10))}px`;
  tipBox.style.top = `${b.bottom - box.top + 8}px`;
}

const hideTip = (): void => {
  tipBox.hidden = true;
};

for (const t of TOOLS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tool';
  button.setAttribute('aria-pressed', String(t === tool));
  button.setAttribute('aria-describedby', 'tool-tip');
  button.dataset.id = t.id;
  const glyph = document.createElement('span');
  glyph.className = 'glyph';
  glyph.textContent = t.glyph;
  const label = document.createElement('span');
  label.textContent = t.label;
  button.appendChild(glyph);
  button.appendChild(label);
  button.addEventListener('click', () => {
    tool = t;
    for (const other of Array.from(palette.children)) {
      other.setAttribute('aria-pressed', String((other as HTMLElement).dataset.id === t.id));
    }
  });
  button.addEventListener('mouseenter', () => showTip(button, t));
  button.addEventListener('focus', () => showTip(button, t));
  button.addEventListener('mouseleave', hideTip);
  button.addEventListener('blur', hideTip);
  palette.appendChild(button);
}

function momentary(button: HTMLElement, address: string): void {
  const press = (on: boolean): void => {
    button.classList.toggle('held', on);
    held[address] = on;
    scan();
  };
  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    press(true);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    button.addEventListener(type, () => press(false));
  }
  button.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      press(true);
    }
  });
  button.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') press(false);
  });
  button.addEventListener('blur', () => press(false));
}

momentary(byId('btn-start'), 'X0');
momentary(byId('btn-stop'), 'X1');

byId('btn-submit').addEventListener('click', showResults);
byId('btn-clear').addEventListener('click', () => {
  for (let row = 0; row < ROWS; row++) rung.cells[row].fill(null);
  rung.vlinks.length = 0;
  programChanged();
});
byId('btn-solve').addEventListener('click', () => {
  for (let row = 0; row < ROWS; row++) rung.cells[row].fill(null);
  rung.vlinks.length = 0;
  rung.cells[0][0] = { type: 'contact-no', device: 'X0' };
  rung.cells[1][0] = { type: 'contact-no', device: 'Y0' };
  rung.cells[0][1] = { type: 'contact-nc', device: 'X1' };
  rung.cells[0][2] = { type: 'coil-out', device: 'Y0' };
  rung.vlinks.push({ row: 0, col: 1 });
  programChanged();
});

// Start with the start button placed, so the first click already means
// something: the visitor's job is to make the rung remember.
buildScaffold();
rung.cells[0][0] = { type: 'contact-no', device: 'X0' };
rung.cells[0][1] = { type: 'contact-nc', device: 'X1' };
rung.cells[0][2] = { type: 'coil-out', device: 'Y0' };
programChanged();
setInterval(scan, GRADE_DT);
