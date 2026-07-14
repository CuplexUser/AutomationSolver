import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CabinetSim,
  defaultInputs,
  type CabinetPuzzleSpec,
  type CabinetSimResult,
  type WiringDoc,
} from '@automationsolver/shared';
import type { HmiRunner } from '../sim/useSimRunner';

const DT = 60; // solve interval / dt in ms, matching the ladder runner cadence

export interface CabinetRunner extends HmiRunner {
  /** Last solve, for live wire/terminal coloring; null until the sim has stepped. */
  result: CabinetSimResult | null;
  machine: Record<string, string | number | boolean>;
}

/** Cabinet counterpart of useSimRunner: drives CabinetSim on an interval. */
export function useCabinetSim(wiring: WiringDoc, spec: CabinetPuzzleSpec): CabinetRunner {
  const simRef = useRef<CabinetSim>(new CabinetSim(spec.cabinet, wiring));
  const inputsRef = useRef<Record<string, boolean>>(defaultInputs(spec.devices));

  const [running, setRunning] = useState(false);
  const [inputs, setInputsState] = useState<Record<string, boolean>>(() => defaultInputs(spec.devices));
  const [result, setResult] = useState<CabinetSimResult | null>(null);
  const [machine, setMachine] = useState<Record<string, string | number | boolean>>({});

  const resetInternal = useCallback(
    (nextWiring: WiringDoc) => {
      simRef.current = new CabinetSim(spec.cabinet, nextWiring);
      inputsRef.current = defaultInputs(spec.devices);
      setInputsState(inputsRef.current);
      setResult(null);
      setMachine({});
    },
    [spec.cabinet, spec.devices],
  );

  // Rebuild whenever the wiring or puzzle changes (wiring happens while stopped).
  // The sim is an external system; this effect resyncs React's mirror of it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRunning(false);
    resetInternal(wiring);
  }, [wiring, resetInternal]);

  const stepOnce = useCallback(() => {
    const sim = simRef.current;
    sim.setInputs(inputsRef.current);
    const res = sim.step(DT);
    setResult(res);
    setMachine(sim.machine);
  }, []);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(stepOnce, DT);
    return () => clearInterval(id);
  }, [running, stepOnce]);

  const setInput = useCallback((address: string, value: boolean) => {
    inputsRef.current = { ...inputsRef.current, [address]: value };
    setInputsState(inputsRef.current);
  }, []);

  return {
    running,
    inputs,
    bits: result?.bits ?? {},
    result,
    machine,
    start: () => setRunning(true),
    stop: () => setRunning(false),
    step: () => stepOnce(),
    reset: () => {
      setRunning(false);
      resetInternal(wiring);
    },
    setInput,
  };
}
