// API request bodies, query params, and response envelopes.
import { z } from "zod";
import {
  OrganizationProfileSchema,
  TaskStatusSchema,
  WorkAnswerSchema,
} from "./domain";
import { FixtureScenarioSchema } from "./engine";

export const ApiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string(),
  }),
});
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;

export const apiData = <T extends z.ZodTypeAny>(schema: T) => z.object({ data: schema });
export const apiList = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({
    data: z.object({ items: z.array(schema), nextCursor: z.string().nullable() }),
  });

export const LoginBodySchema = z.object({ password: z.string().min(1).max(512) });
export const SessionStateSchema = z.object({ authenticated: z.boolean() });

export const TaskListQuerySchema = z.object({
  status: TaskStatusSchema.optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const AnswersBodySchema = z.object({
  revision: z.number().int().positive(),
  answers: z.array(WorkAnswerSchema).min(1).max(50),
});
export const RetryBodySchema = z.object({ revision: z.number().int().positive() });
export const ReviewBodySchema = z.object({
  revision: z.number().int().positive(),
  action: z.enum(["approve", "dismiss"]),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm");

/** Editable settings fields only. Everything is optional; nested objects merge. */
// Strict at every level: unknown keys (credentials, eligibility, provider settings) are a 400, never silently dropped.
export const SettingsPatchSchema = z
  .object({
    organization: OrganizationProfileSchema.omit({ id: true })
      .extend({ brand: OrganizationProfileSchema.shape.brand.partial().strict() })
      .partial()
      .strict(),
    automationEnabled: z.boolean(),
    allowedSenders: z.array(z.string().min(3).max(320)).max(50),
    autoPrepare: z.boolean(),
    notifications: z
      .object({
        channel: z.enum(["outbox", "whatsapp"]),
        recipient: z.string().max(64).nullable(),
        quietHours: z
          .object({
            enabled: z.boolean(),
            start: hhmm,
            end: hhmm,
            timezone: z.string().min(1).max(64),
          })
          .partial()
          .strict(),
        digestTime: hhmm,
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const DemoInjectBodySchema = z.object({
  scenario: FixtureScenarioSchema,
  replayKey: z.string().min(1).max(200).optional(),
});
export const DemoInjectResultSchema = z.object({
  taskId: z.string(),
  deduplicated: z.boolean(),
});
