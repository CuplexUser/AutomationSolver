import { useCallback, useEffect, useState } from 'react';
import type { MachineState } from '@automationsolver/shared';
import { decodeShift, type IntroScript, type RecordedShift } from './cinema';
import { FADE_OUT_S } from './IntroDirector';
import type { IntroPhase } from './IntroOverlay';

/**
 * A fly-in's life outside the canvas: whether it plays on its own, fetching the
 * recording, and the phases from black through the flight to the handover.
 *
 * The view renders `IntroOverlay` from `phase`/`caption` and, while `intro` is
 * set, an `IntroDirector` in its scene with the scene drawing `intro.frames`
 * instead of the live machine.
 */

export interface Shift {
  frames: MachineState[];
  dt: number;
}

/** What a scene needs while the fly-in owns it. */
export interface IntroRun extends Shift {
  /** Bumped on every replay, to remount the director. */
  run: number;
  onStart: () => void;
  onCaption: (shot: number) => void;
  onFadeOut: () => void;
}

const loads = new Map<string, Promise<Shift>>();
function loadShift(url: string): Promise<Shift> {
  let load = loads.get(url);
  if (!load) {
    load = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`intro recording: ${r.status}`);
        return r.json() as Promise<RecordedShift>;
      })
      .then((rec) => ({ frames: decodeShift(rec), dt: rec.dt }));
    // A failed load may be retried by the replay button.
    load.catch(() => loads.delete(url));
    loads.set(url, load);
  }
  return load;
}

// Per viewer and per browser, which is all "the first time" needs to mean here.
function seenIntro(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
/** A player who asked their system for less motion gets the fly-in only by pressing replay. */
function autoplayIntro(key: string): boolean {
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return !calm && !seenIntro(key);
}
function markIntroSeen(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Storage blocked: the intro plays again next time, which is harmless.
  }
}

export function useIntro(script: IntroScript): {
  phase: IntroPhase;
  caption: number;
  intro: IntroRun | undefined;
  onSkip: () => void;
  onReplay: () => void;
} {
  const { url, seenKey } = script;
  const [phase, setPhase] = useState<IntroPhase>(() => (autoplayIntro(seenKey) ? 'loading' : 'off'));
  const [caption, setCaption] = useState(-1);
  const [shift, setShift] = useState<Shift | null>(null);
  const [run, setRun] = useState(0);

  // Fetch the recording when an intro is asked for; give up quietly if it cannot be had.
  useEffect(() => {
    if (phase !== 'loading' || shift) return;
    let live = true;
    loadShift(url).then(
      (s) => live && setShift(s),
      () => live && setPhase('off'),
    );
    return () => {
      live = false;
    };
  }, [phase, shift, url]);

  // The fade to black, then the puzzle's own floor fading up, then nothing.
  useEffect(() => {
    if (phase !== 'out' && phase !== 'reveal') return;
    const next = phase === 'out' ? 'reveal' : 'off';
    const id = setTimeout(() => setPhase(next), (phase === 'out' ? FADE_OUT_S : 0.9) * 1000);
    return () => clearTimeout(id);
  }, [phase]);

  const onStart = useCallback(() => {
    markIntroSeen(seenKey);
    setPhase('playing');
  }, [seenKey]);
  const onFadeOut = useCallback(() => setPhase((p) => (p === 'playing' ? 'out' : p)), []);
  const onSkip = useCallback(() => setPhase((p) => (p === 'playing' || p === 'loading' ? 'out' : p)), []);
  const onReplay = useCallback(() => {
    setCaption(-1);
    setRun((r) => r + 1);
    setPhase('loading');
  }, []);

  // The showcase run is on screen from the first frame to the bottom of the fade.
  const intro: IntroRun | undefined =
    shift && (phase === 'loading' || phase === 'playing' || phase === 'out')
      ? { frames: shift.frames, dt: shift.dt, run, onStart, onCaption: setCaption, onFadeOut }
      : undefined;

  return { phase, caption, intro, onSkip, onReplay };
}
