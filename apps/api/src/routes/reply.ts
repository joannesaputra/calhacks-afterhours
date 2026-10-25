import type { FastifyInstance } from "fastify";
import { ReplySendBodySchema } from "@afterhours/contracts";
import { clientWithTokens, createGmailApi, getReplyView, sendReply, type GmailApi, type GmailTokens } from "@afterhours/data";
import type { Ctx } from "../app";

export type MakeGmailApi = (tokens: GmailTokens, onTokens: (t: GmailTokens) => void) => GmailApi;

/** Send the reviewed files back to whoever asked. Reading the panel is a GET; sending needs session and same origin. */
export function registerReplyRoutes(app: FastifyInstance, ctx: Ctx, injected?: MakeGmailApi): void {
  const makeApi: MakeGmailApi = injected ?? ((tokens, onTokens) => createGmailApi(clientWithTokens(ctx.config, tokens, onTokens)));
  const idOf = (req: { params: unknown }) => String((req.params as { id: string }).id);

  app.get("/v1/tasks/:id/reply", { preHandler: [ctx.requireSession] }, async (req) => ({
    data: getReplyView(ctx.db, ctx.config, idOf(req), ctx.now()),
  }));

  app.post(
    "/v1/tasks/:id/reply",
    {
      preHandler: [ctx.requireSession, ctx.requireOrigin],
      // Sending mail is the one action here with an outside effect: keep it slow even for a script holding a session.
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req) => {
      const body = ReplySendBodySchema.parse(req.body);
      return { data: await sendReply({ db: ctx.db, config: ctx.config, now: ctx.now, makeApi }, idOf(req), body) };
    },
  );
}
