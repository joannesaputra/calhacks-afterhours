/* global AbortController, TextEncoder, TextDecoder */
// Engine-boundary seam: calls the real runWork() in-process with copied synthetic attachment bytes.
// The public /v1/demo/inject endpoint takes only a scenario name, so changed-input checks must use this seam.
// This is NOT full HTTP/worker evidence; label results accordingly.
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./harness.mjs";

export async function loadEngine() { return import(path.join(REPO_ROOT, "packages/engine/src/index.ts")); }

export function scenarioInput(name, { csvTransform, bodyText, attachmentText } = {}) {
  const sc = JSON.parse(readFileSync(path.join(REPO_ROOT, "fixtures/scenarios", `${name}.json`), "utf8"));
  const organization = JSON.parse(readFileSync(path.join(REPO_ROOT, "fixtures/organization/harbor-creative.json"), "utf8"));
  const attachments = (sc.attachmentFiles ?? []).map((a) => {
    const meta = sc.email.attachments.find((m) => m.id === a.attachmentId);
    let bytes = new Uint8Array(readFileSync(path.join(REPO_ROOT, "fixtures", a.relativePath)));
    if (csvTransform && meta.filename.endsWith(".csv")) bytes = new TextEncoder().encode(csvTransform(new TextDecoder().decode(bytes)));
    if (attachmentText && !meta.filename.endsWith(".csv")) bytes = new TextEncoder().encode(attachmentText);
    return { id: a.attachmentId, filename: meta.filename, mimeType: meta.mimeType, bytes };
  });
  const email = { ...sc.email, ...(bodyText === undefined ? {} : { bodyText }), attachments: sc.email.attachments };
  return { taskId: "qa-direct-task", revision: 1, mode: "fixture", email, attachments, organization, answers: [], now: "2026-10-24T00:00:00.000Z", fixtureScenario: sc.scenario };
}

export async function run(input) {
  const { runWork } = await loadEngine();
  const progress = [];
  const result = await runWork(input, { signal: new AbortController().signal, onProgress: async (p) => { progress.push(p.stage); } });
  return { result, progress };
}
