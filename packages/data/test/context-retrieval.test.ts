import { describe, expect, it } from "vitest";
import { applyDeckEdits, readDeckBytes } from "@afterhours/engine";
import { OWNER_ID, createFilesGrant, upsertAccount, type ResolveOutcome } from "../src";
import { MemoryFileProvider } from "../src/testing";
import { BOSS, MAILBOX, REQUEST_AT, deck, makeTask, makeWorld, msg, resolveTask, syncAll, useFiles } from "./context-helpers";

const resolved = (o: ResolveOutcome) => { if (o.kind !== "resolved") throw new Error(`expected resolved, got ${o.kind}${o.kind === "needs_input" ? `: ${o.questions[0]!.question}` : ""}`); return o; };
const asked = (o: ResolveOutcome) => { if (o.kind !== "needs_input") throw new Error(`expected needs_input, got ${o.kind}`); return o; };

const VAGUE = "Can you revise the presentation from last week based on what we discussed?";

describe("1. vague request resolves the deck and the feedback in the current thread", () => {
  it("finds last week's attachment and the written feedback, and builds a validated bundle", async () => {
    const d = await deck();
    const w = makeWorld({
      messages: [
        msg({ id: "m1", threadId: "T1", subject: "Maple & Moss kickoff deck", body: "Deck attached for review.", date: "2026-10-20T17:00:00.000Z", attachments: [{ filename: "Kickoff Deck.pptx", bytes: d }] }),
        msg({ id: "m2", threadId: "T1", from: { email: BOSS }, subject: "Re: Maple & Moss kickoff deck", date: "2026-10-22T18:00:00.000Z",
          body: "Two things from the call.\nChange the fee from $50,000 to $45,000 on slide 2.\nOn slide 3 add the bullet \"Launch review on Friday\".\n\nOn Tue, Oct 20, 2026 at 10:00 AM Me <me@harbor.example> wrote:\n> Deck attached for review." }),
        msg({ id: "req-t1", threadId: "T1", subject: "Re: Maple & Moss kickoff deck", body: VAGUE, date: REQUEST_AT }),
      ],
    });
    await syncAll(w);
    const t = makeTask(w, { subject: "Re: Maple & Moss kickoff deck", body: VAGUE, threadId: "T1", messageId: "req-t1" });
    const out = await resolveTask(w, t);
    expect(out.kind).toBe("resolved");
    if (out.kind !== "resolved") return;
    const b = out.bundle;
    expect(b.resolvedTarget.filename).toBe("Kickoff Deck.pptx");
    expect(b.resolvedTarget.reasonCodes).toEqual(expect.arrayContaining(["thread_linkage", "temporal_fit", "file_type_match", "documented_feedback"]));
    expect(b.requirements.map((r) => r.edit)).toEqual([
      { op: "replace_text", slide: 2, find: "$50,000", replace: "$45,000" },
      { op: "append_bullet", slide: 3, text: "Launch review on Friday" },
    ]);
    // quoted history is not extracted a second time, and every requirement cites the feedback message
    expect(b.requirements.every((r) => r.support[0]!.quote && b.sources.some((s) => s.id === r.support[0]!.sourceId && s.from === BOSS))).toBe(true);
    expect(b.temporalInterpretation).toMatchObject({ phrase: "last week", interpretation: expect.stringContaining("previous calendar week"), anchor: expect.stringContaining("2026-10-26T09:00") });
    expect(b.constraints).toMatchObject({ reviewOnly: true, preserveOriginal: true });
    expect(b.sources.every((s) => s.untrusted)).toBe(true);
    expect(b.sources.some((s) => s.kind === "file_section" && s.locator === "slide 2")).toBe(true);
    expect(out.files[0]!.bytes.byteLength).toBe(d.byteLength);
    // the bundle really drives the editor
    const edited = applyDeckEdits(out.files[0]!.bytes, b.requirements.map((r) => ({ id: r.id, edit: r.edit })));
    expect(edited.results.map((r) => r.status)).toEqual(["applied", "applied"]);
    expect(readDeckBytes(edited.bytes)[1]!.paragraphs[0]).toBe("Fee is $45,000");
    const run = w.db.prepare("SELECT outcome, metrics_json FROM retrieval_runs WHERE task_id=?").get(t.taskId) as { outcome: string; metrics_json: string };
    expect(run.outcome).toBe("resolved");
    expect(JSON.parse(run.metrics_json)).toMatchObject({ modelTokens: 0, modelCostUsd: 0, filesParsed: 1 });
  });
});


describe("2. deck and revisions from earlier exchanges with the same person", () => {
  it("uses a deck I sent, feedback Jordan sent in another thread, and ignores unrelated mail from Jordan", async () => {
    const d = await deck();
    const w = makeWorld({
      messages: [
        msg({ id: "a1", threadId: "TA", from: { email: MAILBOX }, to: [BOSS], subject: "Kickoff deck draft", body: "Here is the Kickoff Deck.", date: "2026-10-20T17:00:00.000Z", labels: ["SENT"], attachments: [{ filename: "Kickoff Deck.pptx", bytes: d }] }),
        msg({ id: "b1", threadId: "TB", subject: "Notes from Sam's call", date: "2026-10-22T18:00:00.000Z", body: "Sam's notes on the Kickoff Deck:\nReplace \"Six weeks from kickoff\" with \"Eight weeks from kickoff\" on slide 3.\nRemove slide 4." }),
        msg({ id: "c1", threadId: "TC", subject: "Lunch Friday?", date: "2026-10-23T18:00:00.000Z", body: "Are we still on for lunch? Change of plan: Thai instead." }),
      ],
    });
    await syncAll(w);
    const t = makeTask(w, { subject: "Quick revision", body: VAGUE, threadId: "TREQ" });
    const out = resolved(await resolveTask(w, t));
    expect(out.bundle.resolvedTarget.filename).toBe("Kickoff Deck.pptx");
    expect(out.bundle.resolvedTarget.reasonCodes).toEqual(expect.arrayContaining(["sender_relevance", "temporal_fit", "explicit_file_reference"].slice(0, 2)));
    expect(out.bundle.requirements.map((r) => r.edit)).toEqual([
      { op: "replace_text", slide: 3, find: "Six weeks from kickoff", replace: "Eight weeks from kickoff" },
      { op: "delete_slide", slide: 4 },
    ]);
    expect(out.bundle.sources.some((s) => s.title === "Lunch Friday?")).toBe(false);
    expect(out.bundle.sources.some((s) => s.title === "Kickoff deck draft")).toBe(true); // the deck's own message is evidence
    // the file was fetched lazily from the mailbox, once
    expect(w.mail.calls.attachment).toBe(1);
  });
});

describe("3. a supported link pulls feedback from another participant's thread", () => {
  it("resolves the linked file through the permitted adapter and finds Priya's comments by file id", async () => {
    const d = await deck();
    const w = makeWorld({
      messages: [
        msg({ id: "p1", threadId: "TP", from: { email: "priya@client.example", name: "Priya" }, subject: "Comments on the deck", date: "2026-10-22T18:00:00.000Z",
          body: "Hi,\nThe deck is at https://docs.google.com/presentation/d/1AbCdEfGhIjKlMn/edit?usp=sharing\nPlease change the fee from $50,000 to $45,000 on slide 2." }),
      ],
    });
    await syncAll(w);
    const drive = new MemoryFileProvider("drive", [
      { id: "F", name: "Client folder", parent: null, folder: true },
      { id: "1AbCdEfGhIjKlMn", name: "Maple Moss Kickoff", parent: "F", content: d, modifiedAt: "2026-10-21T12:00:00.000Z" },
    ]);
    useFiles(w, "drive", drive);
    const acct = upsertAccount(w.db, OWNER_ID, "drive", "drive-test", { state: "connected" }, w.now);
    createFilesGrant(w.db, OWNER_ID, acct.id, [{ providerId: "F", kind: "folder", label: "Client folder" }], {}, w.now);
    const t = makeTask(w, { subject: "Maple Moss deck", body: "Can you revise the deck at https://docs.google.com/presentation/d/1AbCdEfGhIjKlMn/edit based on Priya's comments?" });
    const out = resolved(await resolveTask(w, t));
    expect(out.bundle.resolvedTarget).toMatchObject({ provider: "drive", snapshotKind: "provider_revision", versionKey: "r1", filename: "Maple Moss Kickoff" });
    expect(out.bundle.resolvedTarget.reasonCodes).toContain("link_file_id_match");
    expect(out.bundle.requirements.map((r) => r.edit)).toEqual([{ op: "replace_text", slide: 2, find: "$50,000", replace: "$45,000" }]);
    expect(out.bundle.sources.find((s) => s.from === "priya@client.example")).toBeTruthy();
    expect(JSON.stringify(out.bundle)).not.toContain("usp=sharing");
  });

  it("does not open a linked file when Drive is not connected, and says so", async () => {
    const w = makeWorld();
    const t = makeTask(w, { subject: "Deck", body: "Can you revise the deck at https://docs.google.com/presentation/d/1AbCdEfGhIjKlMn/edit from last week?" });
    const out = asked(await resolveTask(w, t));
    expect(out.failure).toBe("unavailable_source");
    expect(out.questions[0]!.question).toMatch(/attach/i);
  });
});

describe("4. unrelated projects from the same sender stay separate", () => {
  it("revises the named project and never uses the other project's feedback", async () => {
    const alpha = await deck([{ title: "Alpha Launch plan", bullets: ["Launch in March"] }, { title: "Budget", bullets: ["Budget is $10,000"] }]);
    const beta = await deck([{ title: "Beta Rebrand plan", bullets: ["Rebrand in June"] }, { title: "Budget", bullets: ["Budget is $20,000"] }]);
    const w = makeWorld({
      messages: [
        msg({ id: "a1", threadId: "TA", subject: "Alpha Launch deck", body: "Alpha deck attached.", date: "2026-10-20T17:00:00.000Z", attachments: [{ filename: "Alpha Launch.pptx", bytes: alpha }] }),
        msg({ id: "a2", threadId: "TA", subject: "Re: Alpha Launch deck", body: "Change the budget from $10,000 to $12,000 on slide 2.", date: "2026-10-22T17:00:00.000Z" }),
        msg({ id: "b1", threadId: "TB", subject: "Beta Rebrand deck", body: "Beta deck attached.", date: "2026-10-21T17:00:00.000Z", attachments: [{ filename: "Beta Rebrand.pptx", bytes: beta }] }),
        msg({ id: "b2", threadId: "TB", subject: "Re: Beta Rebrand deck", body: "Change the budget from $20,000 to $5,000 on slide 2.\nRemove slide 1.", date: "2026-10-23T17:00:00.000Z" }),
      ],
    });
    await syncAll(w);
    const t = makeTask(w, { subject: "Alpha Launch presentation", body: "Can you revise the Alpha Launch presentation from last week based on what we discussed?", threadId: "TX" });
    const out = resolved(await resolveTask(w, t));
    expect(out.bundle.resolvedTarget.filename).toBe("Alpha Launch.pptx");
    expect(out.bundle.requirements.map((r) => r.edit)).toEqual([{ op: "replace_text", slide: 2, find: "$10,000", replace: "$12,000" }]);
    expect(JSON.stringify(out.bundle.sources)).not.toContain("Beta");
    expect(JSON.stringify(out.bundle.sources)).not.toContain("$5,000");
  });
});

describe("5 and 10. two plausible decks lead to clarification; an answer resolves it and reuses the search", () => {
  it("asks which deck, offers both with their dates, then resolves on the answer without searching again", async () => {
    const proposal = await deck([{ title: "Proposal", bullets: ["Fee is $50,000"] }, { title: "Pricing", bullets: ["Fee is $50,000"] }]);
    const results = await deck([{ title: "Results", bullets: ["Net new: 12"] }, { title: "Pricing", bullets: ["Fee is $50,000"] }]);
    const w = makeWorld({
      messages: [
        msg({ id: "d1", threadId: "T1", subject: "Proposal deck", body: "Proposal deck attached.", date: "2026-10-19T17:00:00.000Z", attachments: [{ filename: "Proposal Deck.pptx", bytes: proposal }] }),
        msg({ id: "d2", threadId: "T2", subject: "Results deck", body: "Results deck attached.", date: "2026-10-22T17:00:00.000Z", attachments: [{ filename: "Results Deck.pptx", bytes: results }] }),
      ],
    });
    await syncAll(w);
    const t = makeTask(w, { subject: "Revision", body: `${VAGUE}\nChange the fee from $50,000 to $45,000 on slide 2.` });
    const first = asked(await resolveTask(w, t));
    expect(first.failure).toBe("ambiguous_match");
    const q = first.questions[0]!;
    expect(q.id).toBe("context_target");
    expect(q.question).toMatch(/October 19.*Proposal.*October 22.*Results/s);
    expect(q.options).toHaveLength(2);
    const fetched = w.mail.calls.attachment;
    const queriesBefore = w.mail.calls.list;
    const choice = q.options!.find((o) => o.label.startsWith("Results"))!;
    const second = resolved(await resolveTask(w, t, { revision: 2, answers: [{ questionId: "context_target", answer: choice.id }] }));
    expect(second.bundle.resolvedTarget.filename).toBe("Results Deck.pptx");
    expect(second.bundle.resolvedTarget.reasonCodes).toContain("user_confirmation");
    expect(w.mail.calls.attachment).toBe(fetched);
    expect(w.mail.calls.list).toBe(queriesBefore);
    const run2 = w.db.prepare("SELECT reused_from_revision, metrics_json FROM retrieval_runs WHERE task_id=? AND revision=2").get(t.taskId) as { reused_from_revision: number; metrics_json: string };
    expect(run2.reused_from_revision).toBe(1);
    expect(JSON.parse(run2.metrics_json).reused).toBe(true);
    // the explicit choice is remembered for these project terms only
    expect(w.db.prepare("SELECT COUNT(*) n FROM entity_links WHERE origin='user_confirmed'").get()).toMatchObject({ n: 1 });
  });

  it("asks when two readings of 'last week' would pick different decks, and says why", async () => {
    const early = await deck();
    const late = await deck([{ title: "Late", bullets: ["x"] }, { title: "Pricing", bullets: ["Fee is $50,000"] }]);
    const w = makeWorld({
      now: new Date("2026-01-02T18:00:00.000Z"),
      messages: [
        msg({ id: "e1", threadId: "T1", subject: "Early deck", body: "Deck", date: "2025-12-24T17:00:00.000Z", attachments: [{ filename: "Early Deck.pptx", bytes: early }] }),
        msg({ id: "e2", threadId: "T2", subject: "Late deck", body: "Deck", date: "2025-12-31T17:00:00.000Z", attachments: [{ filename: "Late Deck.pptx", bytes: late }] }),
      ],
    });
    await syncAll(w);
    const t = makeTask(w, { subject: "Revision", body: `${VAGUE}\nChange the fee from $50,000 to $45,000 on slide 2.`, receivedAt: "2026-01-02T17:00:00.000Z" });
    const out = asked(await resolveTask(w, t));
    expect(out.failure).toBe("ambiguous_match");
    expect(out.questions[0]!.reason).toMatch(/previous calendar week.*7 days/s);
    expect(out.questions[0]!.options!.map((o) => o.label.split(" (")[0]).sort()).toEqual(["Early Deck.pptx", "Late Deck.pptx"]);
  });

  it("does not pick the newest file named 'final' over the deck that was sent in the interval", async () => {
    const sent = await deck();
    const finalDeck = await deck([{ title: "Maple and Moss kickoff FINAL", bullets: ["x"] }, { title: "Pricing", bullets: ["Fee is $50,000"] }]);
    const w = makeWorld({
      messages: [
        msg({ id: "v1", threadId: "T1", subject: "Kickoff deck", body: "Deck", date: "2026-10-20T17:00:00.000Z", attachments: [{ filename: "Kickoff Deck v1.pptx", bytes: sent }] }),
        msg({ id: "v2", threadId: "T2", subject: "Kickoff deck final", body: "Final", date: "2026-10-26T15:00:00.000Z", attachments: [{ filename: "Kickoff Deck FINAL.pptx", bytes: finalDeck }] }),
      ],
    });
    await syncAll(w);
    const t = makeTask(w, { subject: "Revision", body: `${VAGUE}\nChange the fee from $50,000 to $45,000 on slide 2.` });
    const out = resolved(await resolveTask(w, t));
    expect(out.bundle.resolvedTarget.filename).toBe("Kickoff Deck v1.pptx");
  });
});

describe("6. one clear deck without revision instructions asks what to change", () => {
  it("does not invent feedback, then proceeds when the user supplies it", async () => {
    const d = await deck();
    const w = makeWorld({ messages: [msg({ id: "m1", threadId: "T1", subject: "Kickoff deck", body: "Deck attached.", date: "2026-10-20T17:00:00.000Z", attachments: [{ filename: "Kickoff Deck.pptx", bytes: d }] })] });
    await syncAll(w);
    const t = makeTask(w, { subject: "Revision", body: VAGUE });
    const out = asked(await resolveTask(w, t));
    expect(out.questions).toHaveLength(1);
    expect(out.questions[0]).toMatchObject({ id: "context_changes", required: true });
    expect(out.questions[0]!.question).toMatch(/Kickoff Deck\.pptx.*sent October 20.*What changes should I make\?.*couldn't find written feedback in the authorized sources/s);
    const second = resolved(await resolveTask(w, t, { revision: 2, answers: [{ questionId: "context_changes", answer: "Change the fee from $50,000 to $45,000 on slide 2." }] }));
    expect(second.bundle.requirements[0]!.edit).toEqual({ op: "replace_text", slide: 2, find: "$50,000", replace: "$45,000" });
    expect(second.bundle.sources.some((s) => s.kind === "user_note")).toBe(true);
  });
});

describe("7. a selected-folder file resolves when no email carries it", () => {
  it("finds the deck in the granted folder and records it as a live local version", async () => {
    const d = await deck();
    const w = makeWorld({ lookbackDays: null });
    const folder = new MemoryFileProvider("folder", [
      { id: "proj", name: "proj", parent: null, folder: true },
      { id: "proj/Kickoff Deck.pptx", name: "Kickoff Deck.pptx", parent: "proj", content: d },
      { id: "proj/notes.txt", name: "notes.txt", parent: "proj", content: new TextEncoder().encode("hi"), mime: "text/plain" },
      { id: "other", name: "other", parent: null, folder: true },
      { id: "other/Secret Deck.pptx", name: "Secret Deck.pptx", parent: "other", content: await deck([{ title: "Secret", bullets: ["x"] }]) },
    ]);
    useFiles(w, "folder", folder);
    const acct = upsertAccount(w.db, OWNER_ID, "folder", "project-files", { state: "connected" }, w.now);
    createFilesGrant(w.db, OWNER_ID, acct.id, [{ providerId: "proj", kind: "folder", label: "proj" }], {}, w.now);
    const t = makeTask(w, { subject: "Kickoff Deck", body: "Please revise the Kickoff Deck presentation. Change the fee from $50,000 to $45,000 on slide 2." });
    const out = resolved(await resolveTask(w, t));
    expect(out.bundle.resolvedTarget).toMatchObject({ provider: "folder", snapshotKind: "local_file", filename: "Kickoff Deck.pptx" });
    expect(out.bundle.resolvedTarget.reasonCodes).toEqual(expect.arrayContaining(["selected_folder_member", "file_type_match"]));
    expect(folder.calls.open).toBe(1);
    expect(folder.entries.get("other/Secret Deck.pptx")).toBeTruthy();
    expect(out.bundle.retrieval.coverage.emailHistory).toBe("not_authorized");
  });
});
