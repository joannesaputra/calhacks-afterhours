# Batch 7 — final integration record (Darren)

This section is the current record. The section after it (candidate `ae422e6`) is kept as history: it describes the platform + engine candidate before the UI, delivery adapter, browser suite and Claude provider were merged.

## Final candidate

| Item | Value |
|---|---|
| Branch | `integration/batch7` |
| **Tested implementation candidate** | `09f54ccedae13762ebca588818c6cbd698cf511b` (`09f54cc`) |
| Later commits | docs-only (this file, `darren.md`, release-doc banners). They add no code and were not re-run. |
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

`packages/engine/src/providers/anthropic.ts` (Messages API over `fetch`, no SDK, typed errors, JSON-only instruction, `max_tokens` → incomplete), `providers/env.ts` (`MODEL_PROVIDER=anthropic` only), `liveModelProblem` in `packages/data/src/config.ts`. The OpenAI adapter, `OPENAI_API_KEY` and the `openai` provider value are gone; `MODEL_PROVIDER=openai` now fails configuration at startup. Tested with a fake `fetch` (status mapping, key never echoed, incomplete, fence unwrapping, environment selection). **Not run against the real Anthropic API**: a key was configured locally but no live task was started, so the key, the model id and real output validity are unverified.

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
| Claude live generation against the real API | NOT RUN (key present, never called) | Darren, one deliberate billed smoke test |
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
