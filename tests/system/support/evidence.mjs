// Writes machine-readable evidence next to the tests (directory is git-ignored via the root `tmp/` rule).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../tmp");
export function record(name, data) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data, null, 2));
}
