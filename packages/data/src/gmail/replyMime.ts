import { randomBytes } from "node:crypto";

export interface ReplyAttachment { filename: string; mimeType: string; bytes: Uint8Array }

export interface ReplyMimeInput {
  from: string;
  to: string;
  subject: string;
  text: string;
  /** RFC 5322 Message-ID of the message being answered, when known. */
  inReplyTo: string | null;
  references: string | null;
  attachments: ReplyAttachment[];
}

/** Header values are single lines: strip every control character so a value can never start a new header. */
export const headerSafe = (v: string): string =>
  [...v].map((ch) => { const c = ch.codePointAt(0)!; return c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029 ? " " : ch; }).join("").replace(/\s{2,}/g, " ").trim();

const ADDRESS = /^[^\s@<>",;()[\]\\]+@[^\s@<>",;()[\]\\]+\.[^\s@<>",;()[\]\\]+$/;
export const isPlainAddress = (v: string): boolean => ADDRESS.test(v) && v.length <= 320;

/** RFC 2047 encoded-word for a header value that is not plain ASCII. */
function encodeHeader(v: string): string {
  const clean = headerSafe(v);
  return [...clean].every((ch) => ch.codePointAt(0)! >= 0x20 && ch.codePointAt(0)! <= 0x7e) ? clean : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

const wrap76 = (b64: string): string => b64.replace(/(.{76})/g, "$1\r\n");
const crlf = (t: string): string => t.replace(/\r\n|\r|\n/g, "\r\n");

/** A filename safe inside a quoted MIME parameter: no path parts, quotes, control characters or non-ASCII. */
export function attachmentName(name: string): string {
  const base = headerSafe(name).split(/[\\/]/).pop() ?? "file";
  return base.replace(/["\\;]/g, "_").replace(/[^\x20-\x7e]/g, "_").slice(0, 150) || "file";
}

/** "Re: subject", never stacking prefixes. */
export function replySubject(subject: string): string {
  const s = headerSafe(subject) || "(no subject)";
  return /^re\s*:/i.test(s) ? s : `Re: ${s}`;
}

/** Build the whole reply. To is always exactly one address, supplied by the caller from the original sender. */
export function buildReplyMime(input: ReplyMimeInput): Buffer {
  if (!isPlainAddress(input.to)) throw new Error("The recipient address is not valid.");
  if (!isPlainAddress(input.from)) throw new Error("The sending account address is not valid.");
  const boundary = `=_ah_${randomBytes(12).toString("hex")}`;
  const head = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${headerSafe(input.inReplyTo)}`] : []),
    ...(input.references ? [`References: ${headerSafe(input.references)}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts: string[] = [
    `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(Buffer.from(crlf(input.text), "utf8").toString("base64"))}\r\n`,
  ];
  for (const a of input.attachments) {
    const name = attachmentName(a.filename);
    parts.push(
      `--${boundary}\r\nContent-Type: ${headerSafe(a.mimeType)}; name="${name}"\r\nContent-Disposition: attachment; filename="${name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(Buffer.from(a.bytes).toString("base64"))}\r\n`,
    );
  }
  return Buffer.from(`${head.join("\r\n")}\r\n\r\n${parts.join("")}--${boundary}--\r\n`, "utf8");
}
