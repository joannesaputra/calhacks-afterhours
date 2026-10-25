import type { FastifyInstance } from "fastify";
import {
  GmailConfigError, authUrl, buildOAuthClient, clientWithTokens, consumeOauthState, createGmailApi, createOauthState,
  disconnectGmail, exchangeCode, getGmailTokens, getIntegrationStatus, lookupSession, oauthRedirectProblem,
  saveGmailConnection, DomainError, GMAIL_SCOPES, reflectGmailIntegration, OWNER_ID, type GmailTokens,
} from "@afterhours/data";
import type { Ctx } from "../app";

/** Injectable Google boundary so OAuth flow is testable without Google. */
export interface GmailOAuthPort {
  authUrl(state: string): string;
  exchange(code: string): Promise<GmailTokens>;
  profileEmail(tokens: GmailTokens): Promise<string>;
  revoke(tokens: GmailTokens): Promise<void>;
}

export function googleOAuthPort(ctx: Ctx): GmailOAuthPort {
  return {
    authUrl: (state) => authUrl(buildOAuthClient(ctx.config), state),
    exchange: (code) => exchangeCode(buildOAuthClient(ctx.config), code),
    async profileEmail(tokens) {
      return createGmailApi(clientWithTokens(ctx.config, tokens)).getProfileEmail();
    },
    async revoke(tokens) {
      const c = buildOAuthClient(ctx.config);
      const t = tokens.refresh_token ?? tokens.access_token;
      if (t) await c.revokeToken(t);
    },
  };
}

const back = (marker: string) => `/settings?gmail=${marker}`;

export function registerIntegrationRoutes(app: FastifyInstance, ctx: Ctx, injected?: GmailOAuthPort): void {
  const port = injected ?? googleOAuthPort(ctx);

  app.get("/v1/integrations", { preHandler: ctx.requireSession }, async () => ({
    data: getIntegrationStatus(ctx.db, ctx.config, ctx.now()),
  }));

  app.get("/v1/integrations/gmail/start", { preHandler: ctx.requireSession }, async (req, reply) => {
    // Connect is a top-level browser navigation: send a browser back to Settings with a safe marker
    // instead of leaving it on a raw JSON error page. API clients still get the 503 error body.
    const browser = /text\/html/.test(String(req.headers.accept ?? ""));
    if (!ctx.config.google.clientId || !ctx.config.google.clientSecret) {
      if (browser) return reply.redirect(back("error&reason=not_configured"));
      throw new DomainError("GMAIL_NOT_CONFIGURED", "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.", 503);
    }
    // A callback on any origin other than PUBLIC_APP_URL cannot carry the session cookie, so refuse early.
    const redirectProblem = oauthRedirectProblem(ctx.config);
    if (redirectProblem) {
      if (browser) return reply.redirect(back("error&reason=redirect_mismatch"));
      throw new DomainError("GMAIL_REDIRECT_MISMATCH", redirectProblem, 503);
    }
    let url: string;
    const state = createOauthState(ctx.db, req.sessionId!, ctx.now());
    try {
      url = port.authUrl(state);
    } catch (e) {
      if (e instanceof GmailConfigError) {
        throw new DomainError("GMAIL_NOT_CONFIGURED", e.message, 503);
      }
      throw e;
    }
    return reply.redirect(url);
  });

  // Not behind requireSession: it is a top-level redirect from Google. The state binds to the session.
  app.get("/v1/integrations/gmail/callback", async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const session = lookupSession(ctx.db, ctx.config.sessionSecret, ctx.sessionToken(req), ctx.now());
    const state = consumeOauthState(ctx.db, typeof q.state === "string" ? q.state : undefined, session?.id ?? null, ctx.now());
    if (state !== "ok") {
      const marker = state === "expired" ? "expired" : state === "session_mismatch" ? "session" : "invalid_state";
      return reply.redirect(back(`error&reason=${marker}`));
    }
    if (q.error || !q.code) return reply.redirect(back("error&reason=denied"));
    try {
      const tokens = await port.exchange(q.code);
      if (!tokens.refresh_token) return reply.redirect(back("error&reason=no_refresh_token"));
      // The user can untick the permission on Google's consent screen; without read access polling cannot work.
      const granted = (tokens.scope ?? "").split(/\s+/);
      if (tokens.scope && !GMAIL_SCOPES.every((sc) => granted.includes(sc))) {
        try { await port.revoke(tokens); } catch { /* best effort */ }
        return reply.redirect(back("error&reason=scope"));
      }
      const email = await port.profileEmail(tokens);
      saveGmailConnection(ctx.db, ctx.config.tokenEncryptionKey, { account: email, tokens }, ctx.now());
      reflectGmailIntegration(ctx.db, OWNER_ID, ctx.now());
      return reply.redirect(back("connected"));
    } catch (e) {
      req.log.warn({ errName: e instanceof Error ? e.name : "unknown" }, "gmail oauth exchange failed");
      return reply.redirect(back("error&reason=exchange_failed"));
    }
  });

  app.delete("/v1/integrations/gmail", { preHandler: [ctx.requireSession, ctx.requireOrigin] }, async () => {
    let tokens: GmailTokens | null = null;
    try { tokens = getGmailTokens(ctx.db, ctx.config.tokenEncryptionKey); } catch { /* unreadable: just drop */ }
    // Delete locally first so polling stops at once and a late refresh cannot write back; then revoke the copy.
    disconnectGmail(ctx.db, ctx.now());
    // Every history and file grant tied to the mailbox is revoked with it; retained copies stay until purged.
    reflectGmailIntegration(ctx.db, OWNER_ID, ctx.now());
    if (tokens) { try { await port.revoke(tokens); } catch { /* best effort */ } }
    return { data: { disconnected: true } };
  });
}
