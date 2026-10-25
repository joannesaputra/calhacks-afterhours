// File bytes for retrieved sources go through the artifact blob root, content-addressed, never into ordinary email rows.
import { createHash, randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveArtifactPath } from "../artifacts";

export const BLOB_PREFIX = "_context";
export const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** Store bytes under <root>/_context/<aa>/<sha256>.bin. Identical bytes share one file. Never overwrites. */
export function putBlob(root: string, bytes: Uint8Array): { relPath: string; sha256: string } {
  const digest = sha256(bytes);
  const relPath = path.posix.join(BLOB_PREFIX, digest.slice(0, 2), `${digest}.bin`);
  const final = path.join(root, relPath);
  mkdirSync(path.dirname(final), { recursive: true });
  const tmp = path.join(root, BLOB_PREFIX, `.tmp-${randomUUID()}`);
  writeFileSync(tmp, bytes, { mode: 0o640 });
  try {
    linkSync(tmp, final);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      if (sha256(readFileSync(final)) !== digest) throw new Error("A different file already exists at a content-addressed path.", { cause: e });
    } else if (code === "EPERM" || code === "ENOTSUP" || code === "EXDEV" || code === "EOPNOTSUPP") {
      try { writeFileSync(final, bytes, { flag: "wx", mode: 0o640 }); } catch (err) { if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err; }
    } else throw e;
  } finally {
    rmSync(tmp, { force: true });
  }
  return { relPath, sha256: digest };
}

/** Read a stored blob and check it still matches its checksum. Null when missing, unsafe or altered. */
export function readBlob(root: string, relPath: string, expectedSha256: string | null): Buffer | null {
  const full = resolveArtifactPath(root, relPath);
  if (!full) return null;
  const bytes = readFileSync(full);
  if (expectedSha256 && sha256(bytes) !== expectedSha256) return null;
  return bytes;
}
