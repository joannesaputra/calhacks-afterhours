import { extractDocument, PARSER_VERSION } from "@afterhours/engine";
import { buildDeckFixture, type FixtureSlide } from "@afterhours/engine/testing";
import type { EmailEnvelope, WorkAnswer } from "@afterhours/contracts";
import {
  createEmailGrant, ingestMessage, patchSettings, ProviderRegistry, resolveContext, runSyncUntilIdle, upsertAccount, OWNER_ID,
  type AppConfig, type ContextDeps, type Db, type ResolveOutcome,
} from "../src";
import { makeTestDb, MemoryFileProvider, MemoryMailProvider, type FixtureMessage } from "../src/testing";

export const MAILBOX = "me@harbor.example";
export const BOSS = "jordan@harbor.example";
export const CLIENT = "sam@client.example";
export const TZ = "America/Los_Angeles";
/** "Now" for the tests: Monday 26 October 2026, 09:05 Pacific. */
export const NOW = new Date("2026-10-26T16:05:00.000Z");
export const REQUEST_AT = "2026-10-26T16:00:00.000Z";

export const SLIDES: FixtureSlide[] = [
  { title: "Maple and Moss kickoff", bullets: ["Harbor Creative proposal"], notes: "Open warmly" },
  { title: "Pricing", bullets: ["Fee is $50,000", "Payment in two instalments", "Travel billed at cost"] },
  { title: "Timeline", bullets: ["Six weeks from kickoff", "Review in week four"] },
  { title: "Team", bullets: ["Two designers", "One producer"] },
];

export const deck = (slides: FixtureSlide[] = SLIDES, mode: "placeholders" | "textboxes" = "placeholders") => buildDeckFixture(slides, mode);

export interface World {
  db: Db; config: AppConfig; accountId: string; mail: MemoryMailProvider; files: { drive: MemoryFileProvider | null; folder: MemoryFileProvider | null };
  deps: ContextDeps; now: Date;
}

export function makeWorld(opts: { now?: Date; lookbackDays?: number | null; messages?: FixtureMessage[]; extraSenders?: string[] } = {}): World {
  const { db, config } = makeTestDb();
  const now = opts.now ?? NOW;
  patchSettings(db, { allowedSenders: [BOSS, CLIENT, ...(opts.extraSenders ?? [])] }, now);
  const account = upsertAccount(db, OWNER_ID, "gmail", MAILBOX, { state: "connected" }, now);
  if (opts.lookbackDays !== null) createEmailGrant(db, OWNER_ID, account.id, { lookbackDays: opts.lookbackDays ?? 90 }, now);
  const mail = new MemoryMailProvider(MAILBOX, opts.messages ?? []);
  const files = { drive: null as MemoryFileProvider | null, folder: null as MemoryFileProvider | null };
  const world: World = {
    db, config, accountId: account.id, mail, files, now,
    deps: {
      artifactsDir: config.artifactsDir, extract: extractDocument, parserVersion: PARSER_VERSION,
      providers: new ProviderRegistry({}, () => mail),
    },
  };
  return world;
}

export function useFiles(w: World, kind: "drive" | "folder", p: MemoryFileProvider): void {
  w.files[kind] = p;
  (w.deps.providers.files as Record<string, unknown>)[kind] = p;
}

export async function syncAll(w: World): Promise<void> {
  const limits = { ...(await import("../src")).DEFAULT_LIMITS };
  await runSyncUntilIdle({ db: w.db, ownerId: OWNER_ID, accountId: w.accountId, provider: w.mail, now: () => w.now, limits }, 100);
}

export interface TestTask { taskId: string; envelope: EmailEnvelope; attachments: Array<{ id: string; filename: string; mimeType: string; bytes: Uint8Array }> }

let counter = 0;
export function makeTask(w: World, o: { from?: string; subject: string; body: string; receivedAt?: string; threadId?: string | null; messageId?: string; attachments?: Array<{ filename: string; bytes: Uint8Array; mimeType?: string }> }): TestTask {
  counter += 1;
  const attachments = (o.attachments ?? []).map((a, i) => ({ id: `att-${i + 1}`, filename: a.filename, mimeType: a.mimeType ?? "application/vnd.openxmlformats-officedocument.presentationml.presentation", bytes: a.bytes }));
  const envelope: EmailEnvelope = {
    providerMessageId: o.messageId ?? `req-${counter}`, providerThreadId: o.threadId ?? null, from: { name: null, email: o.from ?? BOSS }, to: [MAILBOX],
    subject: o.subject, receivedAt: o.receivedAt ?? REQUEST_AT, bodyText: o.body,
    attachments: attachments.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, sizeBytes: a.bytes.byteLength })),
  };
  const out = ingestMessage(w.db, { sourceKey: `gmail:test:${envelope.providerMessageId}`, mode: "gmail", integrationId: null, envelope, attachments, generationMode: "fixture", fixtureScenario: null }, w.now);
  if (out.kind !== "task") throw new Error(`ingest failed: ${out.reason}`);
  return { taskId: out.taskId, envelope, attachments };
}

export async function resolveTask(w: World, t: TestTask, o: { revision?: number; answers?: WorkAnswer[]; deps?: Partial<ContextDeps>; useAccount?: boolean } = {}): Promise<ResolveOutcome> {
  return resolveContext({ ...w.deps, ...o.deps }, {
    db: w.db, taskId: t.taskId, revision: o.revision ?? 1, now: w.now, envelope: t.envelope, attachments: t.attachments, timezone: TZ,
    answers: o.answers ?? [], useAccount: o.useAccount ?? true,
  });
}

export const msg = (m: Partial<FixtureMessage> & Pick<FixtureMessage, "id" | "subject" | "body" | "date">): FixtureMessage => ({
  threadId: null, from: { email: BOSS }, to: [MAILBOX], ...m,
});
