# Email history and file context resolution

Status: implemented on `feature/context-resolution`. This document is the record for that work.
Section 1 and 2 were written before any code changed and describe the repository as it was.
Sections 3 and later describe what was built.

## 1. Current flow (before this work)

Verified by reading the code on `integration/batch7` (c5e5179), not from older handoff notes.

1. **Intake.** `packages/data/src/ingest.ts` `ingestMessage()` normalizes one email, applies the intake rules
   (`automationEnabled`, exact `allowedSenders`, `autoPrepare`; demo mode accepts only `.example` senders), dedupes on
   `intake_messages.source_key`, copies at most 5 attachments (10 MB each, 20 MB total) into `task_attachments` as SQLite
   BLOBs, creates a `tasks` row (`status = queued`, `revision = 1`) and a `jobs` row. `intake_messages.received_at` is
   the original email time; `tasks.created_at` is ingestion time.
2. **Gmail.** `packages/data/src/gmail/poll.ts` `pollGmailOnce()` lists the **inbox only**, newest first, from a persisted
   checkpoint (`integrations.checkpoint_json`), bounded to 5 pages x 50 ids and 10 messages per cycle. It ignores anything
   older than the connect time. Scope is `gmail.readonly`. Messages from senders that are not on the allow list are
   audited and dropped: **their bodies and attachments are never stored.** Sent mail is never read.
3. **Queue.** `queue.ts`: `claimNextJob` (lease, 90 s), `heartbeatJob`, `recoverExpiredJobs`, `recordExecutionFailure`
   (`MAX_ATTEMPTS = 2`), `commitEngineResult` (one transaction for manifest, status, events, notification intent).
   State machine in `state.ts`: queued → planning → running → ready | needs_input | failed | skipped; ready → approved |
   dismissed; needs_input → queued (answers create revision n+1 and a new job).
4. **Worker.** `apps/worker/src/worker.ts` `buildInput()` loads the task email, its stored attachments, the organization
   snapshot and answers, calls the engine (`runWork`), validates the result (`validateEngineResult`), stages artifacts
   privately, promotes them to immutable content-qualified paths, re-verifies bytes, then commits.
5. **Engine.** `packages/engine/src/pipeline.ts` `execute()` builds sources from the one email plus its attachments.
   `sources.ts` reads **only text, Markdown and CSV**; every other attachment (including PPTX and DOCX) is recorded as
   `unsupported`. The engine then classifies the request (fixture) or calls Claude once (+ one repair), verifies the
   products (`grounding.ts`, `layout.ts`) and renders **new** DOCX/PPTX files from scratch (`render/docx.ts`,
   `render/pptx.ts`, pptxgenjs).
6. **Review.** `review.ts`: `submitAnswers`, `retryFailedTask`, `markReviewed`. "Mark reviewed" writes a task event and
   changes status only. No notification, send or provider call is made from it.
7. **API and web.** Fastify routes under `/v1` (session cookie + Origin check on writes), Next.js dashboard with
   task list, task detail (request, plan, sources, activity, notifications tabs), needs-input form, review panel.

## 2. Gaps against the requirement

| Requirement | State before |
|---|---|
| Resolve "the presentation from last week" | The engine sees one email. There is no history, no search, no file identity. |
| Email history store | None. Only `intake_messages` (allowed senders, tasks only). Sent mail never read. |
| Consent for history / files | None. Gmail connect is all-or-nothing and only feeds new-task intake. |
| Backfill without launching tasks | No backfill. (Existing poll already ignores pre-connect mail.) |
| Attachment / linked-file identity and versions | `task_attachments` is keyed by (task, attachment id) with no provider identity, checksum lineage or revision. |
| Reading a source deck | PPTX/DOCX attachments are `unsupported`. Nothing can read a deck. |
| Editing a deck | Not possible. The engine only generates new files; it cannot preserve an original. |
| Temporal interpretation | `resolveDeadline` handles *future* due dates only. No past/relative-interval logic. |
| Clarification of which file / which edits | `needs_input` exists, but questions are free text and the engine cannot ask about candidates. |
| Search | None. No FTS, no owner/account/grant scoping. |
| Folder / Drive access | No Drive or folder integration exists. |
| Dashboard evidence | Plan, sources, activity only. No "context used", no correction path. |
| Sync cursors / retries / audit | Gmail poll checkpoint only; no backoff, no resumable backfill, no redacted audit table. |
| Retention / revocation | Disconnect deletes Gmail credentials; nothing is scoped to a grant, so nothing can be revoked or purged per grant. |

Existing behavior that must be preserved: API + worker split, SQLite, `execute()` entry point, task/job/revision
lifecycle, artifact staging and downloads, dashboard routes, authorization controls (`automationEnabled`,
`allowedSenders`, `autoPrepare`), Claude-only live provider.

## 3. What was built

One deterministic pipeline in front of the existing engine. A request that asks to change something that already exists
("revise the presentation from last week based on what we discussed") is resolved in two separate steps, and the engine
only runs once both are supported by evidence.

```
email ──ingest (unchanged: allowed sender, automation, autoPrepare)──► task + job
worker claims job
  └─ resolveContext()            packages/data/src/context/resolve.ts
       A parse request            request.ts, requirements.ts, temporal.ts   (evidence kept apart from inference)
       B current thread           mail.ts threadEmails
       C prior exchanges          mail.ts emailsInvolving + search.ts (FTS5, or bounded scan)
       D related conversations    email_links (same provider file id), confirmed associations, project terms
       E source files             attachments, supported provider links, selected folders (metadata first)
       F rank                     rank.ts (named reason codes; recency alone is never a signal)
       G completeness             no_match | ambiguous | unavailable | unsupported | incomplete sync | budget | retryable
       H bundle                   ContextBundle (packages/contracts/src/context.ts), validated before use
  └─ checkAccess()               access.ts: grants, deletions and the live version are re-checked before generation
  └─ engine execute()            revision.ts: edits a COPY of the original .pptx in place; no model call
  └─ checkAccess() again, then stage → promote → verify → commit (unchanged artifact publication)
```

| Area | Behavior |
|---|---|
| Consent | Email history and files are separate grants (`context_grants`). Email-only mode is one row. Email lookback is chosen by the user (90 days suggested). Files are specific files or folders only; there is no whole-drive option. Grants can expire, be revoked (access stops at once) and be purged (data removed). |
| Backfill | Bounded pages, persisted cursor per page, retry with exponential backoff (30 s doubling to 1 h, 8 attempts), lease per cursor, resumable. Backfill and incremental sync only **store** messages. They never call task intake, so no task, job or notification can result. Coverage is reported ("History sync is still running"). |
| Identity | Contacts come from headers and stay unverified. Two addresses merge only after an explicit verified link. A shared name or company domain never merges people. |
| Dates | "last week", weekdays, calendar dates, "n days ago" are read against `email.receivedAt` and the organization timezone, never the worker clock. Each phrase keeps its basis and alternatives (calendar week vs the 7 days before the request). If the readings pick different decks the user is asked. |
| Versions | File identity is the provider id, never the filename. An attachment snapshot is keyed by checksum; a live file by its provider revision. Same-name files stay separate. Lineage collapses only versions that trail the best by the decision margin, so a newer file called "final" has no standing of its own. |
| Clarification | Uses `needs_input` with closed options for "which deck", free text for "what changes". Candidates and evidence are stored; answering creates a new revision that reuses the stored search. |
| Revision | Edits the original package: replace text (run formatting kept), add a bullet to an existing bulleted text area, remove a slide (with its notes). Untouched parts keep their exact bytes (verified). Each requested change ends as applied, already satisfied, unsupported or blocked. If nothing could be applied the task asks instead of delivering. |
| Dashboard | Phase labels (Finding the presentation and feedback, Preparing your revision, Needs your input, Ready for review, retryable error), a "Context used" tab, corrections (use another file, remove a source, drop a change, add feedback), a change summary, and settings for consent. |
| Safety | Email and file text is carried as untrusted data. Instruction-like text aimed at the assistant is dropped from requirements and noted; it cannot create grants, widen scope, read other folders or send anything. URLs lose their query strings before reaching the engine. |

### Provider scopes, stated accurately

- **Gmail:** `gmail.readonly`. It is read-only but covers the **whole mailbox**; Google cannot limit it to a lookback.
  The lookback is an Afterhours-side limit on what is stored and used.
- **Local project folder:** the operator sets `CONTEXT_FILES_ROOT`. Selected folders must be inside it. The restriction is
  enforced by Afterhours (path containment, symbolic links treated as shortcuts and judged by their target), not by the
  operating system.
- **Google Drive:** no integration exists in this release. It is listed as unavailable with the reason. Nothing simulates it.
- In every unavailable case the existing route stays usable: attach the presentation to a new email.

## 4. Files

| Concern | Files |
|---|---|
| Schema | `packages/data/migrations/004_context_resolution.sql` |
| Contracts | `packages/contracts/src/context.ts` (bundle, revision report, API views), additive fields in `domain.ts` (`WorkQuestion.options`) and `engine.ts` (`EngineInput.context/contextFiles`, `revisionReport`) |
| Retrieval | `packages/data/src/context/`: `request`, `requirements`, `temporal`, `text`, `rank`, `resolve`, `run`, `access`, `view`, `corrections`, `projects`, `search`, `mail`, `files`, `blobs`, `accounts`, `sync`, `mailProvider`, `providers`, `limits`, `audit` |
| Engine | `packages/engine/src/ooxml/` (`zip`, `xml`, `deck`, `extract`), `revision.ts`, hook in `pipeline.ts` |
| Worker | `apps/worker/src/worker.ts` (`prepareContext`, `syncContext`, revalidation, purge), `main.ts`, `once-main.ts` |
| API | `apps/api/src/routes/context.ts`; Gmail disconnect/connect reflect into grants in `routes/integrations.ts` |
| Web | `components/context-panel.tsx`, `components/settings/context-access.tsx`, option questions in `review-panels.tsx`, hooks and client in `lib/` |
| Fixtures | `fixtures/attachments/{kickoff,proposal,results}-deck.pptx`, `fixtures/scenarios/revision*.json` (regenerate with `scripts/make-revision-fixtures.ts`) |

## 5. Migrations and configuration

Migration 004 adds: `connected_accounts`, `context_grants`, `contacts`, `contact_addresses`, `emails`, `email_participants`,
`email_links`, `source_files`, `file_versions`, `content_chunks`, `search_docs`, `project_entities`, `entity_links`,
`project_summaries`, `retrieval_runs`, `retrieval_sources`, `task_requirements`, `task_context_overrides`,
`output_revisions`, `sync_cursors`, `context_audit`, `context_meta`. Reused instead of duplicated: `integrations`
(credentials stay encrypted there), `tasks`, `jobs` (lease/retry), `artifacts` (output), the artifact blob root (retained
files live under `<ARTIFACTS_DIR>/_context/`, content-addressed), `task_events`. Indexes cover owner/account/thread/date/
sender/subject/participant/file-id paths. Scoped uniqueness: `(owner, account, provider_message_id)`,
`(owner, account, provider, provider_file_id)`, `(file_id, version_key)`, `(task_id, revision)` for runs, requirements
and output revisions. The FTS5 table is created at runtime when the SQLite build supports it (`ensureSearchIndex`); the
bounded-scan fallback is tested and reports truncation.

New optional environment variables (see `.env.example`): `CONTEXT_FILES_ROOT`, `CONTEXT_SUGGESTED_LOOKBACK_DAYS` (90),
`CONTEXT_RETENTION_DAYS` (30), `CONTEXT_MAX_QUERIES|MESSAGES|FILES|BYTES|UNITS|MS`, `CONTEXT_MIN_TARGET_SCORE` (30),
`CONTEXT_MIN_MARGIN` (12). Nothing is enabled by default: with no grants a request is processed exactly as before.

## 6. Existing behavior preserved

Intake rules are untouched (`automationEnabled`, exact `allowedSenders`, `autoPrepare`); history sync runs only while
automation is on and never turns it on. The API/worker split, queue lease and retry policy, state machine (one additive
transition: a *correction* may re-queue a `ready` task; approved and dismissed stay closed), artifact staging and
immutable paths, downloads, notification outbox and "Mark reviewed" (records review only; asserted by test) are unchanged.
Requests that are not revisions skip the whole feature (no run row is written). The shipped demo scenarios still behave
as before; two scenarios were added. The Claude-only live provider is unaffected: the revision path calls no model.

## 7. Verification

Final run on this branch (exact results):

| Check | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm build` (`env -u NODE_ENV`) | exit 0 |
| `pnpm test` | 40 files, 459 tests passed (baseline before this work: 32 files, 356 tests; 103 new) |
| `pnpm test:e2e` (real browser, isolated stack) | 28 passed, 1 skipped (the stub-engine case, not applicable), 0 failed; 3 of the passes are new (`tests/e2e/context.spec.ts`) |

Required scenarios and where they are tested (all synthetic; the providers are mocks named `Memory*Provider` with
`isMock = true`, which exercise the real sync, grant, retrieval and parsing code and are **not** evidence of a live integration):

| # | Scenario | Test |
|---|---|---|
| 1 | vague request resolves deck and feedback in the thread | `packages/data/test/context-retrieval.test.ts` (1) |
| 2 | earlier sent/received exchanges with the same person | `context-retrieval` (2) |
| 3 | supported link finds feedback in another participant's thread | `context-retrieval` (3) |
| 4 | unrelated projects from one sender stay separate | `context-retrieval` (4) |
| 5 | two plausible decks lead to clarification (and an interval ambiguity) | `context-retrieval` (5 and 10) |
| 6 | one deck, no instructions, asks what to change | `context-retrieval` (6) |
| 7 | selected-folder file with no attachment | `context-retrieval` (7) |
| 8 | revoked access, forbidden files, other owners, shortcut escapes, symlinks | `context-controls` (8) |
| 9 | duplicate sync, retries, backfill create no tasks | `context-controls` (9) |
| 10 | dates use receivedAt and timezone across week/year boundaries | `context-pure` (relative dates), `context-retrieval` |
| 11 | live source change detected, exact version recorded | `context-sources` (11), `apps/worker/test/context.test.ts` |
| 12 | deleted, unavailable, encrypted, oversized, unsupported | `context-sources` (12) |
| 13 | prompt injection in email or file | `context-sources` (13), `context-pure`, `packages/engine/test/context-revision.test.ts` |
| 14 | gaps, limits, provider errors vs no match | `context-sources` (14) |
| 15 | restart/resume keeps context, no replayed generation | `apps/worker/test/context.test.ts` |
| 16 | revision applies edits, preserves the rest | `packages/engine/test/context-revision.test.ts`, worker end-to-end, browser e2e |
| 17 | dashboard review, download, Mark reviewed has no side effects | worker test (17), `tests/e2e/context.spec.ts`, `apps/api/test/context.test.ts` |

## 8. Synthetic end-to-end example (from `apps/worker/test/context.test.ts`)

History in the (mock) mailbox: thread T1 holds the user's own message of 20 Oct with `Kickoff Deck.pptx` attached, and
Jordan's reply of 22 Oct: "Change the fee from $50,000 to $45,000 on slide 2. On slide 3 add the bullet "Launch review on
Friday". Make the whole thing warmer." (plus quoted history). On Monday 26 Oct 09:00 Pacific Jordan writes:
"Can you revise the presentation from last week based on what we discussed?"

1. Parse: action revise, deliverable presentation, date phrase "last week", no edits in the new text.
2. Interpret: calendar week 19–25 Oct (alternative: 7 days before the day of the request; same deck either way).
3. Thread and history: the 20 Oct deck message and the 22 Oct feedback are found; the quoted history is not extracted twice.
4. Rank the deck: `thread_linkage`, `sender_relevance`, `temporal_fit`, `file_type_match`, `documented_feedback`.
5. Fetch only that attachment (once), parse it, capture the snapshot (version key = SHA-256).
6. Requirements: replace `$50,000` with `$45,000` (slide 2), add a bullet (slide 3), and "Make the whole thing warmer." kept as
   unstructured.
7. Engine edits a copy of the original: 2 applied, 1 reported unsupported; slide 1 and 4 bytes identical; output
   `Kickoff-Deck-revised-r1.pptx`; the task is `ready` with a change summary and an outbox notification. The dashboard
   "Context used" tab lists the deck and version, the three messages with dates and participants, the reasons, the time
   reading, and the outcome of each change.

## 9. Limitations and what was not verified

- **No live integration was exercised.** Gmail history sync, attachment fetch and the OAuth flow were tested with mocks
  of the provider interface only. Google Drive does not exist in this release.
- **File fidelity:** only `.pptx` can be revised, only by the three edit types above. Requested changes are read by fixed
  rules from written text; loosely phrased feedback is reported as not supported, not guessed. Charts, images and
  layouts are preserved but never edited. A new text box cannot be added; adding a bullet needs an existing bulleted text
  area. DOCX and PDF sources are recognized but not revised (PDF: not read at all). No model maps free-form feedback to
  edits, so no model cost is incurred.
- **Output opening:** the revised file is validated structurally (well-formed XML, consistent relationships and content
  types, untouched parts byte-identical, requested text present). It was **not** opened in PowerPoint or Keynote here.
- **Gmail sync** uses time-window queries with persisted page tokens, not the Gmail history API; messages deleted at
  Google are noticed only when a task reaches them (the fetch fails as "deleted"), not by a periodic sweep.
- **One owner:** the product has a single workspace owner. Owner isolation is enforced in every query and tested with a
  second owner id, but there is no multi-user sign-in.
- **Retention:** revoke stops access; purge removes retained messages, files, text, search entries, associations,
  summaries and stored evidence; the worker purges revoked grants after `CONTEXT_RETENTION_DAYS`. Backups taken earlier
  are not rewritten; there is no backup retention policy beyond the documented procedure.
- **Search quality** depends on subject and file names, project terms and the stated reason codes. The thresholds
  (`30`, `12`) are heuristic and configurable; they are validated only by the ambiguity fixtures above, not by real mail.
- Metrics (resolution accuracy, requirement coverage, clarification rate, latency, files parsed, unsupported-source rate,
  model cost) are computed from stored runs and shown in Settings, but there is no real traffic yet to report.
