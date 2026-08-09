import { useEffect, useRef, useState } from 'react';
import {
  ASSEMBLY_TUNED,
  CONV_TUNED,
  factoryLine,
  isAnalog,
  LINE_DEVICES,
  LINE_SECTIONS,
  lineProject,
  PAINT_TUNED,
  SimEngine,
  STORE_TUNED,
  TEST_TUNED,
  WELD_TUNED,
  type MachineState,
} from '@automationsolver/shared';
import { FactoryLine3D } from '../features/sim/factoryLine/FactoryLine3D';

/**
 * A dev-only window onto the excavator line, with no puzzle behind it.
 *
 * The scene is built before the puzzles that use it, which leaves it with no
 * route: `MachineView` dispatches on `spec.processId` and nothing declares
 * `factory-line` yet. Rather than author a puzzle early just to be able to look
 * at a shed, this runs the plant the way the soak test does — the six tuned
 * section programs in one `SimEngine`, stepped at `GRADE_DT` — and hands the
 * resulting `MachineState` straight to the scene.
 *
 * It stays useful after the puzzles land, because re-modelling a cell means
 * watching one mechanism for a minute without also playing the game. `App.tsx`
 * mounts it behind `import.meta.env.DEV`, so it is never in a production bundle.
 */

/** The same 50 ms the grader and the live client scan at. */
const DT = 50;
/** Wall-clock between ticks. Faster than DT would mean simulating time twice. */
const TICK_MS = 50;

/**
 * The six tuned programs, handed to the shared builder rather than assembled
 * here. It supplies the supervisor, the task and every section's declarations,
 * and resolves the names to addresses — which the engine needs, since these
 * programs are written in symbols.
 */
const TUNED = {
  WELD: WELD_TUNED,
  STORE: STORE_TUNED,
  PAINT: PAINT_TUNED,
  ASSY: ASSEMBLY_TUNED,
  TEST: TEST_TUNED,
  CONV: CONV_TUNED,
};

const OUT_DEVICES = LINE_DEVICES.filter((d) => d.io === 'output' && !isAnalog(d));
const ANALOG_DEVICES = LINE_DEVICES.filter(isAnalog);
/** Start, Stop (NC), E-Stop (NC) and Auto, all made — the line simply runs. */
const PLANT_INPUTS: Record<string, boolean> = { X0: true, X1: true, X2: true, X3: true };

/** Everything the loop carries between ticks but the picture never reads. */
interface SimCarry {
  engine: SimEngine;
  machine: MachineState;
  derived: Record<string, boolean>;
  derivedRegs: Record<string, number>;
}

function startLine(): SimCarry {
  const engine = new SimEngine(lineProject(TUNED));
  engine.reset();
  return {
    engine,
    machine: factoryLine.init(LINE_DEVICES),
    derived: {},
    derivedRegs: {},
  };
}

/** What a frame of the plant looks like: the two things the scene is handed. */
interface Snapshot {
  machine: MachineState;
  bits: Record<string, boolean>;
  scans: number;
}

export function LinePreviewPage() {
  const [section, setSection] = useState<string>('');
  const [running, setRunning] = useState(true);
  const [generation, setGeneration] = useState(0);

  // The engine and its carried images live in a ref because they are an
  // external system stepped fifty times a second; the *snapshot* the scene
  // draws is state, because that is what render reads.
  const sim = useRef<SimCarry | null>(null);
  const [snap, setSnap] = useState<Snapshot>(() => ({
    machine: factoryLine.init(LINE_DEVICES),
    bits: {},
    scans: 0,
  }));

  useEffect(() => {
    // A new generation is a Reset: throw the engine away and start over.
    sim.current = startLine();
    setSnap({ machine: sim.current.machine, bits: {}, scans: 0 });
  }, [generation]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const s = sim.current;
      if (!s) return;
      // Exactly the loop the soak test runs, so what is on screen is what the
      // grader would see: derived sensors in, scan, coils out, plant steps.
      s.engine.setInputs(PLANT_INPUTS);
      s.engine.setInputs(s.derived);
      s.engine.setRegisters(s.derivedRegs);
      s.engine.scan(DT);

      const outputs: Record<string, boolean> = {};
      for (const d of OUT_DEVICES) outputs[d.address] = s.engine.getBit(d.address);
      const registers: Record<string, number> = {};
      for (const d of ANALOG_DEVICES) registers[d.address] = s.engine.getRegister(d.address);

      const res = factoryLine.step({
        outputs,
        inputs: PLANT_INPUTS,
        registers,
        machine: s.machine,
        devices: LINE_DEVICES,
        dtMs: DT,
      });
      s.machine = res.machine;
      s.derived = res.derivedInputs ?? {};
      s.derivedRegs = res.derivedRegisters ?? {};
      setSnap((prev) => ({ machine: res.machine, bits: outputs, scans: prev.scans + 1 }));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  return (
    <div className="line-preview">
      <div className="lp-bar">
        <strong>Excavator line</strong>
        <span className="lp-clock">
          {((snap.scans * DT) / 1000).toFixed(1)} s · {snap.scans} scans
        </span>
        <button type="button" onClick={() => setRunning((r) => !r)}>
          {running ? 'Pause' : 'Run'}
        </button>
        <button type="button" onClick={() => setGeneration((g) => g + 1)}>
          Reset
        </button>
        <span className="lp-cams">
          <button
            type="button"
            className={section === '' ? 'on' : undefined}
            onClick={() => setSection('')}
          >
            Plant
          </button>
          {['WELD', 'CONV', 'STORE', 'PORTAL', 'PAINT', 'ASSY', 'TEST'].map((id) => (
            <button
              key={id}
              type="button"
              className={section === id ? 'on' : undefined}
              onClick={() => setSection(id)}
            >
              {id}
            </button>
          ))}
        </span>
        <span className="lp-note">
          Dev preview. Seven tuned sections, no puzzle. Sections: {Object.values(LINE_SECTIONS).join(' ')}
        </span>
      </div>
      <div className="lp-scene">
        {/* The process model returns a fresh machine object every step, so the
            memoized cells reconcile on identity exactly as they do in play. */}
        <FactoryLine3D
          machine={snap.machine}
          outputs={snap.bits}
          section={section || undefined}
          height="100%"
        />
      </div>
    </div>
  );
}
