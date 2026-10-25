// Inspectable ranking of candidate source files. Every point comes from a named reason code, so the dashboard can say
// why a file was chosen. Recency alone is never a signal: the closest thing is temporal_fit against the interval the
// request itself describes.
import path from "node:path";
import type { RankWeights } from "./limits";
import { tokenize } from "./text";
import { inInterval, type TimeInterval } from "./temporal";

export type CandState = "ok" | "pending" | "unsupported" | "encrypted" | "oversized" | "failed" | "unavailable" | "deleted" | "forbidden" | "revoked";

export interface Cand {
  fileId: string; versionId: string; name: string; mime: string; provider: "gmail" | "folder" | "drive" | "task"; providerFileId: string;
  emailId: string | null; threadId: string | null; sentAt: string | null; modifiedAt: string | null; subject: string; fromAddr: string | null; participants: string[];
  mutable: boolean; viaFolder: boolean; isCurrentAttachment: boolean; checksum: string | null;
  state: CandState; stateDetail: string | null; textSample: string; title: string;
  signals: Map<string, number>; score: number; dominated: boolean;
}

export interface RankContext {
  requestFilenames: string[];
  /** lowercased subject and newly written text, used to notice a file named in words ("the Kickoff Deck") */
  requestText: string;
  linkRefs: Set<string>;
  currentThread: string | null;
  senderIdentities: Set<string>;
  projectTerms: string[];
  explicitProjectTerms: string[];
  interval: TimeInterval | null;
  feedbackThreads: Set<string>;
  feedbackFileRefs: Set<string>;
  confirmedFileIds: Set<string>;
  selectedVersionId: string | null;
  mentionsAttached: boolean;
}

const VERSION_NOISE = /\b(?:v\d+|ver\d+|version\s*\d+|final|draft|copy|revised|rev\d*|latest|new|updated|signed|clean|\d{4}-\d{2}-\d{2}|\d{6,8})\b|\(\d+\)/gi;

/** File name without extension, version markers and punctuation. "Kickoff Deck v2 FINAL.pptx" -> "kickoff deck". */
export function stemOf(filename: string): string {
  return path.basename(filename, path.extname(filename)).toLowerCase().replace(VERSION_NOISE, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export const isDeckFile = (c: Pick<Cand, "name" | "mime">): boolean => /\.(pptx|ppt|key|odp|pdf)$/i.test(c.name) || /presentation|powerpoint/i.test(c.mime);
const isPptx = (c: Pick<Cand, "name" | "mime">) => /\.pptx$/i.test(c.name) || /presentationml/i.test(c.mime);

export function scoreCandidate(c: Cand, rc: RankContext, w: RankWeights, interval: TimeInterval | null = rc.interval): Map<string, number> {
  const s = new Map<string, number>();
  const add = (code: keyof RankWeights) => s.set(code, w[code]);
  const stem = stemOf(c.name);
  if (rc.selectedVersionId === c.versionId) add("user_confirmation");
  if (rc.confirmedFileIds.has(c.fileId)) add("user_confirmation");
  if (stem && rc.requestFilenames.some((f) => stemOf(f) === stem)) add("explicit_file_reference");
  else if (stem.length >= 6 && rc.requestText.includes(stem)) add("explicit_file_reference");
  else if (c.isCurrentAttachment && rc.mentionsAttached) add("explicit_file_reference");
  if (rc.linkRefs.has(c.providerFileId)) add("link_file_id_match");
  if (c.isCurrentAttachment || (c.threadId && rc.currentThread && c.threadId === rc.currentThread)) add("thread_linkage");
  if (rc.projectTerms.length) {
    const tokens = new Set(tokenize(`${c.name} ${c.subject} ${c.textSample}`));
    if (rc.projectTerms.some((t) => tokens.has(t))) add("project_match");
    else if (c.textSample && rc.explicitProjectTerms.length) add("different_project"); // content was read and shares nothing with the project the request names
  }
  if ((c.fromAddr && rc.senderIdentities.has(c.fromAddr)) || c.participants.some((p) => rc.senderIdentities.has(p))) add("sender_relevance");
  const when = c.sentAt ?? c.modifiedAt;
  if (interval && when) add(inInterval(when, interval) ? "temporal_fit" : "outside_interval");
  if (isPptx(c)) add("file_type_match");
  if ((c.threadId && rc.feedbackThreads.has(c.threadId)) || rc.feedbackFileRefs.has(c.providerFileId)) add("documented_feedback");
  if (c.viaFolder) add("selected_folder_member");
  return s;
}

export const total = (signals: Map<string, number>): number => [...signals.values()].reduce((a, b) => a + b, 0);

export function lineageKey(c: Cand): string {
  return c.checksum ? `sum:${c.checksum}` : `${c.provider}:${c.provider === "gmail" || c.provider === "task" ? stemOf(c.name) : c.providerFileId}`;
}

/**
 * Collapse versions of the same document. A member that trails the best of its lineage by at least the decision margin
 * is superseded by it. Members that are close stay separate, so two equally plausible versions are put to the user
 * instead of one being picked by file name or date. The newest copy named "final" has no special standing.
 */
export function applyLineage(cands: Cand[], w: RankWeights, minMargin: number): void {
  const groups = new Map<string, Cand[]>();
  for (const c of cands) {
    c.dominated = false;
    const k = lineageKey(c);
    groups.set(k, [...(groups.get(k) ?? []), c]);
    // also group by stem across providers so a PDF export and the pptx it came from are one document
    const stem = `stem:${stemOf(c.name)}`;
    if (stemOf(c.name)) groups.set(stem, [...(groups.get(stem) ?? []), c]);
  }
  for (const members of groups.values()) {
    const uniq = [...new Map(members.map((m) => [m.versionId, m])).values()];
    if (uniq.length < 2) continue;
    const best = Math.max(...uniq.map((m) => m.score));
    const winners = uniq.filter((m) => m.score === best);
    for (const m of uniq) {
      if (m.score <= best - minMargin) m.dominated = true;
      else if (winners.length === 1 && !m.signals.has("version_lineage")) { m.signals.set("version_lineage", w.version_lineage); m.score += w.version_lineage; }
    }
  }
}

export interface Decision {
  kind: "target" | "ambiguous" | "none";
  target: Cand | null;
  options: Cand[];
  ranked: Cand[];
}

export function decide(cands: Cand[], minTargetScore: number, minMargin: number): Decision {
  const ranked = [...cands].filter((c) => !c.dominated).sort((a, b) => b.score - a.score || (b.sentAt ?? "").localeCompare(a.sentAt ?? ""));
  const viable = ranked.filter((c) => c.score >= minTargetScore);
  if (!viable.length) return { kind: "none", target: null, options: ranked.slice(0, 4), ranked };
  const top = viable[0]!;
  const close = viable.slice(1).filter((c) => top.score - c.score < minMargin);
  if (close.length) return { kind: "ambiguous", target: null, options: [top, ...close].slice(0, 4), ranked };
  return { kind: "target", target: top, options: [top], ranked };
}
