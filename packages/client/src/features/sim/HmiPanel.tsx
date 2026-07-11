import type { PuzzleDevice, PuzzleSpec } from '@automationsolver/shared';
import type { SimRunner } from './useSimRunner';

export function HmiPanel({ spec, runner }: { spec: PuzzleSpec; runner: SimRunner }) {
  const inputs = spec.devices.filter((d) => d.io === 'input');
  const outputs = spec.devices.filter((d) => d.io === 'output');

  return (
    <div className="hmi panel">
      <div className="hmi-head">
        <span className="eyebrow">Operator Panel</span>
        <span className={`scan-dot${runner.running ? ' live' : ''}`}>
          {runner.running ? 'SCANNING' : 'HALTED'} · 60ms
        </span>
      </div>

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
              <InputWidget key={d.address} device={d} runner={runner} />
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

function InputWidget({ device, runner }: { device: PuzzleDevice; runner: SimRunner }) {
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
    // Normally-closed: healthy input = true; pressed = false.
    const pressed = runner.inputs[addr] === false;
    return (
      <div className="widget">
        <button
          className={`estop${pressed ? ' pressed' : ''}`}
          onClick={() => runner.setInput(addr, pressed)}
          aria-pressed={pressed}
          aria-label={`${device.label} ${pressed ? 'pressed' : 'healthy'}`}
        >
          <span className="estop-cap" />
        </button>
        <WidgetLabel device={device} state={pressed ? 'PRESSED' : 'OK'} />
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
        <WidgetLabel device={device} state={on ? 'ON' : 'OFF'} />
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
      <WidgetLabel device={device} />
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

function WidgetLabel({ device, state }: { device: PuzzleDevice; state?: string }) {
  return (
    <div className="widget-label">
      <span className={`dev-chip dev-${device.address[0]}`}>{device.address}</span>
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
