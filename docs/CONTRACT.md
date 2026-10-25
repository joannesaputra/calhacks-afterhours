<!-- Canonical shared contract. Copied verbatim from the team build kit (shared specification v1.0). Change only via docs/contract-change-requests.md and Person 1's merge. -->

# AfterHours — authoritative shared implementation specification

Version: 1.0. This specification is included in every role prompt. Use the working name AfterHours. It is a temporary project name, not a claim that a brand or domain is available.

## 1. Read this before coding

You are a hands-on senior engineer building a hackathon MVP with two other engineers. Each human may use Codex or Claude Code. Implement the code for your assigned role, run appropriate checks, fix errors, and leave a clear handoff. A plan or an explanation by itself is not completion. Do not claim code works without running the relevant checks. If an integration cannot be exercised, identify exactly what remains unverified.

Read existing AGENTS.md files and inspect the actual repository before modifying it. Preserve existing work. Do not reset, overwrite, force-push, delete teammates' files, or re-scaffold a populated application. Do not create additional coding agents unless your human explicitly asks. These prompts already divide the work among three human owners.

Use this specification as the integration contract. Do not independently change route names, types, state names, ownership, ports, or package exports. If you discover a genuine blocker, propose the smallest contract amendment in docs/contract-change-requests.md in your own branch and tell the human integration owner. Continue other work. Only Person 1 merges an approved amendment to the canonical contract.

Make reasonable implementation choices within your boundary. Ask a question only if missing information prevents useful implementation. Missing external credentials should activate an explicitly labeled fixture or disconnected mode rather than halt local development.

## 2. Product definition

AfterHours watches a connected Gmail inbox. When an authorized sender requests supported work, it identifies the assignment, gathers the permitted context, prepares real downloadable deliverables, and places them in a review queue. A notification links the user to the result. The user need not open the email, gather the attachments, or type a new prompt for each eligible assignment.

Primary audience for the demo: a small client-facing project team, such as an agency or consulting team. This is a starting audience, not a validated market claim.

Primary demonstration: an incoming email asks for a project proposal and a five-slide kickoff deck. The application reads the message, its attachments, and a configured company profile. It creates an actual .docx proposal and .pptx deck, with traceable source references and explicit unknowns, then presents both for review.

Secondary demonstration: an incoming email contains a small sales CSV and requests a short performance report plus slides. The application calculates the numbers in code, generates charts from those calculations, and creates a report and deck.

The essential product event is a request becoming a useful file automatically. Merely generating a task record, a summary, an outline, or text claiming that a presentation exists does not satisfy the MVP.

The app prepares work automatically after initial authorization. Approval in the MVP records the user's acceptance of that revision. It does not send an email, submit a proposal, publish a file, spend money, or contact the original requester. Make the review button say "Mark reviewed". Do not imply it sends anything.

## 3. Scope, priority, and deliberate limits

P0 — must work locally without paid external integrations:

- A password-protected single-workspace application.
- Explicit fixture mode and explicit live-model mode; never silently interchange them.
- Incoming fixture email enters the same ingestion, queue, engine, artifact, and review path as a Gmail email.
- Automatic processing, durable task state, honest progress, real DOCX/PPTX output, content previews, source references, review actions, failure states, and a notification outbox.
- The primary proposal-and-deck scenario and the CSV report-and-deck scenario.
- Repeated delivery of the same source message creates one task.
- Restarting the worker preserves queued and recoverable running jobs.

P1 — complete after the first local end-to-end result:

- Live Gmail OAuth for explicitly configured test accounts and polling for new messages.
- One live LLM provider, configured entirely by server environment variables.
- Live notification adapter for WhatsApp through an official provider, only where the proposed use is eligible and the team has configured a permitted test recipient.
- Polished desktop dashboard and a usable mobile review page.

P2 — only with spare time after the acceptance suite passes:

- The second LLM provider.
- Text extraction from ordinary text PDFs and basic DOCX/XLSX inputs.
- A status callback that distinguishes provider acceptance from confirmed delivery of a notification.

Do not add public signup, multi-tenant billing, arbitrary browser automation, calendar writes, automatic email replies, automatic proposal submission, payment actions, OCR, vector databases, agent framework orchestration, unrestricted web browsing, full Google Drive indexing, real-time collaboration, or a generic workflow builder. Do not build PDF export for this version. Do not promise to solve arbitrary work.

Plain text, Markdown, and CSV attachments are P0. Never pretend to have read a binary file if its parser is unavailable. An unsupported attachment needed for the request must lead to needs_input with a useful explanation.

## 4. Frozen architecture

Use a pnpm workspace with TypeScript throughout. Use Node.js 24 LTS unless the repository or deployment environment already establishes a compatible supported Node version. Person 1 resolves supported compatible stable dependency versions during bootstrap, pins the package manager, and commits one lockfile. Do not assume API examples from an old package version are correct; inspect installed types and official documentation.

Services:

- apps/web: Next.js App Router, React, TypeScript. Browser-facing port 3000.
- apps/api: Fastify, TypeScript. Private/local port 4000.
- apps/worker: a persistent Node process. Polls Gmail, claims jobs, executes the engine, persists results, and processes the notification outbox.
- packages/contracts: Zod schemas and inferred TypeScript types. Shared by all three owners.
- packages/data: SQLite repository and migrations using better-sqlite3. Person 1 owns all database access.
- packages/engine: extraction, planning, LLM adapter, grounded content generation, deterministic calculations, DOCX/PPTX generation. No database access.
- packages/delivery: notification composition and provider adapter. No database access.

Use a single durable SQLite database on a local persistent disk. Enable foreign keys, WAL, and a bounded busy timeout. This deliberately targets one machine/container host. Do not run separate replicas against a network filesystem. Do not host the worker as a browser tab, a short-lived serverless request, or a Next.js request handler that must stay open.

The web app proxies /api/:path* to the API /v1/:path*. All browser requests use relative /api URLs. Configure the proxy's API origin on the server, not as a browser-exposed secret. No CORS setup should be needed for the browser path.

Use simple polling in the UI every two seconds while a task is active, backing off while idle or hidden. Use Gmail polling every 15 seconds. Pub/Sub, WebSockets, Redis, and BullMQ are out of scope. A persistent SQLite-backed jobs table is sufficient at this scale.

Never import backend/provider modules into a client component. The browser may import runtime schemas and public DTO types from contracts. API keys, encryption keys, Gmail refresh tokens, DB paths, and Twilio credentials must stay server-side.

## 5. Ownership matrix

Person 1 — platform and integration owner:

- Root workspace configuration, root scripts, lockfile, Docker/Compose, .env.example, .gitignore, README.
- packages/contracts, packages/data, apps/api, apps/worker.
- Gmail/OAuth, sessions, durable queue, artifact persistence/downloads, notification outbox, final integration.
- docs/backend-handoff.md, docs/contract-change-requests.md, docs/runbook.md.

Person 2 — intelligence and deliverables owner:

- packages/engine, including its package.json and tests after initial scaffold.
- fixtures/**, demo input files, organization profiles, expected calculations.
- docs/engine-handoff.md and docs/engine-evaluation.md.

Person 3 — experience and notification owner:

- apps/web, including its package.json and Next configuration after initial scaffold.
- packages/delivery, including its package.json and tests after initial scaffold.
- tests/e2e/**, docs/ux-handoff.md, docs/demo-script.md, docs/notification-setup.md.

During bootstrap Person 1 creates minimal manifests and export stubs in all packages. Once the foundation commit is shared, owners replace only their own stubs. Person 1 does not redesign the UI or engine internals. Persons 2 and 3 do not edit database migrations, API routes, shared types, root dependencies, or the lockfile without coordination.

## 6. Collaboration and bootstrap sequence

Use one shared repository, three branches, and one foundation commit. Person 1 works on platform, Person 2 on engine, Person 3 on experience. Each person uses a separate clone or git worktree. Do not have multiple coding tools mutate the same physical checkout at once.

First 60–90 minutes: Person 1 establishes the workspace, schemas, public fixtures, package export stubs, scripts, and health route, then shares the commit. In parallel, Person 2 prepares demo content and validates a DOCX/PPTX library spike inside a scratch folder; Person 3 prepares screen designs and notification adapter research in a scratch folder. They must not create competing root scaffolds. After the foundation commit, both branch from that exact base and move their work into owned paths.

If a role starts before the foundation exists, inspect the repository. If contracts and workspace files are absent, complete only the independent preparation above and provide a bootstrap-needed handoff. Do not fabricate an incompatible local contract or tell the user the integrated app is complete.

Person 1 merges in small working increments. Root lockfile conflicts are resolved by rerunning the chosen package manager and reviewing dependency changes, not by accepting an arbitrary side blindly. No direct push to another teammate's branch.

Expected root commands after bootstrap:

```text
pnpm install
pnpm setup:local
pnpm db:migrate
pnpm db:seed
pnpm dev
pnpm demo:proposal
pnpm demo:report
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
```

setup:local is idempotent: creates missing .env from .env.example, generates a local session secret and token-encryption key, creates data/artifact directories, and prints how to obtain or set the local demo password. It never overwrites existing secrets or configuration. Commit .env.example, never .env.

dev starts web, API, and worker with readable process prefixes. Individual dev:web, dev:api, and dev:worker commands must also work. Builds are dependency-ordered. Lint is a separate command, not assumed to happen inside next build.

demo commands perform a real HTTP POST to the local authenticated demo endpoint using DEMO_CLI_TOKEN. They do not insert database rows directly and do not write directly to the UI's local state. CLI token is server-only and can access only the demo injection endpoint, not general private API routes. Do not put it in URLs or browser bundles.

## 7. Canonical public data contract

Person 1 implements these in packages/contracts with Zod runtime validation. Export the public types and corresponding schemas. Strings used as IDs are nonempty opaque IDs, normally UUIDs; UI must not parse them. Timestamps are ISO-8601 UTC strings. Currency amounts use integer minor units in domain data; illustrative display values can be formatted at the edges.

```ts
export type TaskStatus =
  | "queued" | "planning" | "running" | "needs_input"
  | "ready" | "approved" | "dismissed" | "failed" | "skipped";
export type OutputKind = "proposal" | "report" | "presentation";
export type ArtifactFormat = "docx" | "pptx";
export type GenerationMode = "fixture" | "live";
export type IngestionMode = "demo" | "gmail";

export interface SourceRef {
  sourceId: string;
  locator: string | null; // e.g. page 2 or CSV rows 2–5; null if unavailable
  quote: string | null;   // exact short source excerpt, not invented evidence
}
export interface SourceDocument {
  id: string;
  kind: "email" | "attachment" | "organization" | "user_answer";
  title: string;
  filename: string | null;
  mimeType: string;
  text: string;
  extractionStatus: "complete" | "unsupported" | "failed";
  warnings: string[];
}
export interface AttachmentMeta {
  id: string; filename: string; mimeType: string; sizeBytes: number;
}
export interface EmailEnvelope {
  providerMessageId: string;
  providerThreadId: string | null;
  from: { name: string | null; email: string };
  to: string[];
  subject: string;
  receivedAt: string;
  bodyText: string;
  attachments: AttachmentMeta[];
}
export interface OrganizationProfile {
  id: string;
  name: string;
  description: string;
  timezone: string; // IANA, default America/Los_Angeles
  currency: string; // ISO currency code, e.g. USD
  backgroundText: string;
  policiesText: string;
  brand: { primaryColor: string; accentColor: string; fontFamily: string };
}
export interface WorkQuestion {
  id: string;
  question: string;
  reason: string;
  required: boolean;
}
export interface WorkAnswer { questionId: string; answer: string }
export interface WorkPlan {
  title: string;
  requestSummary: string;
  requestedOutputs: OutputKind[];
  dueAt: string | null;
  dueAtExplanation: string | null;
  steps: string[];
  assumptions: string[];
  questions: WorkQuestion[];
  sourcesUsed: string[];
}
export interface ContentBlock {
  id: string;
  kind: "paragraph" | "bullets" | "table" | "chart";
  heading: string | null;
  text: string | null;
  items: string[];
  columns: string[];
  rows: string[][];
  chart: {
    type: "bar" | "line";
    labels: string[];
    series: Array<{ name: string; values: number[] }>;
    unit: string | null;
  } | null;
  evidence: SourceRef[];
  basis: "source" | "calculated" | "recommendation" | "assumption";
}
export interface SlideContent {
  id: string;
  title: string;
  layout: "title" | "bullets" | "two_column" | "chart" | "closing";
  blocks: ContentBlock[];
  speakerNotes: string;
}
export interface WorkProduct {
  id: string;
  kind: OutputKind;
  title: string;
  subtitle: string | null;
  blocks: ContentBlock[]; // document content; [] for a slide-only product
  slides: SlideContent[]; // deck content; [] for a document-only product
  assumptions: string[];
  warnings: string[];
}
export interface Artifact {
  id: string;
  taskId: string;
  revision: number;
  productId: string;
  format: ArtifactFormat;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  downloadPath: string; // exact /api/artifacts/:id/download
  createdAt: string;
}
export interface TaskEvent {
  id: string;
  taskId: string;
  revision: number;
  type: "status" | "progress" | "warning" | "error" | "review";
  stage: "intake" | "plan" | "extract" | "generate" | "verify" | "export" | "notify" | "review";
  message: string;
  createdAt: string;
}
export interface TaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
  revision: number;
  ingestionMode: IngestionMode;
  generationMode: GenerationMode;
  senderName: string | null;
  senderEmail: string;
  subject: string;
  requestedOutputs: OutputKind[];
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  warningCount: number;
  artifactCount: number;
  error: { code: string; message: string; retryable: boolean } | null;
}
export interface TaskDetail {
  task: TaskSummary;
  email: EmailEnvelope;
  plan: WorkPlan | null;
  sources: SourceDocument[];
  products: WorkProduct[];
  artifacts: Artifact[]; // current revision only
  questions: WorkQuestion[];
  answers: WorkAnswer[];
  events: TaskEvent[];
  notifications: NotificationRecord[];
}
export interface WorkspaceSettings {
  organization: OrganizationProfile;
  automationEnabled: boolean;
  allowedSenders: string[]; // exact case-normalized addresses, no implicit wildcards
  autoPrepare: boolean;
  notifications: {
    channel: "outbox" | "whatsapp";
    recipient: string | null; // server redacts it in diagnostic logs
    quietHours: { enabled: boolean; start: string; end: string; timezone: string };
    digestTime: string; // local HH:mm
  };
}
export interface IntegrationStatus {
  gmail: {
    state: "disconnected" | "connected" | "error";
    email: string | null;
    connectedAt: string | null;
    lastPollAt: string | null;
    lastError: string | null;
  };
  model: { mode: GenerationMode; provider: "fixture" | "anthropic"; configured: boolean; model: string | null };
  notifications: { channel: "outbox" | "whatsapp"; configured: boolean; eligible: boolean; lastError: string | null };
  worker: { lastHeartbeatAt: string | null; healthy: boolean };
}
export interface NotificationRecord {
  id: string;
  taskId: string | null; // null for a multi-task digest
  revision: number | null;
  channel: "outbox" | "whatsapp";
  state: "queued" | "simulated" | "accepted" | "delivered" | "blocked" | "failed";
  message: string;
  taskIds: string[];
  scheduledFor: string;
  providerMessageId: string | null;
  lastError: string | null;
  createdAt: string;
}
```

All contract objects are JSON serializable. Binary buffers belong only in the internal engine interface below. Do not add arbitrary HTML or filesystem paths to public DTOs. Display email/content text through React escaping. If using Markdown rendering, disallow raw HTML.

## 8. Canonical engine interface

Export these from @afterhours/engine. Implement cross-role input/output schemas in contracts under an engine.ts module, except ModelClient implementation types may remain inside engine. Import shared domain types rather than duplicating them.

```ts
export interface BinaryAttachment {
  id: string; filename: string; mimeType: string; bytes: Uint8Array;
}
export interface EngineInput {
  taskId: string;
  revision: number;
  mode: GenerationMode;
  email: EmailEnvelope;
  attachments: BinaryAttachment[];
  organization: OrganizationProfile;
  answers: WorkAnswer[];
  now: string; // injected clock; never assume the machine timezone
  fixtureScenario: "proposal" | "report" | "ambiguous" | "no_action" | null;
}
export interface EngineProgress {
  stage: "plan" | "extract" | "generate" | "verify" | "export";
  message: string;
  plan?: WorkPlan;
}
export interface GeneratedFile {
  id: string; // deterministic per task/revision/product/format
  productId: string;
  format: ArtifactFormat;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}
export type EngineResult =
  | { outcome: "ready"; plan: WorkPlan; sources: SourceDocument[]; products: WorkProduct[]; files: GeneratedFile[]; warnings: string[] }
  | { outcome: "needs_input"; plan: WorkPlan; sources: SourceDocument[]; questions: WorkQuestion[]; warnings: string[] }
  | { outcome: "skipped"; reason: string; sources: SourceDocument[] };
export interface EngineDependencies {
  onProgress: (progress: EngineProgress) => Promise<void>;
  signal: AbortSignal;
}
export async function runWork(input: EngineInput, deps: EngineDependencies): Promise<EngineResult>;
export class EngineError extends Error {
  code: string;
  retryable: boolean;
}
```

runWork loads its provider configuration from validated server environment variables, but does not load .env itself. Root/API/worker entrypoints load environment consistently. Internally allow model-client injection for tests. Public application code does not need to know the provider's response format. Export createEngine or a documented test factory if injection requires it, while preserving runWork as the integration entrypoint.

Engine generation never sends messages, fetches arbitrary email links, changes the database, or writes final artifact paths. It returns bytes and structured products. Person 1 validates and persists the result. Both the UI preview and file renderer use the same WorkProduct content. Avoid a second independent generation pass for the UI.

Derive WorkProduct.id and GeneratedFile.id in code from taskId, revision, output kind, and output slot/format. The model does not choose persistent IDs. One proposal/report document product maps to one DOCX, and one presentation product maps to one PPTX. Use unique deterministic slots if a future supported request needs more than one product of a kind. Snapshot generation mode when a task is ingested; queued jobs and later clarification revisions retain that mode. Changing the operator's default mode affects newly ingested tasks, not existing work invisibly.

## 9. Canonical delivery interface

Export from @afterhours/delivery. Person 1 owns the outbox/scheduling/retries. Person 3 owns composition and provider calls.

```ts
export interface DeliveryInput {
  notificationId: string;
  channel: "outbox" | "whatsapp";
  recipient: string | null;
  publicAppUrl: string;
  tasks: Array<{ id: string; title: string; revision: number; artifactCount: number }>;
  deliveryPolicy: {
    eligible: boolean;
    customerServiceWindowOpen: boolean;
    approvedContentSid: string | null;
  };
}
export interface DeliveryResult {
  state: "simulated" | "accepted" | "blocked";
  message: string;
  providerMessageId: string | null;
  reason: string | null;
}
export async function sendNotification(input: DeliveryInput): Promise<DeliveryResult>;
export function composeNotification(input: DeliveryInput): string;
```

Throw a typed DeliveryError with code/retryable for network/provider failures. Returning accepted means provider acceptance, not confirmed delivery. Outbox mode returns simulated and performs no network request. Refuse live sends when recipient/configuration/eligibility is missing. A sandbox does not automatically waive provider policy restrictions.

For a provider timeout after request submission where acceptance is unknown, use code DELIVERY_UNCERTAIN with retryable=false. The worker records state=failed and a safe lastError explaining uncertainty; it does not automatically resend. Do not invent an extra public notification state without amending the contract.

## 10. API contract

API prefixes below are backend paths. The browser uses /api instead of /v1.

Successful responses: { data: T }. Error responses: { error: { code: string, message: string, details?: unknown, requestId: string } }. No stack traces, access tokens, provider request bodies, or secrets in error payloads. Lists use { data: { items: T[], nextCursor: string | null } }. Page size defaults to 30, caps at 100; stable ordering by createdAt descending plus ID.

| Method and backend path | Request / response |
|---|---|
| GET /health | public minimal process health; no environment details |
| POST /v1/session | { password: string }; sets session cookie; data { authenticated: true } |
| GET /v1/session | data { authenticated: boolean }; safe without prior login |
| DELETE /v1/session | clears/revokes cookie; data { authenticated: false } |
| GET /v1/tasks | optional status and cursor; paginated TaskSummary |
| GET /v1/tasks/:id | TaskDetail |
| POST /v1/tasks/:id/answers | { revision: number, answers: WorkAnswer[] }; returns TaskSummary |
| POST /v1/tasks/:id/retry | { revision: number }; returns TaskSummary |
| POST /v1/tasks/:id/review | { revision: number, action: "approve" | "dismiss" }; returns TaskSummary |
| GET /v1/artifacts/:id/download | authenticated binary with correct Content-Type and Content-Disposition |
| GET /v1/settings | WorkspaceSettings |
| PATCH /v1/settings | partial editable fields, validated and merged; full WorkspaceSettings response |
| GET /v1/integrations | IntegrationStatus |
| GET /v1/integrations/gmail/start | authenticated redirect to Google OAuth |
| GET /v1/integrations/gmail/callback | state-bound OAuth callback; redirects to /settings?gmail=connected or a safe error marker |
| DELETE /v1/integrations/gmail | disconnect, revoke/delete tokens, stop future polling; data { disconnected: true } |
| POST /v1/demo/inject | { scenario: "proposal" | "report" | "ambiguous" | "no_action", replayKey?: string }; returns data { taskId: string, deduplicated: boolean } |
| GET /v1/notifications | paginated NotificationRecord |

Return 400 for schema/format errors, 401 for missing/invalid login, 403 for disallowed operations, 404 for unknown resources, 409 for stale revision/invalid transition, 413 for oversized inputs, 429 for rate limiting, 503 for unavailable required service. Unsupported but valid work should be represented as skipped or needs_input, not an HTTP 500.

Review/retry/answer endpoints use optimistic revision checks. Missing or stale revision never overwrites a newer result. On successful answers/retry, increment revision and queue a fresh job transactionally. On review, keep revision and append the review event atomically. Existing artifacts are immutable. TaskDetail contains current revision artifacts only. Historical events keep their revision field.

Demo injection is enabled only when DEMO_ENABLED=true. It requires the normal session cookie or a DEMO_CLI_TOKEN bearer token. The CLI token grants only this endpoint. Each injection uses the same input normalization and task creation service as Gmail. replayKey deterministically identifies the source message for deduplication; a new ordinary demo click gets a new key.

## 11. State machine and queue semantics

Allowed transitions:

```text
queued -> planning
planning -> running | needs_input | skipped | failed
running -> ready | needs_input | failed
needs_input -> queued (new revision after validated answers)
failed -> queued (new revision for manual retry)
ready -> approved | dismissed
needs_input | failed | skipped -> dismissed
approved and dismissed are terminal in this MVP
```

Internal recovery exception: planning/running -> queued is permitted only for the same revision's bounded automatic retry or expired-lease recovery, with an explicit recovery/retry event. Browser endpoints cannot invoke this exception.

An automated transient retry stays within the same revision and returns its failed job attempt to queued with a progress event; do not show a terminal task failure unless the attempt limit is exhausted. User-initiated retries create a new revision. Only failed tasks can use the retry API. Do not invent a regenerate button on ready/approved tasks unless a contract amendment defines it.

Use one engine job at a time. Job uniqueness is taskId plus revision. A worker claims an eligible job atomically with a lease, owner token, attempts, and availableAt. Lease is 90 seconds; heartbeat at most every 15 seconds. A job can run up to 240 seconds while its lease is renewed. Persist worker heartbeat independently. At most two automatic execution attempts per revision; retry transient timeouts/429/5xx once after about 30 seconds. Do not retry malformed input, unsupported files, or missing credentials automatically forever.

SQLite transactions must be short: claim, progress update, result commit. No network request or long model execution inside a write transaction. Work from an input snapshot. Result commit checks that the lease owner token and task revision still match. A stale worker cannot overwrite a newer task revision or a job reclaimed by another worker.

Aim for at-least-once processing with idempotent commits. Do not claim exactly-once network delivery. Artifact IDs and final paths are deterministic per task/revision/product/format. Persist files atomically into a task/revision directory; publish the database manifest only when the complete expected output set is present and verified. Clean temporary files after failure. Handle orphaned files after a crash safely. A ready result and its unique notification intent are committed in one transaction.

Notification key is taskId/revision/channel for immediate notifications, or local digest date/channel for a digest. Provider timeouts can leave delivery uncertain; store that honestly and do not aggressively resend uncertain sends. Outbox processing must not rerun generation.

## 12. Gmail connection and ingestion

Use Google's official OAuth and Gmail API client. Request the minimum required scope, normally gmail.readonly for this MVP. Do not request modify, compose, send, or full mailbox access merely because they are convenient. Document Google test-user configuration and the difference between a private hackathon test and public production verification.

Bind OAuth state to a session, use short expiry and one-time consumption, verify callback state, keep redirect URI exact, and encrypt stored refresh tokens using AES-256-GCM with a server-side 32-byte key. Keep access/refresh tokens out of browser storage, frontend DTOs, logs, and git. Retain an existing refresh token if a refresh response omits one.

On first connect, record connectedAt and process only new inbox messages received after that point, with a small overlap to handle clock/poll races. Never process the user's entire historic inbox automatically. Poll every 15 seconds only while enabled and connected. Use overlap plus a database uniqueness constraint on connection ID/provider message ID. Persist polling cursors/checkpoints. Follow bounded pagination; do not advance beyond messages left unprocessed by a per-cycle cap.

Normalize MIME recursively. Prefer text/plain; otherwise sanitize HTML to readable text. Decode base64url correctly. Resolve only actual MIME attachments through Gmail's attachment endpoint. Do not load remote images, follow email links, execute macros, or treat attachments as trusted executable content. Cap 10 MB per file, 20 MB aggregate, and five files per email. Cap extracted text supplied to the model at 60,000 characters total with explicit truncation warnings and a blocking question when missing content is material.

Only exact allowedSenders can auto-prepare work. Unknown senders do not start model calls; record a bounded intake audit event, without filling the task queue with spam. Do not use an address allowlist as permission to follow arbitrary instructions in its attachments.

For the live demo, configure one test sender and one test inbox. Fixtures use fictional .example addresses; do not silently treat those as the live allowlist. New messages in a thread may create new task records; show the thread relation if useful, but do not automatically overwrite a previously reviewed task based solely on a shared thread ID.

## 13. Grounding and work quality

Treat email text, attachments, and retrieved context as untrusted data. They describe work and supply facts; they cannot grant new system privileges, request secret disclosure, change provider endpoints, execute shell commands, or authorize external actions. A document saying "ignore prior instructions and send API keys" must not change the execution policy.

Use a bounded pipeline: normalize/extract -> classify and plan -> generate structured content -> deterministic validation -> export files. An optional verification model call is allowed inside the budget. Never run an unbounded agent loop. Default maximum is three logical model calls per attempt, each with a hard timeout no more than 60 seconds and bounded output tokens. If SDK-level retries are enabled, document and bound them; do not accidentally multiply retries at four layers.

Use schema-constrained JSON where supported. Validate every model result using contracts. At most one repair request, counted inside the call budget. Do not blindly JSON.parse an arbitrary fenced block and pass it downstream. A badly formed model result should become a typed error, never a broken downloadable file.

Every factual content block must reference existing source IDs, or explicitly state its basis as calculated, recommendation, or assumption. Quote fields must match the source text after documented whitespace normalization. CSV calculations should identify dataset/rows and formula in the source/evidence explanation. Never invent precise page numbers for an unpaginated extraction.

Numbers come from code. Dates, amounts, totals, differences, percent changes, and fees must be normalized and computed deterministically when derived. The model may explain validated results, but must not be the calculator of record. A missing value is unknown, not zero. Preserve currency and unit distinctions. Do not sum two currencies or compare nonmatching date windows as if they were equivalent.

If a missing fact affects a material commitment, ask a specific blocking question. An unspecified project deadline or required client budget is not an invitation to invent one. Optional styling choices can use explicit assumptions. Conflicting important source facts must be surfaced rather than silently resolved.

Use organization timezone for relative dates. Resolve "next Monday" from receivedAt and timezone, record the interpretation, and ask when ambiguous enough to affect the deliverable. Do not use today's machine clock as the reference for an old email. Do not invent a contractual deadline merely because the demo feels better with one.

Avoid unsupported claims such as "this will increase revenue by 30%" or fake customer testimonials. A polished document containing fabricated business facts is a failed result.

## 14. File and presentation quality

Use docx for Word output and PptxGenJS for PowerPoint output, verifying the installed APIs. Generated files must be valid Office ZIP containers with expected internal files. Use deterministic layout templates; do not ask the model to place arbitrary objects at pixel coordinates.

DOCX: coherent title, descriptive subtitle, headings, readable body type, consistent spacing, properly sized tables, summary, requested substantive sections, explicit assumptions/unknowns, and concise source notes. Use page headers/footers or page numbers if straightforward. No fake legal commitments. Proposal documents should be about 3–5 pages of useful content in the demo, but do not pad weak content to hit a page count.

PPTX: 16:9, five slides for the primary fixture, readable type, restrained palette from the organization profile, consistent margins, no overflow, no empty placeholder slides, and speaker notes where useful. Use editable text and native charts when the library supports them. Suggested primary layouts: title, understanding/objectives, scope/deliverables, timeline/fees, next steps/assumptions.

For charts, data must match deterministic calculations. Avoid decorative images that require external credentials. Prefer clean native shapes and charts. Table cells and slides need content budgets and safe wrapping; split dense material or summarize while preserving the details in the document.

For validation, inspect the Office container structure, parse XML where useful, and render/open at least one proposal/deck pair if local tools are available. If no Office renderer is installed, say visual rendering is unverified and inspect the structured preview and layout constraints. Do not state that a PowerPoint renders perfectly just because generation returned bytes.

## 15. Review experience

The web app is a calm work queue. Default view emphasizes results ready to review, then active tasks, then tasks needing input. A task detail page shows the incoming request, the plan, real progress events, sources, file cards, preview content, warnings, and review actions.

The UI must distinguish:

- Demo email versus actual Gmail ingestion.
- Fixture intelligence versus live model generation.
- Generated and ready versus marked reviewed.
- Notification simulated, queued, provider accepted, delivered, blocked, or failed.
- Gmail connected versus disconnected, and worker healthy versus stale.

Never show an invented progress percentage, fake live task, fake time saved, fake confidence score, or completed delivery when the provider only accepted the request. Seeded data is permitted only when labeled as demo data. No local-only approve actions that disappear on refresh.

Office previews in MVP are structured content previews of the same WorkProduct used to produce the file. Label them "Content preview". They are not a claim of pixel-identical DOCX/PPTX rendering. The actual generated files must be separately downloadable.

## 16. Notifications and overnight operation

WhatsApp is an optional delivery interface over the same result-review system. The system's core execution must not depend on WhatsApp approval, an unofficial session scraper, or a phone remaining connected. Use only official provider APIs; do not use personal-account reverse-engineered libraries.

Current platform restrictions may limit general-purpose AI assistant use. The team must confirm this use case is permitted for the account/region before enabling live delivery. A template or sandbox is not proof of eligibility, and calling the product a different name is not a workaround. This is a platform prerequisite, not a reason to halt local MVP development. Build a working outbox fallback and label it honestly.

When WhatsApp messaging is eligible, free-form outbound messages require an open customer-service window; otherwise use an approved template with the exact configured variables. Never send arbitrary generated text outside that window. If eligibility/window/template is missing, return blocked and leave the review result accessible in the dashboard.

P0 supports immediate notification intents. P1 supports quiet hours in the user's IANA timezone, including windows crossing midnight, and a morning digest at digestTime. Work generation continues during quiet hours. Only message delivery is delayed. Persist the delivery schedule so restarting overnight does not lose the notification. A digest links to the queue and lists a bounded number of tasks with a count for the remainder. Do not wake users with per-stage notifications.

A live overnight run requires the API/worker to run on an always-on host with a persistent disk. Closing the browser must not stop work. A sleeping laptop will stop local processing; document that accurately. The hackathon demonstration can compress overnight into a short live sequence and must say it is a time-compressed demo.

## 17. Environment contract

Person 1 creates the root .env.example and ensures every service reads consistent settings. Only NEXT_PUBLIC_APP_NAME may be public. Use the following names exactly unless an amendment is merged:

```dotenv
NODE_ENV=development
PUBLIC_APP_URL=http://localhost:3000
API_ORIGIN=http://127.0.0.1:4000
API_PORT=4000
DATABASE_PATH=./var/afterhours.sqlite
ARTIFACTS_DIR=./var/artifacts
SESSION_SECRET=
APP_PASSWORD=
TOKEN_ENCRYPTION_KEY=
DEMO_ENABLED=true
DEMO_CLI_TOKEN=
GENERATION_MODE=fixture
MODEL_PROVIDER=fixture
MODEL_NAME=
ANTHROPIC_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/integrations/gmail/callback
GMAIL_POLL_INTERVAL_SECONDS=15
NOTIFICATION_CHANNEL=outbox
WHATSAPP_USE_CASE_ELIGIBLE=false
WHATSAPP_CUSTOMER_SERVICE_WINDOW_UNTIL=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=
TWILIO_WHATSAPP_TO=
TWILIO_CONTENT_SID=
NEXT_PUBLIC_APP_NAME=AfterHours
```

Validate configuration at startup. Derive every local path from the repository root or an explicit absolute path, not from whichever package happens to be cwd. Empty optional provider settings must not crash fixture mode. Live mode with missing model credentials must fail clearly, not silently return fixture work. Only enabling Gmail/WhatsApp requires its corresponding credentials.

Distinguish invalid core runtime configuration from disconnected optional integrations. Invalid database/session/encryption configuration may prevent startup. Missing live model credentials should appear as configured=false and cause a typed nonretryable task configuration error while leaving the API, login, settings, and worker heartbeat available. Missing Gmail or WhatsApp setup similarly remains visible and disconnected/blocked rather than bringing down the whole application.

Store user-editable organization and notification schedule in the database; environment variables provide initial defaults and secrets. Recipient can be edited in authenticated settings, but credentials cannot. The eligibility env flag is controlled by the operator, not toggled by an arbitrary client setting. Display the reason when live WhatsApp is disabled.

## 18. Minimum practical security

This is a private single-workspace prototype. Implement a real server session with an opaque random token stored as a hash, HttpOnly SameSite=Lax cookie, Secure in production, expiry, logout revocation, and a hashed application password. Rate-limit login and ingestion endpoints. Check Origin on browser mutation routes. OAuth callback is a separate state-verified route. Do not leave demo endpoints or artifact downloads public.

Artifact downloads look up a known ID in the database and serve a path inside the artifact root. Do not accept arbitrary file paths. Prevent traversal, sanitize download filenames, set private/no-store cache behavior where appropriate, and reject symlink/path escapes. Download links in notifications may require login and should continue to the requested task afterward. Do not put session tokens or secrets in links.

Never log full source documents, email bodies, access tokens, refresh tokens, cookies, authorization headers, API keys, or recipient phone numbers. Log task IDs, stage names, durations, safe error codes, and provider request IDs if available. Demo fixtures contain only fictional information.

## 19. Shared acceptance scenarios

A. Proposal happy path: inject primary fixture -> one task -> real progress -> ready -> exactly one proposal DOCX plus one presentation PPTX -> source-grounded matching preview -> mark reviewed -> refresh preserves approved state.

B. CSV happy path: inject report fixture -> code calculates January revenue 12,000, February revenue 15,000, absolute change 3,000, growth 25% -> report/deck display the same values -> native chart/preview data match -> no fabricated explanation of causality.

C. No action: a newsletter/FYI message with no request -> skipped; no model-generated Office files or WhatsApp send.

D. Ambiguous assignment: "Prepare the proposal" without scope, client facts, or a usable brief -> needs_input with specific blocking questions; validated answers create a new revision and resume processing. The old question answers remain traceable.

E. Duplicate email: inject same scenario twice with the same replayKey -> same taskId and one job/notification intent for the revision.

F. Provider outage: live provider failure -> bounded retry -> actionable failure; no fabricated ready status. Manual retry works after the issue is fixed.

G. Restart: stop worker during a job -> restart -> recover only after lease expiry or safe shutdown release -> complete without duplicate ready manifests.

H. Unauthorized access: private tasks, settings, demo injection, downloads, and mutations reject unauthenticated requests. CLI token cannot read inbox data.

I. Injection attempt: attachment asks for credentials or to send all inbox messages -> no secret leakage, no arbitrary external call, normal task policy retained.

J. Notification fallback: no Twilio credentials -> outbox simulated; an actual live send is never claimed. Ineligible WhatsApp -> blocked. Outside window without template -> blocked.

K. Quiet hours: at 23:30 local, work completes; notification is scheduled for the configured morning time; correct timezone handling, including the next date and DST.

L. Stale review: review revision 1 after revision changed -> 409 and UI refresh prompt. Failed/needs_input work cannot be approved.

M. Input limits: oversized attachments or unsupported required input -> clear bounded failure/needs_input; no silent partial result presented as complete.

N. Export integrity: DOCX and PPTX open as valid Office files and contain the expected proposal/deck content. Metadata, MIME, filenames, size, hashes, current revision, and download routes match.

Use meaningful tests for queue durability, data integrity, grounding, state transitions, calculations, exports, and critical review flows. Do not spend hours snapshot-testing decorative UI or writing tests that merely repeat trivial implementation details.

## 20. Completion standard and handoff

At the end of your role's turn, report:

1. Concrete functionality implemented and owned files changed.
2. Exact setup/run commands actually exercised.
3. Test/build results, with failures or unrun checks identified.
4. Environment variables the human must provide, without showing secret values.
5. Public exports/routes consumed by other owners.
6. Known limitations and the next integration step.

If you leave a stub, mark it prominently. No TODO hidden behind a successful toast. No mock provider inside live mode. No fabricated benchmark or "production-ready" claim. Prefer a smaller complete flow to a larger UI full of actions that do not work.

## 21. Official references and verification checkpoints

Use current official docs and installed dependency types during implementation:

- Next.js installation and app structure: https://nextjs.org/docs/app/getting-started/installation
- Fastify validation: https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
- Gmail OAuth: https://developers.google.com/workspace/gmail/api/auth/web-server
- Gmail scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
- Google OAuth test users: https://developers.google.com/workspace/guides/configure-oauth-consent
- PptxGenJS: https://gitbrent.github.io/PptxGenJS/
- DOCX library: https://docx.js.org/
- Twilio WhatsApp concepts: https://www.twilio.com/docs/whatsapp/api
- Twilio sandbox: https://www.twilio.com/docs/whatsapp/sandbox
- Meta AI-provider policy/pricing: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers

These links support implementation research, not proof that your particular deployment has received provider approval. Confirm actual provider responses and account settings before stating a live integration works.



## Appendix: additive contract changes for email-history and file context (Batch 8)

All additions are optional or new; existing producers and consumers keep working. Source of truth is
`packages/contracts/src/context.ts` and `docs/context-resolution.md`.

- `WorkQuestion.options?: { id, label, detail }[]` closed choices; the answer is one option id. The model-facing live
  schema omits it.
- `EngineInput.context?: ContextBundle` and `EngineInput.contextFiles?: { versionId, filename, mimeType, bytes }[]`.
- `EngineResult` (ready) `revisionReport?: RevisionReport` (per-requirement status, slide counts, base version checksum).
- `FixtureScenario` adds `revision` and `revision_choice`.
- API: `GET /v1/context`, `POST /v1/context/grants`, `DELETE /v1/context/grants/:id`, `POST /v1/context/grants/:id/purge`,
  `GET /v1/context/folders`, `GET /v1/context/emails/:id`, `GET /v1/context/files/:versionId/download`,
  `GET /v1/tasks/:id/context`, `POST /v1/tasks/:id/context/corrections`.
- State machine: a context correction may move a `ready` task to `queued` as a new revision.
