// Server-side render checks for the "Context used" view and the choice question. No browser, network or backend.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { ContextView, TaskDetail } from "@afterhours/contracts";
import { ContextUsed } from "../components/context-panel";
import { NeedsInputPanel } from "../components/review-panels";

const view = (over: Partial<ContextView> = {}): ContextView => ({
  phase: "ready", phaseLabel: "Ready for review", outcome: "resolved", failure: null, failureDetail: null,
  target: { fileId: "f1", versionId: "v1", name: "Kickoff Deck.pptx", versionKey: "abcdef0123456789abcdef", sha256: "a".repeat(64), provider: "gmail", snapshotKind: "attachment_snapshot", modifiedAt: null, sentAt: "2026-10-20T17:00:00.000Z", reasons: ["thread_linkage", "temporal_fit"], openable: true, changedSinceSelection: false },
  candidates: [
    { fileId: "f1", versionId: "v1", name: "Kickoff Deck.pptx", date: "2026-10-20T17:00:00.000Z", provider: "gmail", score: 60, reasons: ["thread_linkage"], selected: true, openable: true, state: "ok" },
    { fileId: "f2", versionId: "v2", name: "Results Deck.pptx", date: "2026-10-22T17:00:00.000Z", provider: "gmail", score: 20, reasons: ["file_type_match"], selected: false, openable: true, state: "ok" },
  ],
  messages: [
    { id: "current-t", subject: "Revise", from: "jordan@harbor.example", to: ["me@harbor.example"], cc: [], date: "2026-10-26T16:00:00.000Z", direction: "inbound", role: "request", excerpt: "Can you revise the presentation?", included: true, openable: false, reasons: ["the_request"] },
    { id: "m2", subject: "<script>alert(1)</script> Notes", from: "sam@client.example", to: ["me@harbor.example"], cc: [], date: "2026-10-22T18:00:00.000Z", direction: "inbound", role: "feedback", excerpt: "Change the fee <b>now</b>", included: true, openable: true, reasons: ["same_thread"] },
    { id: "m3", subject: "Lunch", from: "x@y.example", to: [], cc: [], date: "2026-10-23T18:00:00.000Z", direction: "inbound", role: "related", excerpt: "", included: false, openable: true, reasons: ["sender_history"] },
  ],
  requirements: [
    { id: "r1", text: "Change the fee from $50,000 to $45,000 on slide 2.", status: "applied", detail: "Replaced 1 occurrence on slide 2.", source: { sourceId: "s", quote: "Change the fee" } },
    { id: "r2", text: "Make it warmer.", status: "unsupported", detail: "No mechanical edit.", source: null },
  ],
  temporal: { phrase: "last week", anchor: "2026-10-26T09:00:00.000-07:00", timezone: "America/Los_Angeles", interpretation: "the previous calendar week (Monday to Sunday)", interval: { start: "2026-10-19T00:00:00.000-07:00", end: "2026-10-25T23:59:59.999-07:00" }, basis: "Relative to the request received.", alternatives: [{ interpretation: "the 7 days before the day of the request", interval: { start: "2026-10-19T00:00:00.000-07:00", end: "2026-10-25T23:59:59.999-07:00" } }] },
  retrieval: { stages: [], coverage: { emailHistory: "partial", files: "not_authorized", notes: ["History sync is still running."] }, limitsReached: [], failure: "none", failureDetail: null },
  uncertainties: [{ kind: "assumption", text: "Feedback in the message was taken to apply to Kickoff Deck.pptx." }],
  corrections: [], report: { baseVersionId: "v1", baseSha256: "a".repeat(64), baseFilename: "Kickoff Deck.pptx", outputFilename: "x.pptx", fidelity: "in_place_edit", edits: [], slides: { unchanged: 3, changed: 1, removed: 0, total: 4 }, unrelatedContentPreserved: true, summary: ["Applied: Replace $50,000 with $45,000."], assumptions: [] },
  limitations: ["Only .pptx presentations are revised."],
  ...over,
});

const detail = (status: TaskDetail["task"]["status"], questions: TaskDetail["questions"] = []): TaskDetail => ({
  task: { id: "t", title: "T", status, revision: 1, ingestionMode: "gmail", generationMode: "fixture", senderName: null, senderEmail: "a@b.example", subject: "S", requestedOutputs: ["presentation"], dueAt: null, createdAt: "2026-10-26T16:01:00.000Z", updatedAt: "2026-10-26T16:01:00.000Z", warningCount: 0, artifactCount: 0, error: null },
  email: { providerMessageId: "m", providerThreadId: null, from: { name: null, email: "a@b.example" }, to: [], subject: "S", receivedAt: "2026-10-26T16:00:00.000Z", bodyText: "x", attachments: [] },
  plan: null, sources: [], products: [], artifacts: [], questions, answers: [], events: [], notifications: [],
});

const wrap = (el: React.ReactElement) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el));

describe("Context used", () => {
  it("shows the selected deck and version, message dates and participants, edits with outcomes, reasons and the time reading", () => {
    const html = wrap(createElement(ContextUsed, { detail: detail("ready"), view: view(), tz: "America/Los_Angeles" }));
    for (const text of ["Kickoff Deck.pptx", "Attachment as sent", "abcdef0123456789", "Same email thread", "Sent in the time you described", "sam@client.example", "Oct 22", "Applied", "Not supported",
      "the previous calendar week", "Other reading", "Change summary", "3 unchanged", "Download the original", "History sync is still running.", "partly read", "not authorized"]) expect(html, text).toContain(text);
    expect(html).toContain("Lunch");
    expect(html).toContain("looked at but not used");
  });

  it("escapes message text instead of rendering it", () => {
    const html = wrap(createElement(ContextUsed, { detail: detail("ready"), view: view() }));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>now</b>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("offers corrections only while a task can still change, and not on a reviewed task", () => {
    expect(wrap(createElement(ContextUsed, { detail: detail("ready"), view: view() }))).toContain("Use this file instead");
    const closed = wrap(createElement(ContextUsed, { detail: detail("approved"), view: view({ phase: "ready", phaseLabel: "Reviewed. Nothing was sent." }) }));
    expect(closed).not.toContain("Use this file instead");
    expect(closed).not.toContain("Add and re-run");
    expect(closed).not.toContain("Do not use this message");
  });

  it("says plainly when a source can no longer be opened and hides its excerpt", () => {
    const revoked = view({ target: { ...view().target!, openable: false }, messages: view().messages.map((m) => ({ ...m, openable: false, excerpt: m.role === "request" ? m.excerpt : "" })) });
    const html = wrap(createElement(ContextUsed, { detail: detail("ready"), view: revoked }));
    expect(html).toContain("cannot open this source now");
    expect(html).toContain("excerpt is hidden because access");
    expect(html).not.toContain("Download the original");
  });

  it("does not hide ambiguity or blocked work behind a success message", () => {
    const html = wrap(createElement(ContextUsed, { detail: detail("needs_input"), view: view({ phase: "needs_input", phaseLabel: "Needs your input", target: null, failure: "ambiguous_match", failureDetail: "Several presentations fit.", requirements: [], report: null }) }));
    expect(html).toContain("Needs your input");
    expect(html).toContain("Why I need you");
    expect(html).toContain("No presentation has been chosen yet.");
    expect(html).toContain("No written edits were found. I will not invent feedback.");
  });
});

describe("NeedsInputPanel with choices", () => {
  it("renders the candidate decks as radio options with their dates and reasons, and keeps free text for other questions", () => {
    const html = wrap(createElement(NeedsInputPanel, {
      detail: detail("needs_input", [
        { id: "context_target", question: "Which presentation should I revise: the October 19 Proposal or the October 22 Results?", reason: "Both fit.", required: true, options: [{ id: "v1", label: "Proposal Deck.pptx (October 19)", detail: "thread_linkage." }, { id: "v2", label: "Results Deck.pptx (October 22)", detail: "weak match." }] },
        { id: "other", question: "Anything else?", reason: "Optional.", required: false },
      ]),
    }));
    expect((html.match(/type="radio"/g) ?? []).length).toBe(2);
    expect(html).toContain("Proposal Deck.pptx (October 19)");
    expect(html).toContain("role=\"radiogroup\"");
    expect(html).toContain("<textarea");
  });
});
