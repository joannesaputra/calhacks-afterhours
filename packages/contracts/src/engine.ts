// Cross-role engine/delivery schemas. Binary data (Uint8Array) is validated separately
// from the JSON metadata so public DTOs never carry buffers.
import { z } from "zod";
import { ContextBundleSchema, ContextFileSchema, RevisionReportSchema } from "./context";
import {
  ArtifactFormatSchema,
  EmailEnvelopeSchema,
  GenerationModeSchema,
  OrganizationProfileSchema,
  SourceDocumentSchema,
  WorkAnswerSchema,
  WorkPlanSchema,
  WorkProductSchema,
  WorkQuestionSchema,
} from "./domain";

export const FixtureScenarioSchema = z.enum(["proposal", "report", "ambiguous", "no_action", "revision", "revision_choice"]);
export type FixtureScenario = z.infer<typeof FixtureScenarioSchema>;

export const Uint8ArraySchema = z.custom<Uint8Array>(
  (v) => v instanceof Uint8Array,
  "Expected Uint8Array",
);

export const BinaryAttachmentSchema = z.object({
  id: z.string().min(1),
  filename: z.string(),
  mimeType: z.string(),
  bytes: Uint8ArraySchema,
});
export type BinaryAttachment = z.infer<typeof BinaryAttachmentSchema>;

export const EngineInputSchema = z.object({
  taskId: z.string().min(1),
  revision: z.number().int().positive(),
  mode: GenerationModeSchema,
  email: EmailEnvelopeSchema,
  attachments: z.array(BinaryAttachmentSchema),
  organization: OrganizationProfileSchema,
  answers: z.array(WorkAnswerSchema),
  now: z.string().datetime({ offset: true }),
  fixtureScenario: FixtureScenarioSchema.nullable(),
  /** Resolved retrieval context (revision requests). Absent for ordinary requests. */
  context: ContextBundleSchema.nullable().optional(),
  /** Bytes of the resolved source file, keyed by `context.resolvedTarget.versionId`. */
  contextFiles: z.array(ContextFileSchema).optional(),
});
export type EngineInput = z.infer<typeof EngineInputSchema>;

export const EngineProgressSchema = z.object({
  stage: z.enum(["plan", "extract", "generate", "verify", "export"]),
  message: z.string(),
  plan: WorkPlanSchema.optional(),
});
export type EngineProgress = z.infer<typeof EngineProgressSchema>;

export const GeneratedFileSchema = z.object({
  id: z.string().min(1),
  productId: z.string().min(1),
  format: ArtifactFormatSchema,
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  bytes: Uint8ArraySchema,
});
export type GeneratedFile = z.infer<typeof GeneratedFileSchema>;

/** JSON-only metadata portions of an EngineResult (no binary). */
export const EngineResultMetaSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("ready"),
    plan: WorkPlanSchema,
    sources: z.array(SourceDocumentSchema),
    products: z.array(WorkProductSchema),
    warnings: z.array(z.string()),
    /** Present when the files are a revision of a resolved source file. */
    revisionReport: RevisionReportSchema.optional(),
  }),
  z.object({
    outcome: z.literal("needs_input"),
    plan: WorkPlanSchema,
    sources: z.array(SourceDocumentSchema),
    questions: z.array(WorkQuestionSchema).min(1),
    warnings: z.array(z.string()),
  }),
  z.object({
    outcome: z.literal("skipped"),
    reason: z.string().min(1),
    sources: z.array(SourceDocumentSchema),
  }),
]);

export const EngineResultSchema = z.union([
  EngineResultMetaSchema.options[0].extend({ files: z.array(GeneratedFileSchema).min(1) }),
  EngineResultMetaSchema.options[1],
  EngineResultMetaSchema.options[2],
]);
export type EngineResult = z.infer<typeof EngineResultSchema>;

export interface EngineDependencies {
  onProgress: (progress: EngineProgress) => Promise<void>;
  signal: AbortSignal;
}

// ---- Delivery ----
export const DeliveryInputSchema = z.object({
  notificationId: z.string().min(1),
  channel: z.enum(["outbox", "whatsapp"]),
  recipient: z.string().nullable(),
  publicAppUrl: z.string().min(1),
  tasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      revision: z.number().int().positive(),
      artifactCount: z.number().int().nonnegative(),
    }),
  ),
  deliveryPolicy: z.object({
    eligible: z.boolean(),
    customerServiceWindowOpen: z.boolean(),
    approvedContentSid: z.string().nullable(),
  }),
});
export type DeliveryInput = z.infer<typeof DeliveryInputSchema>;

export const DeliveryResultSchema = z.object({
  state: z.enum(["simulated", "accepted", "blocked"]),
  message: z.string(),
  providerMessageId: z.string().nullable(),
  reason: z.string().nullable(),
});
export type DeliveryResult = z.infer<typeof DeliveryResultSchema>;

// ---- Demo fixtures ----
export const DemoFixtureSchema = z.object({
  scenario: FixtureScenarioSchema,
  email: EmailEnvelopeSchema,
  attachmentFiles: z.array(
    z.object({ attachmentId: z.string().min(1), relativePath: z.string().min(1) }),
  ),
});
export type DemoFixture = z.infer<typeof DemoFixtureSchema>;
