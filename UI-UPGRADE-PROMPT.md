# SideNote — UX redesign brief

Paste this into Claude Code, or say: `read UI-UPGRADE-PROMPT.md and work
through it phase by phase, stopping after each phase for review`.

---

You are redesigning the user experience of SideNote, the drug-safety triage app
in this repository. Read `CLAUDE.md` first and treat it as binding. Read
`UI-AUDIT.md` for the journey-level findings this brief is built on.

This is **not** a visual refresh and not an engineering clean-up. The palette,
the type scale and the density are already right. What is wrong is the *route*
through the app: what it asks each user to decide, in what order, and what it
leaves them to work out alone. You are redesigning flow, navigation and
interaction. Where a screen needs restructuring, restructure it; where it only
needs restyling, leave it alone.

## The two users, and the jobs they came to do

Design every decision against these. If a change does not make one of these
sentences faster, calmer or harder to get wrong, do not make it.

**The reporter.** A patient, carer or clinician. Worried, possibly elderly,
possibly reading in a second language, most likely on a phone, and quite
possibly describing something frightening that is happening right now. Their
job: *"Something bad happened after a medicine. I want to tell someone, and I
want to know if it's normal."* They have no idea what pharmacovigilance is and
must never need to.

**The reviewer.** Works a shift, shares the role with colleagues, lives in this
screen for eight hours. Their loop is four steps: **what must I do first → is
this reaction already known → record the decision → next case.** The app today
supports step two well and the other three barely at all.

## Constraints — a change that breaks one of these is a regression

1. **No new dependency.** No component library, no icons package, no animation
   or drag library. Six runtime dependencies is a feature of this build.
2. **No new colour.** The six in `src/app/tokens.css` and the mixes declared
   there. `--signal` stays reserved for an expedited or overdue regulatory
   clock and nothing else, ever. Emphasis comes from weight, size, position and
   rule-weight, in that order, then `--steady`.
3. **No shadows, gradients or elevation.** `--radius-sharp` for rows and rails;
   `--radius-soft` (2px) is the ceiling for inputs, buttons and chips.
4. **Spacing on the 4px scale; type on the existing `--text-*` ramp.** Do not
   introduce a new size.
5. **Do not rewrite the public-facing copy.** It is the best thing in this
   build — "Write it however you like. There is no wrong way to do this." Match
   that register when you add text: plain, short, kind, no regulatory
   vocabulary on the reporter side, no marketing register anywhere. Never
   soften an honest degraded state into a friendly one.
6. **Do not weaken the honesty rules.** Non-negotiables 3–6 in `CLAUDE.md`
   govern the UI: no claim without its citation, no model determination, the
   three reading states kept visually distinct, verbatim spans only. Blurring
   "found nothing" into "could not read" is the worst bug this app can have.
7. **Server Components stay server components.** `queue/page.tsx` and
   `case/[id]/page.tsx` must not become client components. Filtering, keyboard
   handling and disclosure go in small `"use client"` leaves fed by
   already-computed props.
8. `npm run build` green after every phase (it chains eslint and vitest).
   Strict TypeScript, no `any`. New pure logic (filtering, sorting, matching,
   ordering) lives in `src/lib/` with a vitest test beside it.

## Method

One phase at a time. After each: run `npm run build`, then say in your own
words what changed, what you deliberately did not do, and anything in
`CLAUDE.md` you had to interpret. Wait for me before starting the next.

---

# Phase 1 — The navigation model

Everything else depends on this. Today one sidebar serves both audiences
permanently, so a patient filling in a form is looking at `Reviewer · Queue ·
Library`, and a reviewer's own identity is small grey text in a corner.

**1.1 Two chromes, one app.**

*Public chrome* — routes `/` and `/report/*`. No left rail. A slim header: the
SideNote wordmark on the left, `Reviewer sign-in →` as one quiet `--slate` link
on the right, and the training-demo banner beneath it. Content centred at the
existing reading measure. This is the whole navigation a reporter needs, and
removing the rail also fixes the phone layout for the journey most likely to
happen on a phone.

*Reviewer chrome* — routes `/queue`, `/case/*`, `/library`. Keep the left rail,
but it now holds reviewer things only: Queue, Library, a global jump-to-case
input, the signed-in reviewer's name with a sign-out affordance, and
`Public report form →` as a single quiet link at the bottom. Move the theme
switcher into that footer group and rebuild it as one compact segmented control
with a 24px minimum target height — right now it is the loudest control in the
navigation and it should be among the quietest.

Keep both areas reachable from either chrome — that is a deliberate choice in
`sidebar.tsx` and it is right — but make the area you are *in* dominant and the
other one a single way across.

**1.2 Make the rail responsive.** Below `lg`, the reviewer rail collapses to a
top bar (wordmark, current area, disclosure button) opening the same nav
full-width. Use `<details>`/`<summary>` or a small client component with
`aria-expanded`/`aria-controls`. Above `lg` it stays exactly as it is. Verify
at 375, 768, 1024, 1600.

**1.3 One front door per job on the landing page.** Today it offers two cards
and the rail immediately contradicts the choice by showing three reporter
options. Replace with:

- **"I want to report a side effect"** → `/report`. One door. The choice of
  chat versus form moves *inside* the flow (Phase 2).
- **"I am a safety reviewer"** → `/queue`.
- Below those, smaller and clearly a different job: **"I just want to know if
  something is normal"** → `/report/search`. It is a lookup, not a report, and
  presenting it as a peer of the two report methods is what makes the reporter
  choose a UI before they can speak.

**1.4 Jump to a case.** A reference input in the reviewer rail, focused with
`g` then `c` or simply `/`. Typing `SN-2026-000104` or `000104` goes straight
there. A colleague saying a case number over a call is a real event with no
current answer.

**1.5 Location and titles.** Give each route a real `generateMetadata` title —
`Queue · 5 on the clock — SideNote`, `SN-2026-000101 · 7d overdue — SideNote`,
`Report a side effect — SideNote`. Six open cases are currently
indistinguishable in the tab bar. Add a breadcrumb line on the case screen
(`Queue › SN-2026-000101`) so the reviewer knows where they are and how to get
back — and retire the label "Full view", which explains nothing.

---

# Phase 2 — The reporter's route

The single most valuable change in the app: today a frightened person's first
task is choosing between three menu items.

**2.1 One intake, two ways to answer it, no dead ends.**

`/report` becomes the only report entry. It opens with a short orientation
block — three lines, before any question:

- what happens to the report (a trained person reads every one; it goes to a
  safety reviewer; you do not need an account)
- how long it takes and that you can leave things blank
- **urgent help**: if this is happening now and it is serious, contact a doctor
  or your local emergency services — this form is not monitored in real time

That third line does not exist anywhere in the app today and it is the omission
a pharmacovigilance reviewer will notice in the first five seconds of the demo.
Put it on `/report`, `/report/chat` and `/report/search`, in `--ink` with a
`--slate` left rule. Quiet, permanent, above the first question.

Then the conversational intake by default, with a visible switch: **"Prefer to
see all the questions at once? Use the form →"**, and the reverse link on the
form. **The switch must carry the answers across in both directions.** Unify
`chat-state.ts` and `report-draft-store.ts` behind one draft store keyed to the
same schema, so a reporter five questions deep who finds the chat tiring does
not start again from nothing. Today choosing wrong is unrecoverable, and that
is the flow's worst failure.

**2.2 Stop asking people to type structured answers.**

The intake asks eight free-text turns, most of which are structured questions
in a conversational coat: age, male or female, how serious it was, your name,
how to reach you. Keep free text where it belongs — the narrative — and give
every other slot quick-answer controls under the question: buttons for sex,
a number field for age, the six seriousness questions as the plain yes/no set
the wizard already uses, and `I don't know` on every one of them.

This stays a scripted state machine, not a model. `conversation.ts`,
`NOTES.md` and `CLAUDE.md` are explicit that this surface must not become
something that asserts what a document says.

**2.3 Make progress legible.** Replace the "Still needed: the medicine, what
went wrong, their age, …" sentence with `Question 3 of 8` plus a ticked
checklist of the same slots. As written it only ever gets shorter, so a
reporter cannot tell two-done from six-done. Show it in both the chat and the
form.

**2.4 Show what is actually required, from the start.** The intro promises you
can leave anything blank; step 5 then blocks sending with a list of what is
missing. Both are true and the user meets them four minutes apart. Put a small
persistent checklist of the four things a report cannot go without — who it
happened to · the medicine · what went wrong · how to reach you — visible from
the first question, ticking as they are satisfied. Everything else stays
genuinely optional and should be labelled so.

**2.5 Reorder the wizard to match how people tell the story.**

Current: who this is about → what happened → hospital and emergencies → the
medicine → about you.

Change to:

1. **Who this is about** (unchanged)
2. **The medicine** — name, what it was for, dose. People lead with this when
   they tell the story out loud, and it is what everything else hangs off.
3. **What happened** — the narrative, when it started, how they are now, and
   the six seriousness questions folded in under *"How bad did it get?"*.
   Hospital *is* what happened; asking it as a separate step makes the user
   answer the same question twice in different words.
4. **Stopping and starting again** — the dechallenge/rechallenge sequence,
   explicitly marked optional with a *Skip this* control. It is the most
   confusing material in the form and currently sits buried inside the
   ten-question medicine step, where fatigue is highest.
5. **About you** (unchanged)

Replace the wrapping text step list with a 5-segment progress rule showing
done / current / remaining, keeping the step names as accessible text. Move the
explanation of a disabled `Next` next to the control, not below it.

**2.6 Keep the draft alive.** `sessionStorage` means one phone call loses a
five-minute form. Move to `localStorage` with a 24-hour expiry, say so in the
same plain voice ("Your answers are kept on this device for a day so you can
come back to them"), and give an explicit **Clear my answers** control. The
privacy instinct behind the current choice is right; the absence of a middle
option is not.

**2.7 Turn the confirmation into a next step.** Both confirmation screens are
well written and both dead-end. Add, under the reference number: *save or print
this page*; *check whether this reaction is already described* (linking to the
search with the medicine pre-filled — thematically the obvious next thing, and
it is one click away); and a plain sentence on what happens next and whether
anyone will be in touch.

**2.8 Escalate on a red-flag answer.** When a reporter answers yes to
life-threatening, hospitalisation or death, respond in place before the next
question: one line naming what they said and pointing at urgent help. Do not
block the flow, do not use `--signal`, do not diagnose. Say what is true.

---

# Phase 3 — The reviewer's shift

The queue must stop being a report and become a worklist.

**3.1 Open with a plan, not a census.** `QueuePage` already computes cases, on
the clock, overdue, sources disagree and not assessed — exactly the right five
questions — and renders them as numbers you cannot act on. Turn the row into
filters: click *Overdue* and the list shows the overdue ones. Add **Mine** and
**Unclaimed**. Filters combine with AND, live in the URL as search params (so
the server keeps doing the filtering and a reviewer can bookmark "overdue and
unclaimed"), and a `Clear` appears only when something is on. Each figure keeps
counting the whole queue, not the filtered subset — a filter that changes its
own label is unreadable.

Above them, one sentence in plain language: *"2 due today, 1 overdue, 4 nobody
has assessed."*

**3.2 Add search and sort.** One input above the list — `/` focuses, `Esc`
clears — matching reference, reaction, drug and reporter name. Sortable by
clock (default), received date, drug and status, with `aria-sort` and the sort
in the URL. Put the matcher in `src/lib/queue/` as a pure function with tests.

**3.3 Make the list scannable and use the screen.** Rows are 92px tall and the
page is capped at 900px, so at 1600px a third of the window is empty margin
while the drug and reaction text truncates. Raise the cap to match the case
page and rebuild the row as an aligned table — rail · clock · ref · reaction ·
drug · seriousness · listedness · status · age · owner — at roughly 36–40px.
Keep the existing card layout as the `compact` variant the case-page rail uses;
a table does not fit in 320px.

Two changes of emphasis in the row: show the age of a case (`22d`) beside the
received date so staleness needs no arithmetic, and promote **Sources disagree**
and **Incomplete — missing …** from the quietest text in the row to hairline
markers in the reaction cell. `CLAUDE.md` says a disagreement *is* the case;
today it renders smaller than the reference number.

**3.4 Support coming back.** Mark cases that arrived since the reviewer's last
visit, and say so in the plan sentence ("3 arrived overnight"). This screen
looks identical whether three cases came in or none.

**3.5 Keyboard.** `j`/`k` or arrows move the highlighted row, `Enter` opens,
`/` searches, `Esc` clears, `?` shows the shortcut sheet. Roving `tabindex` with
`aria-activedescendant`, no key capture while focus is in an input. For a tool
someone lives in eight hours a day this is the single loudest signal that it
was built for them.

**3.6 Empty states.** "No cases in the queue." and "No cases match these
filters." with the clear control, both inside the table frame.

---

# Phase 4 — The case screen: answer first, decide in place

Today the reviewer opens a case to answer one question — *is this reaction
already described?* — and that answer is the last thing on a 1400px page, split
into two stacked panels under a heading called "Evidence", below nine cells of
administrative metadata.

**4.1 Restructure the page in the reviewer's order.**

```
┌ sticky ──────────────────────────────────────────────────────────┐
│ Queue › SN-2026-000101        case 3 of 16      ‹ prev   next ›  │
│ liver failure, died · Hepalex          7d overdue · due 08-22    │
│ [ Claim this case ]  or  Held by Demo Reviewer since 14:02       │
└──────────────────────────────────────────────────────────────────┘

  IS IT ALREADY DESCRIBED?          ← the answer, first
  ┌ Company · CCDS v7.2 ─────────┬ Public · FDA label ─────────────┐
  │ describes transaminase rise, │ silent on hepatic failure       │
  │ not hepatic failure          │                                 │
  │ "Elevations in hepatic…"     │ "No cases of hepatic failure…"  │
  │ 4.8 Undesirable effects      │ 6 Adverse reactions             │
  │ ccds-7.2#41                  │ lbl-hepalex#18                  │
  └──────────────────────────────┴─────────────────────────────────┘
  ⚠ The two documents read differently — that is this case.

  YOUR RULING                       ← the decision, next
  listed ○ / unlisted ●   expected ○ / unexpected ●
  rationale […]
  → unlisted + serious = 15-day clock from 2026-08-07, due 2026-08-22
  [ Record ruling ]

  WHY THIS IS SERIOUS               ← the supporting evidence
  narrative with the flagged phrases marked, seriousness list beside it

  ▸ Case details   ▸ Reporter   ▸ History        ← collapsed by default
```

At `xl`, run this as three columns: queue rail | main column | a context rail
holding case facts, reporter, and the minimum-criteria checklist. Below `xl`,
the context rail becomes the collapsed sections shown above. Below `lg`, hide
the queue rail entirely — today it stacks *above* the case, so tapping a case
lands you on the list you just left with a thousand pixels to scroll — and
replace it with the compact `‹ prev · 3 of 16 · next ›` strip.

**4.2 Deliver the side-by-side promise.** Two columns at `xl`, company on the
left (it is usually updated first and the clock keys off it), aligned row for
row — stance, reading, passage, citation — so the eye compares across at a
fixed height instead of scrolling and remembering.

**4.3 One degraded notice, not two.** When no model is configured, both panels
currently print the same three-line explanation and the same reason string.
Hoist it to a single notice above the pair and leave each panel a one-line
`not read` marker. Keep the three reading states rigorously distinct.

**4.4 Make the disagreement the headline.** When the two sources diverge, it
belongs directly under the pair in `--ink` at `--text-base`, not as a note
below the header. It is the most interesting thing that can happen on this
screen.

**4.5 Give the screen a primary action.** Replace the read-only ruling
paragraph with a real form — listedness, expectedness, rationale — disabled
until the case is claimed by the current reviewer and the rationale is
non-empty, with the consequence shown live beside it before they commit
("unlisted + serious → 15-day clock from 2026-08-07, due 2026-08-22"). Same zod
schema both sides. **Assess this case** stays, but demoted to what it is: a
supporting step that fetches passages, not the main event.

**4.6 Answer "is someone else on this?"** — the question the whole project
exists to resolve, and today the interface never asks it. Unclaimed shows
`Claim this case`. Claimed by me shows `You have this case since 14:02` with
`Release`. Claimed by someone else shows who and since when, with every write
control disabled *and that as the stated reason* — the pattern the existing
Assess control already gets right. When a claim loses the race, render it in
place: who holds it, since when, and what this reviewer can still do (read
everything, rule nothing). That screen is what you will demo; make it look
deliberate rather than thrown.

Wire it to a server action against the existing store now, shaped so the
Durable Object drops in behind it later.

**4.7 Close the loop with `next`.** After recording a ruling, offer the next
case in the current queue order and filters, bound to `]`. A reviewer working a
shift should never have to go back to the list.

**4.8 Make the narrative marks visible.** The phrases behind each seriousness
flag are marked with a 6% ink wash and a dotted underline — effectively
invisible, for a requirement `CLAUDE.md` states outright. Keep the offset-based
marking exactly as it is, including dropping a span whose quote no longer
matches, and strengthen it: a 2px `--slate` underline with `--row-active` fill,
a small index tying each mark to its seriousness row, hover and focus linking
in both directions, and a one-line legend saying what the marks are.

**4.9 History.** Non-negotiable #9 emits `[AUDIT]` lines for every mutation and
no screen shows one. A collapsed reverse-chronological list at the bottom —
timestamp, actor, action, outcome, and for an AI result the model and gateway
request id. Cheapest credibility win in the build, and exactly what a
pharmacovigilance reviewer expects to find.

---

# Phase 5 — The library, joined up

Today it is a shelf you cannot look inside, and it connects to the queue in
neither direction.

**5.1 Documents open.** A detail route listing the chunks — ordinal, section,
first line, chunk id — plus when it was ingested and by whom. The ingestion
pipeline is a headline capability of this build and it is currently summarised
as a number that leads nowhere.

**5.2 Coverage per drug.** A view answering "what do we hold for Hepalex?" —
CCDS v7.2 held, FDA label held — and the inverse on the case screen: a line
under the evidence pair saying which documents were in scope for this search.
A case for a drug with no company document currently looks exactly like one
with a document, right up until the search returns nothing.

**5.3 Close the upload loop.** After a document is ingested, say what it
affects: "3 cases for Hepalex can now be re-assessed", linking to them
filtered. Right now uploading has no visible consequence anywhere in the
reviewer's work.

**5.4 Status and failure on every document** — pending, embedded, failed, and
the "needs OCR" rejection the spec requires, with the reason on screen.

**5.5 Search and a company/public filter**, and move the drop zone below the
list or behind an `Add a document` control. The library is the content; the
uploader is an action.

---

# Acceptance — test these as tasks, not as code

- A reporter on a 375px phone goes from the landing page to a submitted report
  in under three minutes, never scrolls sideways, and is told at the start what
  happens to the report and what to do if it is urgent.
- A reporter five questions into the chat switches to the form and finds their
  answers already there.
- At any moment in either intake, the reporter can see how many questions
  remain and which four things are genuinely required.
- A reviewer landing on the queue can, in one click, see only the overdue
  cases; in one more, only the ones nobody has claimed.
- A reviewer opens a case and can state what both documents say without
  scrolling.
- A reviewer can claim a case, record a ruling, see the deadline that ruling
  implies *before* committing to it, and move to the next case without
  returning to the list.
- A second reviewer opening a claimed case is told who holds it, since when,
  and what they can still do.
- Every screen works at 375px and uses more than 70% of the window at 1600px.
- Queue and case are fully operable from the keyboard, with a visible focus
  ring at every stop.
- The three reading states stay visually distinct; no claim renders without its
  citation; no model output writes a determination.
- Light and dark checked on every screen touched; `npm run build` green.

## Order, if time is short

Phase 1, then 4, then 2, then 3. Navigation first because everything else sits
on it. The case screen next because the reviewer's decision loop is the
product, and right now the screen has no primary action. Then the reporter's
route, because one unrecoverable choice at the front door is the worst
individual failure in the app. Then the queue, because filters are what turn a
list into a worklist.

## Also worth fixing while you are in there

Small, unrelated to flow, cheap: the sidebar emits `<h2>` before the page
`<h1>`; the demo banner is a bare `<div>` with no `<header>` landmark and is
the quietest text on the page; the queue's stat row wraps at ~800px; the case
rail scrolls away instead of sticking; the facts grid stops at four columns and
wraps "liver failure, died" inside a narrow cell in a wide row.
