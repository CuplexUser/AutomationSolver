import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  traceScenario,
  type LadderPuzzleSpec,
  type ProgramDoc,
  type ScenarioTrace,
} from '@automationsolver/shared';
import { trimDevMeasures } from './devMeasures';
import type { SimRunner } from './useSimRunner';

/**
 * Samples are one `GRADE_DT` apart, so advancing one sample per 50 ms tick is
 * the plant at the speed it really runs at. Faster speeds advance several
 * samples per tick instead of ticking faster, since timers cannot go much
 * below a frame and every tick re-renders the machine view.
 */
const TICK_MS = 50;

/** The speeds the replay bar offers, as multiples of real time. */
export const REPLAY_SPEEDS = [0.5, 1, 2, 4, 8, 16] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/**
 * A player's own replay starts at real time, for picking a failure apart. A
 * demonstration starts at 4x: a forklift crossing the hall takes most of a
 * minute, and the point of watching is the order of operations, not the drive.
 * A looping demo is ambient and has no transport to change it, so real time.
 */
const REPLAY_SPEED: ReplaySpeed = 1;
const DEMO_SPEED: ReplaySpeed = 4;

const noop = () => {
  // replay is driven by the controller below, not by SimRunner controls
};

export interface ReplayController {
  trace: ScenarioTrace | null;
  index: number;
  playing: boolean;
  /**
   * This trace is a shipped demonstration rather than the player's own run.
   *
   * The bar reads differently for one (nothing failed, so there is nothing to
   * jump to) and, more importantly, the ladder editor must not light up: the
   * rungs on screen are the player's, and the ones driving the machine are not.
   */
  demo: boolean;
  /** This demo restarts at the end rather than stopping (`PuzzleDemo.loop`). */
  looping: boolean;
  /** Playback speed as a multiple of real time. */
  speed: ReplaySpeed;
  setSpeed: (speed: ReplaySpeed) => void;
  /** The step the playhead is inside, so the bar can show why it failed. */
  currentStep: ScenarioTrace['steps'][number] | undefined;
  /** Where each failing step was judged, as a 0..1 position along the scrub. */
  failureMarks: number[];
  runner: SimRunner | null;
  start: (spec: LadderPuzzleSpec, program: ProgramDoc, scenarioName: string) => void;
  /** Play the puzzle's shipped demonstration, if it has one. */
  startDemo: (spec: LadderPuzzleSpec) => void;
  seek: (index: number) => void;
  play: () => void;
  pause: () => void;
  stepToFailure: () => void;
  close: () => void;
}

export function useReplay(): ReplayController {
  const [trace, setTrace] = useState<ScenarioTrace | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [demo, setDemo] = useState(false);
  const [looping, setLooping] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(REPLAY_SPEED);
  // The fraction of a sample a slow speed has not advanced yet.
  const carry = useRef(0);

  const start = useCallback(
    (spec: LadderPuzzleSpec, program: ProgramDoc, scenarioName: string) => {
      const t = traceScenario(spec, program, scenarioName);
      setTrace(t ?? null);
      setIndex(0);
      setPlaying(false);
      setDemo(false);
      setLooping(false);
      setSpeed(REPLAY_SPEED);
    },
    [],
  );

  // A demo opens already running: the player asked to watch the machine, not to
  // be handed a scrub bar and left to find the play button.
  const startDemo = useCallback((spec: LadderPuzzleSpec) => {
    if (!spec.demo) return;
    const t = traceScenario(spec, spec.demo.program, spec.demo.scenario);
    setTrace(t ?? null);
    setIndex(0);
    setDemo(true);
    setLooping(spec.demo.loop === true);
    setSpeed(spec.demo.loop === true ? 1 : DEMO_SPEED);
    setPlaying(t !== undefined);
  }, []);

  const seek = useCallback(
    (i: number) => {
      if (!trace) return;
      setIndex(Math.min(Math.max(i, 0), trace.samples.length - 1));
    },
    [trace],
  );

  const play = useCallback(() => {
    if (!trace || trace.samples.length === 0) return;
    setPlaying(true);
  }, [trace]);

  const pause = useCallback(() => setPlaying(false), []);

  // Land on the scan the grader actually judged, not the start of the step.
  // Steps run for seconds; opening at their first scan is why a replay could
  // show the machine working perfectly with no sign of the failure.
  const stepToFailure = useCallback(() => {
    if (!trace) return;
    const failing = trace.steps.find((s) => !s.passed);
    if (failing) setIndex(failing.checkSample);
  }, [trace]);

  const close = useCallback(() => {
    setTrace(null);
    setIndex(0);
    setPlaying(false);
    setDemo(false);
    setLooping(false);
  }, []);

  // Auto-advance while playing. A looping demo starts over at the end; anything
  // else stops there.
  useEffect(() => {
    if (!playing || !trace) return;
    const total = trace.samples.length;
    carry.current = 0;
    const id = setInterval(() => {
      carry.current += speed;
      const step = Math.floor(carry.current);
      if (step === 0) return;
      carry.current -= step;
      setIndex((i) => {
        if (i >= total - 1) {
          if (looping) return 0;
          setPlaying(false);
          return i;
        }
        return Math.min(i + step, total - 1);
      });
    }, TICK_MS);
    const stopTrim = trimDevMeasures();
    return () => {
      clearInterval(id);
      stopTrim();
    };
  }, [playing, trace, looping, speed]);

  const history = useMemo(
    () => trace?.samples.map((s) => ({ tMs: s.tMs, bits: s.bits, registers: s.registers })) ?? [],
    [trace],
  );

  const runner = useMemo<SimRunner | null>(() => {
    if (!trace || trace.samples.length === 0) return null;
    const sample = trace.samples[Math.min(index, trace.samples.length - 1)];
    return {
      running: true, // keeps LadderEditor read-only and HmiPanel showing "SCANNING"
      inputs: sample.bits,
      bits: sample.bits,
      registers: sample.registers,
      machine: sample.machine,
      // A demo's rung results belong to the program that shipped with the
      // puzzle, not to the one on screen. Highlighting the player's grid from
      // them would show power flowing through cells that are not even there.
      evalResults: demo ? {} : sample.rungResults,
      history,
      start: noop,
      stop: noop,
      step: noop,
      reset: noop,
      setInput: noop,
    };
  }, [trace, index, history, demo]);

  const currentStep = useMemo(() => {
    if (!trace) return undefined;
    let found: ScenarioTrace['steps'][number] | undefined;
    for (const step of trace.steps) {
      if (step.startSample > index) break;
      found = step;
    }
    return found;
  }, [trace, index]);

  const failureMarks = useMemo(() => {
    const total = trace?.samples.length ?? 0;
    if (!trace || total < 2) return [];
    return trace.steps.filter((s) => !s.passed).map((s) => s.checkSample / (total - 1));
  }, [trace]);

  return {
    trace,
    index,
    playing,
    demo,
    looping,
    speed,
    setSpeed,
    currentStep,
    failureMarks,
    runner,
    start,
    startDemo,
    seek,
    play,
    pause,
    stepToFailure,
    close,
  };
}
