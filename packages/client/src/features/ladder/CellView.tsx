import type { LadderElement } from '@automationsolver/shared';

export const CELL_W = 104;
export const CELL_H = 72;
export const WIRE_Y = 40;

const IDLE_WIRE = '#3a4d61';
const LIVE = '#ffb020';
const IDLE_SYM = '#8ba0b5';

interface Props {
  element: LadderElement | null;
  selected: boolean;
  leftLive: boolean;
  rightLive: boolean;
  symbolLive: boolean;
  onClick: () => void;
}

function glow(live: boolean): React.CSSProperties {
  return live ? { filter: 'drop-shadow(0 0 4px rgba(255,176,32,0.8))' } : {};
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
            {/* connecting wires */}
            <line x1={0} y1={WIRE_Y} x2={38} y2={WIRE_Y} stroke={leftColor} strokeWidth={2.5} style={glow(leftLive)} />
            <line x1={66} y1={WIRE_Y} x2={CELL_W} y2={WIRE_Y} stroke={rightColor} strokeWidth={2.5} style={glow(rightLive)} />
            <Symbol element={element} color={symColor} live={symbolLive} />
            <text x={CELL_W / 2} y={16} textAnchor="middle" className="cell-addr" fill={symColor}>
              {element.device}
            </text>
            {(element.type === 'timer' || element.type === 'counter') && element.preset != null && (
              <text x={CELL_W / 2} y={CELL_H - 6} textAnchor="middle" className="cell-preset">
                K{element.preset}
              </text>
            )}
          </>
        ) : (
          <g className="cell-empty">
            <line x1={CELL_W / 2 - 5} y1={WIRE_Y} x2={CELL_W / 2 + 5} y2={WIRE_Y} stroke="#2b3a4b" strokeWidth={1.5} />
            <line x1={CELL_W / 2} y1={WIRE_Y - 5} x2={CELL_W / 2} y2={WIRE_Y + 5} stroke="#2b3a4b" strokeWidth={1.5} />
          </g>
        )}
      </svg>
    </button>
  );
}

function Symbol({ element, color, live }: { element: LadderElement; color: string; live: boolean }) {
  const sw = 2.5;
  const s = glow(live);
  const t = element.type;

  // Contacts: two vertical bars at x=42 and x=62
  if (t === 'contact-no' || t === 'contact-nc' || t === 'contact-rising' || t === 'contact-falling') {
    return (
      <g stroke={color} strokeWidth={sw} style={s} fill="none">
        <line x1={42} y1={WIRE_Y - 12} x2={42} y2={WIRE_Y + 12} />
        <line x1={62} y1={WIRE_Y - 12} x2={62} y2={WIRE_Y + 12} />
        <line x1={38} y1={WIRE_Y} x2={42} y2={WIRE_Y} />
        <line x1={62} y1={WIRE_Y} x2={66} y2={WIRE_Y} />
        {t === 'contact-nc' && <line x1={40} y1={WIRE_Y + 13} x2={64} y2={WIRE_Y - 13} />}
        {t === 'contact-rising' && (
          <path d="M52 34 l5 8 l-10 0 z" fill={color} stroke="none" />
        )}
        {t === 'contact-falling' && (
          <path d="M52 46 l5 -8 l-10 0 z" fill={color} stroke="none" />
        )}
      </g>
    );
  }

  // Coils: two arcs forming ( )
  if (t === 'coil-out' || t === 'coil-set' || t === 'coil-reset') {
    const letter = t === 'coil-set' ? 'S' : t === 'coil-reset' ? 'R' : '';
    return (
      <g stroke={color} strokeWidth={sw} style={s} fill="none">
        <path d="M44 28 A 16 16 0 0 0 44 52" />
        <path d="M60 28 A 16 16 0 0 1 60 52" />
        <line x1={38} y1={WIRE_Y} x2={44} y2={WIRE_Y} />
        <line x1={60} y1={WIRE_Y} x2={66} y2={WIRE_Y} />
        {letter && (
          <text x={52} y={WIRE_Y + 5} textAnchor="middle" fontSize={14} fontWeight={700} fill={color} stroke="none">
            {letter}
          </text>
        )}
      </g>
    );
  }

  // Timer / Counter: function block box
  const letter = t === 'timer' ? 'T' : 'C';
  return (
    <g stroke={color} strokeWidth={sw} style={s} fill="none">
      <rect x={38} y={WIRE_Y - 15} width={28} height={30} rx={3} />
      <line x1={30} y1={WIRE_Y} x2={38} y2={WIRE_Y} />
      <line x1={66} y1={WIRE_Y} x2={74} y2={WIRE_Y} />
      <text x={52} y={WIRE_Y + 5} textAnchor="middle" fontSize={15} fontWeight={700} fill={color} stroke="none">
        {letter}
      </text>
    </g>
  );
}
