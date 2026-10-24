/* global setTimeout */
// Scenarios A, B, N (+ timing J of the four-person list): canonical proposal and CSV report through the
// REAL path: CLI-token inject -> API -> separate worker process -> real engine -> artifact store -> authenticated download.
// Evidence is structural (ZIP/XML text). It does NOT prove visual rendering.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { record } from "./support/evidence.mjs";
import { startStack } from "./support/harness.mjs";
import { docxText, openZip, pptxChartData, pptxSlides, sha256 } from "./support/office.mjs";

const norm = (t) => t.replace(/\s+/g, " ").trim();
const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Download every current artifact via the authenticated API and independently verify manifest vs bytes. */
async function downloadAll(s, detail) {
  const out = {};
  for (const a of detail.artifacts) {
    assert.equal(a.downloadPath, `/api/artifacts/${a.id}/download`, "downloadPath must be exactly /api/artifacts/:id/download");
    const r = await s.get(s.backendPath(a.downloadPath));
    assert.equal(r.status, 200, `download ${a.filename}`);
    assert.equal(r.headers.get("content-type"), a.mimeType);
    assert.equal(a.mimeType, MIME[a.format]);
    assert.match(r.headers.get("content-disposition") ?? "", new RegExp(`attachment; filename="${escapeRe(a.filename)}"`));
    assert.equal(r.bytes.length, a.sizeBytes, "size must match manifest");
    assert.equal(sha256(r.bytes), a.sha256, "sha256 must match manifest");
    const zip = openZip(r.bytes);
    assert.equal(zip.magic, "504b0304", "PK container");
    zip.test();
    out[a.format] = { artifact: a, zip, bytes: r.bytes };
  }
  return out;
}

async function runScenario(s, scenario) {
  const inj = await s.inject(scenario);
  assert.equal(inj.status, 200);
  const taskId = inj.body.data.taskId;
  const detail = await s.waitStatus(taskId, ["ready", "failed", "needs_input", "skipped"]);
  return { taskId, detail };
}

describe("A/B/N. canonical scenarios through the real worker", () => {
  let s;
  before(async () => { s = await startStack(); });
  after(async () => { await s?.stop(); });
  const ctx = {};

  it("A1. proposal task reaches ready (not failed) with real progress events", async () => {
    const { taskId, detail } = await runScenario(s, "proposal");
    ctx.proposal = { taskId, detail };
    assert.equal(detail.task.status, "ready", `status=${detail.task.status} error=${JSON.stringify(detail.task.error)}`);
    assert.equal(detail.task.generationMode, "fixture");
    assert.equal(detail.task.ingestionMode, "demo");
    const stages = detail.events.map((e) => e.stage);
    for (const st of ["intake", "plan", "extract", "generate", "verify", "export"]) assert.ok(stages.includes(st), `missing ${st} progress`);
    assert.equal(detail.task.revision, 1);
  });

  it("A2. exactly one proposal DOCX and one presentation PPTX, current revision, product mapping consistent", () => {
    const d = ctx.proposal.detail;
    assert.equal(d.artifacts.length, 2);
    assert.deepEqual(d.artifacts.map((a) => a.format).sort(), ["docx", "pptx"]);
    for (const a of d.artifacts) {
      assert.equal(a.revision, d.task.revision);
      assert.equal(a.taskId, ctx.proposal.taskId);
      const p = d.products.find((x) => x.id === a.productId);
      assert.ok(p, `artifact ${a.filename} must map to a product`);
      assert.equal(p.kind, a.format === "docx" ? "proposal" : "presentation");
    }
    assert.equal(d.products.filter((p) => p.kind === "proposal").length, 1);
    assert.equal(d.products.filter((p) => p.kind === "presentation").length, 1);
    assert.equal(d.products.find((p) => p.kind === "presentation").slides.length, 5);
  });

  it("A3/N. downloads match manifest; DOCX+PPTX contain client, fee, scope, dates; PPTX has exactly 5 slides", async () => {
    const f = await downloadAll(s, ctx.proposal.detail);
    ctx.proposal.files = f;
    const doc = norm(docxText(f.docx.zip));
    const slides = pptxSlides(f.pptx.zip);
    const deck = norm(slides.map((x) => x.text).join(" "));
    assert.equal(slides.length, 5, "exactly five slides");
    for (const needle of ["Maple & Moss", "USD 6,000", "October 26"]) {
      assert.ok(doc.includes(needle), `DOCX missing "${needle}"`);
      assert.ok(deck.includes(needle), `PPTX missing "${needle}"`);
    }
    for (const needle of ["Harbor Creative", "Discovery", "content calendar", "measurement"]) assert.ok(new RegExp(needle, "i").test(doc), `DOCX missing "${needle}"`);
    assert.ok(/Payment milestones[^.]*(Unknown|confirm|not stated|to be agreed)/i.test(doc), "unknown payment milestones must be flagged, not invented");
    for (const part of ["[Content_Types].xml", "word/document.xml"]) assert.ok(f.docx.zip.entries().includes(part), `docx part ${part}`);
    for (const part of ["[Content_Types].xml", "ppt/presentation.xml"]) assert.ok(f.pptx.zip.entries().includes(part), `pptx part ${part}`);
    record("proposal", {
      taskId: ctx.proposal.taskId,
      revision: 1,
      artifacts: ctx.proposal.detail.artifacts.map(({ filename, mimeType, sizeBytes, sha256: h, format }) => ({ filename, mimeType, sizeBytes, sha256: h, format })),
      slideTitles: slides.map((x) => x.text.slice(0, 40)),
    });
  });

  it("A4. preview content == file content (same WorkProduct): fee, dates and headings appear in both", () => {
    const d = ctx.proposal.detail;
    const previewText = norm(JSON.stringify(d.products));
    // The source states "start October 26 and run for four weeks": both the start date and the duration must be present (an end date is derived, not required).
    for (const needle of ["USD 6,000", "October 26, 2026", "4 calendar weeks", "Maple & Moss"]) assert.ok(previewText.includes(needle), `preview missing ${needle}`);
    const doc = norm(docxText(ctx.proposal.files.docx.zip));
    for (const block of d.products.find((p) => p.kind === "proposal").blocks) {
      if (block.heading) assert.ok(doc.includes(block.heading), `DOCX missing preview heading "${block.heading}"`);
    }
  });

  it("A5. evidence: every cited sourceId exists and every non-null quote appears in that source text", () => {
    const d = ctx.proposal.detail;
    const byId = new Map(d.sources.map((x) => [x.id, x]));
    let quotes = 0;
    const blocks = d.products.flatMap((p) => [...p.blocks, ...p.slides.flatMap((sl) => sl.blocks)]);
    for (const b of blocks) {
      if (b.basis === "source") assert.ok(b.evidence.length > 0, `source-basis block "${b.heading}" has no evidence`);
      for (const ev of b.evidence) {
        const src = byId.get(ev.sourceId);
        assert.ok(src, `evidence points at unknown source ${ev.sourceId}`);
        if (ev.quote) { quotes += 1; assert.ok(norm(src.text).includes(norm(ev.quote)), `quote not in source: "${ev.quote}"`); }
      }
    }
    assert.ok(quotes > 0, "expected at least one verbatim quote");
  });

  it("A6/J. receivedAt keeps its fixture meaning; createdAt is ingestion time; due date resolved in org timezone", () => {
    const d = ctx.proposal.detail;
    assert.equal(d.email.receivedAt, "2026-10-23T19:00:00.000Z");
    assert.notEqual(d.task.createdAt, d.email.receivedAt);
    assert.ok(Date.parse(d.task.createdAt) > Date.parse(d.email.receivedAt), "ingestion time is later than the fixture's received time");
    assert.ok(Math.abs(Date.now() - Date.parse(d.task.createdAt)) < 10 * 60_000, "createdAt is real ingestion time");
    assert.equal(d.plan.dueAt, "2026-10-26T16:00:00.000Z", "Monday 9:00 AM America/Los_Angeles (PDT, UTC-7)");
  });

  it("A7. outbox notification: exactly one intent for the ready revision, simulated, nothing sent", async () => {
    let mine = [];
    for (let i = 0; i < 50; i += 1) {
      const r = await s.get("/v1/notifications");
      mine = r.body.data.items.filter((x) => x.taskId === ctx.proposal.taskId);
      if (mine.length && mine.every((x) => x.state !== "queued")) break;
      await new Promise((res) => setTimeout(res, 200));
    }
    assert.equal(mine.length, 1, "exactly one notification intent for taskId/revision/channel");
    assert.equal(mine[0].channel, "outbox");
    assert.equal(mine[0].state, "simulated", "outbox mode must be simulated, never accepted/delivered");
    assert.equal(mine[0].revision, 1);
    assert.equal(mine[0].providerMessageId, null);
  });

  it("A8. Mark reviewed persists: approve -> approved; refresh sees it; second approve 409; no new notification", async () => {
    const taskId = ctx.proposal.taskId;
    const ok = await s.post(`/v1/tasks/${taskId}/review`, { revision: 1, action: "approve" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.data.status, "approved");
    const again = await s.get(`/v1/tasks/${taskId}`);
    assert.equal(again.body.data.task.status, "approved");
    assert.ok(again.body.data.events.some((e) => e.type === "review"), "review event recorded");
    assert.equal(again.body.data.artifacts.length, 2, "approval keeps the same revision and artifacts");
    const dup = await s.post(`/v1/tasks/${taskId}/review`, { revision: 1, action: "approve" });
    assert.equal(dup.status, 409);
    const notifs = (await s.get("/v1/notifications")).body.data.items.filter((x) => x.taskId === taskId);
    assert.equal(notifs.length, 1, "approving must not enqueue another notification");
  });

  it("B1. report task: ready, one report DOCX + one 5-slide PPTX; values match the fixture oracle", async () => {
    const { taskId, detail } = await runScenario(s, "report");
    ctx.report = { taskId, detail };
    assert.equal(detail.task.status, "ready", `status=${detail.task.status} error=${JSON.stringify(detail.task.error)}`);
    assert.equal(detail.artifacts.length, 2);
    assert.ok(detail.products.find((p) => p.kind === "report").blocks.length > 0);
    assert.equal(detail.products.find((p) => p.kind === "presentation").slides.length, 5);
    const f = await downloadAll(s, detail);
    ctx.report.files = f;
    const doc = norm(docxText(f.docx.zip));
    const slides = pptxSlides(f.pptx.zip);
    const deck = norm(slides.map((x) => x.text).join(" "));
    assert.equal(slides.length, 5);
    for (const needle of ["$12,000", "$15,000", "$3,000", "25%", "120", "150", "$100"]) assert.ok(doc.includes(needle), `report DOCX missing ${needle}`);
    for (const needle of ["25%", "120", "150", "$100"]) assert.ok(deck.includes(needle), `deck missing ${needle}`);
    const chart = pptxChartData(f.pptx.zip);
    assert.ok(chart.some((c) => c.values.join() === "12000,15000"), `native PPTX chart data must be [12000,15000], got ${JSON.stringify(chart)}`);
    const chartBlocks = detail.products.flatMap((p) => [...p.blocks, ...p.slides.flatMap((sl) => sl.blocks)]).filter((b) => b.chart);
    assert.ok(chartBlocks.length > 0);
    for (const b of chartBlocks) assert.deepEqual(b.chart.series[0].values, [12000, 15000], "preview chart data == file chart data");
    record("report", {
      taskId,
      revision: 1,
      artifacts: detail.artifacts.map(({ filename, mimeType, sizeBytes, sha256: h, format }) => ({ filename, mimeType, sizeBytes, sha256: h, format })),
      chart,
    });
  });

  it("B2. report makes no unsupported claims (no profit/ROAS/CAC/conversion figures, no causal explanation)", () => {
    const doc = norm(docxText(ctx.report.files.docx.zip));
    const deck = norm(pptxSlides(ctx.report.files.pptx.zip).map((x) => x.text).join(" "));
    const stripped = (t) => t.replace(/ROAS, profit, retention, CAC, and conversion rate cannot be calculated/, "");
    for (const text of [doc, deck]) {
      assert.ok(!/(ROAS|CAC|profit|conversion rate)[^.]{0,40}\d/i.test(stripped(text)), "no invented derived metrics");
      assert.ok(!/because|due to|caused by|driven by/i.test(text), "no causal explanation");
    }
    assert.match(doc, /does not establish causality|cannot be calculated/i);
  });

  it("B3. report is labeled fixture generation; report DOCX carries no native chart part (observed fact, data table instead)", () => {
    assert.equal(ctx.report.detail.task.generationMode, "fixture");
    const charts = ctx.report.files.docx.zip.entries().filter((e) => /^word\/charts\//.test(e));
    record("docx-native-chart", { reportDocxNativeChartParts: charts });
    assert.equal(charts.length, 0);
  });

  it("N2. four stored artifacts are distinct (ids and hashes)", () => {
    const all = [...ctx.proposal.detail.artifacts, ...ctx.report.detail.artifacts];
    assert.equal(new Set(all.map((a) => a.sha256)).size, 4);
    assert.equal(new Set(all.map((a) => a.id)).size, 4);
  });
});
