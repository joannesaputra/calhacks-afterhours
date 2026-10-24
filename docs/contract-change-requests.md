# Contract change requests

Propose the smallest amendment here, on your own branch, and tell Person 1. Only Person 1 merges an approved
amendment into `docs/CONTRACT.md` and `packages/contracts`.

Template:

```text
ID: CCR-<n>
Requested by / role:
Blocker (what cannot be built without it):
Proposed change (exact names/types/routes):
Compatibility impact on other owners:
Status: proposed | approved | rejected | merged (commit)
```

## Open

```text
ID: CCR-1
Requested by / role: Darren (Person 1), on behalf of the clarification UI (Maricella) — PROPOSAL ONLY, not implemented
Blocker (what cannot be built without it): After a clarification round, `TaskDetail.questions` is empty and
  `TaskDetail.answers` holds only `{ questionId, answer }`. The UI cannot show "what was asked" next to a retained
  answer. The question text is stored (`answer_history.question`) but not exposed. `plan.questions` is overwritten
  by later revisions.
Proposed change: add an optional field to `TaskDetail`: `answerHistory?: Array<{ revision: number; questionId: string;
  question: string; answer: string; createdAt: string }>`, ordered by revision then creation. Additive and optional;
  no route changes.
Compatibility impact on other owners: Maricella may ignore it; Joanne unaffected. Zod schema gains one optional key.
Status: proposed (needs Maricella's yes before Darren merges it). Workaround today: show the answers by
  questionId, or render the question text from the earlier needs_input event messages.
```

## Platform notes (not amendments)

- Batch 4 (Darren): `SettingsPatchSchema` is now strict at every nesting level (`organization`, `organization.brand`,
  `notifications`, `notifications.quietHours`). Unknown keys return 400 instead of being dropped silently, so the
  browser cannot believe it set credentials or eligibility. Field checks added in the data layer: recipient E.164 or
  null, brand colors `#RRGGBB`, currency 3 uppercase letters, organization text length caps. No route, type or
  response shape changed. Maricella: send only the documented editable fields.

- Node: the spec prefers Node 24 LTS. The shared dev machines run Node 20.x, so the workspace targets
  `node >=20.12` and pins `better-sqlite3@12` (v13 requires Node 22+). The Docker image uses Node 22.
  Switching everyone to Node 24 later only needs `better-sqlite3` re-evaluated.

## Platform note (Batch 5, Darren) — no public contract change

No DTO field, route, status, error code or env var changed. Clarifications and tightenings that UI/delivery owners should
know (details in `docs/runbook.md`):

1. `PATCH /v1/settings` rejects an enabled quiet-hours window with `start === end` (ambiguous), non-IANA zone names
   (`UTC+3`) and non-`HH:mm` times with 400 `VALIDATION_ERROR`. Previously equal times silently meant "never quiet".
2. `NotificationRecord.scheduledFor` of a queued record may move later at dispatch if quiet hours apply then.
3. A local date can have follow-up digests when a result arrives after a digest was claimed; a task revision is never in
   two notifications for one channel.
4. `blocked` + `lastError` prefix `POLICY_CHANGED:` and `failed` + prefix `DELIVERY_UNCERTAIN:` are the two new stable
   reasons (state names unchanged).
