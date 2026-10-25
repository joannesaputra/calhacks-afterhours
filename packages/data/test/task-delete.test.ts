import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deleteTask, ingestMessage, markReviewed, patchSettings } from "../src";
import { makeTestDb, seedApprovedReply } from "../src/testing";

const T = new Date("2026-03-03T09:00:00Z");
const count = (db: ReturnType<typeof makeTestDb>["db"], table: string, taskId: string) =>
  (db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE task_id = ?`).get(taskId) as { n: number }).n;

describe("deleteTask", () => {
  it("removes the task, everything attached to it, its stored email and its files, and nothing else", () => {
    const { db, config } = makeTestDb();
    const a = seedApprovedReply(db, config);
    db.prepare("INSERT INTO task_events (id, task_id, revision, type, stage, message, created_at) VALUES ('e1', ?, 1, 'status', 'intake', 'x', ?)").run(a.taskId, T.toISOString());
    db.prepare("INSERT INTO reply_sends (id, task_id, revision, status, to_email, subject, artifact_ids_json, created_at, updated_at) VALUES ('r1', ?, 1, 'sent', 'jordan@client.example', 's', '[]', ?, ?)").run(a.taskId, T.toISOString(), T.toISOString());
    const intakeId = (db.prepare("SELECT intake_id FROM tasks WHERE id=?").get(a.taskId) as { intake_id: string }).intake_id;
    const dir = path.join(config.artifactsDir, a.taskId);
    expect(existsSync(dir)).toBe(true);

    // a second, unrelated task must survive
    const other = ingestMessage(db, {
      sourceKey: "gmail:x:other", mode: "gmail", integrationId: (db.prepare("SELECT id FROM integrations").get() as { id: string }).id,
      envelope: { providerMessageId: "m2", providerThreadId: null, from: { name: null, email: "jordan@client.example" }, to: [], subject: "Other", receivedAt: T.toISOString(), bodyText: "Please prepare a report.", attachments: [] },
      attachments: [], generationMode: "fixture", fixtureScenario: null,
    }, T);
    expect(other.kind).toBe("task");

    expect(deleteTask(db, config, a.taskId, T)).toEqual({ deleted: true, files: 2 });
    for (const table of ["tasks", "artifacts", "task_events", "reply_sends"]) {
      expect((db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${table === "tasks" ? "id" : "task_id"} = ?`).get(a.taskId) as { n: number }).n, table).toBe(0);
    }
    expect(db.prepare("SELECT 1 FROM intake_messages WHERE id=?").get(intakeId)).toBeUndefined();
    expect(existsSync(dir)).toBe(false);
    expect(other.kind === "task" && db.prepare("SELECT 1 FROM tasks WHERE id=?").get(other.taskId)).toBeTruthy();
    expect(count(db, "artifacts", a.taskId)).toBe(0);
  });

  it("remembers only the message key, so the same email never becomes a task again", () => {
    const { db, config } = makeTestDb();
    const a = seedApprovedReply(db, config);
    const key = (db.prepare("SELECT m.source_key k FROM tasks t JOIN intake_messages m ON m.id=t.intake_id WHERE t.id=?").get(a.taskId) as { k: string }).k;
    deleteTask(db, config, a.taskId, T);
    const row = db.prepare("SELECT * FROM deleted_intake").get() as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(["deleted_at", "source_key"]);
    expect(row.source_key).toBe(key);
    const again = ingestMessage(db, {
      sourceKey: key, mode: "gmail", integrationId: (db.prepare("SELECT id FROM integrations").get() as { id: string }).id,
      envelope: { providerMessageId: "msg-1", providerThreadId: "thr-1", from: { name: null, email: a.sender }, to: [], subject: "Please prepare the proposal", receivedAt: T.toISOString(), bodyText: "Please prepare the proposal.", attachments: [] },
      attachments: [], generationMode: "fixture", fixtureScenario: null,
    }, T);
    expect(again).toEqual({ kind: "ignored", reason: "previously_deleted" });
    expect((db.prepare("SELECT COUNT(*) n FROM tasks").get() as { n: number }).n).toBe(0);
  });

  it("does not block a demo message with the same key from being injected again", () => {
    const { db, config } = makeTestDb();
    const a = seedApprovedReply(db, config, { mode: "demo", sender: "jordan@client.example", connect: false });
    deleteTask(db, config, a.taskId, T);
    expect((db.prepare("SELECT COUNT(*) n FROM deleted_intake").get() as { n: number }).n).toBe(0);
  });

  it("refuses a task a worker may be using, and a task that does not exist", () => {
    const { db, config } = makeTestDb();
    for (const status of ["queued", "planning", "running"]) {
      const a = seedApprovedReply(db, config, { status });
      expect(() => deleteTask(db, config, a.taskId, T), status).toThrow(expect.objectContaining({ code: "TASK_ACTIVE", httpStatus: 409 }));
      expect(db.prepare("SELECT 1 FROM tasks WHERE id=?").get(a.taskId)).toBeTruthy();
      db.prepare("DELETE FROM tasks WHERE id=?").run(a.taskId);
      db.prepare("DELETE FROM intake_messages").run();
    }
    expect(() => deleteTask(db, config, "nope", T)).toThrow(expect.objectContaining({ httpStatus: 404 }));
  });

  it("deletes finished tasks in every settled state, and records no email content in the audit trail", () => {
    const { db, config } = makeTestDb();
    for (const status of ["ready", "approved", "dismissed", "failed", "skipped", "needs_input"]) {
      db.prepare("DELETE FROM intake_messages").run();
      const a = seedApprovedReply(db, config, { status, key: status });
      expect(deleteTask(db, config, a.taskId, T).deleted, status).toBe(true);
    }
    const audit = JSON.stringify(db.prepare("SELECT reason, source_ref FROM intake_audit WHERE reason='task_deleted'").all());
    expect(audit).toContain("task_deleted");
    expect(audit).not.toMatch(/jordan|proposal|client\.example/i);
    void markReviewed; void patchSettings;
  });
});
