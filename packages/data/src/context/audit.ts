import type { Db } from "../db";
import { iso } from "../util";

type Scalar = string | number | boolean | null;
const SENSITIVE_KEY = /body|text|content|token|secret|password|subject|quote|excerpt|html|bytes|credential|authorization|url/i;

/**
 * Append a redacted audit event: ids, counts and codes only. A key that could carry content or a credential is stored
 * as "[redacted]" whatever its value, long strings are cut, and nested values are dropped, so a caller cannot leak a
 * message body into the audit trail by mistake.
 */
export function redactDetail(detail: Record<string, unknown>): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (SENSITIVE_KEY.test(k)) { out[k] = "[redacted]"; continue; }
    if (v === null || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.length > 80 ? `${v.slice(0, 77)}...` : v;
  }
  return out;
}

export function auditContext(
  db: Db, ownerId: string, kind: string, subject: { type?: string; id?: string }, detail: Record<string, unknown>, now: Date,
): void {
  db.prepare("INSERT INTO context_audit (owner_id, kind, subject_type, subject_id, detail_json, created_at) VALUES (?,?,?,?,?,?)")
    .run(ownerId, kind.slice(0, 60), subject.type ?? null, subject.id?.slice(0, 80) ?? null, JSON.stringify(redactDetail(detail)), iso(now));
  // Bounded: keep the newest 5000 events per owner.
  db.prepare("DELETE FROM context_audit WHERE owner_id = ? AND id <= (SELECT COALESCE(MAX(id),0) - 5000 FROM context_audit WHERE owner_id = ?)").run(ownerId, ownerId);
}
