# Tasks: Review engine (Task 2)

Run `npm run test:core` after every step; it must pass before the next one. No new dependencies.

- [x] 1. SM-2 types, `newCard` and date helpers
  - Create `packages/core/src/sm2.ts` with `Quality`, `Card`, `newCard`, private `parseIsoDate` / `addDays` (UTC).
  - In `sm2.test.ts`: `newCard("2026-11-27")` values; invalid dates (`2026-02-30`, `27-11-2026`) throw RangeError.
  - _Requirements: 1.10, 1.12, 4.2_

- [x] 2. `nextReview`
  - Implement validation, ease update (rounded to 2 decimals), interval/repetitions rules (old ease for interval, capped at `MAX_INTERVAL_DAYS = 365`), dueAt.
  - Unit tests: demo sequence E1 table, the "old ease" example, the 365-day cap example, invalid quality and card fields.
  - _Requirements: 1.1-1.11, 1.13_

- [x] 3. SM-2 properties
  - Add fast-check properties P1-P6 and P4a from design.md to `sm2.test.ts`.
  - _Requirements: 1.1, 1.2-1.9, 1.13_

- [x] 4. `gateDecision`
  - Create `gate.ts` with `GateMode`, `GateReason`, `GateResult`, `DEFAULT_PASS_MARK`, defaults `passMark = 0.7`, `mode = "strict"`.
  - `gate.test.ts`: examples E2 and properties P10-P13; invalid mode throws.
  - _Requirements: 2.1-2.8_

- [x] 5. `scoreQuiz`
  - Create `scoring.ts` with `QuizQuestion`, `QuizAnswer`, `QuizResult`, `EXPLAIN_MISS_BELOW`.
  - `scoring.test.ts`: example E3, empty quiz, every invalid-input case in 3.9-3.12.
  - _Requirements: 3.1-3.12_

- [x] 6. Scoring properties
  - Add the quiz generator and properties P7-P9 to `scoring.test.ts`.
  - _Requirements: 3.1, 3.3, 3.4, 3.7_

- [x] 7. Public exports
  - Re-export all public names from `packages/core/src/index.ts` (named exports only); run `npm run typecheck` and `npm run build -w @seance/core`.
  - _Requirements: 4.1_

- [x] 8. Demo script, docs, commit
  - Add `scripts/demo-review.mjs`: plain Node, imports `../packages/core/dist/index.js`, starts `newCard("2026-11-27")`, applies ratings 5, 5, 2, 4 (each on the previous dueAt), prints one line per step: rating, ease (2 decimals), interval, dueAt. Expected dates: 2026-11-28, 2026-12-04, 2026-12-05, 2026-12-06. Run it after the build.
  - Update `PROJECT.md` (Task 2 -> done, date) and `docs/KIRO_USAGE.md` (spec + PBT notes, Task 2 log entry).
  - Commit `Task 2: review engine (SM-2, gate, scoring)` with files staged by name; `git push origin main`.
  - _Requirements: all_
