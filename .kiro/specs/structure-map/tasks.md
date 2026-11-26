# Tasks: Structure map + structural questions (Task 3)

Run `npm run test:core` after every step; it must pass before the next one. No new dependencies (`@babel/parser` and `@babel/types` 7.29.14 are already installed). Core modules never read files; only tests and scripts read `packages/core/fixtures/`.

- [x] 1. Fixtures
  - Create the fixture files listed under "Example-based tests" in design.md (`project/src/*.ts`, `component.jsx`, `broken.ts`, `script.py`). No `*.test.*` names; they stay outside `src/`, so `tsc` never checks them.
  - _Requirements: 3.3_

- [x] 2. Map types, validation and file-level entries
  - Create `structure-map.ts` with the types, `MAP_LIMITS`, path normalisation, limit checks, language and line count. Other files get the file-level entry.
  - Tests: E4, `script.py` part of E3, line-count cases from req 1.12.
  - _Requirements: 1.1, 1.2, 1.11, 1.12, 1.16-1.18_

- [x] 3. Parsing and extraction
  - Parse per design step 3 (plugins by extension, module then script, catch any thrown value). Extract imports, exports, functions, classes, methods; iterative call walk with `VISITOR_KEYS`; sorting per design step 7.
  - Tests: E1, E2, E3, plus `toMatchSnapshot` of the full fixture map.
  - _Requirements: 1.3-1.10, 1.13-1.15_

- [x] 4. Map properties
  - Add `arbContent`, `arbProject` (with its oracle) and properties P1-P4 to `structure-map.test.ts`.
  - _Requirements: 1.1, 1.2, 1.5-1.10, 1.13-1.15_

- [x] 5. Question generator
  - Create `structural-questions.ts`: `fnv1a32`, option validation, the six templates, distractor choice, choice order, round-robin ordering.
  - Tests: E5, snapshot of the fixture questions, `fnv1a32("")` is `0x811c9dc5`, and a type-level check that `StructuralQuestion[]` is assignable to `QuizQuestion[]` and passes through `scoreQuiz`.
  - _Requirements: 2.1-2.11, 2.13, 2.14_

- [x] 6. Question properties
  - Add properties P5, P5a and P6-P9 to `structural-questions.test.ts`, using maps built from `arbProject` and `fc.nat()` seeds and attempts. P6 uses a test-side oracle per template.
  - _Requirements: 2.3-2.7, 2.10-2.12_

- [x] 7. Public exports
  - Re-export `buildStructureMap`, `MAP_LIMITS`, `generateStructuralQuestions` and all public types from `index.ts` (named only; `fnv1a32` stays internal). Run `npm run typecheck` and `npm run build -w @seance/core`.
  - _Requirements: 3.1, 3.2_

- [x] 8. Demo script and docs (no commit; the orchestrator commits after review)
  - Add `scripts/demo-map.mjs`: plain Node (no tsx), imports `../packages/core/dist/index.js`, reads every file under `packages/core/fixtures/` itself, prints one line per file (path, language, lines, counts of imports/exports/functions/classes, errors) and then 5 questions with choices, marking the correct one. Add root script `"demo:map": "npm run build -w @seance/core && node scripts/demo-map.mjs"`. Run it.
  - Update `PROJECT.md` (Task 3 -> done with date, Task 4 -> next) and add a `### Task 3` entry to the `docs/KIRO_USAGE.md` task log (spec, PBT findings, any spec gaps found).
  - _Requirements: all_

- [x] 9. Review fixes (changed after review; requirements and design updated first)
  - Map: decorators, export forms, script fallback by error count, readable deep-nesting message, path normalisation, early size check, `.d.mts`/`.d.cts`, `plainParams`, `calledNames`, typed sort comparators, method tie-break.
  - Questions: lazy candidates in a fixed template order, precomputed lookups, resolved-callee `caller` rule, same-file `caller`/`async-pick`, plain-parameter `param-count`, `default` filter, `\u0000` key separator.
  - Tests: edge corpus, per-template attempt check, 2- and 4-choice coverage, timing tests T1.
  - _Requirements: 1.2-1.4, 1.6-1.10, 1.13, 1.16, 1.17, 2.5, 2.9, 2.12, 2.16-2.20_

- [x] 10. Second review pass (changed after re-review; requirements and design updated first, no commit)
  - Map: `superClass` and `accessors` on classes, `mentionedNames` on functions and methods (parameters walked too), `commonjsExports` and `hasUnknownExports` on files.
  - Questions: `class-method` hides inherited and accessor names and skips classes with a parent outside the map; `export-owner` hides CommonJS files; `caller` uses `mentionedNames`; `param-count` picks wrong numbers by hash from p-2..p+3.
  - Tests: one per mention shape, inheritance repro and chain/cycle/external cases, CommonJS shapes, P11 and P12 answer-position properties, edge corpus files, timing with 499 mentions per function.
  - _Requirements: 1.8, 1.8a, 1.9, 1.9b, 1.9c, 2.17, 2.18, 2.21, 2.22_
