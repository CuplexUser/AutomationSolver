import type { ReplayController } from './useReplay';

export function ReplayBar({ replay }: { replay: ReplayController }) {
  const { trace, index, playing, currentStep, failureMarks, play, pause, seek, stepToFailure, close } =
    replay;
  if (!trace) return null;

  const total = trace.samples.length;
  const tMs = trace.samples[index]?.tMs ?? 0;
  const totalMs = trace.samples.at(-1)?.tMs ?? 0;
  const hasFailure = trace.steps.some((s) => !s.passed);
  // Only once the playhead has reached the scan the grader judged — showing the
  // verdict while the step is still running is what made the replay read as
  // "everything looks fine, so what is it complaining about?".
  const judged = currentStep && !currentStep.passed && index >= currentStep.checkSample;

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
        <div className="replay-track">
          <input
            type="range"
            min={0}
            max={Math.max(0, total - 1)}
            value={index}
            onChange={(e) => seek(Number(e.target.value))}
            className="replay-scrub"
            aria-label="Scrub replay"
          />
          {failureMarks.map((at, i) => (
            <span key={i} className="replay-mark" style={{ left: `${at * 100}%` }} />
          ))}
        </div>
        <span className="replay-time mono">
          {(tMs / 1000).toFixed(1)}s / {(totalMs / 1000).toFixed(1)}s
        </span>
      </div>
      {currentStep && (
        <div className={`replay-step${judged ? ' failed' : ''}`}>
          <p className="muted sm">{currentStep.label}</p>
          {judged && (
            <ul className="replay-fails">
              {currentStep.failures.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
