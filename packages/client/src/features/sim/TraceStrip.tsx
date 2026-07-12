import type { MouseEvent } from 'react';
import type { PuzzleDevice, PuzzleRegister } from '@automationsolver/shared';
import type { TraceHistorySample } from './useSimRunner';

const ROW_H = 20;

interface Row {
  address: string;
}

/** A compact logic-analyzer strip: one row per address, filled where the bit is high. */
export function TraceStrip({
  history,
  devices,
  registers,
  cursor,
  onScrub,
}: {
  history: TraceHistorySample[];
  devices: PuzzleDevice[];
  registers?: PuzzleRegister[];
  cursor?: number;
  onScrub?: (index: number) => void;
}) {
  const rows: Row[] = [
    ...devices.map((d) => ({ address: d.address })),
    ...(registers ?? []).map((r) => ({ address: r.address })),
  ];

  const w = 600;
  const h = Math.max(1, rows.length) * ROW_H;
  const n = history.length;

  const scrub = (e: MouseEvent<SVGSVGElement>) => {
    if (!onScrub || n < 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onScrub(Math.round(frac * (n - 1)));
  };

  return (
    <div className="trace-strip panel">
      <div className="trace-head">
        <span className="eyebrow">Trace</span>
        <span className="muted sm mono">
          {n === 0 ? 'no samples yet' : `${((history.at(-1)?.tMs ?? 0) / 1000).toFixed(1)}s`}
        </span>
      </div>
      {rows.length === 0 || n === 0 ? (
        <p className="muted sm">Run the sim to record a trace.</p>
      ) : (
        <div className="trace-body">
          <div className="trace-labels">
            {rows.map((r) => (
              <div key={r.address} className="trace-label mono" style={{ height: ROW_H }}>
                {r.address}
              </div>
            ))}
          </div>
          <div className="trace-scroll">
            <svg
              viewBox={`0 0 ${w} ${h}`}
              width="100%"
              height={h}
              preserveAspectRatio="none"
              className={`trace-svg${onScrub ? ' scrubbable' : ''}`}
              onClick={scrub}
            >
              {rows.map((r, i) => (
                <TraceRow key={r.address} address={r.address} history={history} y={i * ROW_H} width={w} />
              ))}
              {cursor != null && n > 1 && (
                <line
                  x1={(cursor / (n - 1)) * w}
                  x2={(cursor / (n - 1)) * w}
                  y1={0}
                  y2={h}
                  stroke="var(--live)"
                  strokeWidth={1.5}
                />
              )}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

function TraceRow({
  address,
  history,
  y,
  width,
}: {
  address: string;
  history: TraceHistorySample[];
  y: number;
  width: number;
}) {
  const n = history.length;
  const stepW = n > 1 ? width / (n - 1) : width;
  const pad = 3;
  const barH = ROW_H - pad * 2;

  const rects: { x: number; w: number }[] = [];
  let runStart: number | null = null;
  for (let i = 0; i < n; i++) {
    const on = history[i].bits[address] === true;
    if (on && runStart == null) runStart = i;
    if (!on && runStart != null) {
      rects.push({ x: runStart * stepW, w: (i - runStart) * stepW });
      runStart = null;
    }
  }
  if (runStart != null) rects.push({ x: runStart * stepW, w: Math.max((n - 1 - runStart) * stepW, 2) });

  return (
    <g>
      <line x1={0} y1={y + ROW_H / 2} x2={width} y2={y + ROW_H / 2} stroke="var(--edge)" strokeWidth={1} />
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={y + pad} width={Math.max(r.w, 1.5)} height={barH} rx={1} fill="var(--live)" opacity={0.75} />
      ))}
    </g>
  );
}
