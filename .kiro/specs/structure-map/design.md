# Design: Structure map + structural questions (Task 3)

Pure TypeScript in `packages/core/src/`. Uses the installed `@babel/parser` and `@babel/types` 7.29.14 (`VISITOR_KEYS` for the walk, node types for narrowing). No `@babel/traverse`, no other new dependencies.

Changes made after the review of the first build are marked "(changed after review)". Changes made after the second review pass are marked "(changed after re-review)".

## Types
```ts
// structure-map.ts
export type Language = "javascript" | "typescript" | "python" | "json" | "markdown" | "css" | "html" | "other";
export interface ImportEntry { source: string; kind: "import" | "require"; defaultName?: string; namespace?: string; names: string[]; typeOnly: boolean; line: number }
export interface ExportEntry { name: string; kind: "named" | "default" | "reexport"; from?: string; line: number } // `export *` -> name "*"
// (changed after review) plainParams and calledNames are new on functions and methods
// (changed after re-review) mentionedNames is new on functions and methods; superClass and accessors on classes;
// commonjsExports and hasUnknownExports on files. MAX_MENTIONED_NAMES = 500 is exported from structure-map.ts (not from index.ts).
export interface FunctionEntry { name: string; params: number; plainParams: boolean; async: boolean; exported: boolean; line: number; calls: string[]; calledNames: string[]; mentionedNames: string[] }
export interface MethodEntry { name: string; params: number; plainParams: boolean; async: boolean; static: boolean; line: number; calls: string[]; calledNames: string[]; mentionedNames: string[] }
export interface ClassEntry { name: string; exported: boolean; line: number; superClass?: string; accessors: string[]; methods: MethodEntry[] } // superClass omitted without `extends`
export interface ParseIssue { message: string; line: number } // line 0 when Babel gives none
export interface FileEntry {
  path: string; language: Language; lines: number; parsed: boolean; errors: ParseIssue[];
  imports: ImportEntry[]; exports: ExportEntry[]; functions: FunctionEntry[]; classes: ClassEntry[];
  commonjsExports: string[]; hasUnknownExports: boolean;
}
export interface StructureMap { schemaVersion: 1; files: FileEntry[] }
export interface SourceFile { path: string; content: string }
export const MAP_LIMITS = { maxFiles: 50, maxTotalBytes: 102_400 } as const;
export function buildStructureMap(files: SourceFile[]): StructureMap;

// structural-questions.ts
// (changed after review) The first design used Extract<QuizQuestion, { kind: "mcq" }> & {...}, which is `never`
// (open question 11). This interface shipped; a test checks it is assignable to QuizQuestion[].
export type StructuralConcept = "exports" | "imports" | "call-graph" | "classes" | "async-functions" | "parameters";
export interface StructuralQuestion {
  id: string; concept: StructuralConcept; kind: "mcq"; choices: string[]; answerIndex: number;
  prompt: string; source: { path: string; line: number };
}
export interface StructuralQuestionOptions { count?: number; seed?: number; attempt?: number } // defaults 5, 0, 0; attempt only reorders choices (req 2.15); same validation as seed
export function generateStructuralQuestions(map: StructureMap, options?: StructuralQuestionOptions): StructuralQuestion[];
export function fnv1a32(text: string): number; // exported for tests; not re-exported from index.ts
```
Optional fields (`defaultName`, `namespace`, `from`) are omitted, never `undefined`, so snapshots and `toEqual` are stable. `StructuralQuestion[]` is assignable to `QuizQuestion[]` (checked by a type-level test).

## `buildStructureMap` algorithm
1. Validate: array length <= 50; each `path` non-empty string, `content` string; normalised paths non-empty and unique; **(changed after review)** a running total of `content.length` is checked first and throws as soon as it exceeds 102 400 (bytes are never fewer than characters), so a huge string is never encoded; then the sum of `TextEncoder` byte lengths <= 102 400. Else RangeError.
2. Path normalisation **(changed after review)**: replace `\` with `/`, split on `/`, drop empty segments and `.` segments, join with `/`. This collapses `//`, removes `./` anywhere, a leading `/` and a trailing `/`. `..` segments are kept.
3. Per file: language from the lower-cased extension (`.js .jsx .mjs .cjs` javascript, `.ts .tsx .mts .cts` typescript, `.py`, `.json`, `.md`, `.css`, `.html`, else other); `lines` per req 1.12.
4. JS/TS only: **(changed after review)** plugins by extension, always with decorators:
   - `.d.ts .d.mts .d.cts`: `[["typescript", { dts: true }], "decorators-legacy"]`
   - `.tsx`: `["typescript", "jsx", "decorators-legacy"]`; `.ts .mts .cts`: `["typescript", "decorators-legacy"]`
   - JS: `["jsx", "decorators-legacy"]`

   `decorators-legacy` was probed with 7.29.14 and combines with all three lists; `@Component({...}) export class A {}` and `@dec class A {}` parse. It rejects `export @dec class A {}`; that file is `parsed: false` (open question 18). The `["decorators", { decoratorsBeforeExport: true }]` form was not needed.
5. Parsing **(changed after review)**: `tryParse(sourceType)` runs `parse(content, { sourceType, errorRecovery: true, plugins })` inside try/catch (any thrown value). Run `"module"` first. If it returns with 0 recorded errors, use it. Otherwise also run `"script"` and choose: both returned -> fewer `ast.errors` wins, tie -> module; only one returned -> that one; neither -> `parsed: false` with the module attempt's issue. Recovered errors (first 10) come from the chosen `ast.errors`. Issue line is `err.loc?.line ?? 0`. In `toIssue`, a `RangeError` whose message contains `Maximum call stack size exceeded` becomes `nested too deeply to parse` (probed: Babel overflows at about 500 nested brackets).
6. Walk `program.body` (top level only):
   - `ImportDeclaration` -> import entry (`importKind === "type"` or all specifiers type-only -> `typeOnly`). Named names are the **imported** names; `default`/`namespace` are local names.
   - `VariableDeclaration` with `const`: declarator init `require("lit")` -> `require` import (identifier -> `defaultName`, object pattern -> `names`); init arrow/function expression -> function entry.
   - `FunctionDeclaration` with body -> function entry (TS overload signatures `TSDeclareFunction` skipped). `ClassDeclaration` -> class entry.
   - `ExportNamedDeclaration`: with `declaration` -> unwrap it, mark exported, add named exports; with `source` -> reexport per specifier; else named export per specifier (exported name; `export { a as default }` is a default export of `a`, written as an if/else, not a nested ternary). `ExportDefaultDeclaration` -> default export; unwrap a function/class declaration (name or `default`); `export default interface I {}` falls through to the name `default` (comment in code). `ExportAllDeclaration` -> reexport `*` (or `exported.name` for `* as ns`).
   - **(changed after review)** Names bound by a declaration: an identifier, or every identifier inside an `ObjectPattern` / `ArrayPattern` (properties, nested patterns, `AssignmentPattern` left side, `RestElement` argument), found with an explicit stack. `TSModuleDeclaration` (`namespace` / `module`) with an identifier id -> that name (`A.B.C` gives `A`; string-named `declare module "x"` and `declare global` give nothing). `TSExportAssignment` (`export = foo`) -> default export named `foo`, or `default` when the expression is not an identifier. `TSImportEqualsDeclaration` with `isExport` -> named export of its `id`; without `isExport` it is ignored.
   - `export declare function f(): void;` is a `TSDeclareFunction`: the export `f` is recorded, no function entry (comment in code).
   - A later `export { a }` marks the local function/class `a` as exported.
7. `params`: count of `params` entries excluding a TS `this` parameter; rest and defaults count 1. `plainParams` **(changed after review)**: every counted parameter is an `Identifier` (no `AssignmentPattern`, `RestElement`, `ObjectPattern`, `ArrayPattern`).
8. Calls and mentions: iterative walk (explicit stack, so a deeply nested body cannot overflow our own code) using `VISITOR_KEYS[node.type]`. **(changed after re-review)** The walk starts from every parameter node (defaults included) and the body, so `function f(a = helper())` is seen. For `CallExpression` / `OptionalCallExpression`: `calls` gets `name`, `obj.name` or `this.name` per req 1.9; **(changed after review)** `calledNames` gets the last segment for every call: an identifier callee, a member callee with an identifier property, or a member callee with a string-literal computed property. **(changed after re-review)** `mentionedNames` gets the name of every `Identifier` and `JSXIdentifier` node (a member property such as `call` in `helper.call` is an `Identifier` node, and so is `helper`), plus the string of a computed member such as `obj["x"]`. All three are `Set`s while walking (no quadratic cost), then sorted; `mentionedNames` is cut to `MAX_MENTIONED_NAMES` (500) after sorting.
8a. **(changed after re-review)** Classes: `superClass` is read from `node.superClass`: an `Identifier` gives its name; a chain of non-computed members with an identifier at the root gives the dotted text (`React.Component`); anything else gives `(expression)`, which can never equal a class name. `accessors` holds the sorted names of `ClassMethod` members with `kind` `get` or `set`.
8b. **(changed after re-review)** CommonJS, top-level `ExpressionStatement` only. An `AssignmentExpression` chain `a = b = value` is unrolled; every left side is checked: `exports.x`, `exports["x"]`, `module.exports.x` add `x` (a computed non-string key sets `hasUnknownExports`); `module.exports` takes the final `value`: an `ObjectExpression` adds its keys (identifier or string, shorthand, `ObjectMethod`), a spread or computed key sets `hasUnknownExports`; any other value adds `default` and sets `hasUnknownExports`. A top-level call `Object.assign(<exports target>, ...sources)` reads object-literal sources the same way and sets `hasUnknownExports` for any other source; `Object.defineProperty(<exports target>, "x", ...)` adds `x` (non-literal name sets the flag). An exports target is `exports` or `module.exports`. Names go into a `Set` and are sorted at the end.
9. Sort (code-unit `<`) **(changed after review: two small typed comparators `byText(get)` and `byNumber(get)` and one `sortWith(list, ...comparators)`, with a JSON-text tie-break at the end, replace the mixed `KeyPair` helper)**: files by path; imports by (source, line); exports by (name, from, line); functions by (name, line); classes by (name, line); methods by (name, static, line); all string lists ascending.

## `generateStructuralQuestions` algorithm (changed after review)
Usable files: `parsed: true`. The first build made every question of every template before taking `count` of them, with list scans inside loops, which is quadratic. The new shape:

1. **Precompute once per call** (all linear): the `Context` holds
   - `pool`: functions and methods whose display name is unique in the map, minus display `default` and methods of a class named `default`. Each pool item carries `path`, `line`, `params`, `plainParams`, `async`, `className?`, `calledNames` and `mentioned` (both `Set`s; **changed after re-review**: `mentioned` and the flag `mentionsCut`, true when the list has `MAX_MENTIONED_NAMES` entries) and `resolvedCalls`.
   - **(changed after re-review)** `classesByName: Map<name, ClassEntry[]>` (every class of a parsed file, for the inheritance walk) and `filesWithUnknownExports: Set<path>`; `exportNamesByFile` also holds each file's `commonjsExports`.
   - `poolByFile: Map<path, PoolFunction[]>`.
   - `calleeToCallers: Map<callee, PoolFunction[]>` built from `resolvedCalls`.
   - export owners (`Map<name, owner[]>`, filled with `push`) and `exportNamesByFile: Map<path, Set<name>>`; import pairs (`Map<key, ImportPair>`, sets filled once while reading); class name counts.
   - Hash functions: `hash(x) = fnv1a32(seed + "|" + x)` picks questions and distractors. `choiceHash(x) = fnv1a32(seed + "|" + attempt + "|" + x)` orders the choices. They are two functions because `attempt` must change only the order of the choices and never which question or wrong answer is picked (req 2.15); mixing `attempt` into `hash` would change the picks. A comment in code says this.
   - Use `Map` and `Set` for every name lookup, never plain objects, so names like `__proto__` and `constructor` are safe.
   - `fnv1a32` uses one module-level `TextEncoder`.
2. **Resolving a call** (req 2.16), for a calling pool item `f` in file `F`: let `relativeNames(F)` be the `names` and `defaultName`s of imports of `F` whose source starts with `./` or `../`, and `relativeNamespaces(F)` their `namespace`s. A call `c` resolves when:
   - `c` has no `.`: `c` is the name of a top-level function in the map (not `default`) or is in `relativeNames(F)`;
   - `c` is `this.m`: `f` is a method and its class has a method `m`;
   - `c` is `obj.x`: `obj` is in `relativeNamespaces(F)`.

   `resolvedCalls` is `calls` filtered by this rule.
3. **Candidates**: each template returns a cheap list of `Candidate { id, template, build(): StructuralQuestion | undefined }`. A candidate is made for every subject that passes the cheap tests (for example "exported by exactly one file"), without building choices. `build` makes the distractors and the question, or returns `undefined` when none are valid.
4. **Order and lazy build**: templates are visited in the fixed order `caller`, `class-method`, `import-from`, `export-owner`, `async-pick`, `param-count`. Each template's candidates are sorted by `hash(id)` (ties by id text). Round-robin: in each round, take the next candidate of each template, call `build()`, keep the question or move on to the next candidate of that template when it returns `undefined`; stop as soon as `count` questions exist or all templates are empty. The sequence does not depend on `count`, so the stable prefix (req 2.12) holds. `count` 0 returns `[]` before any work.
5. Distractors: dedupe the pool, remove the correct answer, sort by `hash(id + "|" + choice)`, take up to 3. Pool empty -> `build()` returns `undefined`. `param-count` takes the nearby numbers directly.
6. Choices = correct + distractors sorted by `choiceHash(id + "#" + choice)`; `answerIndex` = index of the correct one. Exception (req 2.18): `param-count` on `attempt` 0 sorts numerically ascending. **(changed after re-review)** The wrong numbers are chosen by hash first (step 5) and sorted after, so the position of the correct number depends on the hash, not on the fixed offsets. Before, the wrong numbers were p-1, p+1, p+2 (always one below, two above), so the correct answer was choice B on attempt 0 for every p >= 1.
7. `source` = the subject's file and line (`async-pick`, `param-count`, `caller`: the correct function).

| Template | Concept | Subject (one candidate each) | Prompt | Correct | Distractor pool (must be false) |
|---|---|---|---|---|---|
| `caller` | call-graph | a resolved callee `Y` (key = the call text, e.g. `log`, `this.save`, `math.add`) with >= 1 caller in `calleeToCallers` | ``In `file`, which function calls `Y`?`` (file of the correct function) | first caller by `hash(id + "|" + display)` | functions in that file whose display last segment is not `last(Y)`, whose `calledNames` and `mentioned` do not contain `last(Y)`, and whose `mentionsCut` is false (changed after re-review) |
| `class-method` | classes | class `C` (not named `default`) with >= 1 method, name unambiguous; **(changed after re-review)** the build returns `undefined` when `C` has an `extends` and the chain leaves the map | ``Which of these is a method of class `C`?`` | first method by hash | method names of other classes and unambiguous top-level function names (not `default`), minus the methods and accessors of `C` and the methods and accessors of every ancestor of `C` (changed after re-review) |
| `import-from` | imports | (file, module) pair with >= 1 named/default name; key `path\u0000module` | ``Which of these does `file` import from `module`?`` | first name by `hash(id + "|" + name)` | imported names of other pairs, minus all names that file imports from that module |
| `export-owner` | exports | named export `X` (not reexport/default) exported by exactly 1 file | ``Which file exports `X`?`` | that path | usable paths with no export entry named `X` or `*`, no `commonjsExports` entry `X`, and `hasUnknownExports` false (so `index.ts` re-exporting `X` is never a "wrong" choice; changed after re-review) |
| `async-pick` | async-functions | each async pooled function | ``In `file`, which function is async?`` | that function | non-async pooled functions in the same file |
| `param-count` | parameters | each pooled function with `plainParams` | ``How many parameters does `fn` in `file` take?`` | `String(p)` | three of `p-2`, `p-1`, `p+1`, `p+2`, `p+3` that are >= 0, chosen by the shared distractor picker (changed after re-review) |

**(changed after re-review)** Inheritance walk for `class-method`: start with the class's `superClass` name; for each name not seen before, look it up in `classesByName`; no entry (or `(expression)`) means the chain leaves the map and the question is skipped; otherwise add the methods and accessors of every class with that name and queue their `superClass` names. A seen-set stops cycles (`class A extends B`, `class B extends A`).

The `import-from` key separator is `\u0000` (changed after review), because `>` can appear in a path. Candidate id is `<template>:<key>`; for `caller` the key is the callee text (`caller:log`).

## Error handling
Only input shape and limits throw `RangeError` (message names the field or limit, e.g. `total content is 120000 bytes, limit 102400`). Content never throws; parse problems go into `errors`.

## Correctness properties (fast-check, `numRuns` 100; P1 200)
Generators:
- `arbContent`: `fc.oneof(fc.string({ unit: "binary", maxLength: 2000 }), fc.array(fc.constantFrom("import", "export", "function", "class", "async", "=>", "(", ")", "{", "}", "<div>", "`", "/*", "\"", "require(", ";", "\n"), { maxLength: 300 }).map(a => a.join(" ")))`, path from `fc.constantFrom("a.ts", "a.tsx", "a.js", "a.jsx", "a.cjs")`.
- `arbProject`: 1-5 files `src/f<i>.ts`; each has 0-4 functions (names from `fn0..fn7`, so duplicates and ambiguity occur), 0-3 params, random `async`/`exported`, body calling 0-3 pool names plus `obj.run` and `util.helper`; 0-2 classes `C0..C2` with methods `m0..m4` (may call `this.m0..m2`); imports `import { fnK } from "./f<j>"`. Rendered from string templates, so it always parses; the generator also returns its own list of what it rendered (the oracle).
- **(changed after review)** `EDGE_CORPUS` in `test-support/edge-corpus.ts`: a fixed list of source files for the cases a random generator does not reach: decorators (class, member, parameter), destructured exports, namespace/module, `export =`, `export import`, member-chain calls (`obj.a.helper()`, `this.db.get()`, `console.log()`), names like `__proto__`, `constructor`, `toString`, `default` functions/classes/interfaces, a CommonJS file with `require` and a `with` statement, `export declare function`, and functions with default/rest/destructured parameters. Some entries carry the facts a correct map must show (their exports, classes, called names); a test checks those facts, so the map is compared with something other than itself. `arbEdgeMap` joins `arbProject` files with a random non-empty subset of the corpus.

| # | Property | Req |
|---|---|---|
| P1 | For any `arbContent` file **or any corpus file**, `buildStructureMap` does not throw and returns 1 entry; if `parsed` is false, lists are empty and `errors.length >= 1`. | 1.13-1.15 |
| P2 | For any `arbProject`, files are sorted by path, no path contains `\`, and every name list is sorted and duplicate-free. | 1.1, 1.2, 1.10 |
| P3 | For any `arbProject`, the map equals the map of the same files shuffled (`fc.shuffledSubarray` full length) and of a second call. | 1.10 |
| P4 | For any `arbProject`, every rendered function/class/method appears with the rendered params, `plainParams`, `async`, `exported`, calls and calledNames. | 1.5-1.9a |
| P5 | For any map from `arbProject` or `arbEdgeMap` and seed: every question has 2-4 unique choices and `0 <= answerIndex < choices.length`. | 2.6 |
| P5a | For any map, seed and two attempts a != b: same ids and prompts in the same order, same choice sets, same `choices[answerIndex]` text. **Per template** (not only on the fixture map), over 20 attempts of one question, the correct answer is not always at the same index. | 2.15 |
| P6 | Exactly one choice is correct, checked by a test-side oracle per template against the map (e.g. `caller`: only `choices[answerIndex]` calls the subject, no wrong choice has the subject's last segment in `calledNames`, the subject resolves in the project, every choice is in the prompt's file). Runs on `arbProject` and `arbEdgeMap` maps. | 2.4, 2.16-2.19 |
| P7 | Every choice is a path, import name, method name or display name in the map, never an ambiguous display name or `default`; `param-count` choices match `/^\d+$/`, are ascending on attempt 0, and the subject has plain parameters. Runs on both map kinds. | 2.3, 2.5, 2.18 |
| P8 | Ids are unique; length <= count; same map + options twice -> deep-equal. | 2.7, 2.10, 2.11 |
| P9 | For counts a < b, `gen(map, {count: a})` equals `gen(map, {count: b}).slice(0, a)`. | 2.12 |
| P10 | A sample of generated maps produces all six templates, and both 2-choice and 4-choice questions. | 2.2, 2.6 |
| P11 | **(changed after re-review)** Over a fixed varied map (about 16 functions, 12 classes, 12 importing files) and 5 consecutive seeds, for each of the six templates the `answerIndex` on attempt 0 takes at least 2 different values. Guards against any future position leak. | 2.15, 2.18 |
| P12 | **(changed after re-review)** For a map of functions with 0..6 parameters, `param-count` `answerIndex` on attempt 0 is not constant and is not always 1 (second-lowest); wrong choices are within p-2..p+3, >= 0, and the correct answer is in the question. | 2.18 |
| T1 | **(changed after review)** Timing, not a property: a built map of 1,000 functions and one of 2,000 classes return 5 questions in under 500 ms; 4,000 functions (the measured repro) in under 1 s. | 2.20 |

## Example-based tests (explicit `toEqual` on key facts, plus one `toMatchSnapshot` of the full map and questions)
Fixtures in `packages/core/fixtures/`: `project/src/math.ts` (`export function add(a, b)`, `export const square = (x) => multiply(x, x)`, private `multiply(a, b)`), `project/src/logger.ts` (`export function log(message)` calling `console.log`), `project/src/user-service.ts` (imports `add`, `log`; `export class UserService` with `async findUser(id)` calling `log` and `this.db.get`, `countAll(a, b)` calling `add`; `export async function loadUser(id)` calling `s.findUser`), `project/src/index.ts` (`export { loadUser } from "./user-service"`, `import * as math from "./math"`, `export default function main()` calling `math.add`), `component.jsx` (function component returning JSX, `export default`), `broken.ts` (`function oops( {`), `script.py` (3 lines).
- **E1** `user-service.ts`: class `UserService` methods `["countAll", "findUser"]`, `findUser` async with `calls` `["log"]` and `calledNames` `["get", "log"]` (**changed after review**: the first design listed `this.db.get` as a call, which req 1.9 excludes; open question 10); `loadUser` `{ params: 1, async: true, exported: true, calls: ["s.findUser"], calledNames: ["findUser"] }`.
- **E2** `math.ts`: functions `add`, `multiply`, `square`; `multiply.exported === false`; `square.calls` = `["multiply"]`. `index.ts`: reexport `loadUser` from `./user-service`, namespace import `math`, default export `main` with calls `["math.add"]`.
- **E3** `broken.ts`: map still has every fixture; `broken.ts` has `errors.length >= 1`. `script.py`: `{ language: "python", lines: 3, parsed: false, errors: [] }` with empty lists. `component.jsx` parses with no errors.
- **E4** Limits: 51 files -> RangeError; one `big.txt` of 102 401 ASCII bytes -> RangeError (rejected before encoding); exactly 102 400 -> ok; 51 200 `é` (2 bytes each) + 1 ASCII byte -> RangeError (bytes, not chars); `a/b.ts` and `a\b.ts` together -> RangeError; **(changed after review)** also `././a.ts` vs `a.ts`, `a//b.ts` vs `a/b.ts`, `a/./b.ts` vs `a/b.ts`, and `/a.ts` vs `a.ts`.
- **E5** Questions from the fixture map: 5 questions with 5 different concepts (round-robin); `caller:log` exists with correct answer `UserService.findUser` and distractors not calling `log`; `generateStructuralQuestions({ schemaVersion: 1, files: [] })` -> `[]`; `count: 51` and `seed: -1` throw RangeError.
- **E6 (changed after review)** Parsing: `@Component({...}) export class A {}` and `@dec class A {}` give `parsed: true` and a class entry; each export form of req 1.6 (destructured object/array incl. nested, defaults and rest; `export namespace`/`module`; `export = foo`; `export import X = require()`); a CommonJS file with `with (a) { b(); }` has `errors.length === 0` (module mode records an error, script mode none); 600 nested brackets give `parsed: false`, no throw, and a message containing `too deeply`; `.d.mts` / `.d.cts` parse as declaration files; a method list with two same-name same-flag methods keeps both in line order.
- **E7 (changed after review)** Questions: (a) `third(){ obj.a.helper(); }` with `other(){ helper(); }` in one file: `caller:helper` is never answered by `third` and `third` is never a wrong choice; (b) `caller:console.log` never exists, for any seed, and no `caller` subject starts with `console.`; (c) `this.save` is asked only for the calling class's own method; `obj.x` on a plain variable is never asked, `ns.x` on a relative namespace import is; (d) a `default` function and a class named `default` never appear; (e) functions with default/rest/destructured parameters have no `param-count` question; (f) `param-count` choices are ascending on `attempt` 0; (g) prompts name the file.
- **E8 (changed after re-review)** Map: `superClass` for `extends Base`, `extends React.Component`, `extends mixin(Base)` (`(expression)`), none without `extends`; `accessors` for `get`/`set`; `commonjsExports` and `hasUnknownExports` for `exports.x =`, `module.exports.x =`, `module.exports = { a, b }`, `module.exports = fn` (`default`, unknown), spread in the object (unknown), `Object.assign`/`Object.defineProperty`; `mentionedNames` for params with defaults and for every shape in E9; no CommonJS facts for an unparsed or non-JS file.
- **E9 (changed after re-review)** `caller` distractor exclusion, one test per way of mentioning `helper`: `helper.call(null)`, `helper.bind(null)()`, tagged template, default parameter, alias, `[1].map(helper)`, `app.get("/", helper)`, `.then(helper)`; plus a function whose parameter is named `helper` (accepted, open question 25).
- **E10 (changed after re-review)** `class-method`: the `Base.save` / `Admin.ban` repro (`save` never offered for `Admin`, whatever the seed); a two-level chain; a cycle (`A extends B`, `B extends A`) does not hang; `extends React.Component` and `extends mixin(Base)` give no `class-method` question; a getter named like a distractor is never offered. `export-owner`: a CommonJS file with `exports.x`, `module.exports.x`, `module.exports = { x }`, and one with `module.exports = something` (unknown) are never wrong answers; a plain file with no exports still is.
- **E11 (changed after re-review)** Timing: `mentionedNames` must not add quadratic cost; T1 maps now carry `mentionedNames`, and a map of functions with 500 mentions each still returns in time.
