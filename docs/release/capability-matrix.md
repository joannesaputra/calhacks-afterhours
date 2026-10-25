> **Batch 7 (final):** superseded in part by `docs/batches/batch-7/integration.md` for candidate `09f54cc`: browser suite PASS (25 passed, 1 skipped, fresh clone), QA harness 53/53, delivery adapter present but live send BLOCKED, live Claude generation NOT RUN. Older text follows. **Batch 7 (earlier):** rows below describe `0e8395e`. Engine, artifact and QA rows were re-run on `ae422e6` (QA harness 53/53 after four reconciled expectations; manual browser pass; downloads verified). The browser suite is still **NOT RUN**. Details: `docs/batches/batch-7/integration.md`.

# Capability matrix (candidate `0e8395e`)

Status words: **PASS** (observed on this candidate), **FAIL**, **BLOCKED** (external prerequisite missing), **NOT RUN**, **NOT IMPLEMENTED**. Evidence ids: `L#` = row of the check ledger in `docs/release/candidate.md`; `R1`/`R2` = demo rehearsals and `I#` = sections in `docs/batches/batch-6/integration.md`. Independent axes are never merged: accepted ≠ delivered, a controlled clock ≠ an overnight trial, a Dockerfile ≠ deployment, Office ZIP/XML ≠ visual rendering.

## Intake

| Capability | Status | Evidence / limit |
|---|---|---|
| Demo injection (UI buttons, `pnpm demo:*`) through the same ingestion service | **PASS** | L13, R1, R2; replay with one key returns the same task (`deduplicated:true`), I4 |
| Live Gmail (OAuth, polling, allowed senders, limits) | **BLOCKED** (code + mocked tests only) | no Google client or test inbox; Batch 4 tests use a mocked Gmail API. Never call a demo task "from Gmail". |
| Unknown sender / limits / malformed cursor / history cutoff | **PASS (mocked/unit)** | `pnpm test` (L10); cursor 400 also observed over HTTP, I4 |

## Intelligence

| Capability | Status | Evidence / limit |
|---|---|---|
| Fixture engine: proposal+deck, report+deck, clarification, no-action | **PASS** | R1, R2; QA suite 50/53 (L12). Content comes from templates over the supplied email, brief, org profile and CSV. It is not a model. |
| Report numbers computed in code (12,000 / 15,000 / +3,000 / 25%, orders 120→150, AOV $100) and narrative follows the data | **PASS** | I3 (DOCX text, native chart values 12000/15000); regression tests for changed and zero-order data |
| Live OpenAI generation | **BLOCKED** | no key / `MODEL_NAME`. Missing key fails honestly (`MODEL_NOT_CONFIGURED`, nonretryable, no fixture fallback, settings and worker stay up), observed in I5. A successful live call was never made. `anthropic` is unsupported by design. |
| Verbatim source quotes in evidence | **FAIL (P2)** | evidence references source ids only; QA A5 |
| Hollow brief (injection-only attachment) | **FAIL vs strict QA expectation (P2)** | engine returns `ready` from the email body with no warning; injected text is not echoed into products or files and nothing leaks; QA I1 |

## Output files

| Capability | Status | Evidence / limit |
|---|---|---|
| Real DOCX + five-slide PPTX persisted, downloaded through authenticated routes, size/SHA-256 equal to the manifest, correct MIME, `private, no-store`, sanitized filename | **PASS** | I2, I3 (both rehearsal tasks and the report) |
| DOCX/PPTX structure and text (headings, five slides, speaker notes, native chart) | **PASS (structural)** | I2, I3 |
| Visual rendering | **PARTIAL**: macOS Quick Look rendered page 1 of the proposal and report DOCX and slide 1 of the deck; tables now render as real tables. Slides 2–5, Word and PowerPoint rendering: **NOT RUN**. A chart table in the report DOCX prints raw `12000`/`15000` (cosmetic). | I2, I3 |
| Preview matches files (same WorkProduct) | **PASS for headings, fee, client**; QA A4 fails only on a date-format string (`October 26-November 22, 2026` expected, engine prints `October 26, 2026 (4 calendar weeks)`): expectation drift, P2 | L12 |

## Review and UI

| Capability | Status | Evidence / limit |
|---|---|---|
| Login, deep-link return after sign-in/session expiry, queue, progress log, sources, files, answers, review, refresh | **PASS (manual, real backend/worker/engine)** | I3, R1, R2. **No automated browser suite exists** (`tests/e2e` empty): NOT RUN |
| "Mark reviewed" records acceptance only | **PASS** | event text "Marked reviewed. Nothing was sent."; stale or repeated review → 409; unauthenticated/foreign-origin → 401/403 |
| Mobile/keyboard | **PASS at 375 px, observed earlier (Batch 5 integration tree, same UI source), NOT re-run on `0e8395e`**: no horizontal overflow, review and downloads worked. Keyboard-only and offline/reconnect: **NOT RUN** | `docs/batches/batch-5/integration.md` |
| Source evidence shown as raw internal ids | **FAIL (P2, usability)** | owner: UI (Maricella/Darren) |

## Delivery

| Capability | Status | Evidence / limit |
|---|---|---|
| Outbox: composed and stored `simulated`, no network | **PASS** | I3 (every ready task created exactly one intent; 7 simulated rows) |
| Queued / blocked / failed / uncertain handling, no regeneration, no resend of uncertain sends, `POLICY_CHANGED` | **PASS (controlled tests with a fake provider)**; real process-death drills in Batch 5 | `pnpm test` L10 |
| Live WhatsApp (Twilio): adapter | **NOT IMPLEMENTED** (`packages/delivery` is the foundation stub; every live send is `blocked`) | owner: Maricella. No Twilio call can happen from this code. |
| Provider accepted vs confirmed delivered | **PASS as a distinction** (accepted never becomes delivered; no delivered path exists) | unit tests; never observed live |
| Digest message lists tasks with a remainder count | **FAIL (P2)** | stub composer prints only a count for more than one task |

## Operation

| Capability | Status | Evidence / limit |
|---|---|---|
| Work continues with the browser closed | **PASS** | Batch 5 candidate `d11127b`, same platform code (candidate doc): worker paused, request created from the browser, browser closed, worker resumed and finished with no browser open |
| Local process restart (`SIGTERM`) keeps tasks, approved state, manifests, files | **PASS** | I6 on the frozen candidate: identical task list and manifest, all 14 files re-hashed |
| Hard kill / expired lease / stale owner / publication crash boundaries / digest and DST policy | **PASS (controlled tests)**; real `SIGKILL` of a fake-engine child process in tests | `pnpm test` L10; Batch 5 reports |
| Quiet-hours schedule across a restart in real elapsed time | **PASS** (~4 minutes) on the Batch 5 candidate, same platform code. **Not** an overnight trial. | `docs/batches/batch-5/integration.md` |
| Consistent backup and restore into a separate directory | **PASS** | I6 (10 tasks, 14 artifacts, verified) |
| Local container (Docker) build, volume, restart | **NOT RUN** | Docker is not installed |
| Remote always-on host | **BLOCKED** | no host/approval; compose is authored, never deployed |
| Real overnight observation | **NOT RUN** | and a sleeping laptop stops all processing |

## Security and data hygiene

| Check | Status | Evidence |
|---|---|---|
| Private routes reject unauthenticated access (tasks, detail, settings, notifications, integrations, downloads, inject, review) | **PASS** | 401 on all, I4 |
| CLI bearer token is limited to `POST /v1/demo/inject` | **PASS** | 401 on tasks, settings and downloads; inject 200 with a valid token, 401 with a wrong one |
| Origin check on browser mutations; path-shaped artifact id; bad cursor | **PASS** | 403; 404; 400 |
| Safe post-login redirect (no open redirect) | **PASS** | unit test (13 cases incl. `//host`, backslash, control characters, `/login`) and browser deep-link run |
| No secrets or private data in git (tree and all 31 commits), `.env`/database/artifacts ignored | **PASS** | I7 |
| Runtime logs free of errors and credential words | **PASS** | I7 |

## Overall

Demonstrated scope: **demo intake → real worker → fixture engine → real DOCX/PPTX → review, locally**. The original full-product gates that are not met: live Gmail (BLOCKED), live model (BLOCKED), WhatsApp (NOT IMPLEMENTED + BLOCKED), automated browser suite (NOT RUN), Docker and remote host (NOT RUN / BLOCKED), real overnight trial (NOT RUN). See `docs/release/status.md` for the decision.
