-- Batch 8: email history, file context, retrieval runs, sync cursors and a redacted audit log.
--
-- owner_id is the workspace owner (one value today, 'workspace'). Every table that holds user content carries it, and
-- every query in packages/data/src/context filters on it first, so a second owner can never read or match the first
-- owner's rows. File bytes are not stored here: they go through the artifact blob store and only their path, checksum
-- and size are recorded. The full-text index (FTS5) is created at runtime by ensureSearchIndex() when the SQLite
-- build supports it; search_docs below is the owner/account/grant-scoped candidate table both search paths use.
--
-- Applied migrations are immutable. Additions go in a new file.

-- Connection and sync status for each source. Credentials stay in `integrations` (encrypted); this row only points at it.
CREATE TABLE connected_accounts (
  id               TEXT PRIMARY KEY,
  owner_id         TEXT NOT NULL,
  provider         TEXT NOT NULL CHECK (provider IN ('gmail','folder','drive')),
  account_ref      TEXT NOT NULL,
  integration_id   TEXT REFERENCES integrations(id),
  state            TEXT NOT NULL CHECK (state IN ('connected','disconnected','error','unavailable')),
  sync_status      TEXT NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle','backfilling','incremental','partial','error','paused')),
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  connected_at     TEXT,
  last_sync_at     TEXT,
  last_error       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (owner_id, provider, account_ref)
);

-- What Afterhours may read. Email history and files are separate grants, so email-only mode is a single row.
-- Revoking sets revoked_at: access stops at once. Retained copies are removed only by an explicit purge (purged_at).
CREATE TABLE context_grants (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT NOT NULL,
  account_id     TEXT NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('email','files')),
  lookback_days  INTEGER CHECK (lookback_days IS NULL OR lookback_days > 0),
  include_sent   INTEGER NOT NULL DEFAULT 1,
  selected_json  TEXT NOT NULL DEFAULT '[]',
  created_at     TEXT NOT NULL,
  expires_at     TEXT,
  revoked_at     TEXT,
  revoke_reason  TEXT,
  purged_at      TEXT,
  updated_at     TEXT NOT NULL,
  CHECK (kind <> 'email' OR lookback_days IS NOT NULL)
);
CREATE INDEX idx_grants_scope ON context_grants (owner_id, account_id, kind, revoked_at);

-- Contacts and verified addresses. A shared name or company domain never merges two people: only a verified link does.
CREATE TABLE contacts (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL,
  display_name TEXT,
  created_at   TEXT NOT NULL
);
CREATE TABLE contact_addresses (
  owner_id   TEXT NOT NULL,
  address    TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  verified   INTEGER NOT NULL DEFAULT 0,
  source     TEXT NOT NULL CHECK (source IN ('header','manual','confirmed')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, address)
);
CREATE INDEX idx_contact_addresses_contact ON contact_addresses (contact_id);

-- Historical and current messages. received_at is the original email time; ingested_at is when Afterhours stored it;
-- tasks.created_at is when a task was created. They are three different instants and are never merged.
CREATE TABLE emails (
  id                  TEXT PRIMARY KEY,
  owner_id            TEXT NOT NULL,
  account_id          TEXT NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  grant_id            TEXT REFERENCES context_grants(id) ON DELETE SET NULL,
  provider_message_id TEXT NOT NULL,
  provider_thread_id  TEXT,
  direction           TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  from_address        TEXT NOT NULL,
  from_name           TEXT,
  to_json             TEXT NOT NULL DEFAULT '[]',
  cc_json             TEXT NOT NULL DEFAULT '[]',
  subject             TEXT NOT NULL,
  normalized_subject  TEXT NOT NULL,
  body_text           TEXT NOT NULL,
  new_text            TEXT NOT NULL,
  received_at         TEXT NOT NULL,
  ingested_at         TEXT NOT NULL,
  provenance          TEXT NOT NULL CHECK (provenance IN ('gmail_backfill','gmail_incremental','gmail_intake','fixture')),
  attachment_count    INTEGER NOT NULL DEFAULT 0,
  invalidated_at      TEXT,
  invalidation_reason TEXT,
  UNIQUE (owner_id, account_id, provider_message_id)
);
CREATE INDEX idx_emails_thread  ON emails (owner_id, account_id, provider_thread_id);
CREATE INDEX idx_emails_date    ON emails (owner_id, account_id, received_at);
CREATE INDEX idx_emails_from    ON emails (owner_id, account_id, from_address, received_at);
CREATE INDEX idx_emails_subject ON emails (owner_id, account_id, normalized_subject);

CREATE TABLE email_participants (
  email_id   TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  owner_id   TEXT NOT NULL,
  account_id TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('from','to','cc')),
  address    TEXT NOT NULL,
  PRIMARY KEY (email_id, role, address)
);
CREATE INDEX idx_participants_address ON email_participants (owner_id, account_id, address);

-- Provider file ids found in a message body (Google Docs/Slides/Drive links). Only the provider and file id are kept,
-- never the URL, so a signed or tokenised link is not stored.
CREATE TABLE email_links (
  email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  file_ref TEXT NOT NULL,
  PRIMARY KEY (email_id, provider, file_ref)
);
CREATE INDEX idx_email_links_ref ON email_links (owner_id, provider, file_ref);

-- File identity is the provider's identity, never the filename: two files called "Deck.pptx" stay two rows.
-- account_id is '' for the attachments of a task's own request email.
CREATE TABLE source_files (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL,
  account_id      TEXT NOT NULL DEFAULT '',
  provider        TEXT NOT NULL CHECK (provider IN ('gmail','folder','drive','task')),
  provider_file_id TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('attachment','linked','folder_file')),
  name            TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  parent_email_id TEXT REFERENCES emails(id) ON DELETE SET NULL,
  parent_ref      TEXT,
  mutable         INTEGER NOT NULL DEFAULT 0,
  state           TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','deleted','unavailable','forbidden')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (owner_id, account_id, provider, provider_file_id)
);
CREATE INDEX idx_source_files_email ON source_files (parent_email_id);

-- An immutable observation of a file's content. version_key is the provider revision for live files and the content
-- checksum for attachment snapshots. blob_rel_path stays NULL until the bytes are fetched (metadata-first retrieval).
CREATE TABLE file_versions (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL,
  file_id           TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  version_key       TEXT NOT NULL,
  snapshot_kind     TEXT NOT NULL CHECK (snapshot_kind IN ('attachment_snapshot','provider_revision','local_file')),
  checksum_sha256   TEXT,
  size_bytes        INTEGER NOT NULL DEFAULT 0,
  modified_at       TEXT,
  sent_at           TEXT,
  blob_rel_path     TEXT,
  acquire_state     TEXT NOT NULL DEFAULT 'metadata_only' CHECK (acquire_state IN ('metadata_only','stored','unavailable')),
  extraction_status TEXT NOT NULL DEFAULT 'pending' CHECK (extraction_status IN
    ('pending','complete','unsupported','encrypted','oversized','failed','unavailable')),
  extraction_detail TEXT,
  parser_version    TEXT,
  unit_count        INTEGER,
  discovered_at     TEXT NOT NULL,
  invalidated_at    TEXT,
  invalidation_reason TEXT,
  UNIQUE (file_id, version_key)
);
CREATE INDEX idx_file_versions_file ON file_versions (file_id, discovered_at);
CREATE INDEX idx_file_versions_sha  ON file_versions (owner_id, checksum_sha256);

-- Extracted text per slide/page/section. The parse cache is "rows exist for (file_version_id, parser_version)".
CREATE TABLE content_chunks (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL,
  account_id      TEXT NOT NULL DEFAULT '',
  file_version_id TEXT NOT NULL REFERENCES file_versions(id) ON DELETE CASCADE,
  ordinal         INTEGER NOT NULL,
  unit            INTEGER,
  unit_kind       TEXT,
  locator         TEXT NOT NULL,
  section         TEXT,
  text            TEXT NOT NULL,
  parser_version  TEXT NOT NULL,
  UNIQUE (file_version_id, parser_version, ordinal)
);
CREATE INDEX idx_chunks_scope ON content_chunks (owner_id, account_id, file_version_id);

-- Candidate rows for both search paths (FTS rowid = search_docs.id when FTS exists). No text is duplicated here.
CREATE TABLE search_docs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id   TEXT NOT NULL,
  account_id TEXT NOT NULL DEFAULT '',
  ref_type   TEXT NOT NULL CHECK (ref_type IN ('email','chunk')),
  ref_id     TEXT NOT NULL,
  UNIQUE (ref_type, ref_id)
);
CREATE INDEX idx_search_docs_scope ON search_docs (owner_id, account_id, ref_type);

-- Lightweight project/client entities and the evidence that links messages, threads, files and tasks to them.
CREATE TABLE project_entities (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL,
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('project','client')),
  created_at      TEXT NOT NULL,
  UNIQUE (owner_id, normalized_name)
);
CREATE TABLE entity_links (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  entity_id   TEXT NOT NULL REFERENCES project_entities(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('email','thread','file','task')),
  target_id   TEXT NOT NULL,
  confidence  REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  origin      TEXT NOT NULL CHECK (origin IN ('inferred','user_confirmed')),
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  UNIQUE (owner_id, entity_id, target_type, target_id)
);
CREATE INDEX idx_entity_links_target ON entity_links (owner_id, target_type, target_id);
-- Small source-backed summary of what is known about an entity. Every line names the message or file it came from.
CREATE TABLE project_summaries (
  entity_id  TEXT PRIMARY KEY REFERENCES project_entities(id) ON DELETE CASCADE,
  owner_id   TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One retrieval run per task revision. The run keeps what was searched, what was chosen and why, and the snapshot of
-- exact source versions, so a restart or a correction can reuse still-valid work instead of searching again.
CREATE TABLE retrieval_runs (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  revision      INTEGER NOT NULL,
  account_id    TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL CHECK (status IN ('running','complete','failed')),
  outcome       TEXT CHECK (outcome IN ('resolved','ambiguous','no_match','needs_requirements','unavailable',
                  'unsupported','incomplete','access_revoked','retryable_error','not_applicable')),
  request_json      TEXT NOT NULL DEFAULT '{}',
  temporal_json     TEXT,
  stages_json       TEXT NOT NULL DEFAULT '[]',
  coverage_json     TEXT NOT NULL DEFAULT '{}',
  limits_json       TEXT NOT NULL DEFAULT '{}',
  limits_hit_json   TEXT NOT NULL DEFAULT '[]',
  candidates_json   TEXT NOT NULL DEFAULT '[]',
  decision_json     TEXT,
  requirements_json TEXT NOT NULL DEFAULT '[]',
  uncertainties_json TEXT NOT NULL DEFAULT '[]',
  questions_json    TEXT NOT NULL DEFAULT '[]',
  bundle_json       TEXT,
  metrics_json      TEXT NOT NULL DEFAULT '{}',
  reused_from_revision INTEGER,
  generation_started_at TEXT,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  UNIQUE (task_id, revision)
);
CREATE INDEX idx_retrieval_runs_owner ON retrieval_runs (owner_id, started_at);

CREATE TABLE retrieval_sources (
  run_id      TEXT NOT NULL REFERENCES retrieval_runs(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('email','file_version')),
  source_id   TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('request','target','candidate','feedback','deck_message','related','excluded')),
  score       REAL,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  version_key TEXT,
  sha256      TEXT,
  selected    INTEGER NOT NULL DEFAULT 0,
  ordinal     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, source_type, source_id, role)
);

-- Individual requested edits and what happened to each of them.
CREATE TABLE task_requirements (
  task_id        TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  revision       INTEGER NOT NULL,
  ordinal        INTEGER NOT NULL,
  id             TEXT NOT NULL,
  text           TEXT NOT NULL,
  edit_json      TEXT,
  support_json   TEXT NOT NULL DEFAULT '[]',
  scope          TEXT NOT NULL DEFAULT '',
  conflicts_json TEXT NOT NULL DEFAULT '[]',
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','already_satisfied','unsupported','blocked')),
  detail         TEXT,
  PRIMARY KEY (task_id, revision, ordinal),
  UNIQUE (task_id, revision, id)
);

-- Corrections the user made from the dashboard. Each takes effect from `effective_revision` and is reused by later ones.
CREATE TABLE task_context_overrides (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id            TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  effective_revision INTEGER NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('select_file','exclude_source','add_feedback','drop_requirement')),
  value_json         TEXT NOT NULL,
  created_at         TEXT NOT NULL
);
CREATE INDEX idx_overrides_task ON task_context_overrides (task_id, effective_revision);

-- The revision Afterhours produced for a task revision, separate from the source file it started from.
CREATE TABLE output_revisions (
  id                   TEXT PRIMARY KEY,
  owner_id             TEXT NOT NULL,
  task_id              TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  revision             INTEGER NOT NULL,
  run_id               TEXT,
  base_file_version_id TEXT,
  base_sha256          TEXT,
  fidelity             TEXT NOT NULL,
  report_json          TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  UNIQUE (task_id, revision)
);

-- Resumable, bounded synchronization with leases and backoff.
CREATE TABLE sync_cursors (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL,
  account_id    TEXT NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  scope         TEXT NOT NULL CHECK (scope IN ('backfill','incremental')),
  status        TEXT NOT NULL CHECK (status IN ('pending','running','complete','failed','paused')),
  cursor_json   TEXT NOT NULL DEFAULT '{}',
  pages_done    INTEGER NOT NULL DEFAULT 0,
  items_done    INTEGER NOT NULL DEFAULT 0,
  window_start  TEXT,
  window_end    TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error    TEXT,
  lease_owner   TEXT,
  lease_until   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (owner_id, account_id, scope)
);

-- Redacted audit trail: ids, counts and codes only, never message or file content.
CREATE TABLE context_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id     TEXT NOT NULL,
  kind         TEXT NOT NULL,
  subject_type TEXT,
  subject_id   TEXT,
  detail_json  TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_context_audit_owner ON context_audit (owner_id, id);

CREATE TABLE context_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
