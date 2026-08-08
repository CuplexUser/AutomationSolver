import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  traceScenario,
  type LadderPuzzleSpec,
  type ProgramDoc,
  type ScenarioTrace,
} from '@automationsolver/shared';
import { trimDevMeasures } from './devMeasures';
import type { SimRunner } from './useSimRunner';

const PLAY_INTERVAL_MS = 80;

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

  const start = useCallback(
    (spec: LadderPuzzleSpec, program: ProgramDoc, scenarioName: string) => {
      const t = traceScenario(spec, program, scenarioName);
      setTrace(t ?? null);
      setIndex(0);
      setPlaying(false);
      setDemo(false);
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
  }, []);

  // Auto-advance while playing; stop at the end of the trace.
  useEffect(() => {
    if (!playing || !trace) return;
    const total = trace.samples.length;
    const id = setInterval(() => {
      setIndex((i) => {
        if (i >= total - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, PLAY_INTERVAL_MS);
    const stopTrim = trimDevMeasures();
    return () => {
      clearInterval(id);
      stopTrim();
    };
  }, [playing, trace]);

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
