import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from "fastify";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { ZodError } from "zod";
import {
  PasswordGate, DomainError, lookupSession, type AppConfig, type Db,
} from "@afterhours/data";
import { registerArtifactRoutes } from "./routes/artifacts";
import { registerContextRoutes } from "./routes/context";
import { registerDemoRoutes } from "./routes/demo";
import { registerIntegrationRoutes, type GmailOAuthPort } from "./routes/integrations";
import { registerSessionRoutes } from "./routes/session";
import { registerSettingsRoutes } from "./routes/settings";
import { registerTaskRoutes } from "./routes/tasks";

export const SESSION_COOKIE = "ah_session";

export interface AppDeps {
  config: AppConfig;
  db: Db;
  now?: () => Date;
  logger?: boolean;
  /** Disable rate limiting (tests). */
  rateLimit?: boolean;
  gmailOAuth?: GmailOAuthPort;
}

export interface Ctx {
  config: AppConfig;
  db: Db;
  now: () => Date;
  gate: PasswordGate;
  publicOrigin: string;
  requireSession: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  requireOrigin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  sessionToken: (req: FastifyRequest) => string | undefined;
}

declare module "fastify" {
  interface FastifyRequest {
    sessionId: string | null;
  }
}

const apiError = (reply: FastifyReply, status: number, code: string, message: string, requestId: string, details?: unknown) =>
  reply.status(status).send({ error: { code, message, ...(details !== undefined ? { details } : {}), requestId } });

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, db } = deps;
  const now = deps.now ?? (() => new Date());
  const options: FastifyServerOptions = {
    genReqId: () => randomUUID(),
    logger: deps.logger
      ? {
          level: "info",
          // Never log headers, bodies, or query strings (OAuth callbacks carry code/state).
          serializers: {
            req: (r: { method: string; url: string }) => ({ method: r.method, path: r.url.split("?")[0] }),
            res: (r: { statusCode: number }) => ({ statusCode: r.statusCode }),
          },
        }
      : false,
    bodyLimit: 256 * 1024,
    // The API is reachable only through the web proxy. Trust exactly one hop so the client IP used for
    // rate limiting is the address the proxy saw, not a client-supplied X-Forwarded-For value.
    trustProxy: (_address: string, hop: number) => hop < 1,
  };
  const app = Fastify(options);

  await app.register(cookie);
  if (deps.rateLimit !== false) {
    await app.register(rateLimit, {
      global: false,
      errorResponseBuilder: () => Object.assign(new Error("Too many requests. Slow down and try again shortly."), { statusCode: 429 }),
    });
  }

  app.decorateRequest("sessionId", null);
  const publicOrigin = new URL(config.publicAppUrl).origin;
  const sessionToken = (req: FastifyRequest) => req.cookies[SESSION_COOKIE];

  const ctx: Ctx = {
    config, db, now,
    gate: new PasswordGate(config.appPassword),
    publicOrigin,
    sessionToken,
    async requireSession(req, reply) {
      const s = lookupSession(db, config.sessionSecret, sessionToken(req), now());
      if (!s) return apiError(reply, 401, "UNAUTHENTICATED", "Sign in to continue.", req.id);
      req.sessionId = s.id;
    },
    async requireOrigin(req, reply) {
      if (req.headers.origin !== publicOrigin) {
        return apiError(reply, 403, "BAD_ORIGIN", "Request origin is not allowed.", req.id);
      }
    },
  };

  app.setNotFoundHandler((req, reply) => apiError(reply, 404, "NOT_FOUND", "Route not found.", req.id));
  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof DomainError) return apiError(reply, err.httpStatus, err.code, err.message, req.id, err.details);
    if (err instanceof ZodError) {
      return apiError(reply, 400, "VALIDATION_ERROR", "Request did not match the expected format.", req.id,
        err.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    if (err.statusCode === 429) return apiError(reply, 429, "RATE_LIMITED", err.message, req.id);
    if (err.statusCode === 413) return apiError(reply, 413, "PAYLOAD_TOO_LARGE", "Request body is too large.", req.id);
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return apiError(reply, err.statusCode, "BAD_REQUEST", "Malformed request.", req.id);
    }
    req.log.error({ errName: err.name, code: err.code }, "unhandled error");
    return apiError(reply, 500, "INTERNAL_ERROR", "Something went wrong on the server.", req.id);
  });

  app.get("/health", async () => ({ data: { status: "ok" } }));
  registerSessionRoutes(app, ctx);
  registerTaskRoutes(app, ctx);
  registerArtifactRoutes(app, ctx);
  registerContextRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);
  registerIntegrationRoutes(app, ctx, deps.gmailOAuth);
  registerDemoRoutes(app, ctx);
  return app;
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
