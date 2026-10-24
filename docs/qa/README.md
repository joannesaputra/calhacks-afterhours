# System QA harness (Eden)

Independent, black-box checks of the real combined system. Owner: Eden (`tests/system/**`, `docs/qa/**`).
Maricella keeps `tests/e2e/**`; these tests do not replace owner unit tests.

## What it does

`tests/system/support/harness.mjs` starts the **real API and real worker** as child processes against a
throwaway SQLite database and artifact directory (`os.tmpdir()/ah-system-*`), on free ports, with an environment
built from scratch (nothing inherited: no real keys, no `.env`, no normal database). Tests then use only public
HTTP routes: cookie login, the restricted `DEMO_CLI_TOKEN` bearer for injection, authenticated downloads. There is no
engine mock, no auth bypass and no extra route. Outbox notification channel only; no external message can be sent.

Files are inspected with the system `unzip` tool (no new dependency). `tests/system/03-*` also calls the real
`runWork()` in-process with copied synthetic bytes, because the public inject endpoint takes a scenario name only.

## Run

Requirements: Node >= 20.19, `pnpm install` done, `unzip` on PATH. Nothing else (no `.env`, no services running).

```bash
node --import tsx --test tests/system/*.test.mjs      # whole suite (~1-2 min)
node --import tsx --test tests/system/02-canonical-flows.test.mjs   # one file
QA_REPO_ROOT=/path/to/other/checkout node --import tsx --test tests/system/*.test.mjs   # test another checkout
```

Exit code is non-zero while any check fails. Failures are the point: they are not silenced or loosened.
Evidence JSON (task ids, sizes, hashes) is written to `tests/system/tmp/` (git-ignored). A root script such as
`test:system` would need Darren's approval; it is not added here.

## Files

| File | Scenarios |
|---|---|
| `01-access.test.mjs` | G: unauthenticated access, CLI-token scope, Origin check, cookie flags, logout revoke, traversal-shaped ids, secret/path leakage |
| `02-canonical-flows.test.mjs` | A, B, N, J(timing): proposal + report through worker, downloads, manifest vs bytes, content, evidence quotes, review persistence, outbox |
| `03-engine-boundary.test.mjs` | C changed input, H input handling, I injection/conflict, N3 DOCX table markup (direct engine) |
| `04-clarification-state.test.mjs` | D clarification, E no_action, F dedupe/state/failure/retry, L stale/terminal, restart persistence |

See `defects.md` and `batch-3-verification.md` for the results.
