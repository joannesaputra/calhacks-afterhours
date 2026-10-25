// The deterministic retrieval pipeline: parse, read the thread, search prior exchanges, expand by concrete links, resolve
// source files, rank, check completeness, and build the bundle. It reads only what the user's grants allow, calls no
// model, and records every decision in a retrieval run so a restart or a correction can reuse still-valid work.
import { DateTime } from "luxon";
import type {
  ContextBundle, ContextFile, ContextRequirement, ContextSource, EmailEnvelope, Uncertainty, RetrievalFailureClass,
  RetrievalSummary, SourceDocument, TemporalInterpretation, WorkAnswer, WorkPlan, WorkQuestion,
} from "@afterhours/contracts";
import type { Db } from "../db";
import { iso, newId, parseJson } from "../util";
import { activeGrants, emailCutoff, findAccount, getAccount, selectedOf, type AccountRow } from "./accounts";
import { auditContext } from "./audit";
import { sha256 } from "./blobs";
import type { Extractor } from "./extractTypes";
import {
  chunksOf, ensureExtracted, getVersion, invalidateVersion, loadVersionBytes, markFileState, registerFile, registerVersion, scopeDecision, storeVersionBytes,
  type FileVersionRow, type ProviderEntry, type ProviderRegistry, type SourceFileRow,
} from "./files";
import { Budget, DEFAULT_LIMITS, DEFAULT_THRESHOLDS, type ContextLimits, type Thresholds } from "./limits";
import { emailsInvolving, emailsLinkingFile, identityAddresses, threadEmails, viewEmail, type EmailRow, type EmailView } from "./mail";
import { ProviderError } from "./mailProvider";
import { recordInferredAssociations } from "./projects";
import { checkAccess } from "./access";
import { applyLineage, decide, isDeckFile, scoreCandidate, stemOf, total, type Cand, type CandState, type RankContext } from "./rank";
import { parseRequest, type ParsedRequest } from "./request";
import { extractRequirements, markConflicts, requirementId } from "./requirements";
import {
  beginRun, bundleOf, finishRun, getRun, priorRun, resolveOverrides, saveRequirements, writeRunSources, type ResolvedOverrides, type RunOutcome, type RunRow, type RunSourceInput,
} from "./run";
import { searchEmails } from "./search";
import { coverageOf } from "./sync";
import { interpretPhrase, type Interpretation, type PhraseInterpretation, type TimeInterval } from "./temporal";
import { clip, redactUrls, splitBody, tokenize } from "./text";
import { OWNER_ID } from "./types";

export interface ContextDeps {
  artifactsDir: string;
  extract: Extractor;
  parserVersion: string;
  providers: ProviderRegistry;
  limits?: Partial<ContextLimits>;
  thresholds?: Partial<Thresholds>;
  clock?: () => number;
}

export interface ResolveArgs {
  db: Db;
  ownerId?: string;
  taskId: string;
  revision: number;
  now: Date;
  envelope: EmailEnvelope;
  attachments: Array<{ id: string; filename: string; mimeType: string; bytes: Uint8Array }>;
  timezone: string;
  answers: WorkAnswer[];
  /** False for demo/fixture mail: its sender is fictional and must not be matched against the real mailbox. */
  useAccount: boolean;
  signal?: AbortSignal;
}

export type ResolveOutcome =
  | { kind: "not_applicable" }
  | { kind: "resolved"; runId: string; bundle: ContextBundle; files: ContextFile[] }
  | { kind: "needs_input"; runId: string; failure: RetrievalFailureClass; plan: WorkPlan; questions: WorkQuestion[]; sources: SourceDocument[]; warnings: string[] };

/** A provider hiccup (timeout, rate limit, 5xx). The job is retried by the normal lease/retry policy. */
export class ContextRetryableError extends Error {
  readonly code = "CONTEXT_PROVIDER_TEMPORARY";
  readonly retryable = true;
  constructor(message: string) { super(message); this.name = "ContextRetryableError"; }
}
/** A failure retrying will not fix (credentials rejected, access revoked). */
export class ContextAccessError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string) { super(message); this.name = "ContextAccessError"; }
}

type Role = "request" | "feedback" | "deck_message" | "related";
interface Evidence {
  id: string; providerMessageId: string; threadId: string | null; subject: string; from: string; to: string[]; cc: string[]; date: string;
  direction: "inbound" | "outbound"; newText: string; bodyText: string; forwardedText: string; isCurrent: boolean;
  roles: Set<Role>; reasons: Set<string>; flagged: number; sourceId: string;
}

const day = (iso: string, tz: string) => DateTime.fromISO(iso, { setZone: true }).setZone(tz).toFormat("LLLL d");
const displayName = (c: Cand) => (c.title && c.title.length <= 60 ? c.title : stemOf(c.name) || c.name);
const FAILURE_TEXT: Record<string, string> = { time: "the time limit", queries: "the search limit", messages: "the message limit", files: "the file limit", bytes: "the size limit", units: "the page/slide limit" };

export async function resolveContext(deps: ContextDeps, args: ResolveArgs): Promise<ResolveOutcome> {
  const { db, taskId, revision, now, envelope } = args;
  const ownerId = args.ownerId ?? OWNER_ID;
  const parsed = parseRequest(envelope);
  if (!parsed.inferred.applicable) return { kind: "not_applicable" };

  const limits: ContextLimits = { ...DEFAULT_LIMITS, ...deps.limits };
  const th: Thresholds = { ...DEFAULT_THRESHOLDS, ...deps.thresholds, weights: { ...DEFAULT_THRESHOLDS.weights, ...deps.thresholds?.weights } };
  const budget = new Budget(limits, deps.clock, args.signal);
  const overrides = resolveOverrides(db, taskId, revision, args.answers);
  const account: AccountRow | null = args.useAccount ? findAccount(db, ownerId, "gmail") : null;
  const accountId = account?.id ?? "";
  // Resume: a completed run for this exact revision (a crash or retry after retrieval) is reused if everything it
  // used is still readable and unchanged. Nothing is searched or fetched again.
  const resumed = await tryResume(deps, db, ownerId, taskId, revision, now);
  if (resumed) return resumed;
  const run = beginRun(db, ownerId, taskId, revision, accountId, now);
  const t0 = deps.clock ? deps.clock() : Date.now();
  const stages: RetrievalSummary["stages"] = [];
  const notes: string[] = [];
  const failures: { cls: RetrievalFailureClass; detail: string }[] = [];

  try {
    const cutoff = account ? emailCutoff(db, ownerId, accountId, now) : null;
    const coverage = account && cutoff ? coverageOf(db, ownerId, accountId, now) : null;
    const historyStatus: RetrievalSummary["coverage"]["emailHistory"] =
      !account ? "not_authorized" : !cutoff ? "not_authorized" : account.state === "disconnected" || account.state === "error" ? "unavailable" : coverage?.complete ? "complete" : "partial";
    if (historyStatus === "not_authorized") notes.push("Email history is not authorized, so only this email and its attachments were used.");
    else if (coverage && !coverage.complete) notes.push(coverage.note);
    if (account?.state === "error") notes.push(`The mailbox reported a problem: ${account.last_error ?? "unknown"}.`);
    const scope = { ownerId, accountId, cutoff, until: envelope.receivedAt };

    // ---- A. request ----
    const sender = envelope.from.email.toLowerCase();
    const identities = new Set(account ? identityAddresses(db, ownerId, sender) : [sender]);
    const terms = parsed.inferred.projectTerms;
    const phrase = parsed.evidence.datePhrases.map((p) => interpretPhrase(p, envelope.receivedAt, args.timezone)).find((x): x is PhraseInterpretation => !!x) ?? null;
    let interval: Interpretation | null = phrase?.primary ?? null;
    if (phrase && overrides.intervalChoice) interval = [phrase.primary, ...phrase.alternatives].find((i) => i.id === overrides.intervalChoice) ?? interval;
    stages.push({ stage: "parse", queries: 0, found: parsed.evidence.editLines.length, note: `action ${parsed.inferred.action}, deliverable ${parsed.inferred.deliverable}${phrase ? `, "${phrase.phrase}"` : ""}` });

    // ---- B-E. gather (or reuse) ----
    const prior = priorRun(db, taskId, revision);
    const evidence = new Map<string, Evidence>();
    const cands = new Map<string, Cand>();
    let reusedFrom: number | null = null;

    const addEvidence = (e: EmailView, role: Role, reason: string): Evidence => {
      let ev = evidence.get(e.id);
      if (!ev) {
        const fwd = splitBody(e.body_text);
        ev = { id: e.id, providerMessageId: e.provider_message_id, threadId: e.provider_thread_id, subject: e.subject, from: e.from_address, to: e.to, cc: e.cc, date: e.received_at,
          direction: e.direction, newText: redactUrls(e.new_text), bodyText: redactUrls(e.body_text), forwardedText: redactUrls(fwd.forwarded), isCurrent: false, roles: new Set(), reasons: new Set(), flagged: 0, sourceId: `src-email-${e.id.slice(0, 8)}` };
        evidence.set(e.id, ev);
      }
      ev.roles.add(role); ev.reasons.add(reason);
      return ev;
    };
    const current: Evidence = {
      id: `current-${taskId}`, providerMessageId: envelope.providerMessageId, threadId: envelope.providerThreadId, subject: envelope.subject, from: sender, to: envelope.to.map((x) => x.toLowerCase()), cc: [],
      date: envelope.receivedAt, direction: "inbound", newText: redactUrls(parsed.evidence.freshText), bodyText: redactUrls(envelope.bodyText), forwardedText: redactUrls(parsed.evidence.forwardedText), isCurrent: true,
      roles: new Set<Role>(["request"]), reasons: new Set(["the_request"]), flagged: parsed.evidence.injectionFlagged, sourceId: "src-request",
    };

    const candOf = (v: FileVersionRow, f: SourceFileRow): Cand => {
      const email = f.parent_email_id ? (db.prepare("SELECT * FROM emails WHERE id=? AND owner_id=?").get(f.parent_email_id, ownerId) as EmailRow | undefined) : undefined;
      const ev = email ? viewEmail(email) : null;
      const cur = f.provider === "task";
      return {
        fileId: f.id, versionId: v.id, name: f.name, mime: f.mime_type, provider: f.provider, providerFileId: f.provider_file_id,
        emailId: email?.id ?? null, threadId: cur ? current.threadId : email?.provider_thread_id ?? null, sentAt: cur ? envelope.receivedAt : v.sent_at ?? email?.received_at ?? null, modifiedAt: v.modified_at,
        subject: cur ? envelope.subject : email?.subject ?? "", fromAddr: cur ? sender : email?.from_address ?? null, participants: ev ? [ev.from_address, ...ev.to, ...ev.cc] : cur ? [sender, ...current.to] : [],
        mutable: f.mutable === 1, viaFolder: f.kind === "folder_file", isCurrentAttachment: cur, checksum: v.checksum_sha256,
        state: stateOfVersion(v, f), stateDetail: v.extraction_detail, textSample: "", title: "", signals: new Map(), score: 0, dominated: false,
      };
    };

    const registerCandidatesOfEmail = (emailId: string) => {
      for (const f of db.prepare("SELECT * FROM source_files WHERE owner_id=? AND parent_email_id=? AND state='active'").all(ownerId, emailId) as SourceFileRow[]) {
        if (overrides.excludeFiles.has(f.id)) continue;
        const v = db.prepare("SELECT * FROM file_versions WHERE file_id=? AND invalidated_at IS NULL ORDER BY discovered_at DESC LIMIT 1").get(f.id) as FileVersionRow | undefined;
        if (!v) continue;
        const c = candOf(v, f);
        if (isDeckFile(c) && !cands.has(c.versionId)) cands.set(c.versionId, c);
      }
    };

    // current attachments are always part of the request itself
    for (const a of args.attachments) {
      const f = registerFile(db, { ownerId, accountId: "", provider: "task", providerFileId: `${taskId}#${a.id}`, kind: "attachment", name: a.filename, mimeType: a.mimeType }, now);
      const sum = sha256(a.bytes);
      const v = registerVersion(db, { ownerId, fileId: f.id, versionKey: sum, snapshotKind: "attachment_snapshot", sha256: sum, sizeBytes: a.bytes.byteLength, sentAt: envelope.receivedAt }, now);
      if (!v.blob_rel_path) storeVersionBytes(db, deps.artifactsDir, ownerId, v.id, a.bytes);
      const c = candOf(getVersion(db, ownerId, v.id)!, f);
      if (isDeckFile(c) && !overrides.excludeFiles.has(f.id)) cands.set(c.versionId, c);
    }

    const reusable = prior ? tryReuse(db, ownerId, prior, now, overrides) : null;
    if (reusable) {
      reusedFrom = prior!.revision;
      for (const id of reusable.emailIds) { const e = db.prepare("SELECT * FROM emails WHERE id=? AND owner_id=?").get(id, ownerId) as EmailRow | undefined; if (e && !overrides.excludeEmails.has(id)) addEvidence(viewEmail(e), "related", "reused"); }
      for (const vid of reusable.versionIds) { const v = getVersion(db, ownerId, vid); if (v && !overrides.excludeFiles.has(v.file_id)) { const c = candOf(v, v.file); if (!cands.has(c.versionId)) cands.set(c.versionId, c); } }
      stages.push({ stage: "reuse", queries: 0, found: evidence.size + cands.size, note: `reused still-valid retrieval from revision ${prior!.revision}` });
    } else {
      // B. current thread
      if (account && cutoff && envelope.providerThreadId && budget.take("queries")) {
        const thread = threadEmails(db, scope, envelope.providerThreadId, 50).filter((e) => e.provider_message_id !== envelope.providerMessageId && !overrides.excludeEmails.has(e.id));
        thread.forEach((e) => { budget.take("messages"); addEvidence(e, "related", "same_thread"); registerCandidatesOfEmail(e.id); });
        stages.push({ stage: "thread", queries: 1, found: thread.length, note: "messages in the current thread" });
      }
      // C. prior exchanges with this person
      if (account && cutoff && !budget.timeUp()) {
        const wins = [phrase?.primary, ...(phrase?.alternatives ?? [])].filter(Boolean) as Interpretation[];
        const winStart = wins.length ? new Date(Math.min(...wins.map((w) => Date.parse(w.interval.start))) - 21 * 86_400_000).toISOString() : cutoff;
        if (budget.take("queries")) {
          const addrs = [...identities];
          const hist = emailsInvolving(db, scope, addrs, { from: winStart }, 60).filter((e) => e.provider_message_id !== envelope.providerMessageId && !overrides.excludeEmails.has(e.id));
          for (const e of hist) { if (!budget.take("messages")) break; addEvidence(e, "related", "sender_history"); registerCandidatesOfEmail(e.id); }
          stages.push({ stage: "sender_history", queries: 1, found: hist.length, note: `mail with ${addrs.length} verified address${addrs.length === 1 ? "" : "es"}` });
        }
        if (terms.length && budget.take("queries")) {
          const hits = searchEmails(db, scope, terms, 30, { scanCap: limits.scanCap });
          let added = 0;
          for (const h of hits.hits) {
            const row = db.prepare("SELECT * FROM emails WHERE id=? AND owner_id=?").get(h.id, ownerId) as EmailRow | undefined;
            if (!row || overrides.excludeEmails.has(row.id)) continue;
            const e = viewEmail(row);
            const involvesSender = [e.from_address, ...e.to, ...e.cc].some((a) => identities.has(a));
            if (!involvesSender || evidence.has(e.id)) continue;
            if (!budget.take("messages")) break;
            addEvidence(e, "related", "project_terms"); registerCandidatesOfEmail(e.id); added += 1;
          }
          if (hits.capped) { budget.hit.add("scan"); notes.push("The history search was capped before every message was scanned (no full-text index available)."); }
          stages.push({ stage: "project_search", queries: 1, found: added, note: `${hits.backend} search for the project terms` });
        }
      }
      // links named in the request or the messages: file id, never the URL
      const linkRefs = new Set(parsed.evidence.linkRefs.map((l) => l.fileRef));
      for (const ev of evidence.values()) {
        for (const l of (db.prepare("SELECT file_ref FROM email_links WHERE email_id=?").all(ev.id) as Array<{ file_ref: string }>)) linkRefs.add(l.file_ref);
      }
      let linked = 0;
      for (const ref of [...linkRefs].slice(0, 8)) {
        if (!budget.timeUp() && account && cutoff && budget.take("queries")) {
          // D. concrete link: other threads that name the same file id (feedback from other participants)
          for (const e of emailsLinkingFile(db, scope, "drive", ref, 20)) {
            if (overrides.excludeEmails.has(e.id) || evidence.has(e.id) || !budget.take("messages")) continue;
            addEvidence(e, "related", "link_file_id_match"); registerCandidatesOfEmail(e.id); linked += 1;
          }
        }
        const c = await resolveLink(ref);
        if (c) { c.signals.set("link_file_id_match", th.weights.link_file_id_match); cands.set(c.versionId, c); }
      }
      if (linkRefs.size) stages.push({ stage: "related_links", queries: Math.min(linkRefs.size, 8), found: linked, note: "other messages that name the same file" });
      // confirmed associations from earlier corrections
      if (account && terms.length) {
        for (const row of confirmedFiles(db, ownerId, terms)) {
          const f = db.prepare("SELECT * FROM source_files WHERE id=? AND owner_id=? AND state='active'").get(row, ownerId) as SourceFileRow | undefined;
          if (!f || overrides.excludeFiles.has(f.id)) continue;
          const v = db.prepare("SELECT * FROM file_versions WHERE file_id=? AND invalidated_at IS NULL ORDER BY discovered_at DESC LIMIT 1").get(f.id) as FileVersionRow | undefined;
          if (v && !cands.has(v.id)) cands.set(v.id, candOf(v, f));
        }
      }
      // E. selected folders
      await gatherFolderFiles();
    }

    async function resolveLink(ref: string): Promise<Cand | null> {
      const provider = deps.providers.files.drive;
      const driveAccount = findAccount(db, ownerId, "drive");
      if (!provider || !provider.available || !driveAccount) {
        failures.push({ cls: "unavailable_source", detail: "A linked file could not be opened: Google Drive is not connected. Attach the file instead." });
        return null;
      }
      const grants = activeGrants(db, ownerId, driveAccount.id, "files", now);
      if (!grants.length) { failures.push({ cls: "not_authorized", detail: "A linked file is outside what you have shared: no file access is granted for it." }); return null; }
      let decision = null as Awaited<ReturnType<typeof scopeDecision>> | null;
      for (const g of grants) { const d = await scopeDecision(provider, ref, selectedOf(g)); if (d.ok) { decision = d; break; } decision ??= d; }
      if (!decision || !decision.ok) { failures.push({ cls: "not_authorized", detail: "A linked file is outside the files you chose to share." }); auditContext(db, ownerId, "retrieval.denied", { type: "task", id: taskId }, { reason: decision && !decision.ok ? decision.reason : "unknown" }, now); return null; }
      return await registerProviderEntry(provider, driveAccount, ref, "linked");
    }

    async function registerProviderEntry(provider: NonNullable<ContextDeps["providers"]["files"]["drive"]>, acct: AccountRow, id: string, kind: "linked" | "folder_file"): Promise<Cand | null> {
      const st = await provider.stat(id);
      if ("missing" in st) { failures.push({ cls: st.reason === "temporary" ? "provider_temporary_failure" : "unavailable_source", detail: st.message }); return null; }
      const target = st.shortcutTargetId ? await provider.stat(st.shortcutTargetId) : st;
      if ("missing" in target) { failures.push({ cls: "unavailable_source", detail: target.message }); return null; }
      if (target.isFolder) return null;
      const f = registerFile(db, { ownerId, accountId: acct.id, provider: provider.id, providerFileId: target.id, kind, name: target.name, mimeType: target.mimeType, mutable: target.mutable }, now);
      const v = registerVersion(db, { ownerId, fileId: f.id, versionKey: target.versionKey ?? `mtime:${target.modifiedAt}`, snapshotKind: provider.id === "folder" ? "local_file" : "provider_revision", sizeBytes: target.sizeBytes ?? 0, modifiedAt: target.modifiedAt }, now);
      const c = candOf(v, f);
      c.viaFolder = kind === "folder_file";
      return isDeckFile(c) ? c : null;
    }

    async function gatherFolderFiles(): Promise<void> {
      for (const acct of (db.prepare("SELECT * FROM connected_accounts WHERE owner_id=? AND provider IN ('folder','drive')").all(ownerId) as AccountRow[])) {
        const grants = activeGrants(db, ownerId, acct.id, "files", now);
        if (!grants.length) continue;
        const provider = deps.providers.files[acct.provider as "folder" | "drive"];
        if (!provider || !provider.available) { failures.push({ cls: "unavailable_source", detail: provider?.limitation ?? "The file source is not available." }); continue; }
        let seen = 0;
        for (const g of grants) {
          for (const item of selectedOf(g)) {
            const queue: Array<{ id: string; depth: number }> = [{ id: item.providerId, depth: 0 }];
            while (queue.length && seen < 200) {
              const cur = queue.shift()!;
              if (item.kind === "file") {
                if (budget.take("queries")) { const c = await registerProviderEntry(provider, acct, cur.id, "folder_file"); if (c && !overrides.excludeFiles.has(c.fileId)) cands.set(c.versionId, c); }
                break;
              }
              if (!budget.take("queries")) break;
              const page = await provider.list(cur.id, { pageToken: null, limit: 100 });
              if ("missing" in page) { failures.push({ cls: page.reason === "temporary" ? "provider_temporary_failure" : "unavailable_source", detail: page.message }); continue; }
              for (const e of page.entries) {
                seen += 1;
                const real: ProviderEntry | null = e.shortcutTargetId ? await resolveShortcut(provider, e, selectedOf(g)) : e;
                if (!real) continue;
                if (real.isFolder) { if (cur.depth < 3) queue.push({ id: real.id, depth: cur.depth + 1 }); continue; }
                const c = await registerProviderEntry(provider, acct, real.id, "folder_file");
                if (c && !overrides.excludeFiles.has(c.fileId)) cands.set(c.versionId, c);
              }
            }
          }
        }
        stages.push({ stage: "folders", queries: 0, found: seen, note: `entries seen in selected ${acct.provider === "folder" ? "folders" : "Drive items"}` });
      }
    }

    async function resolveShortcut(provider: NonNullable<ContextDeps["providers"]["files"]["drive"]>, e: ProviderEntry, selected: ReturnType<typeof selectedOf>): Promise<ProviderEntry | null> {
      const d = await scopeDecision(provider, e.id, selected);
      if (!d.ok) { auditContext(db, ownerId, "retrieval.denied", { type: "task", id: taskId }, { reason: d.reason }, now); return null; }
      const t = await provider.stat(e.shortcutTargetId!);
      return "missing" in t ? null : t;
    }

    // ---- F. rank ----
    const tzDay = (d: string | null) => (d ? day(d, args.timezone) : "an unknown date");
    const feedbackProbe = (ev: Evidence) => extractRequirements(ev.newText, {}).requirements.length > 0;
    const feedbackThreads = new Set<string>();
    for (const ev of evidence.values()) if (ev.threadId && feedbackProbe(ev)) feedbackThreads.add(ev.threadId);
    const linkRefSet = new Set<string>(parsed.evidence.linkRefs.map((l) => l.fileRef));
    const feedbackFileRefs = new Set<string>();
    for (const ev of evidence.values()) if (feedbackProbe(ev)) for (const l of db.prepare("SELECT file_ref FROM email_links WHERE email_id=?").all(ev.id) as Array<{ file_ref: string }>) feedbackFileRefs.add(l.file_ref);
    const answerText = overrides.selectedAnswer;
    const selectedVersionId = overrides.selectedVersionId ?? (answerText ? matchAnswer(answerText, [...cands.values()]) : null);
    const rc: RankContext = {
      requestFilenames: parsed.evidence.filenames, requestText: `${envelope.subject}\n${parsed.evidence.freshText}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " "), linkRefs: linkRefSet, currentThread: envelope.providerThreadId, senderIdentities: identities, projectTerms: terms, explicitProjectTerms: parsed.inferred.explicitProjectTerms,
      interval: interval?.interval ?? null, feedbackThreads, feedbackFileRefs, confirmedFileIds: new Set(), selectedVersionId,
      mentionsAttached: /\b(?:attached|attachment|enclosed|here(?:'s| is)\s+the)\b/i.test(`${envelope.subject}\n${parsed.evidence.freshText}`),
    };
    const rescore = (iv: TimeInterval | null = rc.interval) => {
      for (const c of cands.values()) { c.signals = scoreCandidate(c, rc, th.weights, iv); c.score = total(c.signals); }
      applyLineage([...cands.values()], th.weights, th.minMargin);
    };
    for (const c of cands.values()) if (confirmedFile(db, ownerId, c.fileId, terms)) rc.confirmedFileIds.add(c.fileId);
    rescore();

    // read plausible candidates (metadata-first): fetch and parse only the strongest few
    const parseOrder = [...cands.values()].filter((c) => c.score > 0 || cands.size <= 3).sort((a, b) => b.score - a.score);
    let acquired = 0;
    for (const c of parseOrder) {
      if (budget.timeUp()) break;
      const ok = await acquireAndParse(c);
      if (ok) acquired += 1;
    }
    stages.push({ stage: "files", queries: 0, found: acquired, note: `${budget.filesParsed} parsed, ${budget.cacheHits} from cache` });
    rescore();

    // ---- G. decide ----
    let decision = decide([...cands.values()], th.minTargetScore, th.minMargin);
    // an interpretation of the date phrase that would pick a different deck is a real ambiguity
    let intervalAmbiguity: Cand[] = [];
    if (decision.kind === "target" && phrase && phrase.alternatives.length && !overrides.intervalChoice && !selectedVersionId) {
      const winners = new Map<string, Cand>([[decision.target!.versionId, decision.target!]]);
      for (const alt of phrase.alternatives) {
        const saved = new Map([...cands.values()].map((c) => [c.versionId, { signals: c.signals, score: c.score, dominated: c.dominated }]));
        rescore(alt.interval);
        const d = decide([...cands.values()], th.minTargetScore, th.minMargin);
        if (d.kind === "target") winners.set(d.target!.versionId, d.target!);
        else if (d.kind === "ambiguous") d.options.forEach((o) => winners.set(o.versionId, o));
        for (const c of cands.values()) { const s = saved.get(c.versionId)!; c.signals = s.signals; c.score = s.score; c.dominated = s.dominated; }
      }
      if (winners.size > 1) { intervalAmbiguity = [...winners.values()]; decision = { kind: "ambiguous", target: null, options: intervalAmbiguity, ranked: decision.ranked }; }
    }
    const historyIncomplete = historyStatus === "partial" || historyStatus === "unavailable";
    const limitsHit = [...budget.hit];
    const buildSummary = (failure: RetrievalFailureClass, detail: string | null): RetrievalSummary => ({
      stages, coverage: { emailHistory: historyStatus, files: filesStatus(db, ownerId, deps), notes }, limitsReached: limitsHit.map((l) => FAILURE_TEXT[l] ?? l), failure, failureDetail: detail,
    });

    const questionsOut = (failure: RetrievalFailureClass, outcome: RunOutcome, questions: WorkQuestion[], detail: string): ResolveOutcome => {
      const plan = makePlan(parsed, envelope, questions);
      const sources = [requestSource(current)];
      persistRun(outcome, questions, null, null, [], buildSummary(failure, detail), []);
      return { kind: "needs_input", runId: run.id, failure, plan, questions, sources, warnings: failures.map((f) => f.detail) };
    };

    const persistRun = (outcome: RunOutcome, questions: WorkQuestion[], bundle: ContextBundle | null, target: Cand | null, reqs: ContextRequirement[], summary: RetrievalSummary, uncertainties: Uncertainty[]) => {
      const rows: RunSourceInput[] = [{ type: "email", id: current.id, role: "request" }];
      for (const ev of evidence.values()) rows.push({ type: "email", id: ev.id, role: ev.roles.has("feedback") ? "feedback" : ev.roles.has("deck_message") ? "deck_message" : "related", reasons: [...ev.reasons], selected: ev.roles.has("feedback") || ev.roles.has("deck_message") });
      for (const c of cands.values()) rows.push({ type: "file_version", id: c.versionId, role: target?.versionId === c.versionId ? "target" : "candidate", score: c.score, reasons: [...c.signals.keys()], versionKey: getVersion(db, ownerId, c.versionId)?.version_key ?? null, sha256: c.checksum, selected: target?.versionId === c.versionId });
      writeRunSources(db, run.id, rows.filter((r) => r.type === "file_version" || !r.id.startsWith("current-")));
      saveRequirements(db, taskId, revision, reqs);
      finishRun(db, run.id, {
        status: "complete", outcome, request_json: { evidence: { ...parsed.evidence, freshText: clip(parsed.evidence.freshText, 600), forwardedText: "" }, inferred: parsed.inferred },
        temporal_json: phrase ? { phrase, chosen: interval?.id ?? null } : null, stages_json: stages, coverage_json: summary.coverage, limits_json: limits, limits_hit_json: limitsHit,
        candidates_json: [...cands.values()].map((c) => ({ versionId: c.versionId, fileId: c.fileId, name: c.name, score: c.score, reasons: [...c.signals.keys()], state: c.state, sentAt: c.sentAt, dominated: c.dominated })),
        decision_json: { kind: decision.kind, target: target?.versionId ?? null, options: decision.options.map((o) => o.versionId), failure: summary.failure, failureDetail: summary.failureDetail },
        requirements_json: reqs, uncertainties_json: uncertainties, questions_json: questions, bundle_json: bundle,
        metrics_json: { latencyMs: (deps.clock ? deps.clock() : Date.now()) - t0, queries: budget.counters.queries, messagesLoaded: budget.counters.messages, filesFetched: budget.counters.files, filesParsed: budget.filesParsed, cacheHits: budget.cacheHits, bytesRead: budget.counters.bytes, unitsRead: budget.counters.units, modelTokens: 0, modelCostUsd: 0, reused: reusedFrom !== null },
        reused_from_revision: reusedFrom,
      }, deps.clock ? new Date(deps.clock()) : now);
    };

    // provider failures noticed during gathering decide before anything else
    const temporary = failures.find((f) => f.cls === "provider_temporary_failure");
    if (temporary && decision.kind !== "target") throw new ContextRetryableError(temporary.detail);

    if (decision.kind === "none" && !selectedVersionId) {
      const noAccess = historyStatus === "not_authorized" && filesStatus(db, ownerId, deps) !== "searched";
      const cls: RetrievalFailureClass = failures.find((f) => f.cls === "unavailable_source" || f.cls === "not_authorized")?.cls
        ?? (noAccess ? "not_authorized" : limitsHit.length ? "budget_limited" : historyIncomplete ? "incomplete_sync" : "no_match");
      if (decision.options.length === 0 || decision.options.every((o) => o.score < th.minTargetScore / 2)) {
        const why = cls === "no_match" ? "I could not find a presentation in the sources you have authorized."
          : cls === "not_authorized" ? "I could not find a presentation in this email, and I have no access to email history or files."
          : cls === "budget_limited" ? `I stopped searching after reaching ${limitsHit.map((l) => FAILURE_TEXT[l] ?? l).join(" and ")}, so a match may exist that I did not reach.`
          : cls === "incomplete_sync" ? `I could not find a presentation, but your email history is not fully read yet (${coverage?.note ?? "history is incomplete"}), so one may exist.`
          : failures[0]!.detail;
        const q: WorkQuestion = { id: "context_target", question: `${why} Please attach the presentation to a new email, or choose a folder that contains it.`, reason: [...notes, ...failures.map((f) => f.detail)].join(" ") || "No candidate file matched.", required: true };
        return questionsOut(cls, cls === "no_match" ? "no_match" : cls === "budget_limited" || cls === "incomplete_sync" || cls === "not_authorized" ? "incomplete" : "unavailable", [q], why);
      }
      // weak candidates only: let the user choose rather than guess
      decision = { ...decision, kind: "ambiguous", options: decision.options.slice(0, 4) };
    }

    if (decision.kind === "ambiguous" && !selectedVersionId) {
      const opts = [...decision.options].sort((a, b) => (a.sentAt ?? a.modifiedAt ?? "").localeCompare(b.sentAt ?? b.modifiedAt ?? ""));
      const q: WorkQuestion = {
        id: "context_target",
        question: opts.length === 1
          ? `I found ${opts[0]!.name} (${tzDay(opts[0]!.sentAt ?? opts[0]!.modifiedAt)}), but I am not sure it is the presentation you mean. Should I revise it?`
          : `Which presentation should I revise: ${opts.map((o) => `the ${tzDay(o.sentAt ?? o.modifiedAt)} ${displayName(o)}`).join(" or ")}?`,
        reason: intervalAmbiguity.length && phrase ? `"${phrase.phrase}" can mean ${[phrase.primary, ...phrase.alternatives].map((i) => i.label).join(" or ")}, and they point to different presentations.` : "More than one presentation fits the request about equally well.",
        required: true,
        options: opts.map((o) => ({ id: o.versionId, label: `${o.name} (${tzDay(o.sentAt ?? o.modifiedAt)})`, detail: `${o.subject ? `Subject "${o.subject}". ` : ""}${[...o.signals.keys()].join(", ") || "weak match"}.` })),
      };
      return questionsOut("ambiguous_match", "ambiguous", [q], "Several presentations fit.");
    }

    const target = selectedVersionId ? ([...cands.values()].find((c) => c.versionId === selectedVersionId) ?? await loadSelected(selectedVersionId)) : decision.target!;
    if (!target) return questionsOut("no_match", "no_match", [{ id: "context_target", question: "The presentation you selected is no longer available. Please attach it to a new email.", reason: "The selected file could not be found.", required: true }], "Selected file missing.");
    if (selectedVersionId && !target.signals.has("user_confirmation")) { target.signals.set("user_confirmation", th.weights.user_confirmation); target.score += th.weights.user_confirmation; }
    if (target.state === "pending") await acquireAndParse(target);
    if (target.state === "deleted" || target.state === "forbidden" || target.state === "revoked" || target.state === "unavailable") {
      const detail = target.stateDetail ?? "The presentation could not be opened.";
      const cls: RetrievalFailureClass = target.state === "revoked" || target.state === "forbidden" ? "access_revoked" : "unavailable_source";
      return questionsOut(cls, cls === "access_revoked" ? "access_revoked" : "unavailable", [{ id: "context_target", question: `I found ${target.name} but cannot open it: ${detail} Please attach a copy to a new email.`, reason: detail, required: true }], detail);
    }
    if (target.state !== "ok" || !(/\.pptx$/i.test(target.name) || /presentationml/i.test(target.mime))) {
      const detail = target.state === "ok" ? "Only .pptx presentations can be revised in place." : (target.stateDetail ?? `The file is ${target.state}.`);
      return questionsOut("unsupported_format", "unsupported", [{ id: "context_target", question: `I found ${target.name}, but it cannot be revised automatically: ${detail} Please attach a .pptx copy.`, reason: detail, required: true }], detail);
    }

    // ---- requirements ----
    const chunks = chunksOf(db, target.versionId, deps.parserVersion);
    const slideCount = chunks.filter((c) => c.unit_kind === "slide").length || null;
    const relevant = relevantMessages(db, [...evidence.values()], current, target, [...cands.values()], terms, identities, envelope);
    const byReq = new Map<string, ContextRequirement>();
    const flaggedSources = new Set<string>();
    const gather = (ev: Evidence, text: string) => {
      const ex = extractRequirements(text, { slideCount });
      if (ex.flagged) { flaggedSources.add(ev.sourceId); ev.flagged += ex.flagged; }
      for (const r of ex.requirements) {
        const id = requirementId(r);
        const have = byReq.get(id);
        const support = { sourceId: ev.sourceId, quote: r.quote };
        if (have) { if (!have.support.some((s) => s.sourceId === support.sourceId)) have.support.push(support); continue; }
        byReq.set(id, { id, text: r.text, edit: r.edit, support: [support], scope: r.scope, conflictsWith: [] });
      }
    };
    gather(current, current.newText);
    if (parsed.evidence.forwardedText && current.newText.split("\n").length <= 3) gather(current, parsed.evidence.forwardedText);
    for (const ev of relevant) { gather(ev, ev.newText); if (ev.forwardedText && ev.newText.split("\n").length <= 3) gather(ev, ev.forwardedText); if ([...byReq.values()].some((r) => r.support.some((s) => s.sourceId === ev.sourceId))) { ev.roles.add("feedback"); } }
    const notes_: ContextSource[] = [];
    for (const fb of overrides.feedback) {
      const ex = extractRequirements(fb.text, { slideCount });
      const sourceId = `src-${fb.id}`;
      notes_.push({ id: sourceId, kind: "user_note", ref: fb.id, title: "Your clarification", from: null, participants: [], date: iso(now), locator: null, text: clip(fb.text, 1500), provenance: "user_answer", untrusted: true });
      const list = ex.requirements.length ? ex.requirements : fb.text.trim() ? [{ text: fb.text.trim().slice(0, 600), edit: null, scope: "deck", quote: fb.text.trim().slice(0, 300) }] : [];
      for (const r of list) { const id = requirementId(r); const have = byReq.get(id); const support = { sourceId, quote: r.quote }; if (have) have.support.push(support); else byReq.set(id, { id, text: r.text, edit: r.edit, support: [support], scope: r.scope, conflictsWith: [] }); }
    }
    let reqs = [...byReq.values()].filter((r) => !overrides.dropRequirements.has(r.id));
    reqs = markConflicts(reqs);
    // an answer to the conflict question keeps one requirement and drops the ones it clashes with
    if (overrides.conflictChoice) {
      const keep = reqs.find((r) => r.id === overrides.conflictChoice);
      if (keep) { const drop = new Set(keep.conflictsWith); reqs = markConflicts(reqs.filter((r) => !drop.has(r.id))); }
    }
    const conflicted = reqs.filter((r) => r.conflictsWith.length);

    if (reqs.length === 0) {
      const cls: RetrievalFailureClass = limitsHit.length ? "budget_limited" : historyIncomplete ? "incomplete_sync" : "no_match";
      const when = target.sentAt ? ` (sent ${tzDay(target.sentAt)})` : "";
      const coverageNote = historyStatus === "not_authorized" ? "Email history is not authorized, so I could only read this email." : historyIncomplete ? `Your email history is not fully read yet, so feedback may exist that I did not see.` : "I couldn't find written feedback in the authorized sources.";
      const q: WorkQuestion = { id: "context_changes", question: `I found ${target.name}${when}. What changes should I make? ${coverageNote}`, reason: "A presentation was identified, but no documented requested edits were found. I will not invent feedback.", required: true };
      persistTargetResolved(target);
      return questionsOut(cls === "budget_limited" ? "budget_limited" : cls === "incomplete_sync" ? "incomplete_sync" : "no_match", "needs_requirements", [q], coverageNote);
    }
    if (conflicted.length) {
      const q: WorkQuestion = {
        id: "context_conflict", question: "Two requested changes cannot both be applied. Which one should I make?",
        reason: "The feedback contains conflicting edits to the same text or slide.", required: true,
        options: conflicted.slice(0, 4).map((r) => ({ id: r.id, label: clip(r.text, 120), detail: `From ${r.support.map((s) => s.sourceId).join(", ")}.` })),
      };
      persistTargetResolved(target);
      return questionsOut("ambiguous_match", "needs_requirements", [q], "Conflicting feedback.");
    }

    // ---- H. bundle ----
    const uncertainties: Uncertainty[] = [];
    if (phrase && interval) uncertainties.push({ kind: "assumption", text: `Read "${phrase.phrase}" as ${interval.label} (${day(interval.interval.start, args.timezone)}${interval.interval.start.slice(0, 10) === interval.interval.end.slice(0, 10) ? "" : ` to ${day(interval.interval.end, args.timezone)}`}).${phrase.alternatives.length && !intervalAmbiguity.length ? " The other reading selects the same presentation." : ""}` });
    for (const ev of relevant.filter((e) => e.roles.has("feedback"))) uncertainties.push({ kind: "assumption", text: `Feedback in the message "${clip(ev.subject, 60)}" from ${ev.from} on ${tzDay(ev.date)} was taken to apply to ${target.name}.` });
    if (limitsHit.length) uncertainties.push({ kind: "assumption", text: `The search stopped at ${limitsHit.map((l) => FAILURE_TEXT[l] ?? l).join(" and ")}; a better match may exist.` });
    if (historyIncomplete) uncertainties.push({ kind: "assumption", text: coverage?.note ?? "Email history is not fully read." });
    if (flaggedSources.size || parsed.evidence.injectionFlagged) uncertainties.push({ kind: "assumption", text: "Some text addressed to the assistant was ignored. Only edits to the presentation were used." });
    if (target.signals.get("user_confirmation")) uncertainties.push({ kind: "assumption", text: "You selected this file." });

    const sources: ContextSource[] = [];
    const used = new Set<string>(reqs.flatMap((r) => r.support.map((s) => s.sourceId)));
    const deckEv = target.emailId ? evidence.get(target.emailId) : null;
    if (deckEv) deckEv.roles.add("deck_message");
    const pushEmail = (ev: Evidence) => sources.push({ id: ev.sourceId, kind: "email_excerpt", ref: ev.isCurrent ? ev.providerMessageId : ev.id, title: ev.subject, from: ev.from, participants: [ev.from, ...ev.to, ...ev.cc], date: ev.date, locator: null, text: clip(ev.newText || ev.bodyText, 1500), provenance: ev.isCurrent ? "this request" : `${ev.direction} message; ${[...ev.reasons].join(", ")}`, untrusted: true });
    pushEmail(current);
    for (const ev of [...evidence.values()]) if (ev !== current && (used.has(ev.sourceId) || ev === deckEv)) pushEmail(ev);
    sources.push(...notes_);
    // selective extraction: the slides the edits name, with their neighbours for context, plus the first slide
    const wanted = new Set<number>([1]);
    for (const r of reqs) { const s = r.edit && "slide" in r.edit ? r.edit.slide : null; if (s) { wanted.add(s); wanted.add(s - 1); wanted.add(s + 1); } }
    const fileSources: ContextSource[] = [];
    for (const ch of chunks) {
      if (ch.unit == null || !wanted.has(ch.unit) || fileSources.length >= 8) continue;
      fileSources.push({ id: `src-file-${target.versionId.slice(0, 8)}-s${ch.unit}`, kind: "file_section", ref: target.versionId, title: `${target.name}, ${ch.locator}`, from: null, participants: [], date: target.sentAt, locator: ch.locator, text: clip(ch.text, 1500), provenance: "source deck", untrusted: true });
    }
    sources.push(...fileSources);
    const tver = getVersion(db, ownerId, target.versionId)!;
    // the requirement list must reference sources that are in the bundle
    const known = new Set(sources.map((s) => s.id));
    for (const r of reqs) r.support = r.support.filter((s) => known.has(s.sourceId));
    reqs = reqs.filter((r) => r.support.length > 0);
    const reasonCodes = [...target.signals.keys()];
    const evidenceIds = [deckEv?.sourceId, ...relevant.filter((e) => e.roles.has("feedback")).map((e) => e.sourceId)].filter((x): x is string => !!x && known.has(x));
    const grantsDesc = [
      account && cutoff ? `Gmail history, last ${Math.max(...activeGrants(db, ownerId, accountId, "email", now).map((g) => g.lookback_days ?? 0))} days` : null,
      (db.prepare("SELECT 1 FROM context_grants g WHERE g.owner_id=? AND g.kind='files' AND g.revoked_at IS NULL LIMIT 1").get(ownerId)) ? "selected files and folders" : null,
    ].filter(Boolean).join("; ") || "this email and its attachments only";
    const summary = buildSummary("none", null);
    const bundle: ContextBundle = {
      version: 1,
      request: { messageId: envelope.providerMessageId, from: sender, receivedAt: envelope.receivedAt, timezone: args.timezone, subject: envelope.subject, action: parsed.inferred.action, deliverable: parsed.inferred.deliverable },
      resolvedTarget: {
        fileId: target.fileId, versionId: tver.id, versionKey: tver.version_key, sha256: tver.checksum_sha256!, filename: target.name, mimeType: target.mime, sizeBytes: tver.size_bytes,
        provider: target.provider, snapshotKind: tver.snapshot_kind, modifiedAt: tver.modified_at, sentAt: target.sentAt, reasonCodes, evidence: evidenceIds,
      },
      requirements: reqs, sources,
      temporalInterpretation: phrase && interval ? toTemporal(phrase, interval, args.timezone) : null,
      retrieval: summary, uncertainties,
      constraints: { authorization: `Existing grants only (${grantsDesc}). Nothing is sent, published or overwritten.`, reviewOnly: true, preserveOriginal: true, maxModelTokens: limits.maxModelTokens },
      snapshot: {
        retrievedAt: iso(now), runId: run.id,
        sources: [
          { type: "file_version", id: tver.id, versionKey: tver.version_key, sha256: tver.checksum_sha256 },
          ...[...evidence.values()].filter((e) => known.has(e.sourceId) && !e.isCurrent).map((e) => ({ type: "email" as const, id: e.id, versionKey: null, sha256: null })),
        ],
      },
    };
    const bytes = loadVersionBytes(db, deps.artifactsDir, ownerId, tver.id);
    if (!bytes) throw new ContextRetryableError("The selected file's content is no longer available locally; it will be fetched again.");
    persistTargetResolved(target);
    persistRun("resolved", [], bundle, target, reqs, summary, uncertainties);
    recordInferredAssociations(db, ownerId, parsed.inferred.explicitProjectTerms, bundle, { deck: deckEv && !deckEv.isCurrent ? deckEv.id : null, feedback: relevant.filter((e) => e.roles.has("feedback")).map((e) => e.id) }, now);
    auditContext(db, ownerId, "retrieval.resolved", { type: "task", id: taskId }, { revision, candidates: cands.size, messages: evidence.size, requirements: reqs.length, reused: reusedFrom !== null }, now);
    return { kind: "resolved", runId: run.id, bundle, files: [{ versionId: tver.id, filename: target.name, mimeType: target.mime, bytes: new Uint8Array(bytes) }] };

    // ---- helpers needing closure state ----
    function persistTargetResolved(t: Cand): void {
      // remember explicit choices (a user's selection) as a confirmed association for this project and file
      if (selectedVersionId && t.versionId === selectedVersionId) confirmAssociation(db, ownerId, taskId, terms, t.fileId, t.name, now);
    }

    async function loadSelected(versionId: string): Promise<Cand | null> {
      const v = getVersion(db, ownerId, versionId);
      if (!v || v.invalidated_at) return null;
      if (v.file.parent_email_id) {
        const mail = db.prepare("SELECT * FROM emails WHERE id=? AND owner_id=?").get(v.file.parent_email_id, ownerId) as EmailRow | undefined;
        if (!mail || mail.invalidated_at || !cutoff || mail.received_at < cutoff) return null;
      }
      const c = candOf(v, v.file);
      cands.set(c.versionId, c);
      return c;
    }

    async function acquireAndParse(c: Cand): Promise<boolean> {
      const v = getVersion(db, ownerId, c.versionId);
      if (!v) return false;
      let bytes: Uint8Array | null = loadVersionBytes(db, deps.artifactsDir, ownerId, c.versionId);
            if (!bytes && v.extraction_status === "complete" && v.parser_version === deps.parserVersion) { fillContent(c); c.state = "ok"; return true; }
      if (!bytes && v.size_bytes > limits.maxFileBytes) {
        db.prepare("UPDATE file_versions SET extraction_status='oversized', extraction_detail=? WHERE id=?").run(`The file is larger than ${Math.round(limits.maxFileBytes / (1024 * 1024))} MB.`, v.id);
        c.state = "oversized"; c.stateDetail = `The file is larger than ${Math.round(limits.maxFileBytes / (1024 * 1024))} MB.`;
        return false;
      }
      if (!bytes) {
        if (!budget.take("files")) { c.state = "pending"; return false; }
        if (v.size_bytes && !budget.take("bytes", v.size_bytes)) { c.state = "pending"; return false; }
        try { bytes = await fetchBytes(c, v); } catch (e) {
          if (e instanceof ProviderError) {
            if (e.kind === "not_found") { c.state = "deleted"; c.stateDetail = "It was deleted or moved."; markFileState(db, v.file_id, "deleted", now); invalidateVersion(db, v.id, "deleted_at_source", now); return false; }
            if (e.kind === "auth") throw new ContextAccessError("CONTEXT_PROVIDER_AUTH", "The connection was rejected. Reconnect it in Settings, then retry.");
            if (e.kind === "forbidden") { c.state = "forbidden"; c.stateDetail = "Access to it was refused."; return false; }
            throw new ContextRetryableError(e.message);
          }
          throw e;
        }
        if (!bytes) return false;
        const stored = storeVersionBytes(db, deps.artifactsDir, ownerId, c.versionId, bytes);
        c.checksum = stored.checksum_sha256;
        c.versionId = stored.id;
      }
      const res = ensureExtracted(db, { artifactsDir: deps.artifactsDir, extract: deps.extract, parserVersion: deps.parserVersion }, c.versionId, ownerId, budget, bytes);
      c.state = (res.status === "complete" ? "ok" : res.status === "pending" ? "pending" : res.status) as CandState;
      c.stateDetail = res.detail;
      if (res.status === "complete") fillContent(c);
      return res.status === "complete";
    }

    function fillContent(c: Cand): void {
      const cs = chunksOf(db, c.versionId, deps.parserVersion);
      c.title = cs[0]?.section ?? cs[0]?.text.split("\n")[0] ?? "";
      c.textSample = cs.slice(0, 3).map((x) => x.text).join(" ").toLowerCase();
    }

    async function fetchBytes(c: Cand, v: NonNullable<ReturnType<typeof getVersion>>): Promise<Uint8Array | null> {
      if (c.provider === "task") { const a = args.attachments.find((x) => `${taskId}#${x.id}` === c.providerFileId); return a?.bytes ?? null; }
      if (c.provider === "gmail") {
        if (!c.emailId || !account || !cutoff) { c.state = "revoked"; c.stateDetail = "Access to that mail is no longer granted."; return null; }
        const mail = db.prepare("SELECT * FROM emails WHERE id=? AND owner_id=?").get(c.emailId, ownerId) as EmailRow | undefined;
        if (!mail || mail.invalidated_at || mail.received_at < cutoff) { c.state = "revoked"; c.stateDetail = "Access to that mail is no longer granted."; return null; }
        const fetcher = deps.providers.mail?.(accountId);
        if (!fetcher) { c.state = "unavailable"; c.stateDetail = "The mailbox client is not available."; return null; }
        const ref = parseJson<{ messageId: string; key: string }>(v.file.parent_ref, { messageId: mail.provider_message_id, key: "" });
        return await fetcher.fetchAttachment(ref.messageId, ref.key);
      }
      const provider = deps.providers.files[c.provider as "folder" | "drive"];
      const acct = getAccount(db, ownerId, v.file.account_id);
      if (!provider || !provider.available || !acct) { c.state = "unavailable"; c.stateDetail = provider?.limitation ?? "The file source is not available."; return null; }
      const grants = activeGrants(db, ownerId, acct.id, "files", now);
      let ok = false;
      for (const g of grants) if ((await scopeDecision(provider, v.file.provider_file_id, selectedOf(g))).ok) { ok = true; break; }
      if (!ok) { c.state = "revoked"; c.stateDetail = "It is outside the files you chose to share, or the grant was revoked."; auditContext(db, ownerId, "retrieval.denied", { type: "task", id: taskId }, { reason: "not_in_grant" }, now); return null; }
      const opened = await provider.open(v.file.provider_file_id);
      if (!opened.ok) {
        if (opened.reason === "deleted") throw new ProviderError("not_found", opened.message);
        if (opened.reason === "temporary") throw new ProviderError("temporary", opened.message);
        c.state = opened.reason === "forbidden" ? "forbidden" : "unavailable"; c.stateDetail = opened.message; return null;
      }
      // the live file may have moved on since it was listed: record the version actually read
      const key = opened.entry.versionKey ?? v.version_key;
      if (key !== v.version_key) {
        const nv = registerVersion(db, { ownerId, fileId: v.file_id, versionKey: key, snapshotKind: v.snapshot_kind, sizeBytes: opened.bytes.byteLength, modifiedAt: opened.entry.modifiedAt }, now);
        c.versionId = nv.id;
      }
      return opened.bytes;
    }
  } catch (e) {
    const outcome: RunOutcome = e instanceof ContextRetryableError ? "retryable_error" : e instanceof ContextAccessError ? "access_revoked" : "retryable_error";
    finishRun(db, run.id, { status: "failed", outcome, decision_json: { failure: e instanceof ContextRetryableError ? "provider_temporary_failure" : "access_revoked", failureDetail: (e as Error).message } }, now);
    throw e;
  }
}

async function tryResume(deps: ContextDeps, db: Db, ownerId: string, taskId: string, revision: number, now: Date): Promise<ResolveOutcome | null> {
  const run = getRun(db, taskId, revision);
  if (!run || run.status !== "complete" || run.owner_id !== ownerId) return null;
  if (run.outcome === "resolved") {
    const bundle = bundleOf(run);
    if (!bundle) return null;
    const access = await checkAccess(db, deps, ownerId, taskId, revision, now);
    if (!access.ok || access.changed) return null;
    const bytes = loadVersionBytes(db, deps.artifactsDir, ownerId, bundle.resolvedTarget.versionId);
    if (!bytes) return null;
    return { kind: "resolved", runId: run.id, bundle, files: [{ versionId: bundle.resolvedTarget.versionId, filename: bundle.resolvedTarget.filename, mimeType: bundle.resolvedTarget.mimeType, bytes: new Uint8Array(bytes) }] };
  }
  return null;
}

function stateOfVersion(v: FileVersionRow, f: SourceFileRow): CandState {
  if (f.state !== "active" || v.invalidated_at) return f.state === "deleted" || v.invalidation_reason === "deleted_at_source" ? "deleted" : f.state === "forbidden" ? "forbidden" : "unavailable";
  if (v.extraction_status === "complete") return "ok";
  if (v.extraction_status === "pending") return "pending";
  return v.extraction_status as CandState;
}

/** Match a free-text answer ("A", "the second", an id, a file name, a date) to one of the offered candidates. */
export function matchAnswer(answer: string, cands: Cand[]): string | null {
  const a = answer.trim().toLowerCase();
  if (!a) return null;
  const byId = cands.find((c) => c.versionId === answer.trim() || c.versionId.startsWith(a));
  if (byId) return byId.versionId;
  const byName = cands.filter((c) => a.includes(c.name.toLowerCase()) || a.includes(stemOf(c.name)));
  return byName.length === 1 ? byName[0]!.versionId : null;
}

export function toTemporal(p: PhraseInterpretation, chosen: Interpretation, tz: string): TemporalInterpretation {
  return {
    phrase: p.phrase, anchor: p.anchor, timezone: tz, interpretation: chosen.label, interval: chosen.interval, basis: p.basis,
    alternatives: [p.primary, ...p.alternatives].filter((i) => i.id !== chosen.id).map((i) => ({ interpretation: i.label, interval: i.interval })),
  };
}

function filesStatus(db: Db, ownerId: string, deps: ContextDeps): RetrievalSummary["coverage"]["files"] {
  const accts = db.prepare("SELECT * FROM connected_accounts WHERE owner_id=? AND provider IN ('folder','drive')").all(ownerId) as AccountRow[];
  const granted = accts.filter((a) => (db.prepare("SELECT 1 FROM context_grants WHERE owner_id=? AND account_id=? AND kind='files' AND revoked_at IS NULL").get(ownerId, a.id)));
  if (!granted.length) return "not_authorized";
  return granted.every((a) => deps.providers.files[a.provider as "folder" | "drive"]?.available) ? "searched" : "unavailable";
}

function makePlan(parsed: ParsedRequest, envelope: EmailEnvelope, questions: WorkQuestion[]): WorkPlan {
  return {
    title: `Revise: ${envelope.subject}`.slice(0, 200),
    requestSummary: `Revise an existing presentation as requested in "${envelope.subject}". The presentation and the requested edits are resolved from the email, its history and any shared files.`,
    requestedOutputs: ["presentation"], dueAt: null, dueAtExplanation: null,
    steps: ["Find the presentation you mean", "Find the written feedback", "Apply the requested edits to a copy of the original"],
    assumptions: [], questions, sourcesUsed: ["src-request"],
  };
}

function requestSource(ev: Evidence): SourceDocument {
  return { id: ev.sourceId, kind: "email", title: ev.subject, filename: null, mimeType: "text/plain", text: ev.bodyText.slice(0, 20_000), extractionStatus: "complete", warnings: [] };
}

/**
 * A message is feedback for the target only if something concrete ties it to the target: the same thread, the deck's file
 * name or title, the same provider file id, or the same project terms from the same people after the deck was shared.
 * A message in the thread of a different candidate deck is never used unless it names this one.
 */
function relevantMessages(db: Db, all: Evidence[], current: Evidence, target: Cand, cands: Cand[], terms: string[], identities: Set<string>, envelope: EmailEnvelope): Evidence[] {
  const stem = stemOf(target.name);
  const title = target.title.toLowerCase();
  const targetSent = target.sentAt ?? "";
  const fileRefs = new Set(target.provider === "drive" ? [target.providerFileId] : []);
  // threads that carry a different candidate deck: their feedback belongs to that deck unless it names this one
  const otherThreads = new Set(cands.filter((c) => c.versionId !== target.versionId && c.threadId && c.threadId !== target.threadId).map((c) => c.threadId!));
  const out: Evidence[] = [];
  for (const ev of all) {
    if (ev.isCurrent || ev.date > envelope.receivedAt) continue;
    const text = `${ev.subject}\n${ev.newText}`.toLowerCase();
    const sameThread = !!ev.threadId && (ev.threadId === target.threadId || ev.threadId === current.threadId);
    const names = (stem.length > 2 && text.includes(stem)) || (title.length > 4 && text.includes(title));
    const linked = fileRefs.size > 0 && (db.prepare("SELECT file_ref FROM email_links WHERE email_id=?").all(ev.id) as Array<{ file_ref: string }>).some((l) => fileRefs.has(l.file_ref));
    const after = sameThread || ev.date > targetSent;
    const hits = new Set(tokenize(`${ev.subject} ${ev.newText}`));
    const projectHits = terms.filter((t) => hits.has(t)).length;
    const peers = [ev.from, ...ev.to, ...ev.cc].some((a) => identities.has(a));
    const project = projectHits >= Math.min(2, Math.max(1, terms.length)) && (peers || linked) && after;
    if (!sameThread && !names && !linked && !project) continue;
    if (!names && !linked && ev.threadId && otherThreads.has(ev.threadId)) continue;
    if (!after) continue;
    out.push(ev);
  }
  return out;
}

// ---- project/entity associations (user-confirmed hints) ----
function entityIdFor(db: Db, ownerId: string, name: string, now: Date): string {
  const norm = name.trim().toLowerCase();
  const row = db.prepare("SELECT id FROM project_entities WHERE owner_id=? AND normalized_name=?").get(ownerId, norm) as { id: string } | undefined;
  if (row) return row.id;
  const id = newId();
  db.prepare("INSERT INTO project_entities (id, owner_id, name, normalized_name, kind, created_at) VALUES (?,?,?,?,?,?)").run(id, ownerId, name.trim(), norm, "project", iso(now));
  return id;
}

/**
 * The user chose this file. Remembered against the project terms of that request (or, when the request named none, the
 * file's own name), and applied later only to requests whose terms include all of them. Never a global preference.
 */
export function confirmAssociation(db: Db, ownerId: string, taskId: string, terms: string[], fileId: string, fileName: string, now: Date): void {
  const key = terms.length ? [...terms].sort().slice(0, 4).join(" ") : stemOf(fileName);
  if (!tokenize(key).length) return;
  const entity = entityIdFor(db, ownerId, key, now);
  db.prepare(`INSERT INTO entity_links (id, owner_id, entity_id, target_type, target_id, confidence, origin, evidence_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(owner_id, entity_id, target_type, target_id) DO UPDATE SET origin='user_confirmed', confidence=1`).run(newId(), ownerId, entity, "file", fileId, 1, "user_confirmed", JSON.stringify([{ task: taskId }]), iso(now));
}

function confirmedFiles(db: Db, ownerId: string, terms: string[]): string[] {
  const have = new Set(terms);
  const rows = db.prepare(`SELECT l.target_id, e.name FROM entity_links l JOIN project_entities e ON e.id=l.entity_id WHERE l.owner_id=? AND l.target_type='file' AND l.origin='user_confirmed'`).all(ownerId) as Array<{ target_id: string; name: string }>;
  return rows.filter((r) => { const t = tokenize(r.name); return t.length > 0 && t.every((x) => have.has(x)); }).map((r) => r.target_id);
}
function confirmedFile(db: Db, ownerId: string, fileId: string, terms: string[]): boolean {
  return confirmedFiles(db, ownerId, terms).includes(fileId);
}

/** Reuse a previous run's candidates when every message and file it used is still visible and unchanged. */
function tryReuse(db: Db, ownerId: string, prior: RunRow, now: Date, overrides: ResolvedOverrides): { emailIds: string[]; versionIds: string[] } | null {
  const rows = db.prepare("SELECT source_type, source_id FROM retrieval_sources WHERE run_id=?").all(prior.id) as Array<{ source_type: string; source_id: string }>;
  if (!rows.length) return null;
  const accountId = prior.account_id;
  const cutoff = accountId ? emailCutoff(db, ownerId, accountId, now) : null;
  const emailIds: string[] = [];
  const versionIds: string[] = [];
  for (const r of rows) {
    if (r.source_type === "email") {
      if (r.source_id.startsWith("current-")) continue;
      const e = db.prepare("SELECT * FROM emails WHERE id=? AND owner_id=?").get(r.source_id, ownerId) as EmailRow | undefined;
      if (!e || e.invalidated_at || !cutoff || e.received_at < cutoff) return null;
      emailIds.push(e.id);
    } else {
      const v = getVersion(db, ownerId, r.source_id);
      if (!v || v.invalidated_at || v.file.state !== "active") return null;
      if (v.file.provider === "folder" || v.file.provider === "drive") {
        const acct = getAccount(db, ownerId, v.file.account_id);
        if (!acct || !activeGrants(db, ownerId, acct.id, "files", now).length) return null;
        if (v.file.mutable) return null; // a live file is re-read, never assumed unchanged
      }
      if (v.file.provider === "gmail") { if (!v.file.parent_email_id) return null; const e = db.prepare("SELECT received_at, invalidated_at FROM emails WHERE id=? AND owner_id=?").get(v.file.parent_email_id, ownerId) as { received_at: string; invalidated_at: string | null } | undefined; if (!e || e.invalidated_at || !cutoff || e.received_at < cutoff) return null; }
      versionIds.push(v.id);
    }
  }
  return { emailIds, versionIds: versionIds.filter((id) => !overrides.excludeFiles.has(getVersion(db, ownerId, id)!.file_id)) };
}
