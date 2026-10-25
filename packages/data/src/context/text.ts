// Pure text helpers: quoted-history splitting, link ids, tokens. No database, no network.

const ATTRIBUTION = /^\s*On\s.+\swrote:\s*$/i;
const FWD = /^\s*(?:-{2,}\s*Forwarded message\s*-{2,}|Begin forwarded message:?)\s*$/i;
const ORIGINAL = /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i;

/** Number of lines (1 or 2) that make up a reply attribution at `i`, or 0. Gmail wraps long ones over two lines. */
function attributionLines(lines: string[], i: number): number {
  const line = lines[i] ?? "";
  if (ATTRIBUTION.test(line)) return 1;
  if (/^\s*On\s/.test(line) && !/wrote:\s*$/i.test(line) && /wrote:\s*$/i.test(lines[i + 1] ?? "")) return 2;
  return 0;
}

export interface SplitBody { fresh: string; quoted: string; forwarded: string }

/**
 * Separate what the sender newly wrote from quoted reply history and forwarded content. Instructions are taken from
 * `fresh` only, so a request that was already made earlier in the thread is not extracted a second time from the quote.
 */
export function splitBody(body: string): SplitBody {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const fresh: string[] = [];
  const quoted: string[] = [];
  const forwarded: string[] = [];
  let mode: "fresh" | "quoted" | "forwarded" = "fresh";
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (mode === "fresh") {
      const attr = attributionLines(lines, i);
      if (attr) { mode = "quoted"; i += attr - 1; continue; }
      if (FWD.test(line)) { mode = "forwarded"; continue; }
      if (ORIGINAL.test(line)) { mode = "quoted"; continue; }
      if (/^--\s?$/.test(line)) { mode = "quoted"; continue; } // signature
      if (/^From:\s.+/i.test(line) && lines.slice(i + 1, i + 5).some((l) => /^(Sent|Date):/i.test(l)) && lines.slice(i + 1, i + 6).some((l) => /^(To|Subject):/i.test(l))) { mode = "quoted"; continue; }
      if (/^\s*>/.test(line)) quoted.push(line.replace(/^\s*>+\s?/, ""));
      else fresh.push(line);
    } else if (mode === "quoted") quoted.push(line.replace(/^\s*>+\s?/, ""));
    else forwarded.push(line.replace(/^\s*>+\s?/, ""));
  }
  const join = (l: string[]) => l.join("\n").trim();
  return { fresh: join(fresh), quoted: join(quoted), forwarded: join(forwarded) };
}

export const newlyAuthoredText = (body: string): string => splitBody(body).fresh;

export function normalizeSubject(subject: string): string {
  let s = subject.trim().toLowerCase();
  for (let i = 0; i < 6; i += 1) {
    const next = s.replace(/^(?:re|fwd?|aw|sv)\s*:\s*/i, "");
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, " ").trim();
}

const GOOGLE_FILE = /https?:\/\/(?:docs\.google\.com\/(?:presentation|document|spreadsheets|file)\/d\/|drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=))([A-Za-z0-9_-]{10,})/g;

export interface LinkRef { provider: "drive"; fileRef: string }

/**
 * File identities named by supported provider links. Only the provider file id is returned: the URL itself (which can
 * carry a share token) is neither kept nor fetched.
 */
export function extractLinkRefs(text: string): LinkRef[] {
  const seen = new Set<string>();
  const out: LinkRef[] = [];
  for (const m of text.matchAll(GOOGLE_FILE)) {
    if (seen.has(m[1]!)) continue;
    seen.add(m[1]!);
    out.push({ provider: "drive", fileRef: m[1]! });
  }
  return out;
}

/** Drop query strings and fragments from URLs: they can carry share tokens and are never needed to understand a request. */
export const redactUrls = (text: string): string => text.replace(/(https?:\/\/[^\s?#<>"')]+)[?#][^\s<>"')]*/gi, "$1?…");

export function extractUrlHosts(text: string): string[] {
  return [...new Set([...text.matchAll(/https?:\/\/([^\s/<>"')]+)/gi)].map((m) => m[1]!.toLowerCase()))];
}

const STOP = new Set(("the and for are but not you your our with from this that have has had was were will would could should can may might about into over under after before between " +
  "please thanks thank hello hi hey regards best kind let know just also any all some more most than then them they their what when where which while who whom why how based discussed discuss " +
  "last week next this month today tomorrow yesterday revise update edit rework redo change changes presentation presentations deck decks slide slides pptx powerpoint document file attached attachment email mail sent send " +
  "need needs want like make made get got see look looking able there here been being does did done using use per via re fwd " +
  "revision revisions revised feedback comments comment notes note request requests follow followup quick question questions input thoughts changes review reviewing edits").split(/\s+/));

export function tokenize(text: string): string[] {
  return [...new Set(text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((t) => t.length >= 3 && !STOP.has(t)))];
}

export interface ProjectTerms { all: string[]; explicit: string[] }

/**
 * Terms that could name a project or client. `explicit` terms come from a capitalised name, a quoted phrase or "the X deck"
 * in the body; `all` adds the subject words. Only explicit terms can count against a candidate that lacks them: a
 * generic subject like "Quick revision" proves nothing about which project is meant.
 */
export function projectTerms(subject: string, freshText: string): ProjectTerms {
  const explicit = new Set<string>();
  for (const m of freshText.matchAll(/\bthe\s+([A-Za-z0-9&'][A-Za-z0-9&' -]{1,40}?)\s+(?:deck|presentation|slides?|proposal|pitch)\b/gi)) for (const t of tokenize(m[1]!)) explicit.add(t);
  for (const m of freshText.matchAll(/(?<![.!?]\s)(?<!^)\b([A-Z][A-Za-z0-9&']{2,}(?:\s+(?:&\s+)?[A-Z][A-Za-z0-9&']{2,}){0,3})\b/gm)) for (const t of tokenize(m[1]!)) explicit.add(t);
  for (const m of freshText.matchAll(/["“]([^"”]{3,60})["”]/g)) for (const t of tokenize(m[1]!)) explicit.add(t);
  const all = new Set<string>([...tokenize(normalizeSubject(subject)), ...explicit]);
  return { all: [...all], explicit: [...explicit] };
}

export function ftsQuery(terms: string[]): string | null {
  const parts = terms.map((t) => t.replace(/[^\p{L}\p{N}]+/gu, "")).filter((t) => t.length >= 2).slice(0, 24).map((t) => `"${t}"`);
  return parts.length ? parts.join(" OR ") : null;
}

export const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
