-- Batch 9: sending the reviewed result back to the person who asked.
--
-- One row per attempt to send. A partial unique index allows at most one live attempt ('sending') or completed send
-- ('sent') per task revision, so a double click, a retry or two browser tabs can never send the same revision twice.
-- A failed attempt stays on record and may be retried. Message text and file bytes are not stored here: only who it
-- went to, which stored files were attached (by id and checksum), the subject, and the provider's message id.
-- Applied migrations are immutable. Additions go in a new file.

CREATE TABLE reply_sends (
  id               TEXT PRIMARY KEY,
  task_id          TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  revision         INTEGER NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('sending','sent','failed')),
  to_email         TEXT NOT NULL,
  from_account     TEXT,
  subject          TEXT NOT NULL,
  artifact_ids_json TEXT NOT NULL,
  provider_message_id TEXT,
  provider_thread_id  TEXT,
  error            TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  sent_at          TEXT
);
CREATE INDEX idx_reply_sends_task ON reply_sends (task_id, revision);
CREATE UNIQUE INDEX idx_reply_sends_one_live ON reply_sends (task_id, revision) WHERE status IN ('sending','sent');
