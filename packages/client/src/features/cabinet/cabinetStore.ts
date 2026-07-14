import { create } from 'zustand';
import type { TerminalId, WiringDoc } from '@automationsolver/shared';

interface CabinetState {
  wiring: WiringDoc;
  selectedTerminal: TerminalId | null;
  selectedWire: string | null;
  dirty: boolean;
  init: (wiring: WiringDoc | null) => void;
  markClean: () => void;
  selectTerminal: (t: TerminalId | null) => void;
  selectWire: (id: string | null) => void;
  /** Adds a wire unless it's a self-loop or duplicates an existing pair. */
  addWire: (from: TerminalId, to: TerminalId) => void;
  removeWire: (id: string) => void;
  clearAll: () => void;
}

// Wire ids are generated here, not in shared — the shared package is banned
// from non-deterministic sources by lint, and ids only need client uniqueness.
let wireCounter = 0;
const nextWireId = () => `w${Date.now().toString(36)}${(wireCounter++).toString(36)}`;

const samePair = (a1: string, a2: string, b1: string, b2: string) =>
  (a1 === b1 && a2 === b2) || (a1 === b2 && a2 === b1);

export const useCabinet = create<CabinetState>((set) => ({
  wiring: { wires: [] },
  selectedTerminal: null,
  selectedWire: null,
  dirty: false,

  init: (wiring) =>
    set({ wiring: wiring ?? { wires: [] }, selectedTerminal: null, selectedWire: null, dirty: false }),
  markClean: () => set({ dirty: false }),
  selectTerminal: (t) => set({ selectedTerminal: t, selectedWire: null }),
  selectWire: (id) => set({ selectedWire: id, selectedTerminal: null }),

  addWire: (from, to) =>
    set((s) => {
      if (from === to) return { selectedTerminal: null };
      if (s.wiring.wires.some((w) => samePair(w.from, w.to, from, to))) {
        return { selectedTerminal: null };
      }
      return {
        wiring: { wires: [...s.wiring.wires, { id: nextWireId(), from, to }] },
        selectedTerminal: null,
        dirty: true,
      };
    }),

  removeWire: (id) =>
    set((s) => ({
      wiring: { wires: s.wiring.wires.filter((w) => w.id !== id) },
      selectedWire: s.selectedWire === id ? null : s.selectedWire,
      dirty: true,
    })),

  clearAll: () =>
    set({ wiring: { wires: [] }, selectedTerminal: null, selectedWire: null, dirty: true }),
}));
