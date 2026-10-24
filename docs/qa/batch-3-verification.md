# Batch 3 verification — Eden / system QA

**Candidate:** `4e1b5ae` — local merge in a QA worktree of `origin/platform` @ `aaed3db` (Darren, Batch 3) and `origin/person-2-engine` @ `258e2eb`
(Joanne, "Implement grounded engine and Office deliverables"). Merge was clean; `pnpm install --frozen-lockfile` succeeded. Not pushed.
**Not present:** any Maricella `experience` branch (`git branch -r` shows only `main`, `platform`, `person-2-engine`).
**Modes:** `GENERATION_MODE=fixture`, ingestion `demo`, notification channel `outbox`. No live Gmail, model, or Twilio anywhere.
**Recommendation for the integrated gate: FAIL / not ready.** One P0 (DEF-1) stops every real proposal/report task. Details in `defects.md`.

Status words: PASS = executed and met expectation; FAIL = executed and did not; BLOCKED = cannot run because something is missing;
NOT RUN = not executed. "Candidate" = unmodified `4e1b5ae`. "Scratch-patched" = the same code plus the one-line DEF-1 fix in a throwaway worktree
(`stableId` joins with `-`), used only to see what else breaks behind DEF-1; it is **not** a PASS for the candidate.

## Commands executed (exit codes)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm lint` | exit 1 — 3 errors, all in `packages/engine/src` (DEF-5); QA files clean |
| `pnpm test` (vitest, owners' unit tests) | exit 1 — 108 pass, 1 fail: `worker.test.ts` "foundation engine stub fails honestly" now gets `ARTIFACT_INVALID` (stale expectation; consequence of DEF-1) |
| `node --import tsx --test tests/system/*.test.mjs` on the candidate | exit 1 — 53 tests, 32 pass, 21 fail |
| same with `QA_REPO_ROOT=<scratch-patched>` | exit 1 — 53 tests, 47 pass, 6 fail (DEF-2 ×4 checks, DEF-3, DEF-4) |

## Scenario matrix (Eden Batch 3 A–I, plus Phase 0/3)

| # | Question | Candidate | Scratch-patched | Evidence type |
|---|---|---|---|---|
| P0 | Batch 2 gate: real engine through real worker to ready, two downloads | **FAIL** (DEF-1). Engine runs and exports in memory; platform rejects ids with `/`. | PASS | Full HTTP + worker |
| A | Proposal: DOCX + exactly-5-slide PPTX, client/fee/scope/dates, product mapping, current revision, MIME/size/hash, review persists, no send | **FAIL** (A1–A5, A7, A8 cascade from DEF-1). A6 timing PASS. | PASS 8/8 | Full HTTP + worker; structural ZIP/XML |
| B | CSV report: 12000/15000/3000/25%, orders 120/150, AOV 100/100, chart data in preview = file; no profit/ROAS/CAC/causality | **FAIL** (DEF-1) | PASS | Full HTTP + worker; native chart XML read |
| C | Changed input (Feb Website 11000): 16000, +4000, 33.3%, orders 150, AOV 106.67 | tables/chart/summary figures PASS (C1–C3); narrative **FAIL** (DEF-2: C4, C5, C6) | same (not HTTP-dependent) | **Direct engine**, separate from HTTP evidence |
| D | Clarification: stable required questions, bad submits safe, one new revision/job, answers reflected | questions, refresh stability, 8 bad submissions, wrong-state actions PASS (D1–D4); resume **FAIL** (D5, D6, D8 cascade DEF-1) | D1–D6, D8 PASS; D7 **FAIL** (DEF-3) | Full HTTP + worker |
| E | No action: skipped, zero files/notifications; cannot approve | PASS | PASS | Full HTTP + worker |
| E′ | Old approved proposal mentioned in a new email is not a delegated task | NOT RUN — public inject takes a scenario name only; QA does not weaken it | — | — |
| F | Dedupe (sequential + 12 simultaneous), approve only ready, retry only failed, stale revision rejected | PASS | PASS | Full HTTP; black-box (Darren's own race tests are unit-level, 98 → 108 pass in `pnpm test`) |
| F′ | Failure/retry: live mode without credentials fails honestly, retry → revision 2, no fixture fallback | PASS | PASS | Full HTTP + worker |
| F″ | Old artifact reference cannot overwrite a newer manifest; controlled worker-kill race | NOT RUN — needs a ready→failed→retry path with stored artifacts, or Darren's controlled race harness | — | — |
| G | Unauthenticated blocked, CLI token scope, Origin, cookie flags, logout revoke, traversal-shaped ids, no path/secret leak | PASS (9/9) | PASS | Full HTTP |
| H | Malformed/oversized/unsupported/blank/zero/conflict/malicious input | H1–H5 PASS; H6 **FAIL** (DEF-2); I1, I2 PASS (fail closed) | same | Direct engine + existing unit tests; **not** HTTP |
| I | UI reality: real-backend browser evidence, 390/1440 px, downloads, Mark reviewed, refresh, labels | **BLOCKED** — no Maricella branch; no browser evidence exists. Darren's local, uncommitted `ui/spacexai-style` is not independent QA evidence | — | — |
| Ph3 | Actual file inspection | Structural: PASS on engine bytes (ZIP test, parts, text, hashes vs manifest) | same | Structural ZIP/XML |
| Ph3v | Visual rendering | **Partial**: macOS QuickLook thumbnail of page/slide 1 only. Title slides legible; both DOCX tables collapse to one-letter columns (DEF-4). Word, PowerPoint, Pages: **NOT RUN** | — | QuickLook only |
| J | Restart persistence (stop API+worker, restart on same DB: approved state, artifacts same hash, session valid, no rerun) | **FAIL** (cascade DEF-1) | PASS | Full HTTP + processes |
| — | Worker killed mid-job (spec G), quiet hours (K), live provider outage (F) | NOT RUN (out of this batch's scope or needs live/controlled seams) | — | — |

## Safe identifiers and hashes (scratch-patched run; the candidate produced no artifacts)

Throwaway DB; ids are not reused anywhere.

- Proposal task `52ba411f-53ac-4d47-ac59-2612135f1aa3`, revision 1
  - `Maple-Moss-Launch-Strategy-Proposal-r1.docx` 10200 B `23c7f0d506e232081a414456a3462838e53725e2de2bafed3993714884a4d54f`
  - `Maple-Moss-Kickoff-Deck-r1.pptx` 92981 B `ee32b8cd3cc68bdf7b888d49763c236dca0160b2dbdad040c5718b477af5009d`
- Report task `bd9ecb95-912a-4801-9a41-a429fdb83383`, revision 1
  - `January-February-Sales-Performance-Report-r1.docx` 9833 B `f26a1f6519dd33e95b84d950082701f90e044a81748522b194052c34eb364ecf`
  - `January-February-Sales-Update-r1.pptx` 109913 B `0b9415b4c78273dd2171983a9a96ebc25c8c7c66d0ac320fbd2d22cdfb30c5bb`
- Native PPTX chart data in the report deck: `[12000, 15000]` (labels 2026-01, 2026-02). The report **DOCX has no native chart part**; its chart block is rendered as a data table (observed fact, not a defect).
- DOCX bytes differ run to run, so these hashes will not reproduce; each run compares downloaded bytes with that run's own manifest.

## Changed-input numbers (direct engine, Feb Website 10000 → 11000)

DOCX tables/summary: Jan $12,000 → Feb $16,000, +$4,000, 33.3% (one decimal), orders 120 → 150 (25%), AOV $100.00 → $106.67 (two decimals, rounded half-up as displayed), Website $8,000 → $11,000, share 66.7% → 68.8%.
PPTX native chart `[12000, 16000]`. Preview chart data equals file chart data. Wrong text: see DEF-2.

## End quality questions

1. **Commits inspected/tested:** `origin/platform` `aaed3db`, `origin/person-2-engine` `258e2eb`, merge `4e1b5ae` (local). `b442c71`/`e5b8510` appear in `aaed3db`'s history and were not tested separately. The "74 tests" figure from the earlier report is a teammate report; I observed 108 owner unit tests on the candidate.
2. **Batch 2 gate:** the real engine now exists and runs, but the real worker cannot store its output (DEF-1). Gate: **FAIL**, no longer merely blocked on a missing engine. Browser half still **BLOCKED** (no experience branch).
3. **Isolation:** yes. Throwaway DB/artifacts under `os.tmpdir()`, fresh environment (no inherited keys, no `.env`), free ports, outbox channel. Zero external messages; `integrations` shows Gmail disconnected and model fixture. My own other scratch runs started and stopped only their own processes; I never touched ports 4000/4177.
4. **Runnable by someone else:** yes, `node --import tsx --test tests/system/*.test.mjs` after `pnpm install`; needs `unzip`. No hidden state.
5. **Real tasks/hashes:** only scratch-patched (above). The candidate produced none, which is itself the finding.
6. **CSV and changed-byte agreement:** tables, chart data, summary figures agree and rounding is explicit (1 dp percentages, 2 dp currency). Narrative text does not (DEF-2).
7. **Clarification:** one new revision (2) and one planning start per revision; answers returned in `answers`; revision-1 events preserved; empty/missing/unknown/duplicate/blank/stale/wrong-type submissions → 400/409 with no new events or revision. Resume itself only completes with the DEF-1 patch; DEF-3 shows contradicting template text.
8. **no_action and duplicates:** PASS. Skipped, zero files, zero notifications, cannot be approved; 12 concurrent same-key injections → one task, one creator, one planning start.
9. **Access boundaries:** PASS without any test bypass; CLI token reads nothing and mutates nothing; revoked cookie stops working; Origin enforced; no paths/secrets in errors or logs; traversal-shaped ids → 400/404.
10. **receivedAt vs createdAt:** PASS (A6): `receivedAt` stays `2026-10-23T19:00:00.000Z`, `createdAt` is real ingestion time later than that, due date `2026-10-26T16:00:00.000Z` (Monday 9:00 PDT).
11. **Evidence kinds:** full HTTP + separate worker process: 01, 02, 04. Direct engine: 03. Browser-observed: none. Unit/mocked: Darren's and Joanne's suites (not mine). Structurally inspected: all downloaded files. Visually rendered: QuickLook first page/slide only.
12. **Defects:** DEF-1…DEF-5 in `defects.md`. No fixes received yet; retest pending.
13. **Mode claims:** observed API states `fixture`/`demo`/`outbox`, notification `simulated` with null provider id, review does not send. UI labelling NOT verified (no UI branch).
14. **FAIL/BLOCKED/NOT RUN:** see matrix. DEF-1 blocks the core gate; UI (I) blocks the browser gate.
15. **What Darren can reproduce:** merge the two branches, `pnpm install`, `pnpm demo:proposal` with worker running → task `failed ARTIFACT_INVALID`; apply the one-line patch → ready. Next shared candidate: merge `person-2-engine` plus the DEF-1 fix, rerun this suite, then Maricella's branch for the browser pass.

## Universal quality questions

1. **Proof of new behavior and commit:** the suite above on `4e1b5ae`; success path shown only on the scratch-patched code.
2. **Checks and exit codes:** table above.
3. **Fixture/mock/stub/live labels:** all fixture/demo/outbox; the engine under test is real (fixture intelligence, real extraction/calculation/files). No mocks in the system tests. Fixture `report-metrics.json` was used only as an oracle by value, not read by the engine of record.
4. **Contract match:** `downloadPath` is `/api/artifacts/:id/download` as specified (the API serves `/v1/...`); statuses, 400/409 semantics, revision rules match `docs/CONTRACT.md`. CCR-1 (answer history) is unanswered and untested.
5. **Safe failure:** DEF-1 fails the task honestly (nonretryable, no files, no ready notification) and loses no valid state; bad inputs return typed errors.
6. **Persistence:** approved state, artifacts (same hash), sessions and no-rerun after restart — PASS only on scratch-patched.
7. **Secrets/private data/unsafe actions:** none observed crossing a boundary; logs and DTOs scanned for password, CLI token, session secret, encryption key, storage paths.
8. **Remaining FAIL/BLOCKED/NOT RUN:** DEF-1 (P0, Joanne/Darren), DEF-2/3 (P1, Joanne), DEF-4/5 (P2, Joanne), UI/browser (Maricella, BLOCKED), Word/PowerPoint rendering (NOT RUN), F″ and worker-kill race (Darren, NOT RUN). DEF-1 and the browser block both stop the integrated gate.
