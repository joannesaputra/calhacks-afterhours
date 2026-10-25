// Test helpers shared by data/api/worker tests. Not imported by production code.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import type {
  EngineInput, EngineResult, GeneratedFile, WorkPlan, WorkProduct, SourceDocument,
} from "@afterhours/contracts";
import { bootstrapDb } from "./bootstrap";
import { findRepoRoot, loadConfig, type AppConfig } from "./config";
import type { Db } from "./db";
import { MIME_BY_FORMAT } from "./artifacts";

export function makeTestConfig(overrides: Record<string, string> = {}): AppConfig {
  const dir = mkdtempSync(path.join(tmpdir(), "afterhours-test-"));
  return loadConfig(
    {
      NODE_ENV: "test",
      SESSION_SECRET: "s".repeat(40),
      APP_PASSWORD: "correct-horse-battery",
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      DATABASE_PATH: path.join(dir, "test.sqlite"),
      ARTIFACTS_DIR: path.join(dir, "artifacts"),
      DEMO_ENABLED: "true",
      DEMO_CLI_TOKEN: "cli-token-for-tests",
      PUBLIC_APP_URL: "http://localhost:3000",
      ...overrides,
    },
    findRepoRoot(import.meta.dirname),
  );
}

export function makeTestDb(config: AppConfig = makeTestConfig()): { db: Db; config: AppConfig } {
  return { db: bootstrapDb(config), config };
}

/** A real (minimal) Office ZIP container for the given format. */
export function officeBytes(format: "docx" | "pptx", marker = "x"): Uint8Array {
  const parts: Record<string, Uint8Array> =
    format === "docx"
      ? {
          "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
          "word/document.xml": strToU8(`<w:document><w:body><w:p>${marker.repeat(40)}</w:p></w:body></w:document>`),
        }
      : {
          "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
          "ppt/presentation.xml": strToU8(`<p:presentation>${marker.repeat(40)}</p:presentation>`),
        };
  return zipSync(parts);
}

const plan = (title = "Proposal and kickoff deck"): WorkPlan => ({
  title, requestSummary: "Prepare a proposal and a five-slide deck.", requestedOutputs: ["proposal", "presentation"],
  dueAt: null, dueAtExplanation: null, steps: ["Read brief", "Draft"], assumptions: [], questions: [], sourcesUsed: ["email"],
});

const sources = (): SourceDocument[] => [
  { id: "email", kind: "email", title: "Email", filename: null, mimeType: "text/plain", text: "body", extractionStatus: "complete", warnings: [] },
];

const block = (id: string) => ({
  id, kind: "paragraph" as const, heading: "Summary", text: "Text", items: [], columns: [], rows: [], chart: null,
  evidence: [{ sourceId: "email", locator: null, quote: null }], basis: "source" as const,
});

export function readyResult(input: Pick<EngineInput, "taskId" | "revision">): Extract<EngineResult, { outcome: "ready" }> {
  const doc: WorkProduct = {
    id: `${input.taskId}-r${input.revision}-proposal`, kind: "proposal", title: "Proposal", subtitle: null,
    blocks: [block("b1")], slides: [], assumptions: [], warnings: [],
  };
  const deck: WorkProduct = {
    id: `${input.taskId}-r${input.revision}-presentation`, kind: "presentation", title: "Deck", subtitle: null,
    blocks: [], slides: [{ id: "s1", title: "Intro", layout: "title", blocks: [block("b2")], speakerNotes: "" }],
    assumptions: [], warnings: [],
  };
  const files: GeneratedFile[] = [
    { id: `${doc.id}-docx`, productId: doc.id, format: "docx", filename: "Proposal.docx", mimeType: MIME_BY_FORMAT.docx, bytes: officeBytes("docx", input.taskId.slice(0, 4)) },
    { id: `${deck.id}-pptx`, productId: deck.id, format: "pptx", filename: "Kickoff Deck.pptx", mimeType: MIME_BY_FORMAT.pptx, bytes: officeBytes("pptx", input.taskId.slice(0, 4)) },
  ];
  return { outcome: "ready", plan: plan(), sources: sources(), products: [doc, deck], files, warnings: [] };
}

export const testPlan = plan;
export const testSources = sources;

// ---- Scenario helpers ----
import { publishArtifactFiles } from "./artifacts";
import { injectDemo } from "./demo";
import { claimNextJob, commitEngineResult, type ClaimedJob } from "./queue";

export function injectTask(db: Db, config: AppConfig, key: string, now: Date, scenario: "proposal" | "report" | "ambiguous" | "no_action" = "proposal"): string {
  const out = injectDemo(db, config, scenario, key, now);
  if (out.kind !== "task") throw new Error(`inject failed: ${out.reason}`);
  return out.taskId;
}

export function runToReady(db: Db, config: AppConfig, key: string, now: Date): { taskId: string; claimed: ClaimedJob } {
  const taskId = injectTask(db, config, key, now);
  const claimed = claimNextJob(db, "test-worker", now);
  if (!claimed || claimed.taskId !== taskId) throw new Error("expected to claim the injected task");
  const result = readyResult({ taskId, revision: claimed.revision });
  const stored = publishArtifactFiles(config.artifactsDir, taskId, claimed.revision, result.files);
  commitEngineResult(db, {
    taskId, revision: claimed.revision, ownerToken: claimed.ownerToken, now,
    outcome: "ready", plan: result.plan, sources: result.sources, products: result.products, warnings: [], files: stored,
  });
  return { taskId, claimed };
}

export * from "./context/testing";
