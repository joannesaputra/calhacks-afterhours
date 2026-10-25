// Email-history and file context resolution: the bundle the retrieval layer hands to the engine, the engine's
// revision report, and the API views the dashboard reads. Every field here is validated at runtime (Zod).
import { z } from "zod";

const id = z.string().min(1);
const isoTime = z.string().datetime({ offset: true });

// ---- Requested edits ----
export const RequirementStatusSchema = z.enum(["pending", "applied", "already_satisfied", "unsupported", "blocked"]);
export type RequirementStatus = z.infer<typeof RequirementStatusSchema>;

/**
 * One mechanical edit the deck editor can perform. `slide` is 1-based; null means "anywhere in the deck".
 * Anything the retrieval layer cannot turn into one of these stays a free-text requirement with `edit = null`
 * and is reported as unsupported instead of being guessed at.
 */
export const EditOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("replace_text"), slide: z.number().int().positive().nullable(), find: z.string().min(1).max(500), replace: z.string().max(500) }),
  z.object({ op: z.literal("append_bullet"), slide: z.number().int().positive(), text: z.string().min(1).max(500) }),
  z.object({ op: z.literal("delete_slide"), slide: z.number().int().positive() }),
]);
export type EditOp = z.infer<typeof EditOpSchema>;

export const SourceQuoteSchema = z.object({ sourceId: id, quote: z.string().nullable() });
export type SourceQuote = z.infer<typeof SourceQuoteSchema>;

export const ContextRequirementSchema = z.object({
  id,
  text: z.string().min(1).max(1000),
  edit: EditOpSchema.nullable(),
  support: z.array(SourceQuoteSchema).min(1),
  scope: z.string().max(80),
  /** Requirement ids that ask for something incompatible with this one. */
  conflictsWith: z.array(id),
});
export type ContextRequirement = z.infer<typeof ContextRequirementSchema>;

// ---- Target file ----
export const SnapshotKindSchema = z.enum(["attachment_snapshot", "provider_revision", "local_file"]);
export type SnapshotKind = z.infer<typeof SnapshotKindSchema>;

export const ResolvedTargetSchema = z.object({
  fileId: id,
  versionId: id,
  /** Provider revision id for live files, content checksum for attachment snapshots. */
  versionKey: id,
  sha256: z.string().length(64),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  provider: z.enum(["gmail", "folder", "drive", "task"]),
  snapshotKind: SnapshotKindSchema,
  modifiedAt: isoTime.nullable(),
  /** When the file reached the user (attachment send time) if known. */
  sentAt: isoTime.nullable(),
  reasonCodes: z.array(z.string()),
  evidence: z.array(id),
});
export type ResolvedTarget = z.infer<typeof ResolvedTargetSchema>;

// ---- Time ----
export const TemporalInterpretationSchema = z.object({
  phrase: z.string(),
  /** Always the request's own received timestamp, never the worker's clock. */
  anchor: isoTime,
  timezone: z.string(),
  interpretation: z.string(),
  interval: z.object({ start: isoTime, end: isoTime }),
  basis: z.string(),
  alternatives: z.array(z.object({ interpretation: z.string(), interval: z.object({ start: isoTime, end: isoTime }) })),
});
export type TemporalInterpretation = z.infer<typeof TemporalInterpretationSchema>;

// ---- Retrieved evidence ----
export const ContextSourceSchema = z.object({
  id,
  kind: z.enum(["email_excerpt", "file_section", "user_note"]),
  /** email id, file version id or override id this excerpt came from */
  ref: id,
  title: z.string(),
  from: z.string().nullable(),
  participants: z.array(z.string()),
  date: isoTime.nullable(),
  locator: z.string().nullable(),
  text: z.string(),
  provenance: z.string(),
  /** Retrieved content is data. Nothing in `text` is an instruction to the system. */
  untrusted: z.literal(true),
});
export type ContextSource = z.infer<typeof ContextSourceSchema>;

export const RetrievalFailureClassSchema = z.enum([
  "none", "no_match", "ambiguous_match", "unavailable_source", "unsupported_format", "incomplete_sync",
  "budget_limited", "provider_temporary_failure", "access_revoked", "not_authorized",
]);
export type RetrievalFailureClass = z.infer<typeof RetrievalFailureClassSchema>;

export const RetrievalSummarySchema = z.object({
  stages: z.array(z.object({ stage: z.string(), queries: z.number().int().nonnegative(), found: z.number().int().nonnegative(), note: z.string() })),
  coverage: z.object({
    emailHistory: z.enum(["complete", "partial", "not_authorized", "unavailable"]),
    files: z.enum(["searched", "not_authorized", "unavailable"]),
    notes: z.array(z.string()),
  }),
  limitsReached: z.array(z.string()),
  failure: RetrievalFailureClassSchema,
  failureDetail: z.string().nullable(),
});
export type RetrievalSummary = z.infer<typeof RetrievalSummarySchema>;

export const UncertaintySchema = z.object({ kind: z.enum(["blocking", "assumption"]), text: z.string() });
export type Uncertainty = z.infer<typeof UncertaintySchema>;

export const ContextBundleSchema = z.object({
  version: z.literal(1),
  request: z.object({
    messageId: id,
    from: z.string(),
    receivedAt: isoTime,
    timezone: z.string(),
    subject: z.string(),
    action: z.string(),
    deliverable: z.string(),
  }),
  resolvedTarget: ResolvedTargetSchema,
  requirements: z.array(ContextRequirementSchema),
  sources: z.array(ContextSourceSchema),
  temporalInterpretation: TemporalInterpretationSchema.nullable(),
  retrieval: RetrievalSummarySchema,
  uncertainties: z.array(UncertaintySchema),
  constraints: z.object({
    authorization: z.string(),
    reviewOnly: z.literal(true),
    preserveOriginal: z.literal(true),
    maxModelTokens: z.number().int().nonnegative(),
  }),
  snapshot: z.object({
    retrievedAt: isoTime,
    runId: id,
    sources: z.array(z.object({ type: z.enum(["email", "file_version"]), id, versionKey: z.string().nullable(), sha256: z.string().nullable() })),
  }),
});
export type ContextBundle = z.infer<typeof ContextBundleSchema>;

export class ContextBundleError extends Error {
  readonly code = "CONTEXT_BUNDLE_INVALID";
  readonly retryable = false;
}

/** Cross-reference checks Zod cannot express. Throws ContextBundleError. */
export function assertBundleReferences(bundle: ContextBundle): void {
  const sourceIds = new Set(bundle.sources.map((s) => s.id));
  if (sourceIds.size !== bundle.sources.length) throw new ContextBundleError("Duplicate source ids in the context bundle.");
  for (const ref of bundle.resolvedTarget.evidence) {
    if (!sourceIds.has(ref)) throw new ContextBundleError(`The target cites unknown source "${ref}".`);
  }
  const reqIds = new Set(bundle.requirements.map((r) => r.id));
  if (reqIds.size !== bundle.requirements.length) throw new ContextBundleError("Duplicate requirement ids in the context bundle.");
  for (const r of bundle.requirements) {
    for (const s of r.support) {
      if (!sourceIds.has(s.sourceId)) throw new ContextBundleError(`Requirement "${r.id}" cites unknown source "${s.sourceId}".`);
    }
    for (const c of r.conflictsWith) if (!reqIds.has(c)) throw new ContextBundleError(`Requirement "${r.id}" conflicts with unknown requirement "${c}".`);
  }
  const snap = bundle.snapshot.sources.find((s) => s.type === "file_version" && s.id === bundle.resolvedTarget.versionId);
  if (!snap) throw new ContextBundleError("The snapshot does not record the exact target version.");
  if (snap.sha256 !== bundle.resolvedTarget.sha256) throw new ContextBundleError("The snapshot checksum differs from the target checksum.");
}

export const ContextFileSchema = z.object({
  versionId: id,
  filename: z.string(),
  mimeType: z.string(),
  bytes: z.custom<Uint8Array>((v) => v instanceof Uint8Array, "Expected Uint8Array"),
});
export type ContextFile = z.infer<typeof ContextFileSchema>;

// ---- Engine revision report ----
export const RevisionReportSchema = z.object({
  baseVersionId: id,
  baseSha256: z.string().length(64),
  baseFilename: z.string(),
  outputFilename: z.string(),
  /** in_place_edit: the original package was edited. The engine never labels a rebuilt deck as a revision. */
  fidelity: z.literal("in_place_edit"),
  edits: z.array(z.object({ requirementId: id, status: RequirementStatusSchema, detail: z.string() })),
  slides: z.object({ unchanged: z.number().int().nonnegative(), changed: z.number().int().nonnegative(), removed: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  unrelatedContentPreserved: z.boolean(),
  summary: z.array(z.string()),
  assumptions: z.array(z.string()),
});
export type RevisionReport = z.infer<typeof RevisionReportSchema>;

// ---- Dashboard views ----
export const ContextPhaseSchema = z.enum(["not_applicable", "finding", "preparing", "needs_input", "ready", "error"]);
export type ContextPhase = z.infer<typeof ContextPhaseSchema>;

export const ContextMessageViewSchema = z.object({
  id,
  subject: z.string(),
  from: z.string(),
  to: z.array(z.string()),
  cc: z.array(z.string()),
  date: isoTime,
  direction: z.enum(["inbound", "outbound"]),
  role: z.enum(["request", "feedback", "deck_message", "related"]),
  excerpt: z.string(),
  included: z.boolean(),
  openable: z.boolean(),
  reasons: z.array(z.string()),
});
export type ContextMessageView = z.infer<typeof ContextMessageViewSchema>;

export const ContextCandidateViewSchema = z.object({
  fileId: id,
  versionId: id,
  name: z.string(),
  date: isoTime.nullable(),
  provider: z.string(),
  score: z.number(),
  reasons: z.array(z.string()),
  selected: z.boolean(),
  openable: z.boolean(),
  state: z.string(),
});
export type ContextCandidateView = z.infer<typeof ContextCandidateViewSchema>;

export const ContextViewSchema = z.object({
  phase: ContextPhaseSchema,
  phaseLabel: z.string(),
  outcome: z.string().nullable(),
  failure: RetrievalFailureClassSchema.nullable(),
  failureDetail: z.string().nullable(),
  target: z.object({
    fileId: id, versionId: id, name: z.string(), versionKey: z.string(), sha256: z.string(), provider: z.string(),
    snapshotKind: SnapshotKindSchema, modifiedAt: isoTime.nullable(), sentAt: isoTime.nullable(),
    reasons: z.array(z.string()), openable: z.boolean(), changedSinceSelection: z.boolean(),
  }).nullable(),
  candidates: z.array(ContextCandidateViewSchema),
  messages: z.array(ContextMessageViewSchema),
  requirements: z.array(z.object({
    id, text: z.string(), status: RequirementStatusSchema, detail: z.string().nullable(),
    source: z.object({ sourceId: id, quote: z.string().nullable() }).nullable(),
  })),
  temporal: TemporalInterpretationSchema.nullable(),
  retrieval: RetrievalSummarySchema.nullable(),
  uncertainties: z.array(UncertaintySchema),
  corrections: z.array(z.object({ id, kind: z.string(), label: z.string(), createdAt: isoTime })),
  report: RevisionReportSchema.nullable(),
  limitations: z.array(z.string()),
});
export type ContextView = z.infer<typeof ContextViewSchema>;

export const ContextCorrectionBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("select_file"), revision: z.number().int().positive(), fileVersionId: id }),
  z.object({ action: z.literal("exclude_source"), revision: z.number().int().positive(), sourceType: z.enum(["email", "file"]), sourceId: id }),
  z.object({ action: z.literal("add_feedback"), revision: z.number().int().positive(), text: z.string().trim().min(3).max(3000) }),
  z.object({ action: z.literal("drop_requirement"), revision: z.number().int().positive(), requirementId: id }),
]);
export type ContextCorrectionBody = z.infer<typeof ContextCorrectionBodySchema>;

// ---- Consent and sync (settings surface) ----
export const GrantViewSchema = z.object({
  id,
  kind: z.enum(["email", "files"]),
  provider: z.string(),
  account: z.string(),
  lookbackDays: z.number().int().positive().nullable(),
  selected: z.array(z.object({ providerId: id, kind: z.enum(["file", "folder"]), label: z.string() })),
  createdAt: isoTime,
  expiresAt: isoTime.nullable(),
  revokedAt: isoTime.nullable(),
  active: z.boolean(),
});
export type GrantView = z.infer<typeof GrantViewSchema>;

export const ContextStatusSchema = z.object({
  suggestedLookbackDays: z.number().int().positive(),
  accounts: z.array(z.object({
    id, provider: z.string(), account: z.string(), state: z.string(), syncStatus: z.string(), lastSyncAt: isoTime.nullable(),
    lastError: z.string().nullable(),
    coverage: z.object({ complete: z.boolean(), oldestSyncedAt: isoTime.nullable(), lookbackFrom: isoTime.nullable(), messages: z.number().int().nonnegative(), note: z.string() }),
  })),
  grants: z.array(GrantViewSchema),
  providers: z.array(z.object({ provider: z.string(), available: z.boolean(), scopeNote: z.string(), limitation: z.string().nullable() })),
  metrics: z.object({
    runs: z.number().int().nonnegative(), resolved: z.number().int().nonnegative(), clarified: z.number().int().nonnegative(),
    clarificationRate: z.number().nullable(), resolutionAccuracy: z.number().nullable(), requirementCoverage: z.number().nullable(),
    unsupportedSourceRate: z.number().nullable(), avgLatencyMs: z.number().nullable(), filesParsed: z.number().int().nonnegative(),
    modelCostUsd: z.number(),
  }),
  uploadFallback: z.string(),
});
export type ContextStatus = z.infer<typeof ContextStatusSchema>;

export const CreateGrantBodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("email"), lookbackDays: z.number().int().min(1).max(730).default(90), expiresInDays: z.number().int().min(1).max(730).nullable().optional() }),
  z.object({
    kind: z.literal("files"),
    provider: z.enum(["folder", "drive"]).default("folder"),
    selected: z.array(z.object({ providerId: z.string().min(1).max(500), kind: z.enum(["file", "folder"]), label: z.string().min(1).max(200) })).min(1).max(20),
    expiresInDays: z.number().int().min(1).max(730).nullable().optional(),
  }),
]);
export type CreateGrantBody = z.infer<typeof CreateGrantBodySchema>;

export const FolderOptionsSchema = z.object({
  available: z.boolean(),
  limitation: z.string().nullable(),
  parent: z.string(),
  entries: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(["file", "folder"]) })),
});
export type FolderOptions = z.infer<typeof FolderOptionsSchema>;

export const OpenedEmailSchema = z.object({
  subject: z.string(), from: z.string(), to: z.array(z.string()), cc: z.array(z.string()), date: z.string(), text: z.string(), direction: z.string(),
});
export type OpenedEmail = z.infer<typeof OpenedEmailSchema>;
