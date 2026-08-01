import type { PuzzleProgram } from '../../api/client';

/**
 * Exported slot files are minified JSON, gzipped and XOR-scrambled behind a magic
 * header. The scramble is obfuscation only — it keeps a file from being casually
 * read or hand-edited, and is not a security measure.
 *
 * Layout: "ASL1" (4 bytes) | XOR(gzip(utf8(minified JSON)))
 */
const MAGIC = new Uint8Array([0x41, 0x53, 0x4c, 0x31]); // "ASL1"
const SCRAMBLE_KEY = new TextEncoder().encode('automationsolver/slot/v1');

export const SLOT_FILE_EXTENSION = '.ladder';

export interface SlotFileEnvelope {
  format: 'automationsolver.slot';
  version: 1;
  /** Puzzle this program belongs to. */
  slug: string;
  /** ISO 8601 timestamp of the export. */
  exportedAt: string;
  /** Author metadata — recorded on export, ignored on import. */
  email: string | null;
  displayName: string | null;
  program: PuzzleProgram;
}

type Bytes = Uint8Array<ArrayBuffer>;

async function gzip(bytes: Bytes): Promise<Bytes> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Bytes): Promise<Bytes> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** XOR against a repeating key; its own inverse. */
function scramble(bytes: Bytes): Bytes {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i]! ^ SCRAMBLE_KEY[i % SCRAMBLE_KEY.length]!;
  return out;
}

export function buildEnvelope(
  slug: string,
  program: PuzzleProgram,
  author: { email: string | null; displayName: string } | null,
  exportedAt: Date,
): SlotFileEnvelope {
  return {
    format: 'automationsolver.slot',
    version: 1,
    slug,
    exportedAt: exportedAt.toISOString(),
    email: author?.email ?? null,
    displayName: author?.displayName ?? null,
    program,
  };
}

export async function encodeSlotFile(envelope: SlotFileEnvelope): Promise<Blob> {
  const json = new TextEncoder().encode(JSON.stringify(envelope));
  const body = scramble(await gzip(json));
  return new Blob([MAGIC, body], { type: 'application/octet-stream' });
}

function hasMagic(bytes: Bytes): boolean {
  return MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * Reads an exported slot file. Plain-JSON files written by the older export format
 * still load; the envelope's author fields are read back but deliberately unused.
 */
export async function decodeSlotFile(
  file: File,
): Promise<{ program: PuzzleProgram; envelope: SlotFileEnvelope | null }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasMagic(bytes)) {
    return { program: JSON.parse(new TextDecoder().decode(bytes)) as PuzzleProgram, envelope: null };
  }
  const json = new TextDecoder().decode(await gunzip(scramble(bytes.subarray(MAGIC.length))));
  const envelope = JSON.parse(json) as SlotFileEnvelope;
  if (!envelope || typeof envelope !== 'object' || typeof envelope.program !== 'object') {
    throw new Error('missing program');
  }
  return { program: envelope.program, envelope };
}
