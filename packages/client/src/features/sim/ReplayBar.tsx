import type { ReplayController } from './useReplay';

export function ReplayBar({ replay }: { replay: ReplayController }) {
  const { trace, index, playing, currentStepLabel, play, pause, seek, stepToFailure, close } = replay;
  if (!trace) return null;

  const total = trace.samples.length;
  const tMs = trace.samples[index]?.tMs ?? 0;
  const totalMs = trace.samples.at(-1)?.tMs ?? 0;
  const hasFailure = trace.steps.some((s) => !s.passed);

  return (
    <div className="replay-bar panel">
      <div className="replay-head">
        <span className="eyebrow">Replay · {trace.scenarioName}</span>
        <button className="icon-btn" onClick={close} title="Close replay, return to live sim">
          ✕
        </button>
      </div>
      <div className="replay-controls">
        <button className="btn btn-ghost" onClick={playing ? pause : play}>
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
        <button className="btn btn-ghost" onClick={stepToFailure} disabled={!hasFailure}>
          ⚠ Jump to failure
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={index}
          onChange={(e) => seek(Number(e.target.value))}
          className="replay-scrub"
          aria-label="Scrub replay"
        />
        <span className="replay-time mono">
          {(tMs / 1000).toFixed(1)}s / {(totalMs / 1000).toFixed(1)}s
        </span>
      </div>
      {currentStepLabel && <p className="replay-step muted sm">{currentStepLabel}</p>}
    </div>
  );
}
