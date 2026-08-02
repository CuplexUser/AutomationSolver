import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultInputs,
  getProcess,
  GRADE_DT,
  SimEngine,
  type LadderProgram,
  type LadderPuzzleSpec,
  type MachineState,
  type RungEvalResult,
  type SimSnapshot,
} from '@automationsolver/shared';

/**
 * Scan interval / dt in ms. Deliberately *the grader's* dt: booleans survived a
 * mismatch here because every process model's timings are exact multiples of
 * both cadences, but an integrator does not — a tank level or a velocity ramp
 * accumulating at 50ms vs 60ms diverges immediately, and a threshold crossing
 * lands on a different scan. Running the same dt is what keeps live play and the
 * server's grade the same run.
 */
const DT = GRADE_DT;
const HISTORY_LIMIT = 480; // ~24s of scans at DT=50ms, for the trace strip

export interface TraceHistorySample {
  tMs: number;
  bits: Record<string, boolean>;
  /** D-register image at this scan, for the analog trend. */
  registers?: Record<string, number>;
}

/**
 * The narrow runner surface HmiPanel needs — both the ladder SimRunner and the
 * cabinet sim hook implement this, so the operator panel serves both kinds.
 */
export interface HmiRunner {
  running: boolean;
  inputs: Record<string, boolean>;
  bits: Record<string, boolean>;
  /** D-register image. Absent on the cabinet runner, which has no word devices. */
  registers?: Record<string, number>;
  /** Scan history, for the analog trend. Absent where nothing is recorded. */
  history?: TraceHistorySample[];
  start: () => void;
  stop: () => void;
  step: () => void;
  reset: () => void;
  setInput: (address: string, value: boolean) => void;
}

/** The scan interval the panel reports, so the header cannot drift from the engine. */
export const SCAN_INTERVAL_MS = DT;

export interface SimRunner extends HmiRunner {
  /** Live D-register image, for analog gauges and the trend. */
  registers: Record<string, number>;
  machine: MachineState;
  evalResults: RungEvalResult[];
  /** Rolling scan history for the trace strip, oldest first. */
  history: TraceHistorySample[];
  /** Live timer/counter state for the working-registers debug view; absent when not tracked (e.g. replay). */
  timers?: SimSnapshot['timers'];
  counters?: SimSnapshot['counters'];
}

export function useSimRunner(program: LadderProgram, spec: LadderPuzzleSpec): SimRunner {
  const engineRef = useRef<SimEngine>(new SimEngine(program));
  const processRef = useRef(getProcess(spec.processId));
  const machineRef = useRef<MachineState>({});
  const derivedRef = useRef<Record<string, boolean>>({});
  const derivedRegsRef = useRef<Record<string, number>>({});
  const inputsRef = useRef<Record<string, boolean>>(defaultInputs(spec.devices));
  const historyRef = useRef<TraceHistorySample[]>([]);
  const tMsRef = useRef(0);

  const [running, setRunning] = useState(false);
  const [inputs, setInputsState] = useState<Record<string, boolean>>(() => defaultInputs(spec.devices));
  const [bits, setBits] = useState<Record<string, boolean>>({});
  const [registers, setRegisters] = useState<Record<string, number>>({});
  const [timers, setTimers] = useState<SimSnapshot['timers']>({});
  const [counters, setCounters] = useState<SimSnapshot['counters']>({});
  const [machine, setMachine] = useState<MachineState>({});
  const [evalResults, setEvalResults] = useState<RungEvalResult[]>([]);
  const [history, setHistory] = useState<TraceHistorySample[]>([]);

  const resetInternal = useCallback(
    (nextProgram: LadderProgram) => {
      engineRef.current = new SimEngine(nextProgram);
      processRef.current = getProcess(spec.processId);
      machineRef.current = processRef.current.init(spec.devices);
      derivedRef.current = {};
      derivedRegsRef.current = {};
      inputsRef.current = defaultInputs(spec.devices);
      historyRef.current = [];
      tMsRef.current = 0;
      setInputsState(inputsRef.current);
      setBits({});
      setRegisters({});
      setTimers({});
      setCounters({});
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
    engine.setRegisters(derivedRegsRef.current);
    engine.scan(DT);
    const outputs: Record<string, boolean> = {};
    const regs: Record<string, number> = {};
    for (const d of spec.devices) {
      if (d.signal === 'analog') regs[d.address] = engine.getRegister(d.address);
      else if (d.io === 'output') outputs[d.address] = engine.getBit(d.address);
    }
    const res = processRef.current.step({
      outputs,
      inputs: inputsRef.current,
      registers: regs,
      machine: machineRef.current,
      devices: spec.devices,
      dtMs: DT,
    });
    machineRef.current = res.machine;
    derivedRef.current = res.derivedInputs ?? {};
    derivedRegsRef.current = res.derivedRegisters ?? {};
    const snap = engine.snapshot();
    tMsRef.current += DT;
    historyRef.current = [
      ...historyRef.current,
      { tMs: tMsRef.current, bits: snap.bits, registers: snap.registers },
    ];
    if (historyRef.current.length > HISTORY_LIMIT) {
      historyRef.current = historyRef.current.slice(historyRef.current.length - HISTORY_LIMIT);
    }
    setEvalResults(engine.lastRungResults.slice());
    setBits(snap.bits);
    setRegisters(snap.registers);
    setTimers(snap.timers);
    setCounters(snap.counters);
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
    registers,
    timers,
    counters,
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
