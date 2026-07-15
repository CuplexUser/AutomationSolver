import { describe, expect, it } from 'vitest';
import { PUZZLES } from '../puzzle/content/index.js';
import { requiredPlacements, schematicRegistryProblems } from './schematic.js';

describe('schematic part registry', () => {
  it('covers every terminal of every component type exactly once', () => {
    expect(schematicRegistryProblems()).toEqual([]);
  });
});

describe('shipped cabinet puzzles place every schematic part', () => {
  const cabinetPuzzles = PUZZLES.filter((p) => p.kind === 'cabinet');

  it('has cabinet puzzles to check', () => {
    expect(cabinetPuzzles.length).toBeGreaterThan(0);
  });

  for (const p of cabinetPuzzles) {
    it(`${p.slug}: one placement per (component, part)`, () => {
      const placed = new Map<string, number>();
      for (const pl of p.cabinet.schematic) {
        const key = `${pl.componentId}/${pl.part}`;
        placed.set(key, (placed.get(key) ?? 0) + 1);
      }
      const missing: string[] = [];
      for (const req of requiredPlacements(p.cabinet)) {
        const key = `${req.componentId}/${req.part}`;
        if (!placed.has(key)) missing.push(key);
        else placed.set(key, placed.get(key)! - 1);
      }
      const duplicatesOrUnknown = [...placed.entries()].filter(([, n]) => n !== 0).map(([k]) => k);
      expect(missing).toEqual([]);
      expect(duplicatesOrUnknown).toEqual([]);
    });
  }
});
