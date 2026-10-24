-- Batch 4: connection identity for Gmail, auth-failure pause, organization snapshot per task.

-- Rotates on every connect, cleared on disconnect. Token refreshes and poll results are only persisted
-- when they belong to the connection that is current at write time.
ALTER TABLE integrations ADD COLUMN connection_token TEXT;
-- Set when Google rejects the saved credentials; polling pauses until the operator reconnects.
ALTER TABLE integrations ADD COLUMN auth_failed_at TEXT;

-- Organization profile captured at ingestion. Revisions of the same task reuse it; settings edits only
-- affect newly ingested work. NULL for tasks created before this migration (worker falls back to settings).
ALTER TABLE tasks ADD COLUMN organization_json TEXT;
