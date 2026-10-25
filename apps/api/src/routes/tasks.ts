import type { FastifyInstance } from "fastify";
import { AnswersBodySchema, RetryBodySchema, ReviewBodySchema, TaskListQuerySchema } from "@afterhours/contracts";
import {
  deleteTask, getTaskDetail, listNotifications, listTasks, markReviewed, retryFailedTask, submitAnswers,
} from "@afterhours/data";
import type { Ctx } from "../app";

export function registerTaskRoutes(app: FastifyInstance, ctx: Ctx): void {
  const read = { preHandler: ctx.requireSession };
  const write = { preHandler: [ctx.requireSession, ctx.requireOrigin] };
  const idOf = (req: { params: unknown }) => String((req.params as { id: string }).id);

  app.get("/v1/tasks", read, async (req) => {
    const q = TaskListQuerySchema.parse(req.query);
    return { data: listTasks(ctx.db, q) };
  });
  app.get("/v1/tasks/:id", read, async (req) => ({ data: getTaskDetail(ctx.db, idOf(req)) }));

  app.post("/v1/tasks/:id/answers", write, async (req) => {
    const b = AnswersBodySchema.parse(req.body);
    return { data: submitAnswers(ctx.db, idOf(req), b.revision, b.answers, ctx.now()) };
  });
  app.post("/v1/tasks/:id/retry", write, async (req) => {
    const b = RetryBodySchema.parse(req.body);
    return { data: retryFailedTask(ctx.db, idOf(req), b.revision, ctx.now()) };
  });
  app.delete("/v1/tasks/:id", write, async (req) => ({ data: deleteTask(ctx.db, ctx.config, idOf(req), ctx.now()) }));
  app.post("/v1/tasks/:id/review", write, async (req) => {
    const b = ReviewBodySchema.parse(req.body);
    return { data: markReviewed(ctx.db, idOf(req), b.revision, b.action, ctx.now()) };
  });

  app.get("/v1/notifications", read, async (req) => {
    const q = TaskListQuerySchema.pick({ cursor: true, limit: true }).parse(req.query);
    return { data: listNotifications(ctx.db, q.cursor ?? null, Math.min(q.limit ?? 30, 100)) };
  });
}
