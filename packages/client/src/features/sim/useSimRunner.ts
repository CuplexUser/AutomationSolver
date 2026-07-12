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
const HISTORY_LIMIT = 400; // ~24s of scans at DT=60ms, for the trace strip

export interface TraceHistorySample {
  tMs: number;
  bits: Record<string, boolean>;
}

export interface SimRunner {
  running: boolean;
  inputs: Record<string, boolean>;
  bits: Record<string, boolean>;
  machine: MachineState;
  evalResults: RungEvalResult[];
  /** Rolling scan history for the trace strip, oldest first. */
  history: TraceHistorySample[];
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
  const historyRef = useRef<TraceHistorySample[]>([]);
  const tMsRef = useRef(0);

  const [running, setRunning] = useState(false);
  const [inputs, setInputsState] = useState<Record<string, boolean>>(() => defaultInputs(spec.devices));
  const [bits, setBits] = useState<Record<string, boolean>>({});
  const [machine, setMachine] = useState<MachineState>({});
  const [evalResults, setEvalResults] = useState<RungEvalResult[]>([]);
  const [history, setHistory] = useState<TraceHistorySample[]>([]);

  const resetInternal = useCallback(
    (nextProgram: LadderProgram) => {
      engineRef.current = new SimEngine(nextProgram);
      processRef.current = getProcess(spec.processId);
      machineRef.current = processRef.current.init(spec.devices);
      derivedRef.current = {};
      inputsRef.current = defaultInputs(spec.devices);
      historyRef.current = [];
      tMsRef.current = 0;
      setInputsState(inputsRef.current);
      setBits({});
      setMachine(machineRef.current);
      setEvalResults([]);
      setHistory([]);
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
    const snapshotBits = engine.snapshot().bits;
    tMsRef.current += DT;
    historyRef.current = [...historyRef.current, { tMs: tMsRef.current, bits: snapshotBits }];
    if (historyRef.current.length > HISTORY_LIMIT) {
      historyRef.current = historyRef.current.slice(historyRef.current.length - HISTORY_LIMIT);
    }
    setEvalResults(engine.lastRungResults.slice());
    setBits(snapshotBits);
    setMachine({ ...machineRef.current });
    setHistory(historyRef.current);
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
    history,
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
