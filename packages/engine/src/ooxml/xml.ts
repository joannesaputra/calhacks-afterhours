import { officeText } from "../text";

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

export const encodeXml = (s: string): string =>
  officeText(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Structural well-formedness: balanced, correctly nested tags with one root. This is not a schema validator; it
 * catches the failures an edit can cause (an unclosed tag, a stray angle bracket) before a file is written.
 */
export function wellFormed(xml: string): { ok: true } | { ok: false; reason: string } {
  const stack: string[] = [];
  let roots = 0;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s>/!?]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let last = 0;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const between = xml.slice(last, m.index);
    if (/[<>]/.test(between.replace(/&[a-z#0-9]+;/gi, ""))) return { ok: false, reason: "stray angle bracket in text" };
    last = re.lastIndex;
    if (m[1] !== undefined) {
      if (stack.pop() !== m[1]) return { ok: false, reason: `unexpected closing tag </${m[1]}>` };
    } else if (m[2] !== undefined) {
      if (stack.length === 0) roots += 1;
      if (m[4] !== "/") stack.push(m[2]);
    }
  }
  if (/[<>]/.test(xml.slice(last))) return { ok: false, reason: "stray angle bracket after the last tag" };
  if (stack.length) return { ok: false, reason: `unclosed tag <${stack.at(-1)}>` };
  if (roots !== 1) return { ok: false, reason: `expected one root element, found ${roots}` };
  return { ok: true };
}
