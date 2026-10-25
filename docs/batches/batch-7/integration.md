# Batch 7 — final integration record (Darren)

This section is the current record. The section after it (candidate `ae422e6`) is kept as history: it describes the platform + engine candidate before the UI, delivery adapter, browser suite and Claude provider were merged.

## Final candidate

| Item | Value |
|---|---|
| Branch | `integration/batch7` |
| **Tested implementation candidate** | `09f54ccedae13762ebca588818c6cbd698cf511b` (`09f54cc`) |
| Later commits | `9a5684f` adds the live-output fix and `worker:once` (code, tested below); everything after it is docs-only. The checks in "Commands and exit codes" below were run on `09f54cc`; the same checks on `9a5684f` are in the live-verification section. |
| Merged, in order | `experience-batch7` `e310849` (fast-forward; Maricella's UI, Twilio delivery adapter, Playwright suite, contains `experience-batch6` and the Batch 7 base `1b4deca`) → `engine-batch7` `3d4a8e2` (Joanne; merge `a1b6569`) → `feature/claude-provider` `13e1984` (Darren; merge `90961d2`) → `scripts/e2e.mjs` provider fix → UI re-theme `09f54cc` |
| Lockfile | taken from `experience-batch7` (adds Playwright, TanStack Query, lucide-react, jsdom for the web package). `pnpm install --frozen-lockfile` exit 0 on pnpm 10.33.4, Node v20.20.2. No manual lockfile edit, no new dependency from me. |
| `main`, `platform`, `platform-batch6` | untouched |

## Conflicts and how they were resolved

- `experience-batch7` was 0 commits behind `integration/batch7`, so it merged as a fast-forward; there was no file conflict.
- `engine-batch7` conflicted only in `packages/engine/test/engine.test.ts`: both sides had rewritten the DEF-2/4/6 regression assertions after Joanne's engine changes. Resolution: take Joanne's file whole (her oracles check the computed values and page width rather than phrasing; they cover the same defects). Her engine source changes (engagement interval, unusable-brief handling, honest no-action plan) merged cleanly.
- `feature/claude-provider` merged without conflict. One reference to the removed provider remained in `scripts/e2e.mjs` (the unconfigured-live-model stack used `MODEL_PROVIDER=openai`, which the config now rejects); it uses the Claude settings with an empty key.
- QA harness: one suite (`04-clarification-state`) also used `MODEL_PROVIDER=openai`; changed to the Claude settings with an empty key.

## UI reconciliation

Two UIs defined the same four routes, so only one set can build. Decision (Maricella's recorded choice, kept): **keep her application** (routes, components, content preview, charts, source dialog, settings forms, notifications page, delivery adapter, Playwright suite) because it is the only one with those features and tests. **Darren's standing rule is that the SpaceXAI look wins**, so her UI was re-themed rather than replaced:

- `apps/web/app/globals.css`: the SpaceXAI palette (near-black surfaces, hairline borders), pill buttons, Helvetica Neue, the letter-spaced wordmark and the horizon mark (`apps/web/components/brand.tsx`), a sticky top navigation instead of the side rail, dark dialogs, toasts and menus. Document and slide previews stay on white paper on purpose (they represent the Word and PowerPoint files); they use a scoped light palette.
- Markup, routes, labels, ARIA structure and test ids are unchanged, so her 26 browser tests still describe the same pages.
- Darren's original pages (`664cc98`, `79a35af`, `1e29d42`) remain restorable from history; they were removed from the tree by Maricella's merge `f38e86e`, as she reported. His `?next=` return path became her `?returnTo=` (same-origin relative path only); the deep-link run is covered by her browser tests (7, 21, 24).
- Screenshots were taken with Playwright at 1440 px and 390 px on the fixture stack (queue, task page with the document preview, settings, mobile task page). No horizontal overflow was visible. The built-in browser pane refused `localhost` in this session, so no pane-based check was done.
- Color contrast was not measured with a tool. Secondary text is white at 64% on the card color (about 7:1 by calculation).

## Claude provider in the candidate

`packages/engine/src/providers/anthropic.ts` (Messages API over `fetch`, no SDK, typed errors, JSON-only instruction, `max_tokens` → incomplete), `providers/env.ts` (`MODEL_PROVIDER=anthropic` only), `liveModelProblem` in `packages/data/src/config.ts`. The OpenAI adapter, `OPENAI_API_KEY` and the `openai` provider value are gone; `MODEL_PROVIDER=openai` now fails configuration at startup. Tested with a fake `fetch` (status mapping, key never echoed, incomplete, fence unwrapping, environment selection). **Live result:** the first real run failed output validation because the prompt lacked the schema; after the fix one real proposal run passed (see "Live Claude proposal verification after the schema fix").

## Live Claude proposal verification after the schema fix: PASS (one task)

**Result: LIVE PROPOSAL GENERATION PASSED for one proposal task.** This is one demo-intake proposal in live mode. It is not live Gmail, not a report or clarification run, not an accuracy benchmark, and not an overnight run.

### 1. Original failure and confirmed findings

- Failed task (historical, section below): `a8f10320-6f3d-45e9-9e52-e111d7dc8251` on `81c0bca`, `MODEL_INVALID_OUTPUT`, `plan.requestedOutputs.0 Invalid option`, two completed provider calls, no products.
- **Observed in code:** `SYSTEM` in `live.ts` told the model to match "the AfterHours WorkPlan and WorkProduct shapes" and never defined them; the repair call added only a sentence plus the issue list. No field, nested object or enum value was visible to the model.
- **Inference, now supported by one run:** the missing contract explains the validation failure, because the same code with a full specification reached `ready` on the first call. The exact wrong value from the failed run is unknown (the raw response was not kept); the first failed run showed 12 reported issues (the list is capped at 12), so more than one field was probably wrong. One successful run does not prove every future response will validate.

### 2. What changed (commit `9a5684f6d0a504468ce3bb9a38d0d74133e7ca8c`, pushed before the live run)

| File | Change |
|---|---|
| `packages/engine/src/liveSpec.ts` (new) | `LiveResponseSchema` moved here and exported; `responseJsonSchema()` derives a JSON Schema from it with `z.toJSONSchema` (shared definitions, only `$schema` and the date-time regex pruned); `FIELD_RULES` for what a schema cannot say (output kind versus file format, "all fields present, unused ones null or `[]`", evidence and quote rules, basis meanings, amounts/percentages/dates must come from the sources, slide count and layout budgets, plan deadline fields null, outcome rules); a placeholder-only `FORMAT_EXAMPLE`; `systemPrompt()` joins them. |
| `packages/engine/src/live.ts` | `SYSTEM = systemPrompt()`. Generation and repair both send it; the repair call adds an instruction to return the complete corrected object, and still carries the original request, the previous response (truncated as before) and the validation issues. Validation, grounding, the single repair and the call budget are unchanged. |
| `apps/worker/src/once.ts`, `once-main.ts`, root script `worker:once` | One-shot control (below). |
| tests | `packages/engine/test/live-spec.test.ts` (11 tests), `apps/worker/test/once.test.ts` (4 tests). |

**Drift protection:** the structural part of the instructions is generated from the validating Zod schema, so it cannot diverge. The hand-written rules and the example are guarded by tests: the contract schemas' fields and enums are checked against the generated schema; every enum option must appear in the right rule; every quoted word in the rules must be a real field, enum option or request field; the example must validate and must fail grounding when used as content (two calls, then `MODEL_INVALID_OUTPUT`); a changed schema changes the specification.

### 3. Offline checks on a fresh clone of `9a5684f` (clean status; no `.env`)

| Command | Exit | Result |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | lockfile unchanged |
| `pnpm setup:local`, `pnpm check:ready` | 0, 0 | generation=fixture, notifications=outbox |
| `pnpm typecheck`, `pnpm lint` | 0, 0 | |
| `pnpm test` | 0 | 29 files, 345 tests (330 before; 15 new) |
| `env -u NODE_ENV pnpm build` | 0 | |
| `pnpm test:e2e` | 0 | 25 passed, 1 skipped (stub-engine failure case, not applicable) |
| QA harness `qa/system-batch7` @ `d248e51` | 0 | 53 of 53 |

### 4. Bounded live run: how the limit was enforced

- Candidate run: `9a5684f`, working tree clean, same commit the processes executed. `.env` untracked (checked against tracked file names).
- Preflight without printing values: mode live, provider `anthropic`, model `claude-sonnet-5-5`, key present, notification channel outbox, Gmail not configured, no Twilio settings, no WhatsApp recipient. API on 4631, web on 3631, scratch database and artifact directory, all ports free beforehand.
- **Enforcement:** the worker was not started as a service. After one demo injection, `pnpm worker:once` ran the real worker (job lease, engine call, terminal commit) for at most one job and one notification with no polling loop, so a retryable failure could only have been requeued, never executed again. The provider adapter is a raw `fetch` (no SDK, no hidden retry); the engine allows one generation and at most one repair, with the existing 3-call, 60 s and 12,000-token limits unchanged. One injection, one new replay key (`live2-proposal-189513f6`), no retry, no regenerate. Tested by `once.test.ts` (retryable failure runs once and stays queued; the ordinary worker's retry policy is unchanged).
- Baseline: new scratch database with 0 tasks; 0 provider calls.

### 5. Result

| Item | Value |
|---|---|
| Task | `ac55e3c3-42ca-4da4-b558-52620e6d1f05`, revision 1; `generationMode=live`, `ingestionMode=demo` |
| Final state | `ready` (then `approved` after one "Mark reviewed") |
| Provider requests | **1** (generate). No repair was needed. |
| Usage | 27,173 ms; 5,150 input and 4,743 output tokens (from the progress event). `worker:once` wall time 28.0 s. Cost not calculated (no verified price in the repository). |
| Missing telemetry | provider request id is returned by the adapter but not stored anywhere; no per-request billing record |
| Fallback | none: live mode has no fixture fallback, and the log shows `Requesting a bounded structured plan from the configured live model` then `Live model call 1 of 3` |
| Database manipulation | none; state came from the worker's normal commit |

### 6. Artifacts (downloaded through the application's authenticated route, not the demo bearer)

| File | Bytes | SHA-256 (first 16) | Checks |
|---|---|---|---|
| `Launch-Strategy-Proposal-for-Maple-Moss-r1.docx` (`art_09c24e83…`) | 11,576 | `9ef799d3b74a97f9` | HTTP 200; correct Word media type; `Cache-Control: private, no-store`; size and hash equal the manifest; ZIP valid; `word/document.xml` present; one fixed-layout table (smallest column 3971 twips) |
| `Maple-Moss-Kickoff-r1.pptx` (`art_cfaf6a20…`) | 98,898 | `a41cb5532b1832a9` | same; `ppt/presentation.xml` present; **exactly 5** `ppt/slides/slideN.xml` parts |

The same bytes were also downloaded by the UI's Download buttons (browser run below); both hashes matched the manifest.

**Content, against the actual fixture bytes** (email: "Please prepare a proposal DOCX and a five-slide kickoff PPTX… ready by Monday, October 26, 2026 at 9:00 AM Pacific… The engagement would start October 26 and run for four weeks"; brief: USD 6,000, paid media separate; company profile: standard four-week package, exclusions):

- Products: exactly `proposal` and `presentation`, matching `requestedOutputs`.
- Client Maple & Moss, provider Harbor Creative, scope (discovery, audience and message strategy, four-week content calendar, measurement plan), fee USD 6,000 with "paid media is separate", duration four weeks, exclusions as in the profile, the sales-growth constraint, no payment schedule, no outcome promise. All as in the sources.
- Dates: plan deadline `2026-10-26T16:00:00.000Z` (9:00 AM PDT) resolved by code from the email's receipt time and the organization time zone; the live run date (Oct 24) is not used. The engagement table shows start October 26 and end November 22: the end date comes from the engine's existing code-derived dates (`calculatedDates`) and is labelled "Calculated in code"; the email states only a start and four weeks.
- Evidence: 14 source references, all pointing at this task's three sources; 13 of 13 quotes found verbatim in their sources; basis counts 11 source, 2 calculated, 2 recommendation, 0 assumption blocks. Recommendations are labelled ("Recommendation from Harbor Creative; not stated in the sources"); the draft is labelled "not sent or accepted".
- Leak scan of both files and the previews: no `EXAMPLE` placeholder, no schema or instruction wording, no raw source ids, no key pattern, no "docx"/"pptx" as content.
- Cosmetic: the timeline block's source label reads "Calculated in code from Proposal and five-slide kickoff deck for Maple & Moss" (the email subject is the cited source title).

**Visual inspection of the exported files: mostly NOT RUN.**

- Quick Look (macOS, not Word or PowerPoint) rendered page 1 of the DOCX and slide 1 of the PPTX: readable, no clipping. Slides 2 to 5 and DOCX page 2 onward were not rendered.
- PowerPoint export to PDF was attempted by AppleScript and timed out (`-1712`, then `-128`): a PowerPoint instance that has been running for six days (not started by this run) did not answer, probably a dialog waiting for input. I did not touch it.
- Word is not installed; LibreOffice is not installed.
- Manual check for Darren: open both files in `var/live-output/` in PowerPoint and Word and look at all five slides and every page.

### 7. UI (Playwright with the installed Chromium; the built-in browser pane was not used)

- Deep link to the task while signed out → `/login?returnTo=%2Ftasks%2Fac55e3c3-…` → after sign-in the same task page.
- Labels: "Ready for review", "Demo email", "Live model" (no "Fixture output" badge); top bar "Live model · claude-sonnet-5-5", "Gmail disconnected", "Notifications: outbox (simulated)". The banner "The worker is not running" appeared because only the one-shot worker was used; it is accurate.
- Both products render in the preview (the proposal tab shows the evidence chips and the CALCULATED / RECOMMENDATION labels); Download buttons worked and showed "checksum verified". Desktop and 390 px screenshots taken; no horizontal overflow at 390 px.
- Marked reviewed once: "Marked reviewed. Nothing was sent." Then the API was killed and restarted, the page reloaded: still reviewed, `GET /tasks/<id>` status `approved`, one task, two artifacts, one live call and one planning attempt in the log, one notification (`outbox`, `simulated`; simulated is not delivered). The only new event after readiness was "Marked reviewed. Nothing was sent." No email or WhatsApp could be sent (no Gmail, no Twilio configuration).

### 8. Where the files are

Untracked and gitignored, still on this machine: `calhacks-afterhours-b7/var/live-output/` holds the DOCX, the PPTX, the Quick Look images, two screenshots, `task-detail.json` and `run-result.json` (no secrets; the key does not occur in any of them or in the logs). The scratch database and logs were deleted after the key scan; the API and web processes I started are stopped; the one-shot worker exited. Not mine and untouched: a Microsoft PowerPoint instance, an orphaned QA worker from an earlier harness run (PID 7459, temporary database), and the process on port 4000.

### 9. Remaining blocked, not run, or limited

Word and all-page/all-slide visual inspection; one successful proposal does not cover a live report, clarification or no-action run; live Gmail and WhatsApp; Docker; remote host; overnight run; no cost figure; repeatability of live output is unmeasured (one sample).

### 10. Quality questions

1. **PASS.** Full envelope, nested definitions and enums are in the system prompt (`live-spec.test.ts` "carries every field…", "carries every enum value…").
2. **PASS.** Repair uses the same `SYSTEM`; test "rejects 'docx'… then repairs" asserts the schema and rules in the repair instructions and the issue `plan.requestedOutputs.0` in its input.
3. **PASS.** Schema derived from the validator; rules and example guarded by the parity tests above.
4. **PASS.** Rule 1 and the "file formats" test.
5. **PASS, with a limit.** The test that the legacy sentence names no field and the "docx" rejection test demonstrate the missing contract and the failure mode; the legacy sentence is quoted in the test, the old code path is not re-run. The live proof is the passing run.
6. **PASS.** Repair success: exactly 2 calls; failed repair: `MODEL_INVALID_OUTPUT`, nonretryable, exactly 2 calls.
7. **PASS.** Unsupported amount and unknown source are both reported and repaired; quote, citation, date, layout and arithmetic checks untouched.
8. **PASS.** Deadline from code (`2026-10-26T16:00Z`), product and block IDs replaced in code, calculation tests unchanged and passing.
9. **PASS.** `needs_input` and `skipped` tests; a ready result with a required question is repaired.
10. **PASS.** Section 3.
11. **PASS.** `9a5684f6d0a504468ce3bb9a38d0d74133e7ca8c`, clean tree, pushed before the run.
12. **PASS.** `worker:once` (section 4) plus raw `fetch` and the engine's single repair.
13. **PASS.** 1 request, 27,173 ms, 5,150 in / 4,743 out.
14. **PASS.** ready through the real API, queue, lease, engine, provider and commit; no fallback or database edits.
15. **PASS.** Authenticated routes, hashes equal the manifest; same hashes through the UI.
16. **PASS** for content and structure (section 6); the November 22 end date is code-derived, not stated in the email.
17. **NOT RUN** for full export rendering; Quick Look page 1 and slide 1 only; PowerPoint timed out; no Word.
18. **PASS.** Section 7.
19. **PASS.** No key, scratch database, raw response or private log in git, outputs or public errors (scan: 0 matches).
20. **PASS.** This section and the historical one below.
21. **PASS.** Pushed to `integration/batch7`; `main` untouched; unrelated work untouched.
22. **PASS.** Section 8.

## Earlier live Claude smoke test (historical, commit `81c0bca`): FAIL

One real task through the real API, queue, worker and the Claude provider, run once and not repeated.

| Item | Value |
|---|---|
| Tested commit | `81c0bca` (`integration/batch7`; code identical to `09f54cc`, the later commits are docs only) |
| Scenario | `proposal` (the demo Maple & Moss email and brief), demo intake |
| Task | `a8f10320-6f3d-45e9-9e52-e111d7dc8251`, revision 1 |
| Mode and model | `generationMode=live`; status endpoint reported provider `anthropic`, model `claude-sonnet-5-5`, configured |
| Setup | API on port 4631 and the worker (both started from the repository with the existing local `.env`), scratch database and artifact directory under `var/smoke/` (deleted afterwards). The web app was not started: files were to be downloaded from the application's API download endpoint, but none were produced. |
| Safeguards | Fixture fallback: none exists in live mode. Automatic retry: the worker allows a second attempt for retryable errors, so the run polled the task and would have stopped the worker before one started; it was not needed because the error was nonretryable. Existing call limits (3 calls per attempt, 60 s per call, 12,000 output cap) were not changed. Notification channel `outbox`, Gmail `disconnected`, no WhatsApp configuration: no email or message could be sent, and the task created no notification. |
| Outcome | `failed`, nonretryable, `MODEL_INVALID_OUTPUT`: "The repaired live model output still failed validation: Schema: plan.requestedOutputs.0 Invalid option: expected one of "proposal"\|"report"\|"presentation"" |
| Credentials, model name, billing | All worked: the provider returned two completed responses. The provider did not reject the key, the model id or the account. |

**Actual provider usage, from the task's progress events** (the only usage record; provider request ids are not stored):

| Call | Purpose | Duration | Input | Output |
|---|---|---|---|---|
| 1 of 3 | generate | 24,352 ms | 1,840 | 4,225 |
| 2 of 3 | repair | 26,231 ms | 6,064 | 4,908 |
| Total | 2 calls | about 50.6 s | 7,904 | 9,133 |

(The progress log also shows: the first response failed 12 validation checks, one bounded repair was requested, and the repaired response still failed.) A monetary cost was not calculated: no price list is recorded in the repository.

**Artifact verification: not possible.** No DOCX, no PPTX and no preview were produced (0 artifacts, 0 products, 0 notifications), so downloads, contents, calculations and the five-slide count were not verified for live output. Nothing in this run should be read as evidence that live Claude generation works.

**Likely cause (read from the code, not confirmed by a second call).** `SYSTEM` in `packages/engine/src/live.ts` tells the model to return "AfterHours WorkPlan and WorkProduct shapes" but the payload contains no schema, enum list or example, so the model has to guess field names and values such as `requestedOutputs` (`proposal`, `report`, `presentation`). The repair call only lists the validation errors. The model output itself is not stored, so the exact wrong value is unknown. Joanne's live-path tests use a scripted fake client built from the fixture engine's own valid output, which is why they could not see this. Suggested fix (owner: Joanne): put the exact JSON shape and enum values for `WorkPlan` and `WorkProduct` into the prompt (or derive it from the Zod schemas), add a test that the prompt contains every enum value, then run one more live smoke test. Not done in this task, because the instruction was one task only.

**Not verified:** whether a corrected prompt produces valid, grounded output; live output quality; per-call cost; anything about Word rendering; whether the key works with models other than `claude-sonnet-5-5`.

Secrets: the key was read only by the server process; it is not in the repository, the logs (0 matches) or this report.

## Commands and exit codes (fresh `git clone --no-hardlinks` of `09f54cc`, clean status before and after)

| Command | Exit | Observed |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | |
| `pnpm setup:local` then `pnpm check:ready` | 0 / 0 | generation=fixture, notifications=outbox, demo=true |
| `pnpm typecheck` | 0 | |
| `pnpm lint` | 0 | |
| `pnpm test` | 0 | 27 files, 330 tests |
| `pnpm build` (run as `env -u NODE_ENV pnpm build`) | 0 | |
| `pnpm test:e2e` | 0 | **25 passed, 1 skipped** in about 1.1 min; real API, worker, engine and browser; nothing BLOCKED. The skipped test is the stub-engine failure case, not applicable because the engine is real. |
| QA harness `qa/system-batch7` @ `d248e51`, `QA_REPO_ROOT` = the clone | 0 | 53 tests, 53 pass |

Notes on how these ran:

- **Chromium:** the machine had Playwright Chromium build 1234 but the suite needs 1243, so `test:e2e` first exited 4 (NOT RUN, as designed). With the user's approval I installed it. `playwright install` timed out in Node (30 s connection limit), so I fetched the two official zips from `cdn.playwright.dev` with `curl` and extracted them into `~/Library/Caches/ms-playwright` with the standard markers; the binary reports 153.0.8010.12.
- **`env -u NODE_ENV`:** sourcing `.env` into a shell sets `NODE_ENV=development`, which breaks `next build` prerender of `/_global-error`. A build with `NODE_ENV` unset is fine.
- **Typecheck after deleting `.next`:** one typecheck run exited 2 after `apps/web/.next` was deleted while a stale, gitignored `tsconfig.tsbuildinfo` still listed `.next/types` files. Re-runs and the fresh clone are exit 0. It is a local build-cache effect, not a source defect.
- The suite runs in fixture mode and forces empty model keys for its failure stack, so the real key in my local `.env` was not used.

## Question answers (changes from the earlier record)

- **Committed frontend and provenance:** Maricella's application (author Claude on her branch, `experience-batch6`/`7`) with Darren's SpaceXAI visual system applied in `09f54cc`.
- **Browser test command runs tests:** PASS. 25 passed, 1 skipped, exit 0 on the fresh clone.
- **Clean checkout reproduces:** PASS for `09f54cc`.
- **Stub in the runtime path:** none in the engine or web app. `packages/delivery` is now the Twilio adapter (mock-tested; no live send); the outbox is still what the demo uses.
- **QA harness:** 53/53 on the final code.

## Remaining failures, blocked and not run

| Item | Status | Owner / path |
|---|---|---|
| Claude live generation | **PASS for one proposal task** after the schema fix (`9a5684f`); the earlier run on `81c0bca` failed. Live report, clarification and no-action runs: NOT RUN | Darren, if wider live coverage is wanted |
| Live Gmail, live WhatsApp (Twilio adapter exists, no account/eligibility) | BLOCKED | external |
| Word rendering of the DOCX; PowerPoint/Word visual check on this candidate | NOT RUN | anyone with Word |
| Docker, remote host, real overnight run, two timed team rehearsals | NOT RUN | needs a host and the team |
| Browser login with every hostile `returnTo` value | PARTIAL: unit test (13 cases) and deep-link browser tests; not every value in a browser | Maricella |
| Screen-reader pass; automated contrast measurement of the dark theme | NOT RUN | Maricella |
| Built-in browser pane check of the restyled UI | NOT RUN (pane refused `localhost`); Playwright screenshots used instead | |
| Older release docs (`docs/release/*`, Batch 6 reports) | still describe `0e8395e`; banners point here | Darren |

## Next tested commands

```bash
git switch integration/batch7
corepack pnpm install --frozen-lockfile
corepack pnpm setup:local            # untracked .env with generated secrets; add ANTHROPIC_API_KEY only for live mode
corepack pnpm check:ready
corepack pnpm dev
corepack pnpm demo:proposal          # fixture mode unless GENERATION_MODE=live
env -u NODE_ENV corepack pnpm test:e2e
```

---

# Batch 7 — earlier integration record (candidate `ae422e6`, superseded by the final record above)

One committed integration candidate now contains the platform, the real engine and the chosen UI. Everything below was observed on it. Reports from earlier batches are history, not evidence for this commit.

## Candidate

| Item | Value |
|---|---|
| Branch | `integration/batch7` |
| **Tested implementation candidate** | `ae422e6a63c897078c4fea07aeb7a8dd17f1f6bd` (`ae422e6`), a merge commit |
| Parent 1 (platform + UI + Darren's Batch 6 work) | `platform-batch6` @ `fef9396c52ef0499177f6194906d7e72b6f18037` (pushed) |
| Parent 2 (engine) | Joanne's `engine-batch6` @ `b31399861ba327affeed782ee47154ebf95ad4f0` (`b313998`, pushed by her; contains `engine-batch5` @ `0bf8819`) |
| Later commits | docs-only (`docs/batches/batch-7/*`, banners in `docs/release/*`). `git diff ae422e6 HEAD --stat` lists only `docs/` paths. They were not re-run. |
| Lockfile / manifests | `git diff platform-batch6 HEAD -- pnpm-lock.yaml package.json` is empty (0 lines). `pnpm install --frozen-lockfile` exit 0 on pnpm 10.33.4 (Corepack shim), Node v20.20.2. |
| Optional QA harness | `qa/system-batch7` (parent `ae422e6`; tests and QA docs only) |

## Refs observed today (the packet's snapshot was partly superseded)

| Ref | Tip | Versus the packet |
|---|---|---|
| `origin/main` | `5d8f342` | same |
| `origin/person-2-engine` | `de6bd40` | same |
| `origin/platform` | `aaed3db` | same |
| `origin/platform-batch4` | `700d7a6` | same (local `af24fef` is three commits ahead, unpushed; they are already ancestors of `platform-batch5`) |
| `origin/platform-batch5` | `d11127b` | same |
| `origin/platform-batch6` | `fef9396` | **new**, pushed by Darren (contains Batch 5, the engine, the UI and the return-path fix) |
| `origin/engine-batch5` | `0bf8819` | **new** (Joanne) |
| `origin/engine-batch6` | `b313998` | **new** (Joanne) |
| experience / Maricella branch | none | still absent, so no second UI exists to reconcile |

## Preserved local work

| Work | Where it is now |
|---|---|
| Uncommitted SpaceXAI UI in the main checkout (`ui/spacexai-style`) | The ten files under `apps/web/app` are byte-identical (SHA-1 compared file by file) to commit `664cc98` on `platform-batch6`. The main checkout was not modified. |
| QA harness (`tests/system`, `docs/qa`) | Was local only on `qa/system-batch3` @ `1cee0ca` (that branch also holds `4e1b5ae`, a local engine-into-platform merge). The two QA-only commits are cherry-picked onto `qa/system-batch7`; the original branch is untouched. |
| Batch 5 logo files (`brand/`, untracked in the b5 worktree) | untouched, not part of this candidate |

**UI in the candidate:** Darren's SpaceXAI-style UI (author Darren; snapshot `664cc98`, return-path fix `79a35af`, `1e29d42`). It is not Maricella's work. If she pushes a different frontend, it has to be reconciled with this one on purpose.

## What the merge did

- `git merge origin/engine-batch6` conflicted in two files, both engine-owned: `packages/engine/src/content.ts`, `packages/engine/src/render/docx.ts`. Both sides had independently fixed the same release defects (DEF-2 report narrative, DEF-4 table grid). Resolution: take Joanne's files whole. Darren's engine commits `8bcdbb4`, `15b15f8`, `f6e3be1`, `68ea1ec` are therefore superseded in those two files; nothing was combined by hand.
- `packages/engine/src/planning.ts` auto-merged. It keeps Darren's DEF-6 "skipped message is not a proposal" title and Joanne's new answer-validation code.
- `packages/engine/test/engine.test.ts`: the four DEF regression groups were kept. DEF-2 and DEF-4 asserted the old wording and an old 9000-twip width; they now assert values, direction and the page width (9746 twips) instead. No test was removed. DEF-3 and DEF-6 are unchanged and pass.
- Platform code, tests (`apps/worker`, `apps/api`, `packages/data`) and the lockfile are unchanged by the merge.

## Commands and exit codes (candidate `ae422e6`, clean worktree, scratch `.env`, scratch DB)

| Command | Exit | Observed |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | lockfile unchanged |
| `pnpm check:ready` (after `pnpm setup:local` wrote a scratch `.env`) | 0 | config, migrations, ports, engine and delivery load; `generation=fixture, notifications=outbox, demo=true`; Gmail INFO not configured. Without a `.env` it exits 1, as designed. |
| `pnpm typecheck` | 0 | |
| `pnpm lint` | 0 | |
| `pnpm test` | 0 | 24 files, 272 tests |
| `pnpm vitest run packages/engine` | 0 | 3 files, 52 tests |
| `pnpm build` | 0 | built with `API_ORIGIN=http://127.0.0.1:4627` |
| `pnpm test:e2e` | 0 | prints `SKIPPED: tests/e2e is empty.` **Browser suite: NOT RUN.** Exit 0 is not a pass. |
| QA harness, inherited expectations | 1 | 53 tests, 49 pass, 4 fail (A3, A4, H5, H6) |
| QA harness, after four reconciled expectations | 0 | 53 tests, 53 pass (`docs/qa/batch-7-verification.md`) |

## Real services, real UI, one task (local, fixture mode)

Processes started by me and stopped by me: API on 4627, worker, built Next on 3627, scratch DB and artifacts under `var/b7/`. The API and worker logs held no level-50 entries across both runs.

1. Unauthenticated `GET /api/tasks/<id>` → 401. Browser to `/tasks/<id>` redirected to `/login?next=%2Ftasks%2F<id>`; after sign-in the browser landed on `/tasks/<id>` (deep-link return PASS, same-origin relative path only).
2. `pnpm demo:proposal` (demo command line) queued task `6882d722-6845-4d5c-9e14-4b2a757de688` (ingestion `demo`, generation `fixture`). It reached `ready`, revision 1. The page showed "Demo email", "Fixture intelligence", the plan, the progress log, the content preview, the sources and the simulated-outbox notification ("not sent to a phone").
3. Content: proposal with 10 blocks and a five-slide deck. Fee `USD 6,000` (quoted from the brief and the company profile). Schedule "Starts October 26, 2026; 4 calendar weeks". Draft due "Monday, October 26, 2026 at 9:00 AM PDT" on its own row. Payment milestones "Not stated in the sources; to be agreed".
4. Downloads through the browser session: both HTTP 200, `Cache-Control: private, no-store`, correct MIME, size and SHA-256 equal the manifest.

   | Artifact id | File | Bytes | SHA-256 (first 16 hex; the full value is in the manifest) |
   |---|---|---|---|
   | `art_05c90bb0038d4eb8cb1e917f497c61d8` | `Maple-Moss-Proposal-r1.docx` | 11923 | `02aa09889f1946c3…` |
   | `art_dbcec1ebaf344e1bfc1b4f52e66e7652` | `Maple-Moss-Kickoff-Deck-r1.pptx` | 101280 | `b4584e1de38b5548…` |

   Structural check on the downloaded copies: both ZIPs pass `testzip`; the PPTX has 5 slides; the DOCX has 2 tables, both `fixed` layout, smallest `gridCol` 1671 twips, and contains the fee and start date. **Visual rendering was not performed on this candidate.** Joanne's audit rendered the same engine in PowerPoint and Quick Look on her merged audit tree (`docs/release/artifact-audit.md`); that is her evidence for her tree, not mine.
5. Clicked **Mark reviewed**: "Marked reviewed. Nothing was sent." Then I killed and restarted the API and worker, reloaded the page: the session cookie still worked, the page still said "Marked reviewed", and `GET /api/tasks/<id>` returned `status: approved`, revision 1. No submission to a client exists in the product.
6. `pnpm demo:report` → task `3e6de0b2-e9a2-49cd-ad22-76a3f54c43d7`, `ready` ("January-February sales performance update"). Report, clarification (revision 2), no-action, replay dedupe, stale review, access and CLI scope are covered by the 53 harness checks through the real API and worker, not by this manual run.

## QA failures: triage

IDs were taken from `docs/qa/defects.md` and the harness test names, not guessed.

| ID | Owner | Expected contract | Observed originally | Class | Now |
|---|---|---|---|---|---|
| DEF-2 / C4, C5, C6, H6 | Joanne | narrative follows computed values | hard-coded "grew 25%", "AOV remained $100" | code defect | PASS with Joanne's `content.ts`; Darren's `68ea1ec` superseded. |
| DEF-3 / D7 | Joanne | no "four-week" next to a three-week answer | hard-coded labels | code defect | PASS with Joanne's `content.ts` (Darren's `f6e3be1` is superseded in that file) |
| DEF-4 / N3.x | Joanne | DOCX tables have a real grid | `gridCol` 100 twips | code defect | PASS (fixed layout, content-proportional widths) |
| DEF-6 | Darren (in Joanne's package) | skipped message is not a proposal | plan title "launch strategy proposal" | code defect | PASS (`15b15f8`, kept through the merge) |
| A4 | QA | start date and duration in the preview | expected an end date `October 26-November 22, 2026` that the email never states | **stale expectation** | PASS after the assertion change |
| A3 | QA | unknown payment milestones are flagged | wording "Not stated … to be agreed" | **stale expectation** | PASS after the assertion change |
| H5 | QA | zero base is flagged, never a number | "Not computable" | **stale expectation** | PASS after the assertion change |
| H6 | QA | AOV unknown for a zero-order month | label "February 2026", "unknown (no orders)" | **stale expectation** (negative assertions kept) | PASS after the assertion change |
| A5 | QA | quotes must match their source | null quotes allowed by the contract | stale expectation | PASS (needed no change) |
| I1 | Joanne | injection-only brief is not a substantive ready proposal | ready outcome, no leak | needs material-fact analysis | PASS |

## Unresolved

| Item | Status | Owner / path |
|---|---|---|
| Browser test suite | **NOT RUN.** `tests/e2e` is empty; `scripts/e2e.mjs` delegates to Person 3. | Maricella; this batch did not change her package |
| Maricella's frontend / reconciliation with the SpaceXAI UI | BLOCKED, no branch on origin | Maricella pushes it; Darren reconciles |
| Delivery adapter (`packages/delivery`) | foundation stub; outbox `simulated`, live always `blocked` | Maricella, then WhatsApp eligibility |
| Evidence chips show raw source ids | P2 | Maricella (web) |
| Word rendering of DOCX | NOT RUN | anyone with Word |
| Live Gmail, live model, WhatsApp | NOT RUN / BLOCKED (no credentials or eligible account) | external |
| Docker, remote host, overnight run | NOT RUN | needs a host |
| Batch 5/6 durability evidence (restart, quiet hours, backup) | reused, unchanged code: `packages/data`, `apps/api`, `apps/worker` are identical to `platform-batch6`; I re-ran one API/worker restart only | see `docs/release/capability-matrix.md` |

## Next tested commands

```bash
git switch integration/batch7
corepack pnpm install --frozen-lockfile
corepack pnpm setup:local          # writes an untracked .env with generated secrets
corepack pnpm check:ready
corepack pnpm dev                  # web, api, worker
corepack pnpm demo:proposal        # then open the printed URL and sign in
QA_REPO_ROOT="$PWD" node --import tsx --test <path-to-qa-worktree>/tests/system/*.test.mjs
```
