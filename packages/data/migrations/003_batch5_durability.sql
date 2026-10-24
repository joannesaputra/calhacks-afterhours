-- Batch 5: notification membership snapshots, send-attempt bookkeeping, recipient snapshot.

-- 'immediate' = one task revision; 'digest' = grouped by logical local date and channel.
ALTER TABLE notifications ADD COLUMN kind TEXT NOT NULL DEFAULT 'immediate' CHECK (kind IN ('immediate','digest'));
UPDATE notifications SET kind = 'digest' WHERE dedupe_key LIKE 'digest/%';

-- Set when a worker claims the row. Membership is frozen from this moment: later arrivals go to a follow-up row.
ALTER TABLE notifications ADD COLUMN sealed_at TEXT;
-- Written (durably) immediately before a provider submission may begin. A lease that expires while this is set
-- on a live channel means the provider may already have accepted the message, so it is never resent.
ALTER TABLE notifications ADD COLUMN submit_started_at TEXT;
-- sha256 fingerprint of the Settings recipient at queue time. Compared at dispatch so a queued live message is
-- never silently sent to a recipient that was edited afterwards.
ALTER TABLE notifications ADD COLUMN recipient_fp TEXT;

-- One row per task revision per channel, across immediate and digest notifications. The UNIQUE constraint is what
-- stops a task revision from being delivered twice (once immediately, once in a digest).
CREATE TABLE notification_members (
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  revision        INTEGER NOT NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('outbox','whatsapp')),
  ordinal         INTEGER NOT NULL,
  PRIMARY KEY (notification_id, task_id, revision),
  UNIQUE (task_id, revision, channel)
);
CREATE INDEX idx_notification_members_task ON notification_members (task_id, revision);

-- Backfill from the JSON membership of existing rows (first occurrence wins if an old row duplicated a member).
INSERT OR IGNORE INTO notification_members (notification_id, task_id, revision, channel, ordinal)
SELECT n.id, j.value, CAST(json_extract(n.task_revisions_json, '$[' || j.key || ']') AS INTEGER), n.channel, j.key
FROM notifications n, json_each(n.task_ids_json) j
WHERE json_extract(n.task_revisions_json, '$[' || j.key || ']') IS NOT NULL
  AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = j.value);

-- Outbox rows that have already left the queue are sealed by definition.
UPDATE notifications SET sealed_at = updated_at WHERE state <> 'queued';
