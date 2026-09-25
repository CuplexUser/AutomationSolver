import { describe, expect, it } from 'vitest';
import { InputLatch } from './inputLatch';

describe('InputLatch', () => {
  it('holds a press released before any scan until one scan has read it', () => {
    const latch = new InputLatch();
    let inputs: Record<string, boolean> = { X0: false };
    inputs = latch.set(inputs, 'X0', true, true);
    inputs = latch.set(inputs, 'X0', false, true);
    expect(inputs.X0).toBe(true);
    inputs = latch.scanned(inputs);
    expect(inputs.X0).toBe(false);
  });

  it('applies a release at once when a scan already read the press', () => {
    const latch = new InputLatch();
    let inputs: Record<string, boolean> = { X0: false };
    inputs = latch.set(inputs, 'X0', true, true);
    inputs = latch.scanned(inputs);
    inputs = latch.set(inputs, 'X0', false, true);
    expect(inputs.X0).toBe(false);
  });

  it('gives every queued state its own scan', () => {
    const latch = new InputLatch();
    let inputs: Record<string, boolean> = { X3: false };
    for (const v of [true, false, true]) inputs = latch.set(inputs, 'X3', v, true);
    const seen = [inputs.X3];
    inputs = latch.scanned(inputs);
    seen.push(inputs.X3);
    inputs = latch.scanned(inputs);
    seen.push(inputs.X3);
    inputs = latch.scanned(inputs);
    expect(seen).toEqual([true, false, true]);
    expect(inputs.X3).toBe(true);
  });

  it('does not defer anything while stopped', () => {
    const latch = new InputLatch();
    let inputs: Record<string, boolean> = { X0: false };
    inputs = latch.set(inputs, 'X0', true, false);
    inputs = latch.set(inputs, 'X0', false, false);
    expect(inputs.X0).toBe(false);
  });

  it('flush applies the last queued value', () => {
    const latch = new InputLatch();
    let inputs: Record<string, boolean> = { X0: false };
    inputs = latch.set(inputs, 'X0', true, true);
    inputs = latch.set(inputs, 'X0', false, true);
    expect(latch.flush(inputs).X0).toBe(false);
  });
});
