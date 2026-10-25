// Canonical public domain schemas. Runtime validation (Zod) is the source of truth;
// the exported types are inferred from the schemas and match docs/CONTRACT.md.
import { z } from "zod";

const id = z.string().min(1);
const isoTime = z.string().datetime({ offset: true });

export const TaskStatusSchema = z.enum([
  "queued", "planning", "running", "needs_input",
  "ready", "approved", "dismissed", "failed", "skipped",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const OutputKindSchema = z.enum(["proposal", "report", "presentation", "document"]);
export type OutputKind = z.infer<typeof OutputKindSchema>;

export const ArtifactFormatSchema = z.enum(["docx", "pptx"]);
export type ArtifactFormat = z.infer<typeof ArtifactFormatSchema>;

export const GenerationModeSchema = z.enum(["fixture", "live"]);
export type GenerationMode = z.infer<typeof GenerationModeSchema>;

export const IngestionModeSchema = z.enum(["demo", "gmail"]);
export type IngestionMode = z.infer<typeof IngestionModeSchema>;

export const SourceRefSchema = z.object({
  sourceId: id,
  locator: z.string().nullable(),
  quote: z.string().nullable(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const SourceDocumentSchema = z.object({
  id,
  kind: z.enum(["email", "attachment", "organization", "user_answer"]),
  title: z.string(),
  filename: z.string().nullable(),
  mimeType: z.string(),
  text: z.string(),
  extractionStatus: z.enum(["complete", "unsupported", "failed"]),
  warnings: z.array(z.string()),
});
export type SourceDocument = z.infer<typeof SourceDocumentSchema>;

export const AttachmentMetaSchema = z.object({
  id,
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});
export type AttachmentMeta = z.infer<typeof AttachmentMetaSchema>;

export const EmailEnvelopeSchema = z.object({
  providerMessageId: id,
  providerThreadId: z.string().nullable(),
  from: z.object({ name: z.string().nullable(), email: id }),
  to: z.array(z.string()),
  subject: z.string(),
  receivedAt: isoTime,
  bodyText: z.string(),
  attachments: z.array(AttachmentMetaSchema),
});
export type EmailEnvelope = z.infer<typeof EmailEnvelopeSchema>;

export const OrganizationProfileSchema = z.object({
  id,
  name: z.string().min(1),
  description: z.string(),
  timezone: z.string().min(1),
  currency: z.string().min(1),
  backgroundText: z.string(),
  policiesText: z.string(),
  brand: z.object({
    primaryColor: z.string(),
    accentColor: z.string(),
    fontFamily: z.string(),
  }),
});
export type OrganizationProfile = z.infer<typeof OrganizationProfileSchema>;

export const WorkQuestionSchema = z.object({
  id,
  question: z.string().min(1),
  reason: z.string(),
  required: z.boolean(),
  /** Closed choices (for example candidate files). The answer is one option id. Absent for free-text questions. */
  options: z.array(z.object({ id, label: z.string(), detail: z.string() })).optional(),
});
export type WorkQuestion = z.infer<typeof WorkQuestionSchema>;

export const WorkAnswerSchema = z.object({ questionId: id, answer: z.string() });
export type WorkAnswer = z.infer<typeof WorkAnswerSchema>;

export const WorkPlanSchema = z.object({
  title: z.string(),
  requestSummary: z.string(),
  requestedOutputs: z.array(OutputKindSchema),
  dueAt: isoTime.nullable(),
  dueAtExplanation: z.string().nullable(),
  steps: z.array(z.string()),
  assumptions: z.array(z.string()),
  questions: z.array(WorkQuestionSchema),
  sourcesUsed: z.array(z.string()),
});
export type WorkPlan = z.infer<typeof WorkPlanSchema>;

export const ContentBlockSchema = z.object({
  id,
  kind: z.enum(["paragraph", "bullets", "table", "chart"]),
  heading: z.string().nullable(),
  text: z.string().nullable(),
  items: z.array(z.string()),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  chart: z
    .object({
      type: z.enum(["bar", "line"]),
      labels: z.array(z.string()),
      series: z.array(z.object({ name: z.string(), values: z.array(z.number()) })),
      unit: z.string().nullable(),
    })
    .nullable(),
  evidence: z.array(SourceRefSchema),
  basis: z.enum(["source", "calculated", "recommendation", "assumption"]),
});
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

export const SlideContentSchema = z.object({
  id,
  title: z.string(),
  layout: z.enum(["title", "bullets", "two_column", "chart", "closing"]),
  blocks: z.array(ContentBlockSchema),
  speakerNotes: z.string(),
});
export type SlideContent = z.infer<typeof SlideContentSchema>;

export const WorkProductSchema = z.object({
  id,
  kind: OutputKindSchema,
  title: z.string(),
  subtitle: z.string().nullable(),
  blocks: z.array(ContentBlockSchema),
  slides: z.array(SlideContentSchema),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type WorkProduct = z.infer<typeof WorkProductSchema>;

export const ArtifactSchema = z.object({
  id,
  taskId: id,
  revision: z.number().int().positive(),
  productId: id,
  format: ArtifactFormatSchema,
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string(),
  downloadPath: z.string(),
  createdAt: isoTime,
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const TaskEventSchema = z.object({
  id,
  taskId: id,
  revision: z.number().int().positive(),
  type: z.enum(["status", "progress", "warning", "error", "review"]),
  stage: z.enum(["intake", "plan", "extract", "generate", "verify", "export", "notify", "review"]),
  message: z.string(),
  createdAt: isoTime,
});
export type TaskEvent = z.infer<typeof TaskEventSchema>;

export const TaskSummarySchema = z.object({
  id,
  title: z.string(),
  status: TaskStatusSchema,
  revision: z.number().int().positive(),
  ingestionMode: IngestionModeSchema,
  generationMode: GenerationModeSchema,
  senderName: z.string().nullable(),
  senderEmail: z.string(),
  subject: z.string(),
  requestedOutputs: z.array(OutputKindSchema),
  dueAt: isoTime.nullable(),
  createdAt: isoTime,
  updatedAt: isoTime,
  warningCount: z.number().int().nonnegative(),
  artifactCount: z.number().int().nonnegative(),
  error: z
    .object({ code: z.string(), message: z.string(), retryable: z.boolean() })
    .nullable(),
});
export type TaskSummary = z.infer<typeof TaskSummarySchema>;

export const NotificationRecordSchema = z.object({
  id,
  taskId: z.string().nullable(),
  revision: z.number().int().positive().nullable(),
  channel: z.enum(["outbox", "whatsapp"]),
  state: z.enum(["queued", "simulated", "accepted", "delivered", "blocked", "failed"]),
  message: z.string(),
  taskIds: z.array(z.string()),
  scheduledFor: isoTime,
  providerMessageId: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: isoTime,
});
export type NotificationRecord = z.infer<typeof NotificationRecordSchema>;

export const TaskDetailSchema = z.object({
  task: TaskSummarySchema,
  email: EmailEnvelopeSchema,
  plan: WorkPlanSchema.nullable(),
  sources: z.array(SourceDocumentSchema),
  products: z.array(WorkProductSchema),
  artifacts: z.array(ArtifactSchema),
  questions: z.array(WorkQuestionSchema),
  answers: z.array(WorkAnswerSchema),
  events: z.array(TaskEventSchema),
  notifications: z.array(NotificationRecordSchema),
});
export type TaskDetail = z.infer<typeof TaskDetailSchema>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm");

/**
 * Who may start work from Gmail. `approved`: only the exact addresses in allowedSenders. `same_domain`: those plus
 * anyone at the connected mailbox's own work domain. `everyone`: any sender. Addresses on the list are always accepted.
 */
export const SenderPolicySchema = z.enum(["approved", "same_domain", "everyone"]);
export type SenderPolicy = z.infer<typeof SenderPolicySchema>;

/**
 * Mailbox providers whose domain is shared by millions of unrelated people. "Same work domain" must never mean
 * "everyone on gmail.com", so for these only the connected address itself counts as the same domain.
 */
export const PUBLIC_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.net",
  "mail.com", "zoho.com", "yandex.com", "fastmail.com", "hey.com",
]);

export const emailDomain = (email: string): string => {
  const e = email.trim().toLowerCase();
  return e.slice(e.lastIndexOf("@") + 1);
};

/** True when the address is on a domain that identifies one organization (not a public mailbox provider). */
export function hasWorkDomain(account: string | null | undefined): boolean {
  const a = (account ?? "").trim().toLowerCase();
  return a.includes("@") && !PUBLIC_MAIL_DOMAINS.has(emailDomain(a));
}

export const WorkspaceSettingsSchema = z.object({
  organization: OrganizationProfileSchema,
  automationEnabled: z.boolean(),
  senderPolicy: SenderPolicySchema.default("approved"),
  allowedSenders: z.array(z.string()),
  autoPrepare: z.boolean(),
  notifications: z.object({
    channel: z.enum(["outbox", "whatsapp"]),
    recipient: z.string().nullable(),
    quietHours: z.object({
      enabled: z.boolean(),
      start: hhmm,
      end: hhmm,
      timezone: z.string().min(1),
    }),
    digestTime: hhmm,
  }),
});
export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;

export const IntegrationStatusSchema = z.object({
  gmail: z.object({
    state: z.enum(["disconnected", "connected", "error"]),
    email: z.string().nullable(),
    connectedAt: isoTime.nullable(),
    lastPollAt: isoTime.nullable(),
    lastError: z.string().nullable(),
    /** The stored Google grant includes permission to send mail (the separate "Allow sending replies" consent). */
    canSend: z.boolean().default(false),
  }),
  model: z.object({
    mode: GenerationModeSchema,
    provider: z.enum(["fixture", "anthropic"]),
    configured: z.boolean(),
    model: z.string().nullable(),
  }),
  notifications: z.object({
    channel: z.enum(["outbox", "whatsapp"]),
    configured: z.boolean(),
    eligible: z.boolean(),
    lastError: z.string().nullable(),
  }),
  worker: z.object({ lastHeartbeatAt: isoTime.nullable(), healthy: z.boolean() }),
});
export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;
