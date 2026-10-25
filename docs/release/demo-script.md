# Judge demo script (2 to 3 minutes)

Owner: Maricella. Status: **script and tooling tested; both team rehearsals NOT RUN** (they need Darren and Joanne on the frozen commit). The measured timings below are from a solo scripted browser run, not a human rehearsal.

## What the demo is, and what it is not (say this out loud, briefly)

- The request arrives through the **demo trigger** (an injected fictional email through the same intake path Gmail uses). **Live Gmail was not used.** The header badge reads "Gmail disconnected".
- The content is made by **fixture intelligence** (real extraction, real calculations, real files, no live AI model). The task badge reads "Fixture output".
- Notifications are the **simulated outbox**: shown, not sent to any phone or inbox. WhatsApp is not live.
- "Overnight" is **time-compressed**. The worker is a separate always-running process; the browser is not needed for work to finish.
- **Mark reviewed** records acceptance. It sends nothing to anyone.

## Start state (do this before the judges arrive)

1. Candidate: record the exact commit in `docs/release/candidate.md` (Darren). Use only that commit.
2. `pnpm install && pnpm setup:local && pnpm db:migrate && pnpm db:seed`, then `pnpm dev` (web :3000, API, worker). If port 4000 is taken, set `API_PORT` and `API_ORIGIN` to the same port (`pnpm check:ready` verifies).
3. Open http://localhost:3000, sign in once (password is `APP_PASSWORD` in `.env`; never put it on a slide or in the README), leave the Work queue open.
4. Header should show: **Fixture mode**, **Gmail disconnected**, **Notifications: outbox (simulated)**, and the worker banner must **not** be showing.
5. Fallback task: run "Run demo → Proposal + kickoff deck" once beforehand so a prepared, labeled result exists. It is shown only as "a prepared example from earlier", never as the task that just finished.

## Roles (agree in the rehearsal)

| Role | Person | Job |
|---|---|---|
| Driver (screen) | Maricella | clicks, scrolls, downloads |
| AI and output voice | Joanne | explains grounding, numbers, files |
| Backend and fallback | Darren | worker, schedule, what is simulated, answers questions |

## Run of show

| Time | Say / do | Proof on screen |
|---|---|---|
| 0:00 to 0:20 | "A client emails a request. AfterHours is already authorized to act on mail from approved senders, so nobody types a prompt." Show Settings → Automation: automation on, prepare automatically, approved sender list. | Approved senders list; Gmail disconnected (disclosed: demo trigger) |
| 0:20 to 0:45 | Work queue → **Run demo → Proposal + kickoff deck**. Open the task: request, attachment, the two timestamps ("Email sent" vs "Entered the system"). Watch the Activity log move; it is ready in seconds. | Real persisted events; no percentage; badges Demo email + Fixture output |
| 0:45 to 1:25 | Open **Content preview**: proposal, then the five-slide deck. Go to slide 4 (fee): **Strategy fee: USD 6,000**. Open a source chip: show title, locator, and the "assumption" blocks. | Fee and scope; assumptions labelled; sources inspectable |
| 1:25 to 1:45 | **Download** both files. Open the proposal (Word/Pages) and the deck (PowerPoint/Keynote) to show they are real. | Real DOCX (about 10 KB) and 5-slide PPTX |
| 1:45 to 2:00 | **Mark reviewed**, then refresh the page. "This records my acceptance. Nothing was sent to the client." | Status stays "Marked reviewed" after reload |
| 2:00 to 2:25 | Run demo → **Sales CSV report + slides**. Show chart and table: revenue 12,000 to 15,000, +3,000, +25%. Point at the Limitations block: it says the data does not establish causality. | Numbers computed in code; chart equals table; no invented cause |
| 2:25 to 2:50 | Notifications page. "Each ready result creates a notification. Here it is simulated, shown exactly as it would be sent. With quiet hours on, files are prepared immediately and the message waits for the morning; the planned time is shown in the workspace timezone." | "Simulated (outbox)" badge; "Currently planned for"; no "Delivered" anywhere |
| 2:50 to 3:00 | Close: "A request became a reviewed draft and real files without anyone opening the email." | |

## Measured timing (solo scripted run, same candidate; NOT a team rehearsal)

Automated browser steps on the integrated candidate with the real API, worker and engine (fixture mode), dev server warmed first:

| Step | Elapsed from start |
|---|---|
| Task page open after clicking Run demo | 0.7 s |
| Ready for review | 3.0 s |
| Proposal and deck previews, source chip, both downloads | 3.3 to 3.8 s |
| Marked reviewed, still reviewed after refresh | 3.9 to 4.3 s |
| Report ready | 7.1 s |
| Notifications showing simulated outbox | 7.5 s |

Machine time is about 8 seconds; the 2 to 3 minute length comes from speaking. **Human rehearsal timings: NOT RUN.** Record them here after the two rehearsals:

| Rehearsal | Date | Commit | Duration | First issue | Owner / fix / retest | Fallback used |
|---|---|---|---|---|---|---|
| 1 | NOT RUN | | | | | |
| 2 | NOT RUN | | | | | |

## Fallbacks (each one is disclosed when used)

| If | Do | Disclosure line |
|---|---|---|
| Live Gmail is unavailable (the expected case) | Use Run demo. Fresh replay key every click; no hidden DB edits. | "This email is injected through the demo trigger; it uses the same intake path as Gmail." |
| A task does not finish in a few seconds | Check the worker banner. Restart `pnpm dev:worker`; the queued task resumes. Otherwise open the prepared example. | "This is a prepared result from earlier, not the task we just started." |
| Model credentials or provider down | Not used: the demo runs on fixture intelligence. | "Content is made by fixture intelligence, not a live model." |
| WhatsApp unavailable | Outbox is the default. | "Simulated. Nothing is sent to a phone." |
| Browser/network trouble | Reload; the work is server-side. | |

## Claims to avoid

No time-saved or accuracy figures, no market claims, no "delivered" for the outbox or for provider acceptance, no "live inbox" wording for the demo trigger, no "verified" badge language (source chips show where a statement came from, not that it is proven). One good sample is not a benchmark.
