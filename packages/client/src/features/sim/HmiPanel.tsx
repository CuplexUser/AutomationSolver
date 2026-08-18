import { useEffect, useMemo, type ReactNode } from 'react';
import { isAnalog, scaleCounts, type AnalogRange, type PuzzleDevice } from '@automationsolver/shared';
import { SCAN_INTERVAL_MS, type HmiRunner } from './useSimRunner';

// A latching widget flips on keydown; anything else is a spring-return button
// that stays on only while the key is held.
function isLatching(d: PuzzleDevice): boolean {
  return d.widget === 'toggle' || d.widget === 'selector' || d.widget === 'estop';
}

// A normally closed field device's bit is on at rest and drops when the button
// is actuated, so every control here is driven in terms of *pressed* and the
// polarity is applied in exactly one place. Getting this wrong is not cosmetic:
// a spring-return NC stop that wrote the raw bit would rest asserted and latch
// itself on the first release, so the live panel and the graded run would
// disagree about what the ladder is reading.
function bitFor(d: PuzzleDevice, pressed: boolean): boolean {
  return d.normallyClosed === true ? !pressed : pressed;
}

function isPressed(d: PuzzleDevice, inputs: Record<string, boolean>): boolean {
  return (inputs[d.address] === true) !== (d.normallyClosed === true);
}

/**
 * Digit keys 1–9 drive the pressable inputs in panel order. Unlike pointer
 * clicks, several keys can be held at once — required by puzzles like
 * Two-Hand Press where both palm buttons must be down simultaneously.
 */
function useInputHotkeys(keyed: PuzzleDevice[], runner: HmiRunner) {
  const { setInput, inputs } = runner;
  useEffect(() => {
    const byDigit = new Map(keyed.map((d, i) => [String(i + 1), d]));
    const deviceFor = (e: KeyboardEvent) => {
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      return m ? byDigit.get(m[1]) : undefined;
    };
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const d = deviceFor(e);
      if (!d) return;
      e.preventDefault();
      if (e.repeat) return;
      setInput(d.address, bitFor(d, isLatching(d) ? !isPressed(d, inputs) : true));
    };
    // No modifier/typing guard on release: a held button must always let go.
    const onKeyUp = (e: KeyboardEvent) => {
      const d = deviceFor(e);
      if (d && !isLatching(d)) setInput(d.address, bitFor(d, false));
    };
    // Keyup is lost when the window blurs mid-hold; spring buttons release.
    const onBlur = () => {
      for (const d of keyed) {
        if (!isLatching(d) && isPressed(d, inputs)) setInput(d.address, bitFor(d, false));
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [keyed, setInput, inputs]);
}

export function HmiPanel({
  devices,
  runner,
  machineSlot,
}: {
  devices: PuzzleDevice[];
  runner: HmiRunner;
  machineSlot?: ReactNode;
}) {
  // Analog devices get their own strip rather than sitting among the lamps:
  // they are the thing a player watches continuously on these puzzles, and a
  // gauge squeezed into the lamp grid is unreadable.
  const analog = devices.filter(isAnalog);
  const inputs = devices.filter((d) => d.io === 'input' && !isAnalog(d));
  const outputs = devices.filter((d) => d.io === 'output' && !isAnalog(d));

  // Sensors are driven by the process model, not the operator, so they get no key.
  const keyed = useMemo(
    () => devices.filter((d) => d.io === 'input' && d.widget !== 'sensor' && !isAnalog(d)).slice(0, 9),
    [devices],
  );
  const hotkeys = new Map(keyed.map((d, i) => [d.address, String(i + 1)]));
  useInputHotkeys(keyed, runner);

  return (
    <div className="hmi panel">
      <div className="hmi-head">
        <span className="eyebrow">Operator Panel</span>
        <span className={`scan-dot${runner.running ? ' live' : ''}`}>
          {runner.running ? 'SCANNING' : 'HALTED'} · {SCAN_INTERVAL_MS}ms
        </span>
      </div>

      {machineSlot}

      {analog.length > 0 && (
        <div className="hmi-analog">
          <span className="eyebrow io-title">Analog</span>
          {analog.map((d) => (
            <AnalogWidget key={d.address} device={d} runner={runner} />
          ))}
        </div>
      )}

      <div className="hmi-controls">
        {runner.running ? (
          <button className="btn btn-stop" onClick={runner.stop}>
            ■ Stop
          </button>
        ) : (
          <button className="btn btn-run" onClick={runner.start}>
            ▶ Run
          </button>
        )}
        <button className="btn btn-ghost" onClick={runner.step} disabled={runner.running}>
          ▷ Step
        </button>
        <button className="btn btn-ghost" onClick={runner.reset}>
          ⟲ Reset
        </button>
      </div>

      <div className="hmi-io">
        <section>
          <span className="eyebrow io-title">Inputs</span>
          <div className="widget-grid">
            {inputs.map((d) => (
              <InputWidget key={d.address} device={d} runner={runner} hotkey={hotkeys.get(d.address)} />
            ))}
          </div>
        </section>
        <section>
          <span className="eyebrow io-title">Outputs</span>
          <div className="widget-grid">
            {outputs.map((d) => (
              <OutputWidget key={d.address} device={d} on={runner.bits[d.address] === true} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

const DEFAULT_RANGE: AnalogRange = {
  countMin: 0,
  countMax: 4000,
  min: 0,
  max: 100,
  units: '%',
  decimals: 1,
};

/** Fraction of full scale, clamped, for drawing. */
function fraction(counts: number, range: AnalogRange): number {
  const span = range.countMax - range.countMin;
  if (span === 0) return 0;
  return Math.min(1, Math.max(0, (counts - range.countMin) / span));
}

/**
 * A word device: the raw count in the register, shown in the units a person
 * thinks in. `trend` additionally draws the last stretch of scan history,
 * because a regulator cannot be judged, let alone tuned, from an instantaneous
 * number.
 */
function AnalogWidget({ device, runner }: { device: PuzzleDevice; runner: HmiRunner }) {
  const range = device.range ?? DEFAULT_RANGE;
  const counts = runner.registers?.[device.address] ?? 0;
  const value = scaleCounts(counts, range).toFixed(range.decimals ?? 1);
  const color = device.color ?? '#4aa3ff';
  const pct = fraction(counts, range) * 100;

  return (
    <div className="analog-widget">
      <div className="analog-head">
        <span className={`dev-chip dev-${device.address[0]}`}>{device.address}</span>
        <span className="analog-name">{device.label}</span>
        <span className="analog-value mono" style={{ color }}>
          {value} <span className="analog-units">{range.units}</span>
        </span>
        <span className="analog-counts mono">{counts}</span>
      </div>
      {device.widget === 'trend' ? (
        <Trend device={device} range={range} runner={runner} color={color} />
      ) : (
        <div className="analog-bar">
          <div className="analog-fill" style={{ width: `${pct}%`, background: color }} />
        </div>
      )}
    </div>
  );
}

const TREND_W = 240;
const TREND_H = 44;

function Trend({
  device,
  range,
  runner,
  color,
}: {
  device: PuzzleDevice;
  range: AnalogRange;
  runner: HmiRunner;
  color: string;
}) {
  const points = useMemo(() => {
    const history = runner.history ?? [];
    if (history.length < 2) return '';
    // One pixel column per sample at most, oldest left.
    const start = Math.max(0, history.length - TREND_W);
    const window = history.slice(start);
    const step = window.length > 1 ? TREND_W / (window.length - 1) : TREND_W;
    return window
      .map((sample, i) => {
        const counts = sample.registers?.[device.address] ?? 0;
        const y = TREND_H - fraction(counts, range) * TREND_H;
        return `${(i * step).toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [runner.history, device.address, range]);

  return (
    <svg
      className="analog-trend"
      viewBox={`0 0 ${TREND_W} ${TREND_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${device.label} trend`}
    >
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1={0}
          x2={TREND_W}
          y1={TREND_H * f}
          y2={TREND_H * f}
          className="trend-grid"
        />
      ))}
      {points && <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />}
    </svg>
  );
}

function InputWidget({
  device,
  runner,
  hotkey,
}: {
  device: PuzzleDevice;
  runner: HmiRunner;
  hotkey?: string;
}) {
  const addr = device.address;
  if (device.widget === 'sensor') {
    const on = runner.bits[addr] === true;
    return (
      <div className="widget">
        <div className={`lamp small${on ? ' on' : ''}`} style={lampStyle('#4aa3ff', on)} />
        <WidgetLabel device={device} />
      </div>
    );
  }

  if (device.widget === 'estop') {
    // Maintained: the mushroom head stays where it was left until it is twisted
    // out again.
    const pressed = isPressed(device, runner.inputs);
    return (
      <div className="widget">
        <button
          className={`estop${pressed ? ' pressed' : ''}`}
          onClick={() => runner.setInput(addr, bitFor(device, !pressed))}
          aria-pressed={pressed}
          aria-label={`${device.label} ${pressed ? 'pressed' : 'healthy'}`}
        >
          <span className="estop-cap" />
        </button>
        <WidgetLabel device={device} state={pressed ? 'PRESSED' : 'OK'} hotkey={hotkey} />
      </div>
    );
  }

  if (device.widget === 'toggle' || device.widget === 'selector') {
    const on = runner.inputs[addr] === true;
    return (
      <div className="widget">
        <button
          className={`toggle${on ? ' on' : ''}`}
          onClick={() => runner.setInput(addr, !on)}
          aria-pressed={on}
          aria-label={device.label}
        >
          <span className="toggle-knob" />
        </button>
        <WidgetLabel device={device} state={on ? 'ON' : 'OFF'} hotkey={hotkey} />
      </div>
    );
  }

  // momentary push button (spring return)
  const held = isPressed(device, runner.inputs);
  const press = (v: boolean) => runner.setInput(addr, bitFor(device, v));
  return (
    <div className="widget">
      <button
        className={`push${held ? ' held' : ''}`}
        onPointerDown={() => press(true)}
        onPointerUp={() => press(false)}
        onPointerLeave={() => held && press(false)}
        onPointerCancel={() => press(false)}
        aria-label={device.label}
      >
        <span className="push-cap" />
      </button>
      <WidgetLabel device={device} hotkey={hotkey} />
    </div>
  );
}

function OutputWidget({ device, on }: { device: PuzzleDevice; on: boolean }) {
  const color = device.color ?? '#37d67a';
  if (device.widget === 'motor') {
    return (
      <div className="widget">
        <div className={`motor${on ? ' on' : ''}`} style={{ color }}>
          <div className="motor-hub" />
          <div className="motor-blades" />
        </div>
        <WidgetLabel device={device} state={on ? 'RUN' : 'STOP'} />
      </div>
    );
  }
  return (
    <div className="widget">
      <div className={`lamp${on ? ' on' : ''}`} style={lampStyle(color, on)} />
      <WidgetLabel device={device} state={on ? 'ON' : 'OFF'} />
    </div>
  );
}

function WidgetLabel({ device, state, hotkey }: { device: PuzzleDevice; state?: string; hotkey?: string }) {
  return (
    <div className="widget-label">
      <span className="widget-chiprow">
        <span className={`dev-chip dev-${device.address[0]}`}>{device.address}</span>
        {hotkey && (
          <kbd className="widget-key" title={`Keyboard: hold ${hotkey}`}>
            {hotkey}
          </kbd>
        )}
      </span>
      <span className="widget-name">{device.label}</span>
      {state && <span className="widget-state">{state}</span>}
    </div>
  );
}

function lampStyle(color: string, on: boolean): React.CSSProperties {
  return {
    color,
    background: on ? color : 'transparent',
    boxShadow: on ? `0 0 14px 2px ${color}, inset 0 0 6px rgba(255,255,255,0.5)` : undefined,
  };
}
