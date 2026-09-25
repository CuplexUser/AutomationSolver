import { useEffect } from 'react';
import type { IntroScript } from './cinema';

/**
 * Where the fly-in is.
 *
 * - `loading`: the kit or the recording is still on its way; black, bars in.
 * - `playing`: the picture fades up and the camera flies.
 * - `out`: fading to black, to swap the showcase run for the puzzle's own.
 * - `reveal`: the puzzle's floor fades up and the bars slide away.
 * - `off`: nothing but the replay button.
 */
export type IntroPhase = 'loading' | 'playing' | 'out' | 'reveal' | 'off';

const pad = (n: number) => String(n).padStart(2, '0');

/** The cinema over the canvas: letterbox, title card, a caption per shot, and the fades. */
export function IntroOverlay({
  script,
  phase,
  caption,
  onSkip,
  onReplay,
}: {
  script: IntroScript;
  phase: IntroPhase;
  /** Index into the script's shots of the caption showing, or -1. */
  caption: number;
  onSkip: () => void;
  onReplay: () => void;
}) {
  const running = phase === 'loading' || phase === 'playing';

  // Escape skips, like any cutscene.
  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, onSkip]);

  if (phase === 'off') {
    return (
      <button type="button" className="icon-btn cine-replay" onClick={onReplay} title="Replay the intro">
        {/* A film frame with a play mark: drawn, so it takes the theme's color. */}
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <rect x="1.5" y="3" width="13" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M6.5 5.8v4.4L10.3 8z" fill="currentColor" />
        </svg>
        <span>Intro</span>
      </button>
    );
  }

  const { shots, duration, title } = script;
  const captioned = shots.flatMap((s, i) => (s.caption ? [i] : []));
  const shot = caption >= 0 ? shots[caption] : undefined;
  return (
    <div
      className={`cine cine--${phase}`}
      // Any press skips, and it keeps the drag from reaching the orbit controls.
      onPointerDown={running ? onSkip : undefined}
      role="presentation"
    >
      <div className="cine-bar cine-bar--top" />
      <div className="cine-bar cine-bar--bottom">
        {phase === 'playing' && <div className="cine-progress" style={{ animationDuration: `${duration}s` }} />}
      </div>
      <div className="cine-veil" />

      {phase === 'playing' && (
        <div className="cine-title">
          <span className="cine-eyebrow">{title.eyebrow}</span>
          <h2>{title.name}</h2>
          <p>{title.blurb}</p>
        </div>
      )}

      {phase === 'playing' && shot?.caption && (
        // Keyed by shot, so each caption plays its entrance afresh.
        <div key={caption} className="cine-caption">
          <span className="cine-index">
            {pad(captioned.indexOf(caption) + 1)} / {pad(captioned.length)}
          </span>
          <strong>{shot.caption.title}</strong>
          <span className="cine-line">{shot.caption.line}</span>
        </div>
      )}

      {running && (
        <button
          type="button"
          className="cine-skip"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onSkip}
        >
          Skip intro
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
            <path d="M2 2.5 6.5 6 2 9.5zM6.5 2.5 11 6 6.5 9.5z" fill="currentColor" />
          </svg>
        </button>
      )}
    </div>
  );
}
