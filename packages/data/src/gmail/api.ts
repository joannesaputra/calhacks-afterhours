import { OAuth2Client, type Credentials } from "google-auth-library";
import { gmail as gmailClient } from "@googleapis/gmail";
import type { AppConfig } from "../config";
import type { GmailTokens } from "../integrations";
import type { GmailPart } from "./mime";

/** Minimum scope: read only. Connecting never asks for more than this. */
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"] as const;
/** Added only when the user chooses "Allow sending replies": send mail from this account, nothing else (no modify or delete). */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/** True when a stored token's granted scopes include permission to send. */
export const hasSendScope = (scope: string | null | undefined): boolean => (scope ?? "").split(/\s+/).includes(GMAIL_SEND_SCOPE);

export interface GmailMessage {
  id: string;
  threadId: string | null;
  internalDate: string;
  labelIds: string[];
  payload: GmailPart;
}

/** Narrow interface so polling can be tested without Google. */
export interface GmailApi {
  getProfileEmail(): Promise<string>;
  listInbox(query: string, pageToken: string | undefined, max: number): Promise<{ ids: string[]; nextPageToken: string | null }>;
  getMessage(id: string): Promise<GmailMessage>;
  getAttachment(messageId: string, attachmentId: string): Promise<Buffer>;
  /**
   * List mail in any folder (inbox and sent) for history sync. Optional so existing test doubles stay valid; a client
   * without it simply cannot back up history, and the context layer reports that instead of pretending.
   */
  listMessages?(query: string, pageToken: string | undefined, max: number): Promise<{ ids: string[]; nextPageToken: string | null }>;
  /** Send one RFC 822 message (optionally into an existing thread). Optional: test doubles and read-only clients omit it. */
  sendMessage?(raw: Buffer, threadId: string | null): Promise<{ id: string; threadId: string | null }>;
}

export class GmailConfigError extends Error {}

export function buildOAuthClient(config: Pick<AppConfig, "google">): OAuth2Client {
  const { clientId, clientSecret, redirectUri } = config.google;
  if (!clientId || !clientSecret) {
    throw new GmailConfigError("Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  }
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

export function authUrl(client: OAuth2Client, state: string, opts: { send?: boolean } = {}): string {
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: opts.send ? [...GMAIL_SCOPES, GMAIL_SEND_SCOPE] : [...GMAIL_SCOPES],
    state,
    include_granted_scopes: false,
  });
}

/** Convert stored tokens to google-auth-library credentials. */
export function toCredentials(t: GmailTokens): Credentials {
  return {
    access_token: t.access_token ?? null,
    refresh_token: t.refresh_token ?? null,
    expiry_date: t.expiry_date ?? null,
    token_type: t.token_type ?? null,
    scope: t.scope ?? undefined,
  };
}

/** OAuth client loaded with stored tokens; refreshed tokens are reported through onTokens. */
export function clientWithTokens(
  config: Pick<AppConfig, "google">, tokens: GmailTokens, onTokens?: (t: GmailTokens) => void,
): OAuth2Client {
  const client = buildOAuthClient(config);
  client.setCredentials(toCredentials(tokens));
  if (onTokens) client.on("tokens", (t) => onTokens(t));
  return client;
}

export async function exchangeCode(client: OAuth2Client, code: string): Promise<GmailTokens> {
  const { tokens } = await client.getToken(code);
  return tokens;
}

export function createGmailApi(client: OAuth2Client): GmailApi {
  const g = gmailClient({ version: "v1", auth: client });
  return {
    async getProfileEmail() {
      const r = await g.users.getProfile({ userId: "me" });
      if (!r.data.emailAddress) throw new Error("Gmail profile returned no address");
      return r.data.emailAddress.toLowerCase();
    },
    async listInbox(q, pageToken, max) {
      const r = await g.users.messages.list({ userId: "me", q, labelIds: ["INBOX"], pageToken, maxResults: max });
      return { ids: (r.data.messages ?? []).map((m) => m.id!).filter(Boolean), nextPageToken: r.data.nextPageToken ?? null };
    },
    async listMessages(q, pageToken, max) {
      const r = await g.users.messages.list({ userId: "me", q, pageToken, maxResults: max });
      return { ids: (r.data.messages ?? []).map((m) => m.id!).filter(Boolean), nextPageToken: r.data.nextPageToken ?? null };
    },
    async getMessage(id) {
      const r = await g.users.messages.get({ userId: "me", id, format: "full" });
      return {
        id: r.data.id!,
        threadId: r.data.threadId ?? null,
        internalDate: r.data.internalDate ?? "0",
        labelIds: r.data.labelIds ?? [],
        payload: (r.data.payload ?? {}) as GmailPart,
      };
    },
    async getAttachment(messageId, attachmentId) {
      const r = await g.users.messages.attachments.get({ userId: "me", messageId, id: attachmentId });
      return Buffer.from(r.data.data ?? "", "base64url");
    },
    async sendMessage(raw, threadId) {
      const r = await g.users.messages.send({ userId: "me", requestBody: { raw: raw.toString("base64url"), ...(threadId ? { threadId } : {}) } });
      if (!r.data.id) throw new Error("Gmail did not return a message id");
      return { id: r.data.id, threadId: r.data.threadId ?? null };
    },
  };
}
