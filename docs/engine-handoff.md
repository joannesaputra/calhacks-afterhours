# Engine handoff

## Integration

Import `runWork` and `EngineError` from `@afterhours/engine`. The canonical input/result/progress types are re-exported from the package and originate in `@afterhours/contracts`. The worker supplies attachment bytes, an injected clock, an `AbortSignal`, and an async progress callback. The engine returns bytes only; the platform owns persistence, hashes, download routes, task state, and retries.

```ts
const result = await runWork({
  taskId, revision, mode, email, attachments, organization, answers,
  now: new Date().toISOString(), fixtureScenario,
}, { signal, onProgress });
```

Fixture paths are `fixtures/scenarios/*.json`, `fixtures/organization/harbor-creative.json`, and `fixtures/attachments/*`. Proposal/report fixtures return one DOCX and one five-slide PPTX. Ambiguous work returns four stable questions until answered. No-action work returns `skipped` with no files.

Deadline interpretation uses the immutable `email.receivedAt` and `organization.timezone`. It never uses `input.now`, because that is worker execution time and the task's `createdAt` is ingestion time. Absolute deadlines and supported relative phrases such as “next Monday at 9 AM” are normalized to UTC; the explanation records the basis. Engagement dates remain separate from draft deadlines.

Engagement end dates are calculated in code as start + 7N − 1 days (inclusive) and shown as "October 26-November 22, 2026 (4 calendar weeks)" with a visible confirm-with-client note; live mode receives them as `calculatedDates`. An attached brief with no project facts returns `usable_project_brief`. Skipped messages get the plan title "No action: <subject>".

Fixture proposal facts are extracted from the supplied email, brief, and organization profile with exact quotes as evidence. A changed client is reflected when the sources agree. Stable `needs_input` question IDs: `proposal_client_conflict`, `proposal_client_length`, `proposal_fee_conflict` (also missing or mixed-currency fees), `proposal_schedule_conflict`, `proposal_start_conflict`, `proposal_deadline_conflict`, `proposal_deadline_past`, `proposal_scope_missing`. A brief that itemizes deliverables wins over the company's standard package, which applies only when a source invokes it. Clarification answers that are too long, or a fee answer without amount and currency, are asked again.

Percent changes are computed to 2 decimals and displayed to 1 by `displayPercent`; the verifier accepts exactly those forms. Report wording is derived from the calculated numbers (increase/decrease/unchanged, ties, month names). Every number in report content must be a calculated metric or a source value, and every amount or percentage in any product must appear in a source.

## Modes and environment

- `fixture`: deterministic local planning/content, real CSV calculation, validation, and real Office bytes; no network.
- `live`: `MODEL_PROVIDER=anthropic` (Claude), nonempty `MODEL_NAME`, and `ANTHROPIC_API_KEY` are required and resolved before any work or progress. Raw `fetch` to the Anthropic Messages API (no SDK, so no SDK retries). Budget per attempt: at most 3 logical calls, each with a 60 s timeout and 12,000 output tokens. The pipeline uses at most 2 (generate + one repair). Original and repaired output pass the same schema, evidence, number, date and layout checks. Product, slide and block IDs and `dueAt` are assigned in code. Usage is reported in progress messages when the provider returns it. There is no fixture fallback. **No live call has been executed yet.**
- Test factory: `createEngine({ modelClient, limits, clock }).runWork(...)` runs the same pipeline with an injected `ModelClient`, for timeout, transient, cancel and malformed drills without paid calls.
- `MODEL_PROVIDER=anthropic`: explicitly unsupported in this version and returns `MODEL_PROVIDER_UNSUPPORTED`.

Errors expose safe `code` and `retryable`. Retryable: `ENGINE_ABORTED`, `MODEL_TIMEOUT` (also HTTP 408), `MODEL_NETWORK`, `MODEL_RATE_LIMIT` (429), and provider 5xx `MODEL_PROVIDER`. Nonretryable: `MODEL_CONFIGURATION`, `MODEL_PROVIDER_UNSUPPORTED`, `MODEL_AUTHENTICATION` (401/403), `MODEL_REQUEST_REJECTED` (other 4xx), `MODEL_INVALID_OUTPUT`, `MODEL_CALL_BUDGET`, `INVALID_INPUT`, `INPUT_LIMIT`, `INVALID_CSV`, `UNSUPPORTED_INPUT`, `INVALID_OUTPUT`, `UNGROUNDED_CONTENT`, `UNSUPPORTED_NUMBER`, `LAYOUT_BUDGET`, and `EXPORT_FAILED`. Messages never include provider bodies, keys, or raw network errors.

Cancellation: the signal is checked before and after every progress callback, between stages, after export, and before returning. No progress is emitted after abort. Per-call timeouts settle at the deadline even if a client ignores its signal; that work is detached, not stopped. Synchronous export is not preemptible but is bounded by content budgets. On this machine, the worst synthetic export blocked the event loop for 14.7 ms.

IDs: `productId = stableId(taskId, revision, kind, slot)` and `file.id = stableId(taskId, revision, productId, format)` are stable within a revision and distinct across revisions. File bytes are **not** byte-stable across reruns (Office timestamps; live variation), so publication must stay fenced and immutable.

## Supported inputs

Plain text, Markdown, and CSV are extracted with five-file, 10 MB/file, 20 MB aggregate, and 60,000-character context limits. CSV parsing supports BOM, CRLF, headers, quoted commas, empty cells, and cents in `revenue_usd`. Required blanks fail instead of becoming zero, and a `currency` column with mixed or non-USD values fails with `UNSUPPORTED_INPUT` instead of being summed. PDF, DOCX, XLSX, encrypted/scanned files, and OCR are not implemented. Unsupported material inputs return `needs_input` when fixture generation depends on them.

## Preview and UI guidance

Render `WorkProduct.blocks` for documents and `WorkProduct.slides` for decks, labeled **Content preview**. Evidence references point to `TaskDetail.sources` by opaque ID. Do not create separate preview copy or imply pixel-identical Office rendering. `basis` distinguishes sourced, calculated, recommendation, and assumption content, and the exported files show it too: DOCX basis lines under each heading, PPTX RECOMMENDATION/ASSUMPTION tags and a per-slide basis line.

## Verification

Final Batch 6 artifact audit, with the engine capability table and claims to avoid: `docs/release/artifact-audit.md`.

Batch 5 evidence and rendering limits: `docs/batches/batch-5/joanne.md`. Reusable synthetic inputs: `fixtures/synthetic/*` and `packages/engine/test/synthetic.ts`. Current outputs: `corepack pnpm exec tsx packages/engine/test/render-samples.ts` (writes to ignored `var/engine-samples`).

The package tests cover fixture calculations, changed inputs, material source conflicts, timezone-relative deadlines, zero denominators, blank values, cancellation, no-action, clarification/resume, deterministic IDs, five-slide output, ZIP signatures, and fail-closed live configuration. Visual Office rendering is not guaranteed unless the generated artifacts are opened or rendered in an Office-compatible application.
