# Requirements: Review engine (Task 2)

Three pure functions in `packages/core/src/`: `nextReview` (SM-2), `gateDecision` (learning gate), `scoreQuiz` (quiz scoring). No I/O, no clock: `today` is always passed in.

## Glossary
- **Card**: `{ ease, interval, repetitions, dueAt }`. A new card is `{ ease: 2.5, interval: 0, repetitions: 0, dueAt: today }`.
- **Quality (q)**: integer 0..5 rating of one review.
- **ISO date**: a real calendar date written `YYYY-MM-DD`.

## 1. `nextReview(card, quality, today)`
1.1 THE SYSTEM SHALL return a new card and never mutate the input card.
1.2 WHEN q < 3, THE SYSTEM SHALL set repetitions to 0 and interval to 1.
1.3 WHEN q >= 3, THE SYSTEM SHALL add 1 to repetitions.
1.4 WHEN q >= 3 and the new repetitions is 1, THE SYSTEM SHALL set interval to 1.
1.5 WHEN q >= 3 and the new repetitions is 2, THE SYSTEM SHALL set interval to 6.
1.6 WHEN q >= 3 and the new repetitions is 3 or more, THE SYSTEM SHALL set interval to max(1, min(365, round(old interval * old ease))), so a card is never due again on the same day.
1.7 THE SYSTEM SHALL set ease to max(1.3, ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)), rounded to 2 decimal places, for every q, including q < 3.
1.13 THE SYSTEM SHALL never return an interval greater than 365 days (`MAX_INTERVAL_DAYS`).
1.8 THE SYSTEM SHALL set dueAt to `today` plus `interval` calendar days, as an ISO date.
1.9 IF q is not an integer in 0..5, THEN THE SYSTEM SHALL throw a RangeError.
1.10 IF `today` or `card.dueAt` is not a valid ISO date (e.g. `2026-02-30`), THEN THE SYSTEM SHALL throw a RangeError.
1.11 IF ease is not a finite number >= 1.3, or interval or repetitions is not a non-negative integer, THEN THE SYSTEM SHALL throw a RangeError.
1.12 THE SYSTEM SHALL provide `newCard(today)` that returns the new-card values from the glossary.

## 2. `gateDecision(score, passMark = 0.7, mode = "strict")`
2.1 THE SYSTEM SHALL return `{ allowed, understood, reason }`.
2.2 THE SYSTEM SHALL set understood to true only WHEN score >= passMark, in every mode.
2.3 WHILE mode is `off`, THE SYSTEM SHALL always set allowed to true.
2.4 WHILE mode is `soft`, THE SYSTEM SHALL always set allowed to true.
2.5 WHILE mode is `strict`, THE SYSTEM SHALL set allowed to true only WHEN score >= passMark.
2.6 THE SYSTEM SHALL set reason to one code: `passed`, `gate-off`, `soft-below`, or `strict-below` (see design).
2.7 IF score or passMark is not a finite number in [0, 1], THEN THE SYSTEM SHALL throw a RangeError.
2.8 IF mode is not `off`, `soft` or `strict`, THEN THE SYSTEM SHALL throw a RangeError.

## 3. `scoreQuiz(questions, answers)`
3.1 THE SYSTEM SHALL return `{ score, missedConcepts, answered, total }` with score in [0, 1].
3.2 THE SYSTEM SHALL weight every question equally: score = sum of question points / number of questions, rounded to 4 decimal places (so float sums like 0.7000000000000001 compare correctly with the pass mark).
3.3 WHEN a choice question (`mcq` or `what-if`) is answered with its correct index, THE SYSTEM SHALL give 1 point, otherwise 0.
3.4 WHEN an `explain` question has a graded score s, THE SYSTEM SHALL give s points (partial credit).
3.5 WHEN a question has no answer, THE SYSTEM SHALL give 0 points and count it as missed.
3.6 THE SYSTEM SHALL count a choice question as missed when it earns 0 points, and an `explain` question as missed when s < 0.5.
3.7 THE SYSTEM SHALL list each missed concept once, in question order.
3.8 WHEN the quiz has no questions, THE SYSTEM SHALL return `{ score: 0, missedConcepts: [], answered: 0, total: 0 }`.
3.9 IF an answer refers to an unknown question id, or two answers share an id, THEN THE SYSTEM SHALL throw a RangeError.
3.10 IF two questions share an id, THEN THE SYSTEM SHALL throw a RangeError.
3.11 IF a choice answer index is not an integer in range of the question's choices, or an answer's kind does not match its question, THEN THE SYSTEM SHALL throw a RangeError.
3.12 IF a graded explain score is not a finite number in [0, 1], THEN THE SYSTEM SHALL throw a RangeError.
3.13 IF a choice question has fewer than 2 choices, or its correct `answerIndex` is not an integer in range of its choices, THEN THE SYSTEM SHALL throw a RangeError.
3.14 WHEN the quiz has no questions, THE SYSTEM SHALL ignore any answers and return the empty result of 3.8 (documented choice; see open question 13).

## 4. Module layout
4.1 THE SYSTEM SHALL put each function in its own module (`sm2.ts`, `gate.ts`, `scoring.ts`) with a `*.test.ts` beside it, and re-export all public names from `packages/core/src/index.ts` as named exports.
4.2 THE SYSTEM SHALL not read the clock, files, network or environment in these modules.

## Open questions (defaults chosen)
1. **Interval ease:** step 1.6 uses the ease from BEFORE this review, as in classic SM-2 (the rating judges the last interval; the new ease applies from the next one).
2. **Ease storage:** DECIDED (Vedant): round ease to 2 decimals so `state.json` and the UI show `2.38`, not `2.3800000000000003`. Tests compare ease exactly with `toBe`.
3. **New card:** added a tiny `newCard(today)` helper (interval 0, due today) so Task 7 has one place to create cards.
4. **Default gate mode:** DECIDED (Vedant): `strict`, because "you can't move on until you understand it" is the core pitch. Users can switch to `soft` or `off` in `.seance/config.json`. Default pass mark 0.7.
5. **Off mode and understood:** `understood` still reflects score >= passMark in `off` mode, so Task 7 can still record progress.
6. **Explain partial credit:** the explain question adds its raw 0..1 score; it is "missed" when < 0.5.
7. **Empty quiz:** returns score 0 with `total: 0`; callers (Task 7) should skip the gate when `total` is 0 instead of treating it as a fail.
8. **Errors:** all invalid input throws `RangeError` with a message naming the field. No custom error class.
9. **Validation:** hand-written checks, no zod in `core` for these three functions (inputs come from our own code; zod is used at trust boundaries in Tasks 4 and 8).
10. **Quiz size:** `scoreQuiz` accepts any number of questions, not only 5; Task 4 enforces the 3 + 1 + 1 format.
11. **Maximum interval:** DECIDED: cap at 365 days (req 1.13), so every card comes back at least once a year. Classic SM-2 has no cap.
13. **Answers on an empty quiz:** ignored rather than rejected (3.14). An empty quiz means there was nothing to test, so there is nothing to validate against. Added after review.
14. **Minimum interval of 1 day:** added after review. A card with interval 0 and 2+ repetitions used to stay due today forever.
12. **Why SM-2 and not FSRS:** SM-2 (1987) is about 15 lines and a beginner can explain every line, which fits Seance's message. FSRS (2022, used by Anki) predicts better but needs 17+ tuned parameters. Revisit after the hackathon.
