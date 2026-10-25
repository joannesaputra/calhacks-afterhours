// Single typed API client: relative /api URLs only, one envelope/error parser, runtime validation with shared schemas.
import { z } from "zod";
import {
  ApiErrorEnvelopeSchema,
  ContextStatusSchema,
  ContextViewSchema,
  FolderOptionsSchema,
  OpenedEmailSchema,
  type ContextCorrectionBody,
  type CreateGrantBody,
  DemoInjectResultSchema,
  IntegrationStatusSchema,
  NotificationRecordSchema,
  SessionStateSchema,
  TaskDetailSchema,
  TaskSummarySchema,
  WorkspaceSettingsSchema,
  type SettingsPatch,
  type WorkAnswer,
} from "@afterhours/contracts";

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  requestId: string | null;
  constructor(status: number, code: string, message: string, details?: unknown, requestId: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

let onUnauthorized: (() => void) | null = null;
/** Registered once by the providers; called for any 401 outside the login call. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";
interface RequestOptions {
  method?: Method;
  body?: unknown;
  signal?: AbortSignal;
  /** The login call handles its own 401. */
  skipUnauthorizedHandler?: boolean;
}

async function send(path: string, opts: RequestOptions): Promise<Response> {
  const method = opts.method ?? "GET";
  try {
    return await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "NETWORK_ERROR", "Could not reach the server. Check that the app is running, then retry.");
  }
}

async function toApiError(res: Response, opts: RequestOptions): Promise<ApiError> {
  let parsed: z.infer<typeof ApiErrorEnvelopeSchema> | null = null;
  try {
    const r = ApiErrorEnvelopeSchema.safeParse(await res.json());
    if (r.success) parsed = r.data;
  } catch {
    /* non-JSON error body, e.g. a proxy failure */
  }
  if (res.status === 401 && !opts.skipUnauthorizedHandler) onUnauthorized?.();
  if (parsed) {
    const e = parsed.error;
    return new ApiError(res.status, e.code, e.message, e.details, e.requestId);
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return new ApiError(res.status, "SERVICE_UNAVAILABLE", "The AfterHours API is not reachable right now.");
  }
  return new ApiError(res.status, "HTTP_ERROR", `The server answered ${res.status}.`);
}

async function request<S extends z.ZodTypeAny>(path: string, schema: S, opts: RequestOptions = {}): Promise<z.infer<S>> {
  const res = await send(path, opts);
  if (!res.ok) throw await toApiError(res, opts);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(res.status, "BAD_RESPONSE", "The server returned an unreadable response.");
  }
  const parsed = z.object({ data: schema }).safeParse(json);
  if (!parsed.success) throw new ApiError(res.status, "BAD_RESPONSE", "The server response did not match the expected format.");
  return (parsed.data as { data: z.infer<S> }).data;
}

const TaskListSchema = z.object({ items: z.array(TaskSummarySchema), nextCursor: z.string().nullable() });
const NotificationListSchema = z.object({ items: z.array(NotificationRecordSchema), nextCursor: z.string().nullable() });

export const api = {
  session: (signal?: AbortSignal) => request("/session", SessionStateSchema, { signal }),
  login: (password: string) =>
    request("/session", SessionStateSchema, { method: "POST", body: { password }, skipUnauthorizedHandler: true }),
  logout: () => request("/session", SessionStateSchema, { method: "DELETE", skipUnauthorizedHandler: true }),

  tasks: (params: { status?: string; cursor?: string | null; limit?: number }, signal?: AbortSignal) => {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.cursor) q.set("cursor", params.cursor);
    if (params.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request(`/tasks${qs ? `?${qs}` : ""}`, TaskListSchema, { signal });
  },
  task: (id: string, signal?: AbortSignal) => request(`/tasks/${encodeURIComponent(id)}`, TaskDetailSchema, { signal }),
  review: (id: string, revision: number, action: "approve" | "dismiss") =>
    request(`/tasks/${encodeURIComponent(id)}/review`, TaskSummarySchema, { method: "POST", body: { revision, action } }),
  answers: (id: string, revision: number, answers: WorkAnswer[]) =>
    request(`/tasks/${encodeURIComponent(id)}/answers`, TaskSummarySchema, { method: "POST", body: { revision, answers } }),
  retry: (id: string, revision: number) =>
    request(`/tasks/${encodeURIComponent(id)}/retry`, TaskSummarySchema, { method: "POST", body: { revision } }),

  context: (signal?: AbortSignal) => request("/context", ContextStatusSchema, { signal }),
  taskContext: (id: string, signal?: AbortSignal) => request(`/tasks/${encodeURIComponent(id)}/context`, ContextViewSchema.nullable(), { signal }),
  correctContext: (id: string, body: ContextCorrectionBody) =>
    request(`/tasks/${encodeURIComponent(id)}/context/corrections`, TaskSummarySchema, { method: "POST", body }),
  createGrant: (body: CreateGrantBody) => request("/context/grants", z.object({ id: z.string() }), { method: "POST", body }),
  revokeGrant: (id: string) => request(`/context/grants/${encodeURIComponent(id)}`, z.object({ revoked: z.boolean() }), { method: "DELETE" }),
  purgeGrant: (id: string) => request(`/context/grants/${encodeURIComponent(id)}/purge`, z.object({ emails: z.number(), files: z.number() }).passthrough(), { method: "POST", body: {} }),
  folders: (parent: string, signal?: AbortSignal) => request(`/context/folders?parent=${encodeURIComponent(parent)}`, FolderOptionsSchema, { signal }),
  openEmail: (id: string, signal?: AbortSignal) => request(`/context/emails/${encodeURIComponent(id)}`, OpenedEmailSchema, { signal }),

  notifications: (cursor: string | null, signal?: AbortSignal) =>
    request(`/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, NotificationListSchema, { signal }),
  settings: (signal?: AbortSignal) => request("/settings", WorkspaceSettingsSchema, { signal }),
  patchSettings: (patch: SettingsPatch) => request("/settings", WorkspaceSettingsSchema, { method: "PATCH", body: patch }),
  integrations: (signal?: AbortSignal) => request("/integrations", IntegrationStatusSchema, { signal }),
  disconnectGmail: () => request("/integrations/gmail", z.object({ disconnected: z.boolean() }), { method: "DELETE" }),
  inject: (scenario: "proposal" | "report" | "ambiguous" | "no_action" | "revision" | "revision_choice", replayKey: string) =>
    request("/demo/inject", DemoInjectResultSchema, { method: "POST", body: { scenario, replayKey } }),
};

export interface DownloadedFile {
  blob: Blob;
  filename: string | null;
  contentType: string;
}

/** Authenticated binary download. Never JSON-parses a successful file body. */
export async function fetchBinary(path: string, signal?: AbortSignal): Promise<DownloadedFile> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", cache: "no-store", signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "NETWORK_ERROR", "Could not reach the server. Check that the app is running, then retry.");
  }
  if (!res.ok) throw await toApiError(res, {});
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") || contentType.includes("text/html")) {
    throw new ApiError(res.status, "BAD_DOWNLOAD", "The server did not return a file.");
  }
  return { blob: await res.blob(), filename: parseFilename(res.headers.get("content-disposition")), contentType };
}

function parseFilename(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try { return decodeURIComponent(star[1]); } catch { /* fall through */ }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() ?? null;
}

/** Plain-language text for an API error. Never shows stack traces or raw bodies. */
export function describeError(err: unknown): string {
  if (!(err instanceof ApiError)) return "Something went wrong. Please try again.";
  switch (err.status) {
    case 0:
      return err.message;
    case 400:
      return err.code === "VALIDATION_ERROR" ? `${err.message} Check the highlighted values and try again.` : err.message;
    case 401:
      return "Your session ended. Sign in again to continue.";
    case 403:
      return err.code === "BAD_ORIGIN"
        ? "The request was blocked because it did not come from this app's address. Open the app at its configured URL."
        : "That action is not allowed.";
    case 404:
      return "That item could not be found.";
    case 409:
      return "This task changed. Refresh to review the latest version.";
    case 413:
      return "That input is too large.";
    case 429:
      return "Too many requests. Wait a minute and try again.";
    case 503:
      return err.code === "GMAIL_NOT_CONFIGURED"
        ? "Gmail is not configured on the server (missing Google client credentials)."
        : "A required service is unavailable right now. Try again shortly.";
    default:
      return err.message || "Something went wrong. Please try again.";
  }
}

export function isStale(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

/** Same-origin relative path only: blocks absolute URLs, protocol-relative URLs, and backslash tricks. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string") return "/";
  // eslint-disable-next-line no-control-regex
  const hasControl = /[\x00-\x1f]/.test(value);
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || hasControl) return "/";
  if (value.startsWith("/login")) return "/";
  return value;
}
