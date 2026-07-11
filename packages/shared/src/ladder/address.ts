import type { DeviceKind } from './types.js';

export interface DeviceRef {
  kind: DeviceKind;
  index: number;
}

const ADDRESS_RE = /^([XYMTC])(\d{1,4})$/;

const VALID_KINDS: ReadonlySet<string> = new Set(['X', 'Y', 'M', 'T', 'C']);

/** Parse "X0" -> { kind: 'X', index: 0 }. Returns null if malformed. */
export function parseAddress(address: string): DeviceRef | null {
  const m = ADDRESS_RE.exec(address.trim().toUpperCase());
  if (!m) return null;
  const kind = m[1] as DeviceKind;
  const index = Number.parseInt(m[2], 10);
  if (Number.isNaN(index)) return null;
  return { kind, index };
}

export function formatAddress(ref: DeviceRef): string {
  return `${ref.kind}${ref.index}`;
}

export function isValidAddress(address: string): boolean {
  return parseAddress(address) !== null;
}

export function addressKind(address: string): DeviceKind | null {
  const ref = parseAddress(address);
  return ref ? ref.kind : null;
}

export function isKind(address: string, kind: DeviceKind): boolean {
  return addressKind(address) === kind;
}

export { VALID_KINDS };
