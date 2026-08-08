import { useCallback, useEffect, useRef, useState } from 'react';
import {
  assembleProject,
  defaultInputs,
  getProcess,
  GRADE_DT,
  primeProcess,
  SimEngine,
  type LadderPuzzleSpec,
  type MachineState,
  type ProgramDoc,
  type RungEvalResult,
  type SimSnapshot,
} from '@automationsolver/shared';
import { trimDevMeasures } from './devMeasures';

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
  /**
   * Rung evaluation per POU, keyed by POU id. An ordinary puzzle's program is
   * wrapped as the single POU `DEFAULT_POU_ID`, so its editor reads one entry.
   */
  evalResults: Record<string, RungEvalResult[]>;
  /** Rolling scan history for the trace strip, oldest first. */
  history: TraceHistorySample[];
  /** Live timer/counter state for the working-registers debug view; absent when not tracked (e.g. replay). */
  timers?: SimSnapshot['timers'];
  counters?: SimSnapshot['counters'];
}

/**
 * `program` is whatever the editor holds — a flat rung list, or a project of
 * the sections the player owns. Either way it goes through `assembleProject`,
 * the same merge the grader does, so a section the puzzle ships pre-written
 * runs here exactly as it will run on the server.
 */
export function useSimRunner(program: ProgramDoc, spec: LadderPuzzleSpec): SimRunner {
  const engineRef = useRef<SimEngine>(new SimEngine(assembleProject(spec, program)));
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
  const [evalResults, setEvalResults] = useState<Record<string, RungEvalResult[]>>({});
  const [history, setHistory] = useState<TraceHistorySample[]>([]);

  const resetInternal = useCallback(
    (nextProgram: ProgramDoc) => {
      engineRef.current = new SimEngine(assembleProject(spec, nextProgram));
      processRef.current = getProcess(spec.processId);
      machineRef.current = processRef.current.init(spec.devices);
      inputsRef.current = defaultInputs(spec.devices);
      // Same priming the grader does, for the same reason and at the same
      // point: the panel has to show the machine that is standing there before
      // the first scan runs, or live play and the graded run start differently.
      const primed = primeProcess(
        processRef.current,
        machineRef.current,
        spec.devices,
        inputsRef.current,
      );
      derivedRef.current = primed.derivedInputs;
      derivedRegsRef.current = primed.derivedRegisters;
      historyRef.current = [];
      tMsRef.current = 0;
      setInputsState(inputsRef.current);
      setBits({});
      setRegisters({});
      setTimers({});
      setCounters({});
      setMachine(machineRef.current);
      setEvalResults({});
      setHistory([]);
    },
    [spec],
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
    setEvalResults({ ...engine.lastResults });
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
    const stopTrim = trimDevMeasures();
    return () => {
      clearInterval(id);
      stopTrim();
    };
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
