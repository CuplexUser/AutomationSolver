import {
  MATH_MNEMONIC,
  MATH_SYMBOL,
  type LadderElement,
  type MathOp,
} from '@automationsolver/shared';

// Compact cell geometry — dense enough to fit a real program on one screen while
// keeping the address label at a legible size. The symbol occupies the middle
// third; the wire enters and leaves at WIRE_Y.
export const CELL_W = 72;
export const CELL_H = 62;
export const WIRE_Y = 34;

// The band below the symbol, where a word block names the register it writes and
// a timer/counter names its preset. The cell used to end 7px under the symbol
// box, so that second line half-overlapped the box outline and the row beneath —
// the destination register, the one thing a MOV is *for*, was the hardest thing
// on the rung to read. The band is now a line of its own with clear air above it.
const DEST_TOP = 47;
const DEST_H = 13;
const DEST_BASE = 57;
/** JetBrains Mono advances 0.6em, so a 10px label is 6px a character. */
const DEST_CHAR_W = 6;

/** A `D` operand is a register (a value that moves); anything else is a constant. */
const REGISTER_RE = /^D\d+$/i;

// Theme-following colors. CSS var() is not valid inside SVG presentation
// attributes, so every color below is applied through the style prop instead.
const IDLE_WIRE = 'var(--wire-idle)';
const LIVE = 'var(--live)';
const IDLE_SYM = 'var(--sym-idle)';

interface Props {
  element: LadderElement | null;
  selected: boolean;
  leftLive: boolean;
  rightLive: boolean;
  symbolLive: boolean;
  onClick: () => void;
}

function glow(live: boolean): React.CSSProperties {
  return live ? { filter: 'drop-shadow(0 0 3px rgba(255,176,32,0.8))' } : {};
}

interface CellText {
  /** The top line, split into tokens so registers can be tinted apart from constants. */
  top: string[];
  /** The register a word block writes, shown as a pill under the symbol. */
  dest?: string;
  /** A timer/counter preset, shown as plain text in the same band. */
  preset?: string;
}

/**
 * What goes on the cell's two text lines.
 *
 * Bit elements have always shown their one address on top. Word elements read
 * as the little expression they are — `D0÷K4` rather than `D0,K4` — split into
 * tokens so a register reads in the register color and a K constant does not.
 * The register they write goes underneath in a pill of the same color: a
 * destination is a different kind of thing from an operand and should not have
 * to be spelled out as one. A compare writes nothing, so it uses the top line
 * alone.
 */
function cellText(element: LadderElement): CellText {
  // A block can be placed before it is fully named, so every slot falls back to
  // `?` — an unfilled field should read as an unfilled field on the rung, not as
  // a blank space that looks finished.
  const a = element.operands?.[0] || '?';
  const b = element.operands?.[1] || '?';
  const dest = element.device || '?';
  switch (element.type) {
    // A wire is the one element with nothing to name, so it gets no address
    // line at all — a `?` there reads as a field still waiting to be filled in.
    case 'hwire':
      return { top: [] };
    case 'compare':
      return { top: [a, element.op ?? '?', b] };
    case 'mov':
      return { top: [a], dest };
    case 'math':
      return { top: [a, MATH_SYMBOL[(element.op as MathOp) ?? 'add'], b], dest };
    case 'pid':
      // Setpoint over measurement; the block face already says which is which.
      return { top: [a, '/', b], dest };
    default:
      return {
        top: [element.device || '?'],
        preset:
          (element.type === 'timer' || element.type === 'counter') && element.preset != null
            ? `K${element.preset}`
            : undefined,
      };
  }
}

/** Spoken form for the cell button's aria-label, since the glyphs are terse. */
export function describeElement(element: LadderElement): string {
  const a = element.operands?.[0] || 'nothing yet';
  const b = element.operands?.[1] || 'nothing yet';
  const dest = element.device || 'nothing yet';
  switch (element.type) {
    case 'hwire':
      return 'wire';
    case 'compare':
      return `compare ${a} ${element.op ?? '='} ${b}`;
    case 'mov':
      return `move ${a} into ${dest}`;
    case 'math':
      return `${MATH_MNEMONIC[(element.op as MathOp) ?? 'add']} ${a} and ${b} into ${dest}`;
    case 'pid':
      return `PID loop, setpoint ${a}, measured ${b}, output ${dest}`;
    default:
      return `${element.type} ${dest}`;
  }
}

export function CellView({ element, selected, leftLive, rightLive, symbolLive, onClick }: Props) {
  const symColor = symbolLive ? LIVE : IDLE_SYM;
  const leftColor = leftLive ? LIVE : IDLE_WIRE;
  const rightColor = rightLive ? LIVE : IDLE_WIRE;
  const text: CellText = element ? cellText(element) : { top: [] };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`ladder-cell${selected ? ' is-selected' : ''}`}
      aria-label={element ? describeElement(element) : 'empty cell'}
    >
      <svg width={CELL_W} height={CELL_H} viewBox={`0 0 ${CELL_W} ${CELL_H}`}>
        {element?.type === 'hwire' ? (
          // A wire is drawn, not symbolized: one unbroken conductor across the
          // cell. It lights from the *node* either side of it rather than from
          // `symbolLive`, which a wire always sets — it conducts by definition,
          // which is not the same as carrying power.
          <line
            x1={0}
            y1={WIRE_Y}
            x2={CELL_W}
            y2={WIRE_Y}
            strokeWidth={2}
            style={{ stroke: leftColor, ...glow(leftLive) }}
          />
        ) : element ? (
          <>
            <line x1={0} y1={WIRE_Y} x2={26} y2={WIRE_Y} strokeWidth={2} style={{ stroke: leftColor, ...glow(leftLive) }} />
            <line
              x1={46}
              y1={WIRE_Y}
              x2={CELL_W}
              y2={WIRE_Y}
              strokeWidth={2}
              style={{ stroke: rightColor, ...glow(rightLive) }}
            />
            <Symbol element={element} color={symColor} live={symbolLive} />
            <text x={CELL_W / 2} y={13} textAnchor="middle" className="cell-addr" style={{ fill: symColor }}>
              {text.top.map((token, i) => (
                // Live wins over the register tint: while the sim runs, "is this
                // conducting" is the more urgent question than "is this a D".
                <tspan
                  key={i}
                  className={!symbolLive && REGISTER_RE.test(token) ? 'cell-reg' : undefined}
                >
                  {token}
                </tspan>
              ))}
            </text>
            {text.dest && <DestPill label={text.dest} />}
            {text.preset && (
              <text x={CELL_W / 2} y={DEST_BASE} textAnchor="middle" className="cell-preset">
                {text.preset}
              </text>
            )}
          </>
        ) : (
          <g className="cell-empty" style={{ stroke: 'var(--edge)' }}>
            <line x1={CELL_W / 2 - 4} y1={WIRE_Y} x2={CELL_W / 2 + 4} y2={WIRE_Y} strokeWidth={1.5} />
            <line x1={CELL_W / 2} y1={WIRE_Y - 4} x2={CELL_W / 2} y2={WIRE_Y + 4} strokeWidth={1.5} />
          </g>
        )}
      </svg>
    </button>
  );
}

/**
 * The register a word block writes, as a filled chip under the block.
 *
 * Mono type means the width is arithmetic rather than a measurement, so the
 * chip fits `D0` and `D1000` alike without ever reaching the cell edge.
 */
function DestPill({ label }: { label: string }) {
  const w = label.length * DEST_CHAR_W + 14;
  return (
    <g>
      <rect
        x={(CELL_W - w) / 2}
        y={DEST_TOP}
        width={w}
        height={DEST_H}
        rx={3}
        className="cell-dest-pill"
      />
      <text x={CELL_W / 2} y={DEST_BASE} textAnchor="middle" className="cell-dest">
        {label}
      </text>
    </g>
  );
}

function Symbol({ element, color, live }: { element: LadderElement; color: string; live: boolean }) {
  const sw = 2;
  const s = { stroke: color, ...glow(live) };
  const t = element.type;

  // Compare: a contact whose "state" is the comparison, so it keeps the contact
  // bars and puts the operator between them.
  if (t === 'compare') {
    return (
      <g strokeWidth={sw} style={s} fill="none">
        <line x1={26} y1={WIRE_Y - 9} x2={26} y2={WIRE_Y + 9} />
        <line x1={46} y1={WIRE_Y - 9} x2={46} y2={WIRE_Y + 9} />
        <line x1={24} y1={WIRE_Y} x2={26} y2={WIRE_Y} />
        <line x1={46} y1={WIRE_Y} x2={48} y2={WIRE_Y} />
        <text
          x={36}
          y={WIRE_Y + 4}
          textAnchor="middle"
          fontSize={11}
          fontWeight={700}
          stroke="none"
          style={{ fill: color }}
        >
          {element.op ?? '='}
        </text>
      </g>
    );
  }

  // Word outputs: a function block carrying its mnemonic.
  if (t === 'mov' || t === 'math' || t === 'pid') {
    const mnemonic =
      t === 'mov' ? 'MOV' : t === 'pid' ? 'PID' : (MATH_MNEMONIC[(element.op as MathOp) ?? 'add'] ?? 'ADD');
    return (
      <g strokeWidth={sw} style={s} fill="none">
        <rect x={18} y={WIRE_Y - 11} width={36} height={22} rx={3} />
        <line x1={12} y1={WIRE_Y} x2={18} y2={WIRE_Y} />
        <line x1={54} y1={WIRE_Y} x2={60} y2={WIRE_Y} />
        <text
          x={36}
          y={WIRE_Y + 4}
          textAnchor="middle"
          fontSize={10}
          fontWeight={700}
          stroke="none"
          style={{ fill: color }}
        >
          {mnemonic}
        </text>
      </g>
    );
  }

  // Contacts: two vertical bars at x=28 and x=44
  if (t === 'contact-no' || t === 'contact-nc' || t === 'contact-rising' || t === 'contact-falling') {
    return (
      <g strokeWidth={sw} style={s} fill="none">
        <line x1={28} y1={WIRE_Y - 9} x2={28} y2={WIRE_Y + 9} />
        <line x1={44} y1={WIRE_Y - 9} x2={44} y2={WIRE_Y + 9} />
        <line x1={26} y1={WIRE_Y} x2={28} y2={WIRE_Y} />
        <line x1={44} y1={WIRE_Y} x2={46} y2={WIRE_Y} />
        {t === 'contact-nc' && <line x1={26} y1={WIRE_Y + 10} x2={46} y2={WIRE_Y - 10} />}
        {t === 'contact-rising' && <path d="M36 29 l4 6 l-8 0 z" stroke="none" style={{ fill: color }} />}
        {t === 'contact-falling' && <path d="M36 39 l4 -6 l-8 0 z" stroke="none" style={{ fill: color }} />}
      </g>
    );
  }

  // Coils: two arcs forming ( )
  if (t === 'coil-out' || t === 'coil-set' || t === 'coil-reset') {
    const letter = t === 'coil-set' ? 'S' : t === 'coil-reset' ? 'R' : '';
    return (
      <g strokeWidth={sw} style={s} fill="none">
        <path d="M30 24 A 12 12 0 0 0 30 44" />
        <path d="M42 24 A 12 12 0 0 1 42 44" />
        <line x1={26} y1={WIRE_Y} x2={30} y2={WIRE_Y} />
        <line x1={42} y1={WIRE_Y} x2={46} y2={WIRE_Y} />
        {letter && (
          <text x={36} y={WIRE_Y + 4} textAnchor="middle" fontSize={11} fontWeight={700} stroke="none" style={{ fill: color }}>
            {letter}
          </text>
        )}
      </g>
    );
  }

  // Timer / counter: function block box. Explicitly the last two types rather
  // than a catch-all — a wire used to land here and draw itself as a counter.
  if (t !== 'timer' && t !== 'counter') return null;
  const letter = t === 'timer' ? 'T' : 'C';
  return (
    <g strokeWidth={sw} style={s} fill="none">
      <rect x={26} y={WIRE_Y - 11} width={20} height={22} rx={3} />
      <line x1={20} y1={WIRE_Y} x2={26} y2={WIRE_Y} />
      <line x1={46} y1={WIRE_Y} x2={52} y2={WIRE_Y} />
      <text x={36} y={WIRE_Y + 4} textAnchor="middle" fontSize={12} fontWeight={700} stroke="none" style={{ fill: color }}>
        {letter}
      </text>
    </g>
  );
}
