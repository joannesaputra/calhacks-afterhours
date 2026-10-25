<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/afterhours-logo-white.svg">
    <img src="brand/afterhours-logo-black.svg" alt="AfterHours" height="40">
  </picture>
</p>

# AfterHours (working name)

AfterHours watches a connected Gmail inbox. When an authorized sender asks for supported work, it prepares real
downloadable deliverables (DOCX proposal/report, PPTX deck) and puts them in a review queue. "Mark reviewed" only
records acceptance — it never sends anything. Separately, and only if you allow it in Settings, a reviewed task can be
emailed back to the person who asked with an explicit Send click (see the runbook).

The canonical team contract is [docs/CONTRACT.md](docs/CONTRACT.md). Ownership, routes, types and env names there
are frozen; propose changes in [docs/contract-change-requests.md](docs/contract-change-requests.md).

## Layout

| Path | Owner | What |
|---|---|---|
| `apps/web` | Person 3 | Next.js App Router UI (port 3000). Proxies `/api/*` → API `/v1/*`. |
| `apps/api` | Person 1 | Fastify API (port 4000, private). |
| `apps/worker` | Person 1 | Long-running worker: Gmail polling, job queue, notification outbox. |
| `packages/contracts` | Person 1 | Zod schemas + inferred types shared by everyone. |
| `packages/data` | Person 1 | SQLite (better-sqlite3) repository, migrations, Gmail adapter. |
| `packages/engine` | Person 2 | `runWork` — fixture planning, real CSV calculation, grounded content, real DOCX/PPTX; Claude (Anthropic) live path, verified with real Gmail emails (proposal, report, clarification, skip; see `docs/audits/final/integration.md`). |
| `packages/delivery` | Person 3 | `sendNotification` / `composeNotification`. Outbox (simulated) by default; a Twilio WhatsApp adapter with eligibility gates is implemented and unit-tested, but a real WhatsApp send has not been tested. |
| `fixtures/**` | Person 2 | Fictional demo inputs. |

### Package strategy

Workspace packages export TypeScript source directly (`"exports": { ".": "./src/index.ts" }`). API, worker and
scripts run through `tsx` in dev and production; Next compiles workspace packages via `transpilePackages`.
There is no separate JS build for packages: `pnpm build` type-checks them and runs `next build` for the web app.
Import extension-less (`import { x } from "./foo"`). Browser code may import only `@afterhours/contracts`.

## Requirements

- Node.js >= 20.19 (developed and tested on 20.20; Node 22 in Docker, not run here). pnpm 10.33.4 (`corepack enable`).
- macOS needs Xcode CLT only if a `better-sqlite3` prebuilt binary is unavailable.

## Quick start

```bash
pnpm install
pnpm setup:local      # creates .env, generates secrets + demo password, creates var/
pnpm db:migrate
pnpm db:seed
pnpm dev              # web :3000, api :4000, worker
pnpm demo:proposal    # in another terminal: real HTTP POST to the demo endpoint
```

Log in at http://localhost:3000 with `APP_PASSWORD` from `.env`.

The app runs in fixture mode by default (no model calls): a demo proposal or report becomes a real DOCX and PPTX in the
SpaceXAI-style web UI. With `GENERATION_MODE=live` and an Anthropic key it uses Claude; with a Google OAuth client it reads
new mail from approved senders in a connected Gmail inbox. The current record of what was tested live, what is simulated and
what is untested is [docs/audits/final/integration.md](docs/audits/final/integration.md) (findings and evidence:
[docs/audits/final/audit.md](docs/audits/final/audit.md)). Older batch records such as
[docs/release/capability-matrix.md](docs/release/capability-matrix.md) are kept as history.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` / `dev:web` / `dev:api` / `dev:worker` | Run all services or one. |
| `pnpm demo:proposal` / `demo:report` | Inject a fixture email over HTTP using `DEMO_CLI_TOKEN`. |
| `pnpm test` | Vitest suites (data, API, worker). |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | Static checks; build is dependency-ordered. |
| `pnpm check:worker` | Exit 0 when the worker's heartbeat in the database is fresh (container health check). |
| `pnpm backup -- create <dir>` / `verify <dir>` / `restore <dir> <newDir>` | Consistent database + artifact backup and verified restore (see runbook). |
| `pnpm check:ready` | Startup readiness: config, migrations, ports, engine/delivery exports. No network calls. |
| `pnpm db:reset -- --demo-only` | Delete local demo data. Refuses if Gmail data exists. |
| `pnpm test:e2e` | Browser suite (Person 3). Prints SKIPPED until it exists. |

Release status, limits and the tested demo steps: [docs/release/status.md](docs/release/status.md).

See [docs/runbook.md](docs/runbook.md) for Gmail setup, deployment and troubleshooting, and
[docs/backend-handoff.md](docs/backend-handoff.md) for routes, data model and integration notes.
