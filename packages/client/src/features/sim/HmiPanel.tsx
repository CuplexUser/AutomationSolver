import { useEffect, useMemo, type ReactNode } from 'react';
import type { PuzzleDevice } from '@automationsolver/shared';
import type { HmiRunner } from './useSimRunner';

// A latching widget flips on keydown; anything else is a spring-return button
// that stays on only while the key is held.
function isLatching(d: PuzzleDevice): boolean {
  return d.widget === 'toggle' || d.widget === 'selector' || d.widget === 'estop';
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
      setInput(d.address, isLatching(d) ? inputs[d.address] !== true : true);
    };
    // No modifier/typing guard on release: a held button must always let go.
    const onKeyUp = (e: KeyboardEvent) => {
      const d = deviceFor(e);
      if (d && !isLatching(d)) setInput(d.address, false);
    };
    // Keyup is lost when the window blurs mid-hold; spring buttons release.
    const onBlur = () => {
      for (const d of keyed) {
        if (!isLatching(d) && inputs[d.address] === true) setInput(d.address, false);
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
  const inputs = devices.filter((d) => d.io === 'input');
  const outputs = devices.filter((d) => d.io === 'output');

  // Sensors are driven by the process model, not the operator, so they get no key.
  const keyed = useMemo(
    () => devices.filter((d) => d.io === 'input' && d.widget !== 'sensor').slice(0, 9),
    [devices],
  );
  const hotkeys = new Map(keyed.map((d, i) => [d.address, String(i + 1)]));
  useInputHotkeys(keyed, runner);

  return (
    <div className="hmi panel">
      <div className="hmi-head">
        <span className="eyebrow">Operator Panel</span>
        <span className={`scan-dot${runner.running ? ' live' : ''}`}>
          {runner.running ? 'SCANNING' : 'HALTED'} · 60ms
        </span>
      </div>

      {machineSlot}

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
    // Ladder inputs read the physical NC contact (normallyClosed: healthy =
    // true, pressed = false); cabinet devices report "actuated" directly.
    const nc = device.normallyClosed === true;
    const pressed = nc ? runner.inputs[addr] === false : runner.inputs[addr] === true;
    return (
      <div className="widget">
        <button
          className={`estop${pressed ? ' pressed' : ''}`}
          onClick={() => runner.setInput(addr, nc ? pressed : !pressed)}
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
  const held = runner.inputs[addr] === true;
  const press = (v: boolean) => runner.setInput(addr, v);
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
