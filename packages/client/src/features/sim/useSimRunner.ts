import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultInputs,
  getProcess,
  SimEngine,
  type LadderProgram,
  type MachineState,
  type PuzzleSpec,
  type RungEvalResult,
} from '@automationsolver/shared';

const DT = 60; // scan interval / dt in ms

export interface SimRunner {
  running: boolean;
  inputs: Record<string, boolean>;
  bits: Record<string, boolean>;
  machine: MachineState;
  evalResults: RungEvalResult[];
  start: () => void;
  stop: () => void;
  step: () => void;
  reset: () => void;
  setInput: (address: string, value: boolean) => void;
}

export function useSimRunner(program: LadderProgram, spec: PuzzleSpec): SimRunner {
  const engineRef = useRef<SimEngine>(new SimEngine(program));
  const processRef = useRef(getProcess(spec.processId));
  const machineRef = useRef<MachineState>({});
  const derivedRef = useRef<Record<string, boolean>>({});
  const inputsRef = useRef<Record<string, boolean>>(defaultInputs(spec.devices));

  const [running, setRunning] = useState(false);
  const [inputs, setInputsState] = useState<Record<string, boolean>>(() => defaultInputs(spec.devices));
  const [bits, setBits] = useState<Record<string, boolean>>({});
  const [machine, setMachine] = useState<MachineState>({});
  const [evalResults, setEvalResults] = useState<RungEvalResult[]>([]);

  const resetInternal = useCallback(
    (nextProgram: LadderProgram) => {
      engineRef.current = new SimEngine(nextProgram);
      processRef.current = getProcess(spec.processId);
      machineRef.current = processRef.current.init(spec.devices);
      derivedRef.current = {};
      inputsRef.current = defaultInputs(spec.devices);
      setInputsState(inputsRef.current);
      setBits({});
      setMachine(machineRef.current);
      setEvalResults([]);
    },
    [spec.processId, spec.devices],
  );

  // Rebuild whenever the program or puzzle changes (editing happens while stopped).
  // The engine is an external system; this effect resyncs React's mirror of it, which
  // is what the setState calls are for.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRunning(false);
    resetInternal(program);
  }, [program, resetInternal]);

  const stepOnce = useCallback(() => {
    const engine = engineRef.current;
    engine.setInputs(inputsRef.current);
    engine.setInputs(derivedRef.current);
    engine.scan(DT);
    const outputs: Record<string, boolean> = {};
    for (const d of spec.devices) if (d.io === 'output') outputs[d.address] = engine.getBit(d.address);
    const res = processRef.current.step({
      outputs,
      inputs: inputsRef.current,
      machine: machineRef.current,
      devices: spec.devices,
      dtMs: DT,
    });
    machineRef.current = res.machine;
    derivedRef.current = res.derivedInputs ?? {};
    setEvalResults(engine.lastRungResults.slice());
    setBits(engine.snapshot().bits);
    setMachine({ ...machineRef.current });
  }, [spec.devices]);

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
    bits,
    machine,
    evalResults,
    start: () => setRunning(true),
    stop: () => setRunning(false),
    step: () => stepOnce(),
    reset: () => {
      setRunning(false);
      resetInternal(program);
    },
    setInput,
  };
}
