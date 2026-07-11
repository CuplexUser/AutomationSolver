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

/** Disjoint-set union. */
class DSU {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    // path compression
    while (this.parent[x] !== root) {
      const next = this.parent[x];
      this.parent[x] = root;
      x = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

export function evaluateRung(
  rung: Rung,
  conducts: (el: LadderElement, row: number, col: number) => boolean,
): RungEvalResult {
  const { rows, cols } = rung;
  const nodeCols = cols + 1;
  // Virtual source node index = rows * nodeCols (one past the real nodes).
  const source = rows * nodeCols;
  const dsu = new DSU(source + 1);

  const nodeId = (row: number, nodeCol: number): number => row * nodeCols + nodeCol;

  const liveCells = new Set<string>();

  // Left rail: every (row, 0) is tied to the source.
  for (let row = 0; row < rows; row++) {
    dsu.union(nodeId(row, 0), source);
  }

  // Horizontal conducting elements.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const el = rung.cells[row]?.[col];
      if (!el || !isConducting(el.type)) continue;
      if (conducts(el, row, col)) {
        dsu.union(nodeId(row, col), nodeId(row, col + 1));
        liveCells.add(`${row}:${col}`);
      }
    }
  }

  // Vertical links (always conduct).
  for (const link of rung.vlinks) {
    if (link.row < 0 || link.row >= rows - 1) continue;
    if (link.col < 0 || link.col > cols) continue;
    dsu.union(nodeId(link.row, link.col), nodeId(link.row + 1, link.col));
  }

  const sourceRoot = dsu.find(source);
  const isEnergized = (row: number, nodeCol: number): boolean =>
    dsu.find(nodeId(row, nodeCol)) === sourceRoot;

  const energizedNodes = new Set<number>();
  for (let row = 0; row < rows; row++) {
    for (let nc = 0; nc < nodeCols; nc++) {
      if (isEnergized(row, nc)) energizedNodes.add(nodeId(row, nc));
    }
  }

  const outputs: EnergizedOutput[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const el = rung.cells[row]?.[col];
      if (!el || !isOutput(el.type)) continue;
      outputs.push({ row, col, element: el, energized: isEnergized(row, col) });
    }
  }

  return { outputs, energizedNodes, liveCells };
}

export { nodeIdFor };
function nodeIdFor(rung: Rung, row: number, nodeCol: number): number {
  return row * (rung.cols + 1) + nodeCol;
}
