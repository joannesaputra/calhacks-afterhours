// Child process for batch3.test.ts: one competing mutation against a shared SQLite file.
import { DomainError, markReviewed, openDb, submitAnswers } from "../../src";

const [file, op, taskId, rev] = process.argv.slice(2);
if (!file || !op || !taskId || !rev) throw new Error("usage: race-child <db> <answer|approve|dismiss> <taskId> <revision>");
const db = openDb(file);
try {
  const revision = Number(rev);
  const now = new Date();
  const out =
    op === "answer"
      ? submitAnswers(db, taskId, revision, [{ questionId: "q1", answer: "Scope: brand site" }], now)
      : markReviewed(db, taskId, revision, op === "approve" ? "approve" : "dismiss", now);
  console.log(JSON.stringify({ ok: true, status: out.status, revision: out.revision }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, code: e instanceof DomainError ? e.code : String(e) }));
} finally {
  db.close();
}
