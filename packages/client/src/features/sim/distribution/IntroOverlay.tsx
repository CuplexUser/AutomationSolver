import { useEffect } from 'react';
import { INTRO_S, SHOTS } from './intro';

/**
 * Where the fly-in is.
 *
 * - `loading`: the kit or the recording is still on its way; black, bars in.
 * - `playing`: the picture fades up and the camera flies.
 * - `out`: fading to black, to swap the showcase hub for the puzzle's own.
 * - `reveal`: the puzzle's floor fades up and the bars slide away.
 * - `off`: nothing but the replay button.
 */
export type IntroPhase = 'loading' | 'playing' | 'out' | 'reveal' | 'off';

const CAPTIONED = SHOTS.flatMap((s, i) => (s.caption ? [i] : []));
const pad = (n: number) => String(n).padStart(2, '0');

/** The cinema over the canvas: letterbox, title card, a caption per shot, and the fades. */
export function IntroOverlay({
  phase,
  caption,
  onSkip,
  onReplay,
}: {
  phase: IntroPhase;
  /** Index into `SHOTS` of the caption showing, or -1. */
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
      <button type="button" className="icon-btn dc-intro-replay" onClick={onReplay} title="Replay the intro">
        {/* A film frame with a play mark: drawn, so it takes the theme's color. */}
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <rect x="1.5" y="3" width="13" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M6.5 5.8v4.4L10.3 8z" fill="currentColor" />
        </svg>
        <span>Intro</span>
      </button>
    );
  }

  const shot = caption >= 0 ? SHOTS[caption] : undefined;
  return (
    <div
      className={`dc-intro dc-intro--${phase}`}
      // Any press skips, and it keeps the drag from reaching the orbit controls.
      onPointerDown={running ? onSkip : undefined}
      role="presentation"
    >
      <div className="dc-intro-bar dc-intro-bar--top" />
      <div className="dc-intro-bar dc-intro-bar--bottom">
        {phase === 'playing' && <div className="dc-intro-progress" style={{ animationDuration: `${INTRO_S}s` }} />}
      </div>
      <div className="dc-intro-veil" />

      {phase === 'playing' && (
        <div className="dc-intro-title">
          <span className="dc-intro-eyebrow">Where this category ends</span>
          <h2>Cold Chain Hub</h2>
          <p>The whole hub on a solved program: every station built, every vehicle busy.</p>
        </div>
      )}

      {phase === 'playing' && shot?.caption && (
        // Keyed by shot, so each caption plays its entrance afresh.
        <div key={caption} className="dc-intro-caption">
          <span className="dc-intro-index">
            {pad(CAPTIONED.indexOf(caption) + 1)} / {pad(CAPTIONED.length)}
          </span>
          <strong>{shot.caption.title}</strong>
          <span className="dc-intro-line">{shot.caption.line}</span>
        </div>
      )}

      {running && (
        <button
          type="button"
          className="dc-intro-skip"
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
