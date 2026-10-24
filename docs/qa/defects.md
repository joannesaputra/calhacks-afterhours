# QA defects — Batch 3

Candidate under test: **`4e1b5ae`** = local merge of `origin/platform` (`aaed3db`) and `origin/person-2-engine` (`258e2eb`),
created in a QA worktree, not pushed. Mode: `GENERATION_MODE=fixture`, demo ingestion, outbox notifications.
Severity: P0 blocks the core local flow / data integrity / private access; P1 wrong substantive content, numbers or
revisions; P2 non-blocking usability, layout or tooling. Fix commit and retest columns are empty until owners respond.

| ID | Sev | Owner | Summary | Fix commit | Retest |
|---|---|---|---|---|---|
| DEF-1 | P0 | Joanne (ids) / Darren (validation) | Real engine file ids contain `/`; platform rejects them, every real task fails `ARTIFACT_INVALID` | — | — |
| DEF-2 | P1 | Joanne | Report narrative is hard-coded; states false numbers when inputs change | — | — |
| DEF-3 | P1 | Joanne | Proposal template hard-codes "four-week" after the client's answers say three weeks | — | — |
| DEF-4 | P2 (provisional) | Joanne | DOCX `tblGrid` columns are 100 twips; tables collapse in macOS QuickLook | — | — |
| DEF-5 | P2 | Joanne | `pnpm lint` fails on engine sources (3 errors) | — | — |

## DEF-1 (P0) — every real proposal/report task fails with `ARTIFACT_INVALID`

- **Preconditions:** candidate `4e1b5ae`, fixture mode, API + worker running, logged in.
- **Steps (sanitized):** `POST /v1/demo/inject {"scenario":"proposal"}` with the CLI bearer; poll `GET /v1/tasks/:id`.
- **Expected:** `ready`, one DOCX and one PPTX.
- **Actual:** task `failed`, `error = {code:"ARTIFACT_INVALID", retryable:false}`, message
  `Unsafe file id: <taskId>/1/<taskId>/1/pr-12c06925e7ad`. The engine did produce valid files in memory
  (progress shows "Exported 2 Office files in memory"); the platform refused to store them.
- **Cause:** `packages/engine/src/ids.ts` `stableId()` joins parts with `/` (and repeats taskId/revision), so `GeneratedFile.id`
  contains slashes. `packages/data/src/artifacts.ts` `publishArtifactFiles` requires ids to match `^[A-Za-z0-9._-]{1,200}$`
  and uses the id as the file name. The id is also the `/api/artifacts/:id/download` path segment, so a platform-side path
  sanitiser alone would not be enough: the id itself must not contain `/`.
- **Evidence:** observed in a real API+worker run (task `2b29fe3a-ebf3-4db8-9f1f-7eba970a0176`, throwaway DB, since deleted);
  `pnpm test` also shows `apps/worker/test/worker.test.ts` "foundation engine stub fails honestly" now failing with
  `ARTIFACT_INVALID` instead of `ENGINE_NOT_IMPLEMENTED`. 21 of 53 system checks fail on the candidate; 16 of them fail because of this defect (the other 5 are DEF-2 and DEF-4).
- **Proposed patch (not applied to the candidate):** in `stableId`, `parts.map(String).join("-").replace(/[^a-zA-Z0-9._-]+/g, "-")`.
  Verified only in a scratch worktree: the same four scenarios then reach `ready`, downloads succeed, and 47 of 53 system checks pass
  (the remaining six are DEF-2/3/4). Joanne owns the fix; Darren should add a platform-side unit test that feeds real engine
  output through `publishArtifactFiles`, and update the stale worker test.
- **Separate from missing teammate work:** this is a regression/integration defect in code that exists, not a missing branch.

## DEF-2 (P1) — report narrative contradicts the computed numbers when inputs change

- **Precondition:** direct engine call (`tests/system/03-engine-boundary.test.mjs`), report scenario, CSV bytes changed
  (Feb Website revenue 10000→11000; and a zero-orders variant).
- **Expected:** every statement follows the computed values (Feb $16,000, +$4,000, 33.3%, AOV $100→$106.67, Website share 66.7%→68.8%).
- **Actual:** tables and chart data are correct, but text is wrong:
  - DOCX summary: "while average order value remained $100" (table says Feb $106.67).
  - PPTX slide 2 title "Revenue grew 25%" (should be 33.3%); slide 4 "Average order value: $100 in both months", "Website share: 66.7% in both months"; speaker note "average order value did not change".
  - Zero-order month: "Orders increased from 120 to 0 (-100%)" and "AOV remained $100" while Feb AOV is Unknown.
  - Zero January revenue: "average order value remained $0", "Website share: 0% in both months".
- **Cause:** string literals / first-month-only values in `packages/engine/src/content.ts` lines 75, 86, 88.
- **Why the canonical gate did not catch it:** the canonical dataset has equal AOV and equal share in both months, so the hard-coded wording happens to be true.
- **Evidence:** failing checks C4, C5, C6, H6. Direct-engine evidence, not HTTP.

## DEF-3 (P1) — proposal text contradicts the client's answers

- **Steps:** inject `ambiguous`; submit the four valid answers with scope "…a three-week content calendar" and schedule "Start November 2, 2026 and run for three weeks"; wait for revision 2.
- **Expected:** deliverables do not say "four-week".
- **Actual:** revision 2 DOCX/PPTX still contain "Four-week content calendar", "Four-week plan and fee" next to the answer text "three-week".
- **Cause:** hard-coded template items in `packages/engine/src/content.ts` lines 45, 57, 58.
- **Evidence:** check D7 (fails on the patched scratch build, where the rest of the clarification flow passes). Answers, revision, job count and traceability behave correctly.

## DEF-4 (P2, provisional) — DOCX tables collapse in macOS QuickLook

- **Actual:** `word/document.xml` has `<w:gridCol w:w="100"/>` for every column (100 twips) with `tcW 4500`. QuickLook renders every table as
  one-letter-per-line columns on the first page of both the proposal and the report. `packages/engine/src/render/docx.ts` line 17 builds `new Table({ width: {size:100, type: PERCENTAGE}, rows })` with no `columnWidths`.
- **Not established:** how Word or Pages render it (not run, see report). Escalate to P1 if either also collapses.
- **Evidence:** QuickLook thumbnails of both DOCX files (first page only); check N3 asserts gridCol ≥ 500 twips and fails.

## DEF-5 (P2) — lint fails on engine sources

`pnpm lint` exits 1 on the candidate: `packages/engine/src/render/docx.ts` (unused `BorderStyle`, `no-control-regex`), `packages/engine/src/sources.ts` (`no-control-regex`). QA files lint clean.

## Observations (not defects)

- O-1: file/product ids are 100+ characters with taskId repeated and a truncated slug ("…-pr-<hash>"); opaque and unique, so allowed, but ugly in logs.
- O-2: generated DOCX bytes differ run to run (10199/10200/10204 bytes) although ids are deterministic; hashes are stored per stored artifact, so integrity checks are unaffected.
- O-3: the failure event for `ARTIFACT_INVALID` is recorded under stage `plan`, which is misleading (Darren, minor).
- O-4: fixture mode cannot consume an edited brief: injection-only or conflicting-budget briefs fail closed with `UNGROUNDED_CONTENT` rather than a clarification question. Safe, but the conflict-surfacing rule (spec §13) cannot be verified until live mode exists.
