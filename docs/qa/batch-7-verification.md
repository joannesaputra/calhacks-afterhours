# Batch 7 verification — system QA on the integration candidate

Optional QA run by Darren in a separate worktree. It is not a fourth team member; the "Eden" label in the Batch 3 QA files is historical.
`docs/batches/batch-3/eden.md` is not carried onto this branch (it stays on the local `qa/system-batch3` branch).

**Candidate under test:** `ae422e6` on `integration/batch7` (merge of `platform-batch6` @ `fef9396` and Joanne's `engine-batch6` @ `b313998`). Production code was not touched by this branch.
**Harness branch:** `qa/system-batch7` (parent `ae422e6`; two cherry-picks of the Batch 3 harness commits `74935bb`, `1cee0ca`, then one expectation-reconciliation commit). It adds only `tests/system/**` and `docs/qa/**`.
**Modes:** `GENERATION_MODE=fixture`, demo ingestion, outbox notifications. No Gmail, model call, Twilio or external message.
**Command:** `QA_REPO_ROOT=<candidate tree> node --import tsx --test tests/system/*.test.mjs` (see `docs/qa/README.md`).

## Results on this candidate

| Run | Exit | Result |
|---|---|---|
| Harness as inherited from Batch 3, unchanged expectations | 1 | 53 tests, 49 pass, 4 fail (A3, A4, H5, H6) |
| Harness after the four expectation changes below | 0 | 53 tests, 53 pass, 0 fail |

The 53/53 is not a new accuracy claim: four assertions were rewritten (below) and the rest were not changed. Earlier scores were 32/53 (Batch 3 candidate `4e1b5ae`), 44/53 (Batch 5 integration) and 50/53 (Batch 6 `0e8395e`); they describe other code.

## Expectation changes (each triaged against the contract and the source inputs)

| Test | Old expectation | Observed on the candidate | Verdict | Change |
|---|---|---|---|---|
| A3 | payment line contains "Unknown" or "confirm" | "Payment milestones — Not stated in the sources; to be agreed" | Stale wording. The unknown is flagged, not invented. | regex also accepts "not stated" and "to be agreed" |
| A4 | preview contains "October 26-November 22, 2026" | "Starts October 26, 2026; 4 calendar weeks"; the draft deadline "Monday, October 26, 2026 at 9:00 AM PDT" is a separate row | Stale expectation. The email says "start October 26 and run for four weeks"; no end date is stated, and the earlier string was a derived interval. | requires "October 26, 2026" and "4 calendar weeks" instead |
| H5 | growth from a zero base says "zero denominator", "unknown" or "undefined" | channel Change cell "Not computable" | Stale wording; the value is not a number and no Infinity/NaN appears. | regex also accepts "not computable" |
| H6 | table row "2026-02 $15,000 0 Unknown" | "February 2026 $15,000 0 unknown (no orders)" | Stale month label and capitalization. AOV is unknown, not $0. | row regex accepts the label and case |

The negative assertions in H6, C4, C5 (no "orders increased" to 0, no "average order value remained $100" when it did not) are unchanged and pass.

## Previously reported failures

| ID | Status on `ae422e6` | Note |
|---|---|---|
| DEF-2 (C4, C5, C6, H6) | PASS | Joanne's `engine-batch5/6` content derives the narrative from computed metrics. Darren's earlier commit `68ea1ec` is superseded, not combined. |
| DEF-3 (D7) | PASS | no "four-week" next to a three-week answer |
| DEF-4 (N3.x grid) | PASS | fixed layout, every `gridCol` >= 500 and the table fits the page |
| A4 | PASS after the expectation change above | |
| A5 | PASS | every non-null quote appears in its source; null quotes are allowed by the contract |
| I1 | PASS | an injection-only brief does not produce a ready proposal (fails closed or asks); no leak of the injected text |

## Not covered by this suite

Browser/UI (the UI was exercised separately by hand, see `docs/batches/batch-7/integration.md`), Word rendering, live Gmail/model/WhatsApp, Docker, remote host, overnight run.
