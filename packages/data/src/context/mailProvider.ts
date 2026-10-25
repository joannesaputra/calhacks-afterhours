// Mail source used by history sync and attachment retrieval. The Gmail adapter wraps the existing GmailApi (read-only scope).
import type { GmailApi } from "../gmail/api";
import { headerValue, parseAddress, parseAddressList, parseGmailPayload } from "../gmail/mime";
import { isGmailAuthError } from "../gmail/poll";
import type { AttachmentMeta } from "./mail";

export type ProviderErrorKind = "auth" | "rate_limit" | "temporary" | "not_found" | "forbidden" | "unsupported";
export class ProviderError extends Error {
  constructor(public readonly kind: ProviderErrorKind, message: string) { super(message); this.name = "ProviderError"; }
}

export interface MailMessageData {
  id: string;
  threadId: string | null;
  internalDateMs: number;
  labelIds: string[];
  from: { name: string | null; email: string } | null;
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  attachments: AttachmentMeta[];
}

export interface MailProvider {
  address(): Promise<string>;
  list(q: { afterSec: number | null; beforeSec: number | null; pageToken: string | null; max: number }): Promise<{ ids: string[]; next: string | null }>;
  get(id: string): Promise<MailMessageData>;
  fetchAttachment(messageId: string, attachmentKey: string): Promise<Uint8Array>;
}

function httpStatus(e: unknown): number | null {
  const err = e as { status?: unknown; code?: unknown; response?: { status?: unknown } } | null;
  const n = Number(err?.status ?? err?.response?.status ?? (typeof err?.code === "number" ? err.code : NaN));
  return Number.isInteger(n) ? n : null;
}

export function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const status = httpStatus(e);
  const msg = e instanceof Error ? e.message : String(e);
  if (isGmailAuthError(e)) return new ProviderError("auth", "The mailbox rejected the saved credentials. Reconnect Gmail.");
  if (status === 429 || /rate.?limit|quota/i.test(msg)) return new ProviderError("rate_limit", "The mailbox rate limit was reached.");
  if (status === 404) return new ProviderError("not_found", "The message no longer exists.");
  if (status === 403) return new ProviderError("forbidden", "The mailbox refused the request.");
  return new ProviderError("temporary", "The mailbox could not be reached.");
}

export function createGmailMailProvider(api: GmailApi, mailbox: string): MailProvider {
  const guard = async <T>(fn: () => Promise<T>): Promise<T> => { try { return await fn(); } catch (e) { throw toProviderError(e); } };
  return {
    address: async () => mailbox.toLowerCase(),
    async list({ afterSec, beforeSec, pageToken, max }) {
      if (!api.listMessages) throw new ProviderError("unsupported", "This mail client cannot list history.");
      const q = [afterSec ? `after:${afterSec}` : "", beforeSec ? `before:${beforeSec}` : ""].filter(Boolean).join(" ");
      const r = await guard(() => api.listMessages!(q, pageToken ?? undefined, max));
      return { ids: r.ids, next: r.nextPageToken };
    },
    async get(id) {
      const m = await guard(() => api.getMessage(id));
      const parsed = parseGmailPayload(m.payload);
      const from = parseAddress(headerValue(m.payload, "from"));
      return {
        id: m.id, threadId: m.threadId, internalDateMs: Number(m.internalDate), labelIds: m.labelIds,
        from: from ? { name: from.name, email: from.email } : null,
        to: parseAddressList(headerValue(m.payload, "to")), cc: parseAddressList(headerValue(m.payload, "cc")),
        subject: headerValue(m.payload, "subject") ?? "(no subject)", bodyText: parsed.text,
        attachments: parsed.attachments.map((a) => ({ key: a.id, filename: a.filename, mimeType: a.mimeType, sizeBytes: a.sizeBytes })),
      };
    },
    async fetchAttachment(messageId, key) {
      const m = await guard(() => api.getMessage(messageId));
      const a = parseGmailPayload(m.payload).attachments.find((x) => x.id === key);
      if (!a) throw new ProviderError("not_found", "The attachment is no longer on the message.");
      if (a.inlineData) return new Uint8Array(a.inlineData);
      if (!a.attachmentId) throw new ProviderError("not_found", "The attachment has no content.");
      return new Uint8Array(await guard(() => api.getAttachment(messageId, a.attachmentId!)));
    },
  };
}
