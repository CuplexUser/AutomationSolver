import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  traceScenario,
  type LadderProgram,
  type PuzzleSpec,
  type ScenarioTrace,
} from '@automationsolver/shared';
import type { SimRunner } from './useSimRunner';

const PLAY_INTERVAL_MS = 80;

const noop = () => {
  // replay is driven by the controller below, not by SimRunner controls
};

export interface ReplayController {
  trace: ScenarioTrace | null;
  index: number;
  playing: boolean;
  currentStepLabel: string | undefined;
  runner: SimRunner | null;
  start: (spec: PuzzleSpec, program: LadderProgram, scenarioName: string) => void;
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

  const start = useCallback(
    (spec: PuzzleSpec, program: LadderProgram, scenarioName: string) => {
      const t = traceScenario(spec, program, scenarioName);
      setTrace(t ?? null);
      setIndex(0);
      setPlaying(false);
    },
    [],
  );

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

  const stepToFailure = useCallback(() => {
    if (!trace) return;
    const failing = trace.steps.find((s) => !s.passed);
    if (failing) setIndex(failing.startSample);
  }, [trace]);

  const close = useCallback(() => {
    setTrace(null);
    setIndex(0);
    setPlaying(false);
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
    return () => clearInterval(id);
  }, [playing, trace]);

  const history = useMemo(
    () => trace?.samples.map((s) => ({ tMs: s.tMs, bits: s.bits })) ?? [],
    [trace],
  );

  const runner = useMemo<SimRunner | null>(() => {
    if (!trace || trace.samples.length === 0) return null;
    const sample = trace.samples[Math.min(index, trace.samples.length - 1)];
    return {
      running: true, // keeps LadderEditor read-only and HmiPanel showing "SCANNING"
      inputs: sample.bits,
      bits: sample.bits,
      machine: sample.machine,
      evalResults: sample.rungResults,
      history,
      start: noop,
      stop: noop,
      step: noop,
      reset: noop,
      setInput: noop,
    };
  }, [trace, index, history]);

  const currentStepLabel = useMemo(() => {
    if (!trace) return undefined;
    let label: string | undefined;
    for (const step of trace.steps) {
      if (step.startSample > index) break;
      label = step.label;
    }
    return label;
  }, [trace, index]);

  return { trace, index, playing, currentStepLabel, runner, start, seek, play, pause, stepToFailure, close };
}
