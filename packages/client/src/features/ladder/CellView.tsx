import type { LadderElement } from '@automationsolver/shared';

// Compact cell geometry — dense enough to fit a real program on one screen while
// keeping the address label at a legible size. The symbol occupies the middle
// third; the wire enters and leaves at WIRE_Y.
export const CELL_W = 72;
export const CELL_H = 52;
export const WIRE_Y = 34;

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

export function CellView({ element, selected, leftLive, rightLive, symbolLive, onClick }: Props) {
  const symColor = symbolLive ? LIVE : IDLE_SYM;
  const leftColor = leftLive ? LIVE : IDLE_WIRE;
  const rightColor = rightLive ? LIVE : IDLE_WIRE;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`ladder-cell${selected ? ' is-selected' : ''}`}
      aria-label={element ? `${element.type} ${element.device}` : 'empty cell'}
    >
      <svg width={CELL_W} height={CELL_H} viewBox={`0 0 ${CELL_W} ${CELL_H}`}>
        {element ? (
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
              {element.device}
            </text>
            {(element.type === 'timer' || element.type === 'counter') && element.preset != null && (
              <text x={CELL_W / 2} y={CELL_H - 3} textAnchor="middle" className="cell-preset">
                K{element.preset}
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

function Symbol({ element, color, live }: { element: LadderElement; color: string; live: boolean }) {
  const sw = 2;
  const s = { stroke: color, ...glow(live) };
  const t = element.type;

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

  // Timer / counter: function block box
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
