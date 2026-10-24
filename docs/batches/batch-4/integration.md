# Batch 4 — integration record (Darren)

| Item | Status | Evidence |
|---|---|---|
| Shared baseline for Batch 4 | Not established | No engine fix branch, no experience branch on origin (checked `git branch -r` after fetch). |
| Batch 2 combined gate | **FAIL** | QA (`qa/system-batch3`, local) merged `platform` `aaed3db` + `person-2-engine` `258e2eb` as `4e1b5ae`: every real proposal/report task fails `ARTIFACT_INVALID` (DEF-1). Browser half BLOCKED. |
| Batch 3 combined gate | **FAIL / BLOCKED** | Same candidate: 32/53 system checks pass; DEF-1 (P0), DEF-2/3 (P1). |
| Batch 4 platform module | Implemented, unit-tested | `platform-batch4` `72ecb27`: 145 tests, typecheck/lint/build exit 0; proxy OAuth path verified without Google network. |
| Live core (Gmail → live model → files) | **BLOCKED** | No Google OAuth client/test account, no model key on this machine. |
| Live notification | **BLOCKED** | No Twilio credentials, eligibility not confirmed, no designated recipient. Outbox `simulated` remains the disclosed fallback. |

No merge into `platform` or `main` was made. Next integration candidate: `platform-batch4` + engine with DEF-1 fixed + experience branch.

## Post-push full-run audit (Darren, 2026-10-23)

Scratch candidate (local, not pushed): `platform-batch4` + `origin/person-2-engine` `258e2eb` + QA harness from
`qa/system-batch3` + the local SpaceXAI web UI, on ports 3100/4100 with a throwaway `.env` and database.

| Check | Result | Evidence |
|---|---|---|
| Static gates on `platform-batch4` | **PASS** | typecheck, lint, build exit 0; `pnpm test` 14 files, 147 tests. |
| QA system suite, before fixes | **FAIL** 31/53 | DEF-1 failed every real proposal/report task; the live-model configuration error tripped the "no key material" check because it named the key variable. |
| Platform fix `00239c2` | Done | The platform derives `art_<sha256(task, revision, product, format)>` artifact ids and never uses engine file ids as paths or URL ids (the contract says ids are opaque). Error text no longer names the key variable. |
| QA system suite, after fix | **47/53** | All platform checks pass. Remaining 6 are engine-only: DEF-2 (C4, C5, C6, H6), DEF-3 (D7), DEF-4 (N3). |
| Platform fix `486df34` | Done | Connect Gmail with Google unconfigured left the browser on a raw JSON 503 page. Browser navigations now return to `/settings?gmail=error&reason=not_configured` or `redirect_mismatch`; API clients still get 503. |
| Browser run (real Next + API + worker) | **PASS** | Login; demo proposal ready with DOCX+PPTX, downloads 200 with correct type, `private, no-store`, sizes equal manifest; report ready; unclear request asked 4 questions, answers created revision 2 and files named for the answered client; Mark reviewed approved once, second approve 409, no new notification; no-action skipped; settings save accepted by the strict PATCH schema, invalid recipient rejected with a clear 400; 375 px width has no horizontal scroll; no console or server errors; API restart kept the session. |
| Secrets in database files | **PASS** | None of the four generated secrets appear in the SQLite files. |

New findings for other owners:
- **DEF-6 (engine, P1):** a skipped no-action email is titled "Maple & Moss launch strategy proposal" with the proposal summary, because the fixture `makePlan` falls through to the proposal branch. With Gmail on, every FYI email would show that title in the queue.
- **UI (P2):** evidence lines show raw source ids (`<taskId>/source/attachment/...`) instead of the source title; the Gmail error notice does not show the `reason` marker.
- DEF-5 (engine lint, 3 errors) still fails `pnpm lint` once the engine branch is merged.
