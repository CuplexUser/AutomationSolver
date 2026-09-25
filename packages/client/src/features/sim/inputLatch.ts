/**
 * Guarantees every operator input state is read by at least one scan.
 *
 * A pushbutton pressed and released between two scans used to vanish: the
 * press set the bit, the release cleared it, and no scan ever ran in between.
 * On a page too busy to keep its 50 ms interval that is most presses, which is
 * how a heavy plant view "ignored" START. A real PLC has the same hazard with a
 * button shorter than its scan, and the answer there is a longer press; here
 * the panel can simply hold the state until a scan has seen it.
 *
 * Only while the sim runs: a stopped engine takes no scans, so deferring would
 * leave a button drawn pressed until the next Run.
 */
export class InputLatch {
  /** Addresses whose current value no scan has read yet. */
  private unscanned = new Set<string>();
  /** Values that arrived while the previous one was still unscanned, in arrival order per address. */
  private deferred = new Map<string, boolean[]>();

  /**
   * Apply `value` to `inputs` now, or queue it behind an unscanned value.
   * Returns the inputs to use (the same object when nothing changed).
   */
  set(
    inputs: Record<string, boolean>,
    address: string,
    value: boolean,
    running: boolean,
  ): Record<string, boolean> {
    if (running && this.unscanned.has(address)) {
      const queue = this.deferred.get(address) ?? [];
      queue.push(value);
      this.deferred.set(address, queue);
      return inputs;
    }
    if (running) this.unscanned.add(address);
    return inputs[address] === value ? inputs : { ...inputs, [address]: value };
  }

  /** A scan has read `inputs`: release the next queued value per address. */
  scanned(inputs: Record<string, boolean>): Record<string, boolean> {
    this.unscanned.clear();
    if (this.deferred.size === 0) return inputs;
    let next = inputs;
    for (const [address, queue] of this.deferred) {
      const value = queue.shift()!;
      if (queue.length === 0) this.deferred.delete(address);
      this.unscanned.add(address);
      if (next[address] !== value) next = { ...next, [address]: value };
    }
    return next;
  }

  /** Stop or reset: nothing is owed to a scan that will not run. Returns inputs with every queued value applied. */
  flush(inputs: Record<string, boolean>): Record<string, boolean> {
    let next = inputs;
    for (const [address, queue] of this.deferred) {
      const value = queue[queue.length - 1];
      if (next[address] !== value) next = { ...next, [address]: value };
    }
    this.deferred.clear();
    this.unscanned.clear();
    return next;
  }
}
