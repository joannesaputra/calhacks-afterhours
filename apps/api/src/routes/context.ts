import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ContextCorrectionBodySchema, CreateGrantBodySchema, type FolderOptions } from "@afterhours/contracts";
import {
  DomainError, GrantError, OWNER_ID, applyContextCorrection, badRequest, buildFileProviders, createEmailGrant, createFilesGrant, getContextStatus, getContextView,
  getOpenableEmail, getOpenableFile, notFound, purgeGrantData, reflectGmailIntegration, revokeGrant, upsertAccount, sanitizeFilename,
} from "@afterhours/data";
import type { Ctx } from "../app";

const grantError = (e: unknown): never => {
  if (e instanceof GrantError) throw new DomainError(e.code, e.message, e.code === "GRANT_NOT_FOUND" || e.code === "ACCOUNT_NOT_FOUND" ? 404 : 409);
  throw e;
};

export function registerContextRoutes(app: FastifyInstance, ctx: Ctx): void {
  const read = { preHandler: ctx.requireSession };
  const write = { preHandler: [ctx.requireSession, ctx.requireOrigin] };
  const idOf = (req: { params: unknown }) => String((req.params as { id: string }).id);

  app.get("/v1/context", read, async () => {
    reflectGmailIntegration(ctx.db, OWNER_ID, ctx.now());
    return { data: getContextStatus(ctx.db, ctx.config, ctx.now()) };
  });

  app.post("/v1/context/grants", write, async (req) => {
    const body = CreateGrantBodySchema.parse(req.body);
    const now = ctx.now();
    const expires = (days: number | null | undefined) => (days ? new Date(now.getTime() + days * 86_400_000) : null);
    try {
      if (body.kind === "email") {
        const account = reflectGmailIntegration(ctx.db, OWNER_ID, now);
        if (!account || account.state === "disconnected") throw new DomainError("GMAIL_NOT_CONNECTED", "Connect Gmail in Settings before sharing email history. You can still attach files to emails without it.", 409);
        const g = createEmailGrant(ctx.db, OWNER_ID, account.id, { lookbackDays: body.lookbackDays, expiresAt: expires(body.expiresInDays) }, now);
        return { data: { id: g.id } };
      }
      if (body.provider === "drive") throw new DomainError("PROVIDER_UNAVAILABLE", "Google Drive is not connected in this installation. Choose a local project folder, or attach the file to your email.", 409);
      const provider = buildFileProviders(ctx.config).folder;
      if (!provider) throw new DomainError("PROVIDER_UNAVAILABLE", "No local folder source is configured on the server (CONTEXT_FILES_ROOT). Attach the file to your email instead.", 409);
      for (const item of body.selected) {
        const st = await provider.stat(item.providerId);
        if ("missing" in st) throw badRequest(`"${item.label}" is not available inside the configured folder.`);
        if (st.shortcutTargetId) throw badRequest(`"${item.label}" is a link. Choose the real file or folder.`);
        if (st.isFolder !== (item.kind === "folder")) throw badRequest(`"${item.label}" is not a ${item.kind}.`);
      }
      const account = upsertAccount(ctx.db, OWNER_ID, "folder", "project-files", { state: "connected", capabilities: { scope: "selected-folders", enforcedBy: "afterhours" } }, now);
      const g = createFilesGrant(ctx.db, OWNER_ID, account.id, body.selected, { expiresAt: expires(body.expiresInDays) }, now);
      return { data: { id: g.id } };
    } catch (e) { return grantError(e); }
  });

  app.delete("/v1/context/grants/:id", write, async (req) => {
    const ok = revokeGrant(ctx.db, OWNER_ID, idOf(req), "revoked_by_user", ctx.now());
    if (!ok) throw notFound("Grant");
    return { data: { revoked: true } };
  });

  app.post("/v1/context/grants/:id/purge", write, async (req) => {
    try { return { data: purgeGrantData(ctx.db, ctx.config.artifactsDir, OWNER_ID, idOf(req), ctx.now()) }; } catch (e) { return grantError(e); }
  });

  app.get("/v1/context/folders", read, async (req): Promise<{ data: FolderOptions }> => {
    const q = z.object({ parent: z.string().max(500).default("") }).parse(req.query);
    const provider = buildFileProviders(ctx.config).folder;
    if (!provider) return { data: { available: false, limitation: "No local folder source is configured on the server (CONTEXT_FILES_ROOT).", parent: "", entries: [] } };
    const page = await provider.list(q.parent, { pageToken: null, limit: 200 });
    if ("missing" in page) throw badRequest("That folder is not available.");
    return { data: { available: true, limitation: null, parent: q.parent, entries: page.entries.filter((e) => !e.shortcutTargetId).map((e) => ({ id: e.id, name: e.name, kind: e.isFolder ? "folder" as const : "file" as const })) } };
  });

  app.get("/v1/tasks/:id/context", read, async (req) => ({ data: getContextView(ctx.db, idOf(req), ctx.now()) }));

  app.post("/v1/tasks/:id/context/corrections", write, async (req) => {
    const body = ContextCorrectionBodySchema.parse(req.body);
    return { data: applyContextCorrection(ctx.db, idOf(req), body, ctx.now()) };
  });

  // Opening a source is allowed only while the grant that covers it is in force.
  app.get("/v1/context/emails/:id", read, async (req) => ({ data: getOpenableEmail(ctx.db, OWNER_ID, idOf(req), ctx.now()) }));

  app.get("/v1/context/files/:id/download", read, async (req, reply) => {
    const f = getOpenableFile(ctx.db, ctx.config.artifactsDir, OWNER_ID, idOf(req), ctx.now());
    const name = sanitizeFilename(f.filename, "source-file");
    const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    return reply
      .header("Content-Type", f.mimeType).header("Content-Length", f.bytes.byteLength)
      .header("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`)
      .header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff")
      .send(f.bytes);
  });
}
