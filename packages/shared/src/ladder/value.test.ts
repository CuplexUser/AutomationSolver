import { describe, expect, it } from 'vitest';
import { parseAddress } from './address.js';
import {
  effectiveAddress,
  formatValueOperand,
  parseValueOperand,
  parseWordTarget,
  readValue,
  staticBase,
  usesIndexRegister,
} from './value.js';

describe('word operand grammar', () => {
  it('still reads plain registers and constants exactly as before', () => {
    expect(parseValueOperand('D10')).toEqual({ kind: 'D', address: 'D10' });
    expect(parseValueOperand(' d007 ')).toEqual({ kind: 'D', address: 'D7' });
    expect(parseValueOperand('K500')).toEqual({ kind: 'K', value: 500 });
    expect(parseValueOperand('-20')).toEqual({ kind: 'K', value: -20 });
    expect(parseValueOperand('K40000')).toBeNull();
    expect(parseValueOperand('')).toBeNull();
    expect(parseValueOperand('M0')).toBeNull();
  });

  it('reads the eight index registers and nothing past them', () => {
    expect(parseValueOperand('Z0')).toEqual({ kind: 'Z', address: 'Z0' });
    expect(parseValueOperand('z7')).toEqual({ kind: 'Z', address: 'Z7' });
    expect(parseValueOperand('Z8')).toBeNull();
    expect(parseAddress('Z7')).toEqual({ kind: 'Z', index: 7 });
    expect(parseAddress('Z8')).toBeNull();
  });

  it('reads an indexed register as a base plus the register that offsets it', () => {
    expect(parseValueOperand('D100Z0')).toEqual({ kind: 'DZ', base: 100, index: 'Z0' });
    expect(parseValueOperand('d0200z3')).toEqual({ kind: 'DZ', base: 200, index: 'Z3' });
    expect(parseValueOperand('D100Z8')).toBeNull();
    expect(parseValueOperand('D100Z10')).toBeNull();
    expect(parseValueOperand('K5Z0')).toBeNull();
    expect(parseValueOperand('M0Z0')).toBeNull();
  });

  it('keeps constants out of the places a value is written', () => {
    expect(parseWordTarget('K5')).toBeNull();
    expect(parseWordTarget('D5')).toEqual({ kind: 'D', address: 'D5' });
    expect(parseWordTarget('Z1')).toEqual({ kind: 'Z', address: 'Z1' });
    expect(parseWordTarget('D5Z1')).toEqual({ kind: 'DZ', base: 5, index: 'Z1' });
  });

  it('formats every form back to its canonical spelling', () => {
    for (const s of ['D10', 'Z0', 'D100Z0', 'K-20']) {
      expect(formatValueOperand(parseValueOperand(s)!)).toBe(s);
    }
    expect(formatValueOperand(parseValueOperand('d0100z0')!)).toBe('D100Z0');
  });

  it('says which operands need index registers', () => {
    expect(usesIndexRegister(parseValueOperand('D1')!)).toBe(false);
    expect(usesIndexRegister(parseValueOperand('K1')!)).toBe(false);
    expect(usesIndexRegister(parseValueOperand('Z1')!)).toBe(true);
    expect(usesIndexRegister(parseValueOperand('D1Z1')!)).toBe(true);
  });
});

describe('resolving an indexed operand', () => {
  const regs = new Map<string, number>([
    ['Z0', 3],
    ['Z1', -2],
    ['Z2', 9000],
    ['D103', 42],
    ['D98', 7],
  ]);

  it('offsets the base by the current value of its index register', () => {
    expect(effectiveAddress(parseValueOperand('D100Z0')!, regs)).toBe('D103');
    expect(readValue(parseValueOperand('D100Z0')!, regs)).toBe(42);
  });

  it('allows a negative index, as the FX does', () => {
    expect(effectiveAddress(parseValueOperand('D100Z1')!, regs)).toBe('D98');
    expect(readValue(parseValueOperand('D100Z1')!, regs)).toBe(7);
  });

  it('refuses to name a register outside D0 to D9999', () => {
    expect(effectiveAddress(parseValueOperand('D1000Z2')!, regs)).toBeNull();
    expect(effectiveAddress(parseValueOperand('D0Z1')!, regs)).toBeNull();
  });

  it('reads an index register itself as a word', () => {
    expect(readValue(parseValueOperand('Z0')!, regs)).toBe(3);
    expect(readValue(parseValueOperand('Z5')!, regs)).toBe(0);
  });

  it('gives static checks the base of an indexed operand', () => {
    expect(staticBase('D100Z0')).toBe('D100');
    expect(staticBase('D7')).toBe('D7');
    expect(staticBase('Z2')).toBe('Z2');
    expect(staticBase('K5')).toBeNull();
  });
});
