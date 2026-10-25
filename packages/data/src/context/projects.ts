// Lightweight project associations and small source-backed summaries. Both are hints: they never replace the original
// messages or files, every line of a summary names what it came from, and an inferred link never outranks a user choice.
import { createHash } from "node:crypto";
import type { ContextBundle } from "@afterhours/contracts";
import type { Db } from "../db";
import { iso, newId, parseJson } from "../util";

export interface SummaryLine { text: string; sourceType: "email" | "file"; sourceId: string }
export interface ProjectSummary { entityId: string; name: string; lines: SummaryLine[]; updatedAt: string }

function entityFor(db: Db, ownerId: string, name: string, now: Date): string {
  const norm = name.trim().toLowerCase();
  const row = db.prepare("SELECT id FROM project_entities WHERE owner_id=? AND normalized_name=?").get(ownerId, norm) as { id: string } | undefined;
  if (row) return row.id;
  const id = newId();
  db.prepare("INSERT INTO project_entities (id, owner_id, name, normalized_name, kind, created_at) VALUES (?,?,?,?,?,?)").run(id, ownerId, name.trim(), norm, "project", iso(now));
  return id;
}

/**
 * After a request is resolved against a named project, remember what belonged to it: the file, the message that carried
 * it and the feedback messages, each with the reason codes as evidence and a confidence that reflects how many
 * independent signals agreed. Confidence is bounded below 1: only a user's own choice is certain.
 */
export function recordInferredAssociations(db: Db, ownerId: string, explicitTerms: string[], bundle: ContextBundle, emailIds: { deck: string | null; feedback: string[] }, now: Date): string | null {
  const name = [...explicitTerms].sort().slice(0, 4).join(" ");
  if (!name) return null;
  const entity = entityFor(db, ownerId, name, now);
  const link = db.prepare(`INSERT INTO entity_links (id, owner_id, entity_id, target_type, target_id, confidence, origin, evidence_json, created_at)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id, entity_id, target_type, target_id) DO UPDATE SET confidence=MAX(confidence, excluded.confidence), evidence_json=excluded.evidence_json WHERE origin='inferred'`);
  const reasons = bundle.resolvedTarget.reasonCodes;
  const conf = Math.min(0.95, 0.4 + reasons.length * 0.1);
  link.run(newId(), ownerId, entity, "file", bundle.resolvedTarget.fileId, conf, "inferred", JSON.stringify(reasons), iso(now));
  if (emailIds.deck) link.run(newId(), ownerId, entity, "email", emailIds.deck, conf, "inferred", JSON.stringify(["carried_the_file"]), iso(now));
  for (const id of emailIds.feedback) link.run(newId(), ownerId, entity, "email", id, Math.min(0.9, conf - 0.1), "inferred", JSON.stringify(["feedback_for_the_file"]), iso(now));
  refreshProjectSummary(db, ownerId, entity, now);
  return entity;
}

/** Rebuild an entity's summary from the records linked to it. Lines carry their source ids; nothing is paraphrased. */
export function refreshProjectSummary(db: Db, ownerId: string, entityId: string, now: Date): ProjectSummary | null {
  const entity = db.prepare("SELECT id, name FROM project_entities WHERE id=? AND owner_id=?").get(entityId, ownerId) as { id: string; name: string } | undefined;
  if (!entity) return null;
  const lines: SummaryLine[] = [];
  const links = db.prepare("SELECT target_type t, target_id id, origin FROM entity_links WHERE entity_id=? AND owner_id=? ORDER BY created_at LIMIT 30").all(entityId, ownerId) as Array<{ t: string; id: string; origin: string }>;
  for (const l of links) {
    if (l.t === "file") {
      const f = db.prepare("SELECT f.name, v.sent_at, v.modified_at FROM source_files f LEFT JOIN file_versions v ON v.file_id=f.id WHERE f.id=? AND f.owner_id=? ORDER BY v.discovered_at DESC LIMIT 1").get(l.id, ownerId) as { name: string; sent_at: string | null; modified_at: string | null } | undefined;
      if (f) lines.push({ text: `File: ${f.name}${f.sent_at ?? f.modified_at ? ` (${(f.sent_at ?? f.modified_at)!.slice(0, 10)})` : ""}${l.origin === "user_confirmed" ? ", confirmed by you" : ""}`, sourceType: "file", sourceId: l.id });
    } else if (l.t === "email") {
      const e = db.prepare("SELECT subject, from_address, received_at FROM emails WHERE id=? AND owner_id=? AND invalidated_at IS NULL").get(l.id, ownerId) as { subject: string; from_address: string; received_at: string } | undefined;
      if (e) lines.push({ text: `Message: ${e.subject.slice(0, 80)} from ${e.from_address} on ${e.received_at.slice(0, 10)}`, sourceType: "email", sourceId: l.id });
    }
  }
  const hash = createHash("sha256").update(JSON.stringify(lines)).digest("hex");
  const have = db.prepare("SELECT input_hash FROM project_summaries WHERE entity_id=?").get(entityId) as { input_hash: string } | undefined;
  if (have?.input_hash !== hash) {
    db.prepare(`INSERT INTO project_summaries (entity_id, owner_id, summary_json, input_hash, updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(entity_id) DO UPDATE SET summary_json=excluded.summary_json, input_hash=excluded.input_hash, updated_at=excluded.updated_at`).run(entityId, ownerId, JSON.stringify(lines), hash, iso(now));
  }
  return { entityId, name: entity.name, lines, updatedAt: iso(now) };
}

export function getProjectSummary(db: Db, ownerId: string, entityId: string): ProjectSummary | null {
  const row = db.prepare("SELECT s.summary_json, s.updated_at, e.name FROM project_summaries s JOIN project_entities e ON e.id=s.entity_id WHERE s.entity_id=? AND s.owner_id=?").get(entityId, ownerId) as { summary_json: string; updated_at: string; name: string } | undefined;
  return row ? { entityId, name: row.name, lines: parseJson<SummaryLine[]>(row.summary_json, []), updatedAt: row.updated_at } : null;
}
