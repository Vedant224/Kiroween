# Design: Review engine (Task 2)

Pure TypeScript in `packages/core/src/`. No new dependencies (tests use the installed vitest + fast-check).

## Types
```ts
// sm2.ts
export type Quality = 0 | 1 | 2 | 3 | 4 | 5;
export interface Card { ease: number; interval: number; repetitions: number; dueAt: string } // dueAt: YYYY-MM-DD
export function newCard(today: string): Card;
export function nextReview(card: Card, quality: number, today: string): Card;

// gate.ts
export type GateMode = "off" | "soft" | "strict";
export type GateReason = "passed" | "gate-off" | "soft-below" | "strict-below";
export interface GateResult { allowed: boolean; understood: boolean; reason: GateReason }
export const DEFAULT_PASS_MARK = 0.7;
export function gateDecision(score: number, passMark?: number, mode?: GateMode): GateResult;

// scoring.ts
export type QuizQuestion =
  | { id: string; concept: string; kind: "mcq" | "what-if"; choices: string[]; answerIndex: number }
  | { id: string; concept: string; kind: "explain" };
export type QuizAnswer =
  | { questionId: string; kind: "choice"; choiceIndex: number }
  | { questionId: string; kind: "graded"; score: number }; // score from the AI grader (Task 4)
export interface QuizResult { score: number; missedConcepts: string[]; answered: number; total: number }
export const EXPLAIN_MISS_BELOW = 0.5;
export function scoreQuiz(questions: QuizQuestion[], answers: QuizAnswer[]): QuizResult;
```
`quality` is typed `number` so the runtime check (1.9) is reachable from untyped callers.

## Algorithms
**`nextReview`** (req 1.1-1.11)
1. Validate q, card fields, `today`, `card.dueAt`.
2. `d = 5 - q`; `newEase = round2(max(1.3, ease + 0.1 - d * (0.08 + d * 0.02)))` where `round2(x) = Math.round(x * 100) / 100`.
3. If q < 3: `reps = 0`, `interval = 1`. Else `reps = repetitions + 1`; `interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.min(MAX_INTERVAL_DAYS, Math.round(card.interval * card.ease))` (old ease, see open question 1). Export `MAX_INTERVAL_DAYS = 365`.
4. `dueAt = addDays(today, interval)`. Return `{ ease: newEase, interval, repetitions: reps, dueAt }`.

**Date helpers** (private in `sm2.ts`): `parseIsoDate` checks `/^\d{4}-\d{2}-\d{2}$/`, builds `Date.UTC(y, m - 1, d)` and rejects it if the round trip differs (catches `2026-02-30`). `addDays` adds `days * 86_400_000` ms in UTC and returns `toISOString().slice(0, 10)`. UTC avoids daylight-saving bugs. No `Date.now()`.

**`gateDecision`** (req 2.1-2.8)
1. Validate score, passMark in [0, 1]; mode in the enum.
2. `understood = score >= passMark`.
3. `off` -> `{ allowed: true, understood, reason: "gate-off" }`.
4. `understood` -> `{ allowed: true, understood: true, reason: "passed" }`.
5. `soft` -> `{ allowed: true, understood: false, reason: "soft-below" }`; `strict` -> `{ allowed: false, understood: false, reason: "strict-below" }`.

**`scoreQuiz`** (req 3.1-3.12)
1. If `questions` is empty, return `{ score: 0, missedConcepts: [], answered: 0, total: 0 }`.
2. Build a `Map` of questions by id (throw on duplicate). Build a `Map` of answers by id (throw on duplicate or unknown id, or kind mismatch: `choice` only for mcq/what-if, `graded` only for explain; validate index and score range).
3. For each question in order: no answer -> 0 points, missed. Choice -> 1 if `choiceIndex === answerIndex` else 0 (missed). Graded -> `score` points, missed if `score < 0.5`.
4. `score = points / questions.length`; clamp to [0, 1] to absorb float error. Dedupe missed concepts keeping first occurrence.

## Error handling
Every invalid input throws `RangeError` whose message names the field, e.g. `quality must be an integer 0..5, got 7`. No partial results, no logging.

## Correctness properties (fast-check, `numRuns` default 100)
Generators: `validCard` = ease `fc.double({ min: 1.3, max: 5, noNaN: true })`, interval and repetitions `fc.nat({ max: 3650 })`, dueAt/today from `fc.date` in 2000..2100 mapped to ISO; `quality` = `fc.integer({ min: 0, max: 5 })`.

| # | Property | Req |
|---|---|---|
| P1 | For any valid card and q, `nextReview(...).ease >= 1.3`. | 1.7 |
| P2 | For any valid card and q < 3, result has `repetitions === 0` and `interval === 1`. | 1.2 |
| P3 | Starting from `newCard(today)`, for any list of 1-10 qualities all >= 3, intervals are non-decreasing step to step. | 1.3-1.6 |
| P4 | For any valid card, q and today, `dueAt` minus `today` in UTC days equals `interval`. | 1.8 |
| P4a | For any valid card and q, `interval <= 365` and `Math.round(ease * 100) / 100 === ease` (at most 2 decimals). | 1.7, 1.13 |
| P5 | `nextReview` never mutates its input (deep-equal to a copy after the call). | 1.1 |
| P6 | Any q outside 0..5 or non-integer (`fc.double` filtered) throws RangeError. | 1.9 |
| P7 | For any valid quiz and answers, `0 <= score <= 1`. | 3.1 |
| P8 | Answering every question correctly (explain score 1) gives score 1 and no missed concepts. | 3.3, 3.4 |
| P9 | `missedConcepts` has no duplicates and is a subset of the question concepts. | 3.7 |
| P10 | For any score and passMark in [0, 1]: strict -> `allowed === (score >= passMark)`. | 2.5 |
| P11 | Off mode always has `allowed === true`. | 2.3 |
| P12 | In every mode, `understood === (score >= passMark)`; so soft never returns understood when score < passMark. | 2.2, 2.4 |
| P13 | Any score or passMark outside [0, 1] or NaN throws RangeError. | 2.7 |

Quiz generator for P7-P9: 0-8 questions with unique ids (`q${i}`), concepts from a small pool (so duplicates occur), 2-4 choices; answers are a random subset with random valid choice indexes / scores.

## Example-based unit tests
**E1 Demo sequence** (`sm2.test.ts`). Start `newCard("2026-11-27")` = `{ ease: 2.5, interval: 0, repetitions: 0, dueAt: "2026-11-27" }`. Each review happens on the previous `dueAt`.

| Step | today | q | ease | interval | repetitions | dueAt |
|---|---|---|---|---|---|---|
| 1 | 2026-11-27 | 5 | 2.6 | 1 | 1 | 2026-11-28 |
| 2 | 2026-11-28 | 5 | 2.7 | 6 | 2 | 2026-12-04 |
| 3 | 2026-12-04 | 2 | 2.38 | 1 | 0 | 2026-12-05 |
| 4 | 2026-12-05 | 4 | 2.38 | 1 | 1 | 2026-12-06 |

Step 3: d = 3, ease = 2.7 + 0.1 - 3 * 0.14 = 2.38. Step 4: d = 1, ease = 2.38 + 0.1 - 0.1 = 2.38. Ease is rounded to 2 decimals, so compare it exactly with `toBe`.
Also: card `{ ease: 2.5, interval: 6, repetitions: 2 }` rated 4 on 2026-11-27 -> interval `round(6 * 2.5) = 15`, ease 2.5, dueAt `2026-12-12` (proves old ease is used).
Cap: card `{ ease: 2.5, interval: 300, repetitions: 5 }` rated 5 on 2026-11-27 -> interval 365 (not 750), dueAt `2027-11-27`.

**E2 Gate** (`gate.test.ts`): `gateDecision(0.6, 0.7, "soft")` -> `{ allowed: true, understood: false, reason: "soft-below" }`; `gateDecision(0.6, 0.7, "strict")` -> `{ allowed: false, understood: false, reason: "strict-below" }`; `gateDecision(0.7)` -> `{ allowed: true, understood: true, reason: "passed" }`; `gateDecision(0.6)` (default mode is strict) -> `{ allowed: false, understood: false, reason: "strict-below" }`.

**E3 Scoring** (`scoring.test.ts`): mcq A correct, mcq B correct, mcq C wrong (concept `closures`), what-if unanswered (`async`), explain graded 0.4 (`modules`). Score = (1 + 1 + 0 + 0 + 0.4) / 5 = 0.48; missed `["closures", "async", "modules"]`; answered 4, total 5. Same quiz with explain 0.8 -> 0.56, `modules` not missed. Unknown answer id throws RangeError.
