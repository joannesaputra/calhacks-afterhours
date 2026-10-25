-- Batch 9: deleting a task.
--
-- Deleting a task removes the task and everything that hangs off it (events, plan, products, files, answers, retrieval
-- runs, reply records) through the existing ON DELETE CASCADE foreign keys, and removes the stored email text. What it
-- keeps is a tombstone holding only the provider's message key, so the mailbox poller never re-creates the deleted task
-- from the same email. The tombstone holds no sender, subject, text or files.
-- Applied migrations are immutable. Additions go in a new file.

CREATE TABLE deleted_intake (
  source_key  TEXT PRIMARY KEY,
  deleted_at  TEXT NOT NULL
);
