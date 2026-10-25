// Regenerates the synthetic presentations and demo scenarios used to demonstrate revision requests.
// All names, companies and addresses are fictional (.example). Run: pnpm tsx scripts/make-revision-fixtures.ts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildDeckFixture } from "@afterhours/engine/testing";

const root = path.resolve(import.meta.dirname, "..", "fixtures");
mkdirSync(path.join(root, "attachments"), { recursive: true });
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const decks = {
  "kickoff-deck.pptx": [
    { title: "Maple & Moss kickoff", bullets: ["Harbor Creative proposal", "Four-week engagement"], notes: "Open warmly and thank the team." },
    { title: "Pricing", bullets: ["Fee is $50,000", "Payment in two instalments", "Travel billed at cost"] },
    { title: "Timeline", bullets: ["Four weeks from kickoff", "Review in week three"] },
    { title: "Thank you", bullets: ["Questions?"] },
  ],
  "proposal-deck.pptx": [
    { title: "Maple & Moss proposal", bullets: ["Scope and approach"] },
    { title: "Pricing", bullets: ["Fee is $50,000", "Payment in two instalments"] },
    { title: "Team", bullets: ["Two designers", "One producer"] },
  ],
  "results-deck.pptx": [
    { title: "Maple & Moss results", bullets: ["First quarter outcomes"] },
    { title: "Pricing", bullets: ["Fee is $50,000", "Renewal in January"] },
    { title: "Next steps", bullets: ["Plan the second phase"] },
  ],
} as const;

const bytes: Record<string, Uint8Array> = {};
for (const [name, slides] of Object.entries(decks)) {
  bytes[name] = await buildDeckFixture(slides.map((s) => ({ ...s, bullets: [...s.bullets] })));
  writeFileSync(path.join(root, "attachments", name), bytes[name]);
}
const meta = (name: string, id: string) => ({ id, filename: name, mimeType: PPTX, sizeBytes: bytes[name]!.byteLength });
const scenario = (name: string, subject: string, body: string, files: Array<[string, string]>) =>
  writeFileSync(path.join(root, "scenarios", `${name}.json`), `${JSON.stringify({
    scenario: name,
    email: {
      providerMessageId: `demo-${name}-base`, providerThreadId: `demo-thread-${name}`,
      from: { name: "Alex Morgan", email: "alex@maple-and-moss.example" }, to: ["team@harbor-creative.example"],
      subject, receivedAt: "2026-10-26T16:00:00.000Z", bodyText: body, attachments: files.map(([n, id]) => meta(n, id)),
    },
    attachmentFiles: files.map(([n, id]) => ({ attachmentId: id, relativePath: `attachments/${n}` })),
  }, null, 2)}\n`);

scenario("revision", "Please update the kickoff deck",
  "Can you revise the attached presentation based on my notes?\nChange the fee from $50,000 to $45,000 on slide 2.\nOn slide 3 add the bullet \"Launch review on Friday\".\nMake the closing warmer.",
  [["kickoff-deck.pptx", "att-kickoff-deck"]]);
scenario("revision_choice", "Updates to the deck",
  "Can you revise the presentation I sent? Change the fee from $50,000 to $45,000 on slide 2.",
  [["proposal-deck.pptx", "att-proposal-deck"], ["results-deck.pptx", "att-results-deck"]]);
console.log("fixtures written");
