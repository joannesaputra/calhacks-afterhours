/* global Buffer */
// Structural inspection of downloaded Office files using the system `unzip` tool (no new dependency).
// This proves container structure and text content. It does NOT prove visual layout.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

export function openZip(bytes) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ah-zip-"));
  const file = path.join(dir, "f.zip");
  writeFileSync(file, bytes);
  const run = (...args) => execFileSync("unzip", args, { maxBuffer: 64 * 1024 * 1024 });
  const api = {
    magic: Buffer.from(bytes.subarray(0, 4)).toString("hex"),
    test() { run("-tq", file); return true; },
    entries() { return run("-Z1", file).toString("utf8").split("\n").filter(Boolean); },
    read(entry) { return run("-p", file, entry).toString("utf8"); },
    close() { rmSync(dir, { recursive: true, force: true }); },
  };
  return api;
}

const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const textOf = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "g"))].map((m) => decode(m[1]));

export function docxText(zip) { return textOf(zip.read("word/document.xml"), "w:t").join(" "); }

export function pptxSlides(zip) {
  const names = zip.entries().filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  return names.map((n) => ({ name: n, text: textOf(zip.read(n), "a:t").join(" ") }));
}

export function pptxChartData(zip) {
  return zip.entries().filter((e) => /^ppt\/charts\/chart\d+\.xml$/.test(e)).map((n) => {
    const xml = zip.read(n);
    return { name: n, values: textOf(xml, "c:v").map(Number).filter((x) => !Number.isNaN(x)), labels: textOf(xml, "c:v").filter((x) => Number.isNaN(Number(x))) };
  });
}

export function docxHasCharts(zip) { return zip.entries().filter((e) => /^word\/(charts|media)\//.test(e)); }
