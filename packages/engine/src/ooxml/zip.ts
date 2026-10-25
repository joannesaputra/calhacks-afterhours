import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";

export type OoxmlFailure = "encrypted" | "corrupt" | "oversized" | "unsupported";

/** A source file that cannot be read for a specific, reportable reason. Never a generic failure. */
export class OoxmlError extends Error {
  constructor(public readonly kind: OoxmlFailure, message: string) {
    super(message);
    this.name = "OoxmlError";
  }
}

export interface ZipLimits {
  maxEntries: number;
  /** Sum of the uncompressed sizes of every entry. Guards against zip bombs before anything is inflated. */
  maxUncompressedBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 2_000, maxUncompressedBytes: 120 * 1024 * 1024 };

interface DirectoryEntry { name: string; flags: number; size: number; compressedSize: number }

const COMPOUND_FILE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Password-protected Office files are OLE compound files, not ZIP archives (legacy .ppt/.doc share the header). */
export const isCompoundFile = (bytes: Uint8Array): boolean => COMPOUND_FILE.every((b, i) => bytes[i] === b);
export const looksLikeZip = (bytes: Uint8Array): boolean => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5);

function centralDirectory(bytes: Uint8Array): DirectoryEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  const stop = Math.max(0, bytes.length - 22 - 0xffff);
  while (eocd >= stop && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
  if (eocd < stop) throw new OoxmlError("corrupt", "The file is not a readable ZIP package (no end-of-archive record).");
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const entries: DirectoryEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) throw new OoxmlError("corrupt", "The ZIP directory is damaged.");
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    entries.push({
      name: strFromU8(bytes.subarray(cursor + 46, cursor + 46 + nameLength)),
      flags: view.getUint16(cursor + 8, true),
      compressedSize: view.getUint32(cursor + 20, true),
      size: view.getUint32(cursor + 24, true),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Read every entry of an OOXML package, refusing encrypted, oversized or damaged containers with a typed error. */
export function readPackage(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Map<string, Uint8Array> {
  if (isCompoundFile(bytes)) throw new OoxmlError("encrypted", "The file is password-protected or in a legacy binary format and cannot be read.");
  if (!looksLikeZip(bytes)) throw new OoxmlError("corrupt", "The file is not a ZIP-based Office package.");
  const directory = centralDirectory(bytes);
  if (directory.length > limits.maxEntries) throw new OoxmlError("oversized", `The package has more than ${limits.maxEntries} parts.`);
  if (directory.some((e) => e.flags & 1)) throw new OoxmlError("encrypted", "The package is encrypted and cannot be read.");
  const total = directory.reduce((n, e) => n + e.size, 0);
  if (total > limits.maxUncompressedBytes) throw new OoxmlError("oversized", "The package expands to more than the allowed size.");
  try {
    const files = unzipSync(bytes);
    return new Map(Object.entries(files));
  } catch {
    throw new OoxmlError("corrupt", "The package could not be decompressed.");
  }
}

const STORED = /\.(png|jpe?g|gif|mp4|mov|m4a|mp3|wav|zip)$/i;

/** Write a package. Entries keep the order of the map ([Content_Types].xml first, as OPC readers expect). */
export function writePackage(files: Map<string, Uint8Array>): Uint8Array {
  const out: Zippable = {};
  const names = [...files.keys()].sort((a, b) => (a === "[Content_Types].xml" ? -1 : b === "[Content_Types].xml" ? 1 : 0));
  for (const name of names) out[name] = [files.get(name)!, { level: STORED.test(name) ? 0 : 6 }];
  return zipSync(out);
}

export const text = (files: Map<string, Uint8Array>, name: string): string | null => {
  const v = files.get(name);
  return v ? strFromU8(v) : null;
};
export { strToU8 };
