// Test doubles for the context layer. Everything here is an explicit MOCK of a provider (`isMock = true`): it exercises the
// real sync, grant, retrieval and extraction code against synthetic data and is never evidence of a live integration.
import { ProviderError, type MailMessageData, type MailProvider } from "./mailProvider";
import type { FileProvider, ProviderEntry, ProviderMissing, ProviderOpen } from "./files";
import type { AttachmentMeta } from "./mail";

export interface FixtureAttachment { key?: string; filename: string; mimeType?: string; bytes: Uint8Array }
export interface FixtureMessage {
  id: string; threadId: string | null; from: { name?: string; email: string }; to: string[]; cc?: string[]; subject: string; body: string;
  date: string; labels?: string[]; attachments?: FixtureAttachment[];
}

export class MemoryMailProvider implements MailProvider {
  readonly isMock = true;
  readonly messages = new Map<string, FixtureMessage>();
  readonly calls = { list: 0, get: 0, attachment: 0 };
  /** Errors thrown by the next calls, in order (any method). */
  readonly failures: ProviderError[] = [];
  constructor(readonly mailbox: string, messages: FixtureMessage[] = []) { for (const m of messages) this.messages.set(m.id, m); }
  add(m: FixtureMessage): void { this.messages.set(m.id, m); }
  remove(id: string): void { this.messages.delete(id); }
  private maybeFail(): void { const f = this.failures.shift(); if (f) throw f; }
  async address(): Promise<string> { return this.mailbox; }
  async list(q: { afterSec: number | null; beforeSec: number | null; pageToken: string | null; max: number }) {
    this.calls.list += 1; this.maybeFail();
    const all = [...this.messages.values()].filter((m) => {
      const t = Date.parse(m.date) / 1000;
      return (q.afterSec === null || t >= q.afterSec) && (q.beforeSec === null || t < q.beforeSec);
    }).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const from = q.pageToken ? Number(q.pageToken) : 0;
    const slice = all.slice(from, from + q.max);
    return { ids: slice.map((m) => m.id), next: from + q.max < all.length ? String(from + q.max) : null };
  }
  async get(id: string): Promise<MailMessageData> {
    this.calls.get += 1; this.maybeFail();
    const m = this.messages.get(id);
    if (!m) throw new ProviderError("not_found", "gone");
    const attachments: AttachmentMeta[] = (m.attachments ?? []).map((a, i) => ({ key: a.key ?? `att-${i + 1}`, filename: a.filename, mimeType: a.mimeType ?? "application/octet-stream", sizeBytes: a.bytes.byteLength }));
    return { id: m.id, threadId: m.threadId, internalDateMs: Date.parse(m.date), labelIds: m.labels ?? [], from: { name: m.from.name ?? null, email: m.from.email }, to: m.to, cc: m.cc ?? [], subject: m.subject, bodyText: m.body, attachments };
  }
  async fetchAttachment(messageId: string, key: string): Promise<Uint8Array> {
    this.calls.attachment += 1; this.maybeFail();
    const m = this.messages.get(messageId);
    const a = m?.attachments?.find((x, i) => (x.key ?? `att-${i + 1}`) === key);
    if (!a) throw new ProviderError("not_found", "attachment gone");
    return a.bytes;
  }
}

export interface MemoryEntry {
  id: string; name: string; mime?: string; parent: string | null; folder?: boolean; shortcutTo?: string | null; content?: Uint8Array;
  revision?: string; modifiedAt?: string; forbidden?: boolean; mutable?: boolean;
}

/** Drive-like mock: parent folders, shortcuts, revisions, deletion and forbidden files. */
export class MemoryFileProvider implements FileProvider {
  readonly isMock = true;
  readonly available = true;
  readonly limitation = null;
  readonly scopeNote = "Mock provider for tests. The selected-folder restriction is enforced by the application.";
  readonly entries = new Map<string, MemoryEntry>();
  readonly calls = { stat: 0, list: 0, open: 0 };
  failNext: ProviderMissing["reason"] | null = null;
  constructor(readonly id: "folder" | "drive", entries: MemoryEntry[] = []) { for (const e of entries) this.put(e); }
  put(e: MemoryEntry): void { this.entries.set(e.id, { revision: "r1", modifiedAt: "2026-10-20T12:00:00.000Z", mutable: true, ...e }); }
  setContent(id: string, bytes: Uint8Array, modifiedAt = "2026-10-25T12:00:00.000Z"): void {
    const e = this.entries.get(id)!; const n = Number((e.revision ?? "r0").slice(1)) + 1;
    this.entries.set(id, { ...e, content: bytes, revision: `r${n}`, modifiedAt });
  }
  remove(id: string): void { this.entries.delete(id); }
  private view(e: MemoryEntry): ProviderEntry {
    return { id: e.id, name: e.name, mimeType: e.folder ? "inode/directory" : e.mime ?? "application/vnd.openxmlformats-officedocument.presentationml.presentation", parentId: e.parent, isFolder: !!e.folder,
      shortcutTargetId: e.shortcutTo ?? null, sizeBytes: e.content?.byteLength ?? null, modifiedAt: e.modifiedAt ?? null, versionKey: e.folder ? null : e.revision ?? null, mutable: e.mutable ?? true };
  }
  private miss(): ProviderMissing | null { if (!this.failNext) return null; const reason = this.failNext; this.failNext = null; return { missing: true, reason, message: reason === "temporary" ? "The provider timed out." : `The provider reported ${reason}.` }; }
  async stat(id: string) {
    this.calls.stat += 1; const f = this.miss(); if (f) return f;
    const e = this.entries.get(id);
    if (!e) return { missing: true as const, reason: "deleted" as const, message: "The file no longer exists." };
    if (e.forbidden) return { missing: true as const, reason: "forbidden" as const, message: "You no longer have access to this file." };
    return this.view(e);
  }
  async list(folderId: string, opts: { pageToken: string | null; limit: number }) {
    this.calls.list += 1; const f = this.miss(); if (f) return f;
    if (!this.entries.get(folderId)?.folder) return { missing: true as const, reason: "deleted" as const, message: "The folder no longer exists." };
    const kids = [...this.entries.values()].filter((e) => e.parent === folderId && !e.forbidden).sort((a, b) => a.name.localeCompare(b.name));
    const from = opts.pageToken ? Number(opts.pageToken) : 0;
    return { entries: kids.slice(from, from + opts.limit).map((e) => this.view(e)), next: from + opts.limit < kids.length ? String(from + opts.limit) : null };
  }
  async open(id: string): Promise<ProviderOpen> {
    this.calls.open += 1; const f = this.miss(); if (f) return { ok: false, reason: f.reason, message: f.message };
    const e = this.entries.get(id);
    if (!e) return { ok: false, reason: "deleted", message: "The file no longer exists." };
    if (e.forbidden) return { ok: false, reason: "forbidden", message: "You no longer have access to this file." };
    if (e.folder || !e.content) return { ok: false, reason: "forbidden", message: "Not a file." };
    return { ok: true, bytes: e.content, entry: this.view(e) };
  }
  async ancestors(id: string): Promise<string[] | null> {
    const out: string[] = []; let cur = this.entries.get(id);
    if (!cur) return null;
    for (let i = 0; i < 30 && cur.parent; i += 1) { out.push(cur.parent); cur = this.entries.get(cur.parent); if (!cur) break; }
    return out;
  }
}
