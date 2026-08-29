# SideNote — UX audit

Walked the app as each of its two users rather than as its developer: a
frightened person trying to report a side effect, and a reviewer working a
shift. Findings are grouped by the journey they break, and each one names what
the user was trying to do at the moment it broke.

Method: every route driven in the browser at 1600 / 800 / 375px in light and
dark, then the flow code read end to end (`wizard.tsx`, `chat-panel.tsx`,
`conversation.ts`, `search/page.tsx`, `case/[id]/page.tsx`, `case-list.tsx`).

---

## What is already good, and should not be touched

Naming these first because they are the parts most likely to be destroyed by a
redesign, and they are the reason this app reads as serious.

- **The copy is genuinely excellent for its audience.** "Write it however you
  like. There is no wrong way to do this." "A few words is fine. For example, a
  rash on both arms." Pronouns adapt to whether it happened to you or someone
  else. Nothing asks a member of the public to classify anything in regulatory
  language. This is better public-health writing than most real portals have.
- **The confirmation screens already exist and are well judged** — reference
  number in mono at figure size, "please write this down or take a picture of
  it", and honesty about the demo link.
- **The three-state honesty is everywhere and it is rare.** "Nothing found",
  "could not summarise", and "no label to search" are kept apart on the public
  search, in the chat verdict, and in the reviewer's evidence panels. Almost
  nothing in this category gets that right.
- **Progressive disclosure in the wizard** — questions appear as earlier ones
  are answered, so step 1 is one question, not eight.
- **Small interaction decisions that were clearly earned the hard way**: the
  Send button beside the box rather than under it; the scroll anchor after the
  form so the new question and the reply box arrive together; the wizard's step
  held in storage rather than the URL so Back does not mean "lose my work";
  focus moved to the step heading on advance.

The problems below are almost all **structural** — what the app asks the user
to decide, in what order, and what it leaves them to work out for themselves.

---

## Journey A — Someone wants to report a side effect

The person here is worried, possibly elderly, possibly reading in a second
language, and most likely on a phone.

### A1. Three front doors and no help choosing (the biggest reporter problem)

The rail offers **Report by chat**, **Search known effects** and **Report by
form** as three equal peers. Two of them are the same job done two ways; the
third is a completely different job. Before a worried person can say anything
at all, they have to make a product-architecture decision on our behalf.

The landing page quietly picks for them — "Start a report →" goes to the chat —
and then the menu on the left immediately undermines that choice by showing two
alternatives. The first thing this app asks a frightened user to do is choose a
UI.

### A2. Choosing wrong is unrecoverable

Start the chat, get five questions in, find the typing tiring, and the only
escape is the form — which starts empty. The two intakes share a schema and
share nothing else. No draft crosses over in either direction.

### A3. The chat is harder work than the form for most of what it asks

Eight free-text turns, of which the majority are structured questions wearing a
conversational coat: age, male or female, how serious it was, your name, how to
reach you. The form asks the seriousness question as six plain yes/no questions
("Did they go to hospital?"); the chat asks the user to compose a sentence
about it. Free text is the right instrument for the narrative and the wrong one
for a sex field.

### A4. The chat never says how long this will take

The form promises "about five minutes… five short steps". The chat opens with a
question and no horizon at all. The only progress signal is the "Still needed:
the medicine, what went wrong, their age, …" line, which is a checklist
rendered as a comma sentence — and because it only ever gets shorter, you
cannot tell "two done" from "six done" at a glance.

### A5. Nothing tells the reporter what happens to their report until after they send it

Before sending, they are told it takes five minutes and needs no account. They
are not told who reads it, how soon, whether anyone will come back to them,
whether they can add to it later, or what happens to their name and phone
number. All of that arrives *after* submission, which is the one moment it can
no longer affect their decision to trust the form.

### A6. There is no safety guidance at the point of fear

Nothing on any reporting surface says what to do if this is happening right
now. Someone typing "swelling of lips and tongue" — a real seeded case — is
describing anaphylaxis into a form that answers with the next intake question.
The tool's job is not clinical triage, but silence here is a design decision
and it is the wrong one. Every real adverse-event portal carries a line about
urgent help, above the form. This is also the omission a pharmacovigilance
reviewer will notice within five seconds of seeing the demo.

### A7. "Leave anything blank" is contradicted five steps later

The intro says you can leave anything blank. Step 5 then blocks sending with a
list of what is missing. Both statements are true — four things really are
required — but the user meets the promise at minute zero and the contradiction
at minute four. What is actually required is never visible while they work.

### A8. The wizard's order does not match how people tell the story

Steps run: who this is about → what happened → hospital and emergencies → the
medicine → about you. Two problems. Hospital *is* what happened, so splitting it
into its own step makes the user answer the same question twice in different
words. And the medicine — the thing people lead with when they tell this story
out loud, "I took X and then Y happened" — comes fourth, after the longest
stretch of event questions.

Worse, step 4 is the heaviest step in the form: ten questions including the
dechallenge/rechallenge sequence (did you stop it, did it get better, did you
start again, did it come back). That is the most confusing material in the
whole flow and it sits where fatigue is highest, with nothing marking it
optional.

### A9. A closed tab loses the report

Answers live in `sessionStorage`; the page says so plainly. On a phone, a
five-minute form and one incoming call is a lost report. The privacy instinct
behind the choice is right; the absence of any middle option is not.

### A10. The confirmation is a dead end

Reference number, then "Report something else". Not offered: save or print
this, check whether this reaction is already known (the search tool is one
click away and thematically the obvious next step), add more detail later, or
tell us about a different medicine for the same person.

### A11. A member of the public is looking at the reviewer's navigation the whole time

`Reviewer · Queue · Library` sits in the rail while a patient fills in a form,
and both links work. It is defensible in a demo and it still undercuts the "no
account needed, this is your form" framing, because the user can see they are
inside somebody's internal tool.

---

## Journey B — A reviewer works a shift

The reviewer's loop is: *what must I do first → is this one already known →
record the decision → next*. The app supports the middle step well and the
other three barely at all.

### B1. The queue says what is there; it does not say what to do now

Five figures across the top — cases, on the clock, overdue, sources disagree,
not assessed — and then a list. Those are exactly the right five questions, and
every one of them is rendered as a number you cannot act on. Overdue says 1 and
does not tell you which, and clicking it does nothing.

There is no filter, no search, no "mine", no "unclaimed", no "arrived since
yesterday". A queue you can only read is a report, not a worklist.

### B2. There is no such thing as a work session

The data has a status vocabulary — received, in review, assessed, closed — and
the UI never lets a reviewer move a case through it. Nothing records "I am on
this one". So a reviewer cannot pick up where they left off, cannot tell what
they already looked at, and cannot hand over.

### B3. The case screen has no primary action

You read about 1400px of case and the page ends with a paragraph explaining
that ruling arrives in a later cluster. The only live control is **Assess this
case**, which triggers a document search — a *supporting* step — and it is
presented as the main event. Any triage screen should answer "what am I
supposed to do here" in its first hundred pixels.

### B4. No way back, no way forward, no sense of position

Open a case and there is no Back to queue beyond the rail, no next case, no
"3 of 16", no keyboard path. Working sixteen cases means sixteen round trips
through the list.

### B5. The one question the reviewer came for is a thousand pixels down

The case opens with drug, substance, reaction, coded-as, patient, day 0,
origin, outcome, governed-by — nine cells of administrative metadata — then the
narrative, then the reporter, then seriousness and validity, and only then, far
below, the two documents. But the reviewer opened this case to answer one
question: *is this reaction already described?* The answer to it is the last
thing on the screen.

### B6. And when they get there, the two sources are stacked, not compared

`CLAUDE.md` says the app "shows both side by side with citations"; the landing
page repeats it to the user. The implementation renders the company document
above the FDA label in a single column, so the comparison the whole product is
built around has to be done from memory by scrolling.

### B7. "Sources disagree" is described as the headline and rendered as a footnote

In the queue it is a plain 12px paragraph at the bottom of a row, quieter than
the case reference above it. On the case screen it is a bordered note below the
header. `CLAUDE.md` is explicit that when the two documents disagree, *that is
the case*.

### B8. Nothing tells a reviewer whether anyone else is on this case

`CLAUDE.md` says many people share the reviewer role and that two of them
opening the same case is the conflict the app exists to resolve. On screen,
that conflict is one sentence of body text. A reviewer's real first question
when opening a case — "is someone already doing this?" — has no answer anywhere
in the interface.

### B9. Returning is unsupported

No "new since your last visit", no unread marker, no arrival counts. This is a
screen people come back to every morning, and it looks identical whether three
cases arrived overnight or none.

### B10. The Library is a shelf you cannot look inside

Documents do not open. You cannot see the chunks, cannot tell when something
was ingested, cannot tell whether it failed. "5 chunks" is the only number on
the page and it leads nowhere — for a build whose ingestion pipeline is a
headline capability, that is the wrong thing to hide.

### B11. Nothing connects documents to cases, in either direction

A reviewer cannot ask "do we even hold a CCDS for Pulmoxa?" — so a case for a
drug with no company document looks exactly like a case for a drug with one,
right up until the search returns nothing. And after uploading a document,
nothing says which queued cases it now affects. Both directions of that link
are missing, and both are one-line answers the data already supports.

### B12. Prominence is inverted in the rail

The loudest control in the navigation is the light/dark switcher — three
buttons, always visible. The reviewer's own identity appears once, as small
grey text in the corner of the queue. There is no sign-in, sign-out, or "who am
I" anywhere.

### B13. No global way to reach a specific case

A colleague says "look at SN-2026-000104". There is nowhere to type it.

---

## Cross-cutting

### C1. One menu serving two audiences, permanently

This is the app's biggest information-architecture decision and it currently
optimises for demonstrating both sides at once, at some cost to each. The fix
is not to hide either area — it is to make the area you are *in* dominant and
the other one a single quiet way across.

### C2. Mobile is broken, and it is the reporter's journey that is on a phone

The rail is a fixed 236px at every width, so at 375px the content column gets
about 130px and the page scrolls sideways. Separately, below 1024px the case
screen stacks the entire sixteen-row queue *above* the case, so tapping a case
lands you on the list you just left and asks you to scroll a thousand pixels.

### C3. Wide screens are mostly margin

The queue is capped at 900px and centred: at 1600px, 29% of the window is empty
while the reaction and drug text truncates inside the column.

### C4. No ambient system state

Whether a model is configured, whether the label service is reachable, when the
corpus last changed. The case screen explains this beautifully once you are
deep inside it ("No model is configured, so the passages can be retrieved but
not read"). Nowhere else does.

### C5. Small things that cost trust

- The "not a validated system" banner is the quietest text on the page.
- "Full view" is an opaque label for "back to the queue".
- Every tab is titled "SideNote — drug safety case triage", so six open cases
  are indistinguishable.
- The sidebar emits `<h2>` before the page's `<h1>`.
- Theme buttons are 22px tall, under any reasonable touch target.
- No designed empty state for a queue with nothing in it.

---

## Corrections to the previous audit

Three things I called missing are present, and the earlier pass was wrong
about them:

- **The chat does keep a transcript**, with citations rendered inline, and it
  ends with a reference number and a link to the reviewer view.
- **The wizard has a full confirmation screen** — reference number, "a trained
  person reads every report", and a Report something else control.
- **The public search has designed result, nothing-found and unavailable
  states**, each with careful copy, plus cross-links back into reporting
  ("Finding it here does not mean it does not matter").

The problem on those surfaces is not missing states. It is that the *route*
through them was never designed.
