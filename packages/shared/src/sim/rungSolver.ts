import { isConducting, isOutput, type LadderElement, type Rung } from '../ladder/types.js';

/**
 * Power-flow solver for a single rung.
 *
 * The rung grid defines a graph of nodes at column boundaries:
 *   node(row, nodeCol) for row in [0, rows), nodeCol in [0, cols].
 * The left rail (nodeCol 0) is the power source; every left-rail node is energized.
 *
 * Edges:
 *   - a conducting element in cell[row][col] joins node(row, col)-node(row, col+1)
 *     when it conducts (contacts depend on device state; wires always conduct);
 *   - a vertical link joins node(row, col)-node(row+1, col) unconditionally.
 *
 * An output element energizes when its left node (row, col) is reachable from the
 * left rail through conducting edges. This naturally yields series = AND and
 * parallel (via vertical links) = OR.
 *
 * An energized output then passes power on to its own right node, so a row of
 * them after one contact all fire from that same condition — `LD X0 / OUT Y0 /
 * MOV K10 D30` is one rung on a real controller, and stacking the blocks left to
 * right is how it reads here. That pass-through is a fixpoint rather than a
 * plain edge: an output only conducts once its *left* node is live, because
 * unioning it unconditionally would let power flow backwards through a block
 * that never fired.
 */

export interface EnergizedOutput {
  row: number;
  col: number;
  element: LadderElement;
  energized: boolean;
}

export interface RungEvalResult {
  outputs: EnergizedOutput[];
  /** node ids that are energized (for UI highlighting). */
  energizedNodes: Set<number>;
  /** "row:col" of conducting cells that actually conducted this scan. */
  liveCells: Set<string>;
}

/**
 * Disjoint-set union over a typed array, as plain functions: one allocation per
 * rung rather than an object and a closure per scan, which on a large project is
 * most of what a scan used to cost.
 */
function find(parent: Int32Array, x: number): number {
  let root = x;
  while (parent[root] !== root) root = parent[root];
  // path compression
  while (parent[x] !== root) {
    const next = parent[x];
    parent[x] = root;
    x = next;
  }
  return root;
}

function union(parent: Int32Array, a: number, b: number): void {
  const ra = find(parent, a);
  const rb = find(parent, b);
  if (ra !== rb) parent[ra] = rb;
}

/**
 * Evaluate one rung. `detail` also collects which nodes and cells carried power,
 * for the editor's highlighting and the replay; the grader asks without it,
 * because it only needs the outputs and a large project spends most of a scan
 * building sets nobody reads. The outputs are identical either way.
 */
export function evaluateRung(
  rung: Rung,
  conducts: (el: LadderElement, row: number, col: number) => boolean,
  detail = true,
): RungEvalResult {
  const { rows, cols } = rung;
  const nodeCols = cols + 1;
  // Virtual source node index = rows * nodeCols (one past the real nodes).
  const source = rows * nodeCols;

  const parent = new Int32Array(source + 1);
  for (let i = 0; i <= source; i++) parent[i] = i;

  const liveCells = new Set<string>();

  // Left rail: every (row, 0) is tied to the source.
  for (let row = 0; row < rows; row++) union(parent, row * nodeCols, source);

  // Horizontal conducting elements, in row-major order (the order `conducts`
  // has always been asked in, which the engine's pulse memory and diagnostics
  // depend on), collecting the outputs on the same pass.
  const outRow: number[] = [];
  const outCol: number[] = [];
  const outEl: LadderElement[] = [];
  for (let row = 0; row < rows; row++) {
    const line = rung.cells[row];
    if (!line) continue;
    for (let col = 0; col < cols; col++) {
      const el = line[col];
      if (!el) continue;
      if (isConducting(el.type) && conducts(el, row, col)) {
        union(parent, row * nodeCols + col, row * nodeCols + col + 1);
        if (detail) liveCells.add(`${row}:${col}`);
      }
      if (isOutput(el.type)) {
        outRow.push(row);
        outCol.push(col);
        outEl.push(el);
      }
    }
  }

  // Vertical links (always conduct).
  for (const link of rung.vlinks) {
    if (link.row < 0 || link.row >= rows - 1) continue;
    if (link.col < 0 || link.col > cols) continue;
    union(parent, link.row * nodeCols + link.col, (link.row + 1) * nodeCols + link.col);
  }

  // Outputs pass power through once they are live. Energizing one can complete a
  // path to the next, so repeat until nothing new lights up.
  const passed = new Uint8Array(outEl.length);
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < outEl.length; i++) {
      if (passed[i]) continue;
      const left = outRow[i] * nodeCols + outCol[i];
      if (find(parent, left) !== find(parent, source)) continue;
      union(parent, left, left + 1);
      passed[i] = 1;
      changed = true;
    }
  }

  const sourceRoot = find(parent, source);
  const energizedNodes = new Set<number>();
  if (detail) {
    for (let id = 0; id < source; id++) {
      if (find(parent, id) === sourceRoot) energizedNodes.add(id);
    }
  }

  const outputs: EnergizedOutput[] = [];
  for (let i = 0; i < outEl.length; i++) {
    outputs.push({
      row: outRow[i],
      col: outCol[i],
      element: outEl[i],
      energized: find(parent, outRow[i] * nodeCols + outCol[i]) === sourceRoot,
    });
  }

  return { outputs, energizedNodes, liveCells };
}

export { nodeIdFor };
function nodeIdFor(rung: Rung, row: number, nodeCol: number): number {
  return row * (rung.cols + 1) + nodeCol;
}
