// Tests for structural-questions.ts: example cases (E5, E7), fast-check properties (P5-P10) and timing (T1).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { scoreQuiz, type QuizAnswer, type QuizQuestion } from "./scoring.js";
import {
  buildStructureMap,
  type FileEntry,
  type FunctionEntry,
  type MethodEntry,
  type SourceFile,
  type StructureMap,
} from "./structure-map.js";
import { fnv1a32, generateStructuralQuestions, type StructuralQuestion } from "./structural-questions.js";
import { arbProject, toSourceFiles } from "./test-support/arb-project.js";
import { arbProjectWithEdges, edgeSourceFiles } from "./test-support/edge-corpus.js";

// Reads every file under packages/core/fixtures/ (tests may do I/O; the core module may not).
function loadFixtures(): SourceFile[] {
  const root = fileURLToPath(new URL("../fixtures/", import.meta.url));
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((name) => statSync(root + name).isFile())
    .map((name) => ({ path: name, content: readFileSync(root + name, "utf8") }));
}

const fixtureMap = buildStructureMap(loadFixtures());
const emptyMap: StructureMap = { schemaVersion: 1, files: [] };
const TEMPLATE_NAMES = ["caller", "class-method", "import-from", "export-owner", "async-pick", "param-count"];

/** A map from a few source files, for the small example tests. */
function mapOf(...files: [path: string, content: string][]): StructureMap {
  return buildStructureMap(files.map(([path, content]) => ({ path, content })));
}

function templateOf(q: StructuralQuestion): string {
  return q.id.split(":")[0] ?? "";
}

function lastName(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1);
}

// ---------------------------------------------------------------------------
// Test-side oracle: looks facts up in the map without using the generator's code
// ---------------------------------------------------------------------------

interface Known {
  display: string;
  isMethod: boolean;
  path: string;
  className?: string;
  params: number;
  plainParams: boolean;
  async: boolean;
  calls: string[];
  calledNames: string[];
  mentionedNames: string[];
}

function known(display: string, path: string, entry: FunctionEntry | MethodEntry, className?: string): Known {
  const { params, plainParams, async, calls, calledNames, mentionedNames } = entry;
  const result: Known = { display, isMethod: className !== undefined, path, params, plainParams, async, calls, calledNames, mentionedNames };
  if (className !== undefined) result.className = className;
  return result;
}

/** Every function and method of the parsed files, with its display name. */
function allKnown(map: StructureMap): Known[] {
  const list: Known[] = [];
  for (const file of map.files.filter((f) => f.parsed)) {
    for (const f of file.functions) list.push(known(f.name, file.path, f));
    for (const c of file.classes) {
      for (const m of c.methods) list.push(known(`${c.name}.${m.name}`, file.path, m, c.name));
    }
  }
  return list;
}

/** The one function with this display name. Fails the test when it is missing or ambiguous. */
function uniqueKnown(map: StructureMap, display: string): Known {
  const matches = allKnown(map).filter((k) => k.display === display);
  expect(matches, `display name ${display} must exist exactly once`).toHaveLength(1);
  return matches[0] as Known;
}

function parsedFile(map: StructureMap, path: string): FileEntry {
  const file = map.files.find((f) => f.path === path && f.parsed);
  expect(file, `file ${path} must be parsed and in the map`).toBeDefined();
  return file as FileEntry;
}

/**
 * Req 2.16, checked from the map alone: does `callee`, called by `caller`, point inside the project?
 * A bare name must be a top-level function of the map or imported from a relative module; `this.m`
 * must be a method of the caller's class; `obj.x` needs `obj` to be a namespace import of a relative module.
 */
function resolvesInProject(map: StructureMap, caller: Known, callee: string): boolean {
  const relativeImports = parsedFile(map, caller.path).imports.filter((i) => i.source.startsWith("./") || i.source.startsWith("../"));
  const dot = callee.indexOf(".");
  if (dot === -1) {
    const isTopLevel = map.files.some((f) => f.parsed && f.functions.some((fn) => fn.name === callee));
    const isImported = relativeImports.some((i) => i.names.includes(callee) || i.defaultName === callee);
    return isTopLevel || isImported;
  }
  const head = callee.slice(0, dot);
  const member = callee.slice(dot + 1);
  if (head === "this") {
    const cls = parsedFile(map, caller.path).classes.find((c) => c.name === caller.className);
    return cls?.methods.some((m) => m.name === member) === true;
  }
  return relativeImports.some((i) => i.namespace === head);
}

/** Checks that exactly one choice is true and every other choice is false (req 2.4), and the prompt rules (2.16-2.19). */
function expectExactlyOneCorrect(map: StructureMap, q: StructuralQuestion): void {
  const [template = "", ...rest] = q.id.split(":");
  const key = rest.join(":");
  const correct = q.choices[q.answerIndex] as string;
  const wrong = q.choices.filter((_, i) => i !== q.answerIndex);

  switch (template) {
    case "export-owner": {
      expect(parsedFile(map, correct).exports.some((e) => e.kind === "named" && e.name === key)).toBe(true);
      for (const path of wrong) {
        const file = parsedFile(map, path);
        expect(file.exports.some((e) => e.name === key || e.name === "*")).toBe(false);
        // Req 2.22: a CommonJS file that exports the name, or may export anything, is never a wrong answer.
        expect(file.commonjsExports, `${path} must not export ${key} through CommonJS`).not.toContain(key);
        expect(file.hasUnknownExports, `${path} has unreadable module.exports`).toBe(false);
      }
      break;
    }
    case "import-from": {
      const [path = "", module = ""] = key.split("\u0000");
      const imports = parsedFile(map, path).imports.filter((i) => i.source === module);
      const real = new Set(imports.flatMap((i) => [...i.names, ...(i.defaultName ? [i.defaultName] : [])]));
      const everything = new Set([...real, ...imports.flatMap((i) => (i.namespace ? [i.namespace] : []))]);
      expect(real.has(correct)).toBe(true);
      for (const name of wrong) expect(everything.has(name)).toBe(false);
      break;
    }
    case "caller": {
      const caller = uniqueKnown(map, correct);
      expect(caller.calls).toContain(key);
      expect(resolvesInProject(map, caller, key), `${key} must point inside the project`).toBe(true);
      expect(q.prompt).toBe(`In \`${caller.path}\`, which function calls \`${key}\`?`);
      expect(q.source.path).toBe(caller.path);
      for (const display of wrong) {
        const other = uniqueKnown(map, display);
        // Req 2.17: no wrong choice calls anything with the subject's last name, however the call is written.
        expect(other.calledNames, `${display} must not call ${lastName(key)}`).not.toContain(lastName(key));
        // Req 2.17 (re-review): nor mention it in any other way (callback, alias, `helper.call(null)`, default value).
        expect(other.mentionedNames, `${display} must not mention ${lastName(key)}`).not.toContain(lastName(key));
        expect(lastName(display)).not.toBe(lastName(key));
        // Req 2.19: every choice is in the file named by the prompt.
        expect(other.path).toBe(caller.path);
      }
      break;
    }
    case "class-method": {
      const classes = map.files.flatMap((f) => f.classes).filter((c) => c.name === key);
      expect(classes).toHaveLength(1);
      const own = classes[0]?.methods.map((m) => m.name) ?? [];
      expect(own).toContain(correct);
      for (const name of wrong) expect(own).not.toContain(name);
      // Req 2.21: the class and every parent found by name in the map: none has a wrong choice as method, getter or setter.
      const everyClass = map.files.flatMap((f) => f.classes);
      const seen = new Set<string>();
      const firstParent = classes[0]?.superClass;
      const todo = firstParent === undefined ? [] : [firstParent];
      for (let parent = todo.pop(); parent !== undefined; parent = todo.pop()) {
        if (seen.has(parent)) continue;
        seen.add(parent);
        const parents = everyClass.filter((c) => c.name === parent);
        expect(parents.length, `${key} extends ${parent}, which must be in the map`).toBeGreaterThan(0);
        for (const p of parents) {
          for (const name of wrong) {
            expect(p.methods.map((m) => m.name), `${name} is a method of ${p.name}`).not.toContain(name);
            expect(p.accessors, `${name} is an accessor of ${p.name}`).not.toContain(name);
          }
          if (p.superClass !== undefined) todo.push(p.superClass);
        }
      }
      for (const name of wrong) expect(classes[0]?.accessors).not.toContain(name);
      break;
    }
    case "async-pick": {
      const picked = uniqueKnown(map, correct);
      expect(picked.async).toBe(true);
      expect(q.prompt).toBe(`In \`${picked.path}\`, which function is async?`);
      for (const display of wrong) {
        const other = uniqueKnown(map, display);
        expect(other.async).toBe(false);
        expect(other.path).toBe(picked.path);
      }
      break;
    }
    case "param-count": {
      const subject = uniqueKnown(map, key);
      expect(subject.plainParams, `${key} must have plain parameters`).toBe(true);
      expect(q.prompt).toBe(`How many parameters does \`${key}\` in \`${subject.path}\` take?`);
      expect(Number(correct)).toBe(subject.params);
      for (const text of wrong) expect(Number(text)).not.toBe(subject.params);
      break;
    }
    default:
      throw new Error(`unknown template in id ${q.id}`);
  }
}

/** Checks that every choice is a real name in the map and never an ambiguous display name or `default` (req 2.3, 2.5). */
function expectChoicesAreReal(map: StructureMap, q: StructuralQuestion): void {
  const template = templateOf(q);
  const all = allKnown(map);
  const paths = map.files.filter((f) => f.parsed).map((f) => f.path);
  const importNames = map.files.flatMap((f) => f.imports.flatMap((i) => [...i.names, ...(i.defaultName ? [i.defaultName] : [])]));
  const methodNames = map.files.flatMap((f) => f.classes.flatMap((c) => c.methods.map((m) => m.name)));
  const topLevelNames = all.filter((k) => !k.isMethod).map((k) => k.display);

  for (const choice of q.choices) {
    if (template === "export-owner") expect(paths).toContain(choice);
    if (template === "import-from") expect(importNames).toContain(choice);
    if (template === "class-method") expect([...methodNames, ...topLevelNames]).toContain(choice);
    if (template === "param-count") expect(choice).toMatch(/^\d+$/);
    if (template === "caller" || template === "async-pick") {
      expect(all.filter((k) => k.display === choice)).toHaveLength(1);
    }
    if (template === "caller" || template === "async-pick" || template === "class-method") {
      expect(choice).not.toBe("default");
      expect(choice.startsWith("default.")).toBe(false);
    }
  }
  if (template === "class-method") {
    // Top-level names used as wrong answers must not be ambiguous either.
    for (const choice of q.choices) {
      if (topLevelNames.includes(choice) && !methodNames.includes(choice)) {
        expect(all.filter((k) => k.display === choice)).toHaveLength(1);
      }
    }
    expect(q.id).not.toBe("class-method:default");
  }
  // The subject of the question is a unique name too.
  if (template === "param-count") uniqueKnown(map, q.id.slice("param-count:".length));
  if (template === "caller") expect(q.id.startsWith("caller:default")).toBe(false);
}

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------

describe("fnv1a32", () => {
  it("hashes the empty text to the FNV offset basis", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
  });

  it("matches known FNV-1a test vectors", () => {
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });

  it("hashes UTF-8 bytes, so non-ASCII text works", () => {
    // "é" is the two bytes C3 A9 in UTF-8. Hash them by hand: xor the byte, then multiply by the FNV prime.
    let expected = 0x811c9dc5;
    for (const byte of [0xc3, 0xa9]) expected = Math.imul(expected ^ byte, 0x01000193) >>> 0;
    expect(fnv1a32("é")).toBe(expected);
  });
});

describe("generateStructuralQuestions examples (E5)", () => {
  const questions = generateStructuralQuestions(fixtureMap);

  it("gives 5 questions about 5 different concepts, in the fixed template order", () => {
    expect(questions).toHaveLength(5);
    expect(new Set(questions.map((q) => q.concept)).size).toBe(5);
    expect(questions.map(templateOf)).toEqual(["caller", "class-method", "import-from", "export-owner", "async-pick"]);
  });

  it("follows the fixed template order in every round, whatever the seed", () => {
    for (const seed of [0, 1, 2, 77]) {
      const all = generateStructuralQuestions(fixtureMap, { seed, count: 6 });
      expect(all.map(templateOf)).toEqual(TEMPLATE_NAMES);
    }
  });

  it("gives the same questions twice", () => {
    expect(generateStructuralQuestions(fixtureMap)).toEqual(questions);
  });

  it("every fixture question has one correct choice by the oracle", () => {
    for (const q of generateStructuralQuestions(fixtureMap, { count: 50 })) {
      expectExactlyOneCorrect(fixtureMap, q);
      expectChoicesAreReal(fixtureMap, q);
    }
  });

  it("caller:log asks who calls `log`; the answer is UserService.findUser and no wrong choice calls it", () => {
    const all = generateStructuralQuestions(fixtureMap, { count: 50 });
    const q = all.find((item) => item.id === "caller:log");
    expect(q).toBeDefined();
    expect(q?.choices[q.answerIndex]).toBe("UserService.findUser");
    expect(q?.concept).toBe("call-graph");
    expect(q?.prompt).toBe("In `project/src/user-service.ts`, which function calls `log`?");
    expect(q?.source.path).toBe("project/src/user-service.ts");
    expect([...(q?.choices ?? [])].sort()).toEqual(["UserService.countAll", "UserService.findUser", "loadUser"]);
  });

  it("export-owner never offers the re-exporting index.ts as a wrong answer for loadUser", () => {
    const q = generateStructuralQuestions(fixtureMap, { count: 50 }).find((item) => item.id === "export-owner:loadUser");
    expect(q?.choices[q.answerIndex]).toBe("project/src/user-service.ts");
    expect(q?.choices).not.toContain("project/src/index.ts");
  });

  it("param-count offers 3 nearby numbers (p-2 to p+3, not below 0), ascending on attempt 0", () => {
    const q = generateStructuralQuestions(fixtureMap, { count: 50 }).find((item) => item.id === "param-count:add");
    expect(q?.choices[q.answerIndex]).toBe("2");
    expect(q?.choices).toHaveLength(4);
    expect(q?.choices.every((c, i) => i === 0 || Number(q.choices[i - 1]) < Number(c))).toBe(true);
    for (const choice of q?.choices ?? []) expect([0, 1, 2, 3, 4, 5]).toContain(Number(choice));
    expect(q?.prompt).toBe("How many parameters does `add` in `project/src/math.ts` take?");
  });

  it("async-pick names the file and only offers functions of that file", () => {
    const q = generateStructuralQuestions(fixtureMap, { count: 50 }).find((item) => item.id === "async-pick:loadUser");
    expect(q?.prompt).toBe("In `project/src/user-service.ts`, which function is async?");
    expect(q?.choices[q.answerIndex]).toBe("loadUser");
    expect(q?.choices).toEqual(expect.arrayContaining(["UserService.countAll"]));
    expect(q?.choices).toHaveLength(2);
  });

  it("class-method asks about UserService", () => {
    const q = generateStructuralQuestions(fixtureMap, { count: 50 }).find((item) => item.id === "class-method:UserService");
    expect(["countAll", "findUser"]).toContain(q?.choices[q.answerIndex]);
    expect(q?.concept).toBe("classes");
  });

  it("returns [] for an empty map, a map of other files, and one tiny file", () => {
    expect(generateStructuralQuestions(emptyMap)).toEqual([]);
    const others = buildStructureMap([
      { path: "a.py", content: "x = 1" },
      { path: "b.json", content: "{}" },
    ]);
    expect(generateStructuralQuestions(others)).toEqual([]);
    const tiny = buildStructureMap([{ path: "a.ts", content: "export const x = 1;" }]);
    expect(generateStructuralQuestions(tiny)).toEqual([]);
  });

  it("skips files with parsed false, even when their lists are filled", () => {
    const base = fixtureMap.files.find((f) => f.path === "project/src/math.ts") as FileEntry;
    const map: StructureMap = { schemaVersion: 1, files: [{ ...base, parsed: false }] };
    expect(generateStructuralQuestions(map, { count: 50 })).toEqual([]);
  });

  it("skips ambiguous display names", () => {
    const map = mapOf(
      ["a.ts", "export function dup(a) {}\nexport async function solo(a, b) {}\nexport function other() {}"],
      ["b.ts", "export function dup(a, b, c) {}"],
    );
    const all = generateStructuralQuestions(map, { count: 50 });
    expect(all.length).toBeGreaterThan(0);
    for (const q of all) {
      expect(q.id.includes("dup")).toBe(false);
      expect(q.choices).not.toContain("dup");
    }
  });

  it("count 0 gives [], and a bigger count gives at most count questions", () => {
    expect(generateStructuralQuestions(fixtureMap, { count: 0 })).toEqual([]);
    expect(generateStructuralQuestions(fixtureMap, { count: 2 })).toHaveLength(2);
    expect(generateStructuralQuestions(fixtureMap, { count: 50 }).length).toBeLessThanOrEqual(50);
  });

  it("different seeds pick different candidates inside a template", () => {
    const a = generateStructuralQuestions(fixtureMap, { seed: 0, count: 50 }).map((q) => q.id);
    const b = generateStructuralQuestions(fixtureMap, { seed: 1, count: 50 }).map((q) => q.id);
    expect(new Set(a)).toEqual(new Set(b)); // same candidates...
    expect(a).not.toEqual(b); // ...in another order
  });

  it("throws RangeError for bad options", () => {
    expect(() => generateStructuralQuestions(emptyMap, { count: 51 })).toThrow(RangeError);
    expect(() => generateStructuralQuestions(emptyMap, { count: -1 })).toThrow(RangeError);
    expect(() => generateStructuralQuestions(emptyMap, { count: 1.5 })).toThrow(RangeError);
    expect(() => generateStructuralQuestions(emptyMap, { count: Number.NaN })).toThrow(RangeError);
    expect(() => generateStructuralQuestions(emptyMap, { seed: -1 })).toThrow(RangeError);
    expect(() => generateStructuralQuestions(emptyMap, { seed: 1.5 })).toThrow(RangeError);
    expect(() => generateStructuralQuestions(emptyMap, { seed: 2 ** 53 })).toThrow(RangeError);
    expect(() => generateStructuralQuestions(emptyMap, { attempt: -1 })).toThrow(RangeError);
    expect(() => generateStructuralQuestions(emptyMap, { attempt: Number.NaN })).toThrow(RangeError);
  });

  it("works with Task 2's QuizQuestion type and scoreQuiz", () => {
    // This line is the type-level check: StructuralQuestion[] must be assignable to QuizQuestion[].
    const quiz: QuizQuestion[] = generateStructuralQuestions(fixtureMap);
    const perfect: QuizAnswer[] = questions.map((q) => ({ questionId: q.id, kind: "choice", choiceIndex: q.answerIndex }));
    expect(scoreQuiz(quiz, perfect).score).toBe(1);
    const wrong: QuizAnswer[] = questions.map((q) => ({ questionId: q.id, kind: "choice", choiceIndex: (q.answerIndex + 1) % q.choices.length }));
    const result = scoreQuiz(quiz, wrong);
    expect(result.score).toBe(0);
    expect(result.missedConcepts).toEqual(questions.map((q) => q.concept));
  });

  it("snapshot of the fixture questions", () => {
    // The import-from id holds a NUL character; show it as a visible mark so the snapshot stays plain text.
    const shown = generateStructuralQuestions(fixtureMap, { count: 50 }).map((q) => ({ ...q, id: q.id.replace("\u0000", "<NUL>") }));
    expect(shown).toMatchSnapshot();
  });
});

describe("question quality rules (E7)", () => {
  it("a function that calls `obj.a.helper()` is never offered as a wrong answer for `helper`", () => {
    const map = mapOf([
      "a.ts",
      [
        "function helper() {}",
        "function other() { helper(); }",
        "function third() { obj.a.helper(); }",
        "function fourth() {}",
        "function fifth() {}",
      ].join("\n"),
    ]);
    for (let seed = 0; seed < 20; seed++) {
      const q = generateStructuralQuestions(map, { seed, count: 50 }).find((item) => item.id === "caller:helper");
      expect(q, `seed ${seed}`).toBeDefined();
      expect(q?.choices[q.answerIndex]).toBe("other");
      expect(q?.choices).not.toContain("third");
      expect(q?.choices).not.toContain("helper");
      expect([...(q?.choices ?? [])].sort()).toEqual(["fifth", "fourth", "other"]);
    }
  });

  it("`console.log` is never asked about, but a project function named `log` still is", () => {
    const maps = [fixtureMap, mapOf(["a.ts", "function f() { console.log(1); Math.max(1, 2); setTimeout(f, 1); }\nfunction g() {}\nfunction h() {}"])];
    for (const map of maps) {
      for (let seed = 0; seed < 10; seed++) {
        for (const q of generateStructuralQuestions(map, { seed, count: 50 })) {
          expect(q.id.startsWith("caller:console.")).toBe(false);
          expect(q.id.startsWith("caller:Math.")).toBe(false);
          expect(q.id).not.toBe("caller:setTimeout");
        }
      }
    }
    expect(generateStructuralQuestions(fixtureMap, { count: 50 }).some((q) => q.id === "caller:log")).toBe(true);
  });

  it("asks about `this.m` only for a method of the calling class, and about `ns.x` only for a relative namespace import", () => {
    const map = mapOf(
      [
        "a.ts",
        [
          'import * as ns from "./b";',
          'import * as lib from "lodash";',
          "class A { save() {} run() { this.save(); } idle() {} other() {} }",
          "class B { run() { this.save(); } }",
          "function f(obj: any) { obj.save(); }",
          "function useIt() { ns.go(); lib.map(); v.zzz(); }",
          "function idle1() {}",
          "function idle2() {}",
        ].join("\n"),
      ],
      ["b.ts", "export function go() {}"],
    );
    const all = generateStructuralQuestions(map, { count: 50 });
    const ids = all.map((q) => q.id);
    expect(ids).toContain("caller:this.save");
    expect(ids).toContain("caller:ns.go");
    expect(ids).not.toContain("caller:lib.map");
    expect(ids).not.toContain("caller:v.zzz");
    expect(ids).not.toContain("caller:obj.save");

    const thisSave = all.find((q) => q.id === "caller:this.save");
    expect(thisSave?.choices[thisSave.answerIndex]).toBe("A.run"); // B.run has no `save` method, so it does not count
    expect(thisSave?.choices).not.toContain("B.run");
    expect(thisSave?.choices).not.toContain("f"); // calls `obj.save()`, same last name
    for (const q of all) expectExactlyOneCorrect(map, q);
  });

  it("never asks about a `default` function or a class named `default`", () => {
    const map = mapOf(
      ["a.ts", "export default function () { helper(); }\nfunction helper() {}\nexport async function other(a) {}\nfunction pad() {}"],
      ["b.ts", "export default class { run() {} stop() {} }\nexport class Real { go() {} }"],
    );
    for (let seed = 0; seed < 10; seed++) {
      for (const q of generateStructuralQuestions(map, { seed, count: 50 })) {
        expect(q.id.includes("default")).toBe(false);
        for (const choice of q.choices) {
          expect(choice).not.toBe("default");
          expect(choice.startsWith("default.")).toBe(false);
        }
      }
    }
    // The only caller of `helper` is the anonymous default function, which is never used.
    expect(generateStructuralQuestions(map, { count: 50 }).some((q) => q.id === "caller:helper")).toBe(false);
  });

  it("asks param-count only about functions whose parameters are all plain identifiers", () => {
    const map = buildStructureMap(edgeSourceFiles().filter((f) => f.path === "edge/params.ts"));
    const ids = generateStructuralQuestions(map, { count: 50 }).map((q) => q.id);
    expect(ids).toContain("param-count:plain");
    expect(ids).toContain("param-count:caller");
    for (const skipped of ["withDefault", "withRest", "withPattern"]) expect(ids).not.toContain(`param-count:${skipped}`);
  });

  it("puts param-count choices in ascending order on attempt 0 and shuffles them on later attempts", () => {
    const params = (attempt: number) =>
      generateStructuralQuestions(richMap, { count: 50, attempt }).filter((q) => templateOf(q) === "param-count");
    const ascending = (q: StructuralQuestion) => q.choices.every((c, i) => i === 0 || Number(q.choices[i - 1]) < Number(c));
    expect(params(0).length).toBeGreaterThan(5);
    for (const q of params(0)) expect(ascending(q), q.id).toBe(true);
    for (const attempt of [1, 2, 3]) expect(params(attempt).some((q) => !ascending(q)), `attempt ${attempt}`).toBe(true);
  });

  it("names the file in the prompts of caller, async-pick and param-count", () => {
    for (const q of generateStructuralQuestions(richMap, { count: 50 })) {
      if (["caller", "async-pick", "param-count"].includes(templateOf(q))) {
        expect(q.prompt, q.id).toContain(`\`${q.source.path}\``);
      }
    }
  });

  it("uses a NUL character between file and module in import-from ids", () => {
    const q = generateStructuralQuestions(fixtureMap, { count: 50 }).find((item) => templateOf(item) === "import-from");
    expect(q?.id).toMatch(/^import-from:[^\u0000]+\u0000[^\u0000]+$/);
  });

  it("copes with names such as __proto__ and constructor", () => {
    const map = buildStructureMap(edgeSourceFiles().filter((f) => f.path === "edge/proto-names.ts"));
    const all = generateStructuralQuestions(map, { count: 50 });
    expect(all.length).toBeGreaterThan(0);
    for (const q of all) {
      expectExactlyOneCorrect(map, q);
      expectChoicesAreReal(map, q);
    }
  });
});

/** Ids of the questions of one template. */
function idsOf(questions: StructuralQuestion[], template: string): string[] {
  return questions.filter((q) => templateOf(q) === template).map((q) => q.id);
}

/** The question with this id for a seed, or undefined. */
function questionFor(map: StructureMap, id: string, seed: number): StructuralQuestion | undefined {
  return generateStructuralQuestions(map, { seed, count: 50 }).find((q) => q.id === id);
}

const SEEDS = Array.from({ length: 20 }, (_, i) => i);

describe("caller: wrong answers never mention the subject in any way (E9)", () => {
  // Each case is one extra function `mentions` that uses `helper` without a plain `helper()` call in its body.
  const cases: [label: string, code: string, isRealCaller: boolean][] = [
    ["helper.call(null)", "function mentions() { helper.call(null); }", false],
    ["helper.bind(null)()", "function mentions() { helper.bind(null)(); }", false],
    ["tagged template", "function mentions() { helper`x`; }", false],
    ["default parameter", "function mentions(a = helper()) {}", true],
    ["alias const h = helper; h()", "function mentions() { const h = helper; h(); }", false],
    ["callback [1].map(helper)", "function mentions() { [1].map(helper); }", false],
    ["route handler app.get('/', helper)", "function mentions() { app.get('/', helper); }", false],
    ["promise callback .then(helper)", "function mentions() { work().then(helper); }", false],
    ["computed member this['helper']()", "function mentions() { this['helper'](); }", false],
    ["parameter named like the subject (shadowing, open question 25)", "function mentions(helper) { helper(); }", true],
  ];

  for (const [label, code, isRealCaller] of cases) {
    it(`${label}: the function is never a wrong answer for \`helper\``, () => {
      const source = ["function helper() {}", "function other() { helper(); }", code, "function fourth() {}", "function fifth() {}"].join("\n");
      const map = mapOf(["a.ts", source]);
      // The cause: the map knows that `mentions` mentions `helper`.
      const mentions = map.files[0]?.functions.find((f) => f.name === "mentions");
      expect(mentions?.mentionedNames, "mentionedNames").toContain("helper");

      for (const seed of SEEDS) {
        const q = questionFor(map, "caller:helper", seed);
        expect(q, `seed ${seed}`).toBeDefined();
        const correct = q?.choices[q.answerIndex] ?? "";
        // The correct answer is `other`; `mentions` too when it really calls `helper(...)` in a way the map records.
        expect(isRealCaller ? ["other", "mentions"] : ["other"]).toContain(correct);
        const wrong = (q?.choices ?? []).filter((choice) => choice !== correct);
        expect(wrong.length).toBeGreaterThan(0);
        for (const choice of wrong) expect(["fourth", "fifth"], `seed ${seed}`).toContain(choice);
      }
    });
  }

  it("a function with a default parameter value `a = helper()` now counts as a caller", () => {
    const map = mapOf(["a.ts", "function helper() {}\nfunction mentions(a = helper()) {}"]);
    const mentions = map.files[0]?.functions.find((f) => f.name === "mentions");
    expect(mentions).toMatchObject({ calls: ["helper"], calledNames: ["helper"] });
    expect(mentions?.mentionedNames).toEqual(["a", "helper"]);
  });

  it("a function whose mention list was cut is never a wrong answer", () => {
    const cut = mapOf(["a.ts", "function helper() {}\nfunction other() { helper(); }\nfunction x() {}\nfunction y() {}"]);
    const file = cut.files[0] as FileEntry;
    // Pretend `x` mentions 500 names, which is the cut limit: `helper` could be among the dropped ones.
    const edited: StructureMap = {
      schemaVersion: 1,
      files: [{ ...file, functions: file.functions.map((f) => (f.name === "x" ? { ...f, mentionedNames: Array.from({ length: 500 }, (_, i) => `n${i}`) } : f)) }],
    };
    for (const seed of SEEDS) {
      const q = questionFor(edited, "caller:helper", seed);
      expect([...(q?.choices ?? [])].sort(), `seed ${seed}`).toEqual(["other", "y"]);
    }
  });
});

describe("class-method and inheritance (E10)", () => {
  /** Class `Admin extends Base` plus other classes and functions that could serve as wrong answers. */
  const baseAdmin = [
    "class Base { save() {} }",
    "class Admin extends Base { ban() {} }",
    "class Other { run() {} stop() {} }",
    "function pad() {}",
  ].join("\n");

  it("the Base.save / Admin.ban repro: `save` is never a wrong answer for Admin", () => {
    const map = mapOf(["a.ts", baseAdmin]);
    for (const seed of SEEDS) {
      const q = questionFor(map, "class-method:Admin", seed);
      expect(q, `seed ${seed}`).toBeDefined();
      expect(q?.choices[q.answerIndex]).toBe("ban");
      expect(q?.choices).not.toContain("save");
      expect([...(q?.choices ?? [])].sort()).toEqual(["ban", "pad", "run", "stop"]);
    }
  });

  it("Base is still asked about, and `ban` (a method of its child, not of Base) can be a wrong answer", () => {
    const map = mapOf(["a.ts", baseAdmin]);
    const offered = new Set<string>();
    for (const seed of SEEDS) {
      const q = questionFor(map, "class-method:Base", seed);
      expect(q?.choices[q.answerIndex]).toBe("save");
      for (const choice of q?.choices ?? []) offered.add(choice);
    }
    expect(offered.has("ban")).toBe(true);
  });

  it("walks the whole chain and also hides top-level functions named like an inherited method", () => {
    const map = mapOf([
      "a.ts",
      [
        "class A { a1() {} }",
        "class B extends A { b1() {} }",
        "class C extends B { c1() {} }",
        "class Other { run() {} stop() {} }",
        "function a1() {}",
        "function b1() {}",
      ].join("\n"),
    ]);
    for (const seed of SEEDS) {
      const q = questionFor(map, "class-method:C", seed);
      expect(q?.choices[q.answerIndex]).toBe("c1");
      expect(q?.choices).not.toContain("a1");
      expect(q?.choices).not.toContain("b1");
      expect([...(q?.choices ?? [])].sort()).toEqual(["c1", "run", "stop"]);
    }
  });

  it("a loop in the chain (A extends B, B extends A) does not hang and still hides the parent's methods", () => {
    const map = mapOf(["a.ts", "class A extends B { a1() {} }\nclass B extends A { b1() {} }\nclass Other { run() {} stop() {} }"]);
    for (const seed of SEEDS) {
      const q = questionFor(map, "class-method:A", seed);
      expect(q, `seed ${seed}`).toBeDefined();
      expect(q?.choices).not.toContain("b1");
      for (const other of generateStructuralQuestions(map, { seed, count: 50 })) expectExactlyOneCorrect(map, other);
    }
  });

  it("a class that extends a class outside the map gets no class-method question", () => {
    const map = mapOf(
      [
        "a.tsx",
        [
          'import { Imported } from "./elsewhere";',
          "class FromReact extends React.Component { render() {} }",
          "class FromImport extends Imported { go() {} }",
          "class FromMixin extends mixin(Base) { mix() {} }",
          "class Plain { one() {} two() {} }",
          "class Third { three() {} }",
        ].join("\n"),
      ],
      ["elsewhere.ts", "export function Imported() {}"], // not a class, so `FromImport` has a parent outside the map
    );
    expect(map.files[0]?.classes.map((c) => [c.name, c.superClass])).toEqual([
      ["FromImport", "Imported"],
      ["FromMixin", "(expression)"],
      ["FromReact", "React.Component"],
      ["Plain", undefined],
      ["Third", undefined],
    ]);
    for (const seed of SEEDS) {
      const ids = idsOf(generateStructuralQuestions(map, { seed, count: 50 }), "class-method");
      expect(ids, `seed ${seed}`).not.toContain("class-method:FromReact");
      expect(ids).not.toContain("class-method:FromMixin");
      expect(ids).not.toContain("class-method:FromImport");
      expect(ids).toContain("class-method:Plain");
    }
  });

  it("`Imported` is a class in the map here, so FromImport is asked about and Imported's methods are hidden", () => {
    const map = mapOf(
      ["a.ts", 'import { Imported } from "./elsewhere";\nclass FromImport extends Imported { go() {} }\nclass Other { run() {} stop() {} }'],
      ["elsewhere.ts", "export class Imported { inherited() {} }"],
    );
    for (const seed of SEEDS) {
      const q = questionFor(map, "class-method:FromImport", seed);
      expect(q, `seed ${seed}`).toBeDefined();
      expect(q?.choices).not.toContain("inherited");
    }
  });

  it("a getter or setter named like a wrong answer is never offered", () => {
    const map = mapOf([
      "a.ts",
      [
        "class G { get size() { return 1; } set mode(v: number) {} run() {} }",
        "class Other { size() {} mode() {} stop() {} fly() {} }",
      ].join("\n"),
    ]);
    expect(map.files[0]?.classes.find((c) => c.name === "G")?.accessors).toEqual(["mode", "size"]);
    expect(map.files[0]?.classes.find((c) => c.name === "G")?.methods.map((m) => m.name)).toEqual(["run"]);
    for (const seed of SEEDS) {
      const q = questionFor(map, "class-method:G", seed);
      expect(q?.choices[q.answerIndex]).toBe("run");
      expect([...(q?.choices ?? [])].sort()).toEqual(["fly", "run", "stop"]);
    }
  });

  it("an inherited getter is hidden too", () => {
    const map = mapOf(["a.ts", "class P { get size() { return 1; } }\nclass K extends P { run() {} }\nclass Other { size() {} stop() {} }"]);
    for (const seed of SEEDS) {
      const q = questionFor(map, "class-method:K", seed);
      expect([...(q?.choices ?? [])].sort()).toEqual(["run", "stop"]);
    }
  });
});

describe("export-owner and CommonJS (E10)", () => {
  /** `a.ts` exports `target`; `cjs.js` has the given code; two plain files can serve as wrong answers. */
  function cjsMap(code: string): StructureMap {
    return mapOf(
      ["a.ts", "export function target() {}"],
      ["cjs.js", code],
      ["f.ts", "export const plain = 1;"],
      ["g.ts", "export const other = 2;"],
    );
  }

  const hidden: [label: string, code: string][] = [
    ["exports.target = ...", "exports.target = function () {};"],
    ["exports['target'] = ...", "exports['target'] = 1;"],
    ["module.exports.target = ...", "module.exports.target = 1;"],
    ["module.exports = { target } (shorthand)", "const target = 1;\nmodule.exports = { target };"],
    ["module.exports = { target: fn } (key)", "module.exports = { target: function () {} };"],
    ["module.exports = { target() {} } (method)", "module.exports = { target() {} };"],
    ["chained exports.a = exports.target = ...", "exports.a = exports.target = 1;"],
    ["Object.defineProperty(exports, 'target', ...)", "Object.defineProperty(exports, 'target', { value: 1 });"],
    ["Object.assign(module.exports, { target })", "const target = 1;\nObject.assign(module.exports, { target });"],
    ["module.exports = something (unknown names)", "module.exports = make();"],
    ["module.exports = require('./x') (unknown names)", "module.exports = require('./x');"],
    ["spread in module.exports (unknown names)", "module.exports = { ...base };"],
    ["computed key in module.exports (unknown names)", "module.exports = { [key]: 1 };"],
    ["exports[name] = ... (unknown names)", "exports[name] = 1;"],
    ["Object.assign(exports, other) (unknown names)", "Object.assign(exports, other);"],
  ];

  for (const [label, code] of hidden) {
    it(`${label}: the file is never a wrong answer for \`target\``, () => {
      const map = cjsMap(code);
      const cjs = map.files.find((f) => f.path === "cjs.js") as FileEntry;
      expect(cjs.parsed).toBe(true);
      expect(cjs.commonjsExports.includes("target") || cjs.hasUnknownExports, "the map must show the CommonJS facts").toBe(true);
      for (const seed of SEEDS) {
        const q = questionFor(map, "export-owner:target", seed);
        expect(q, `seed ${seed}`).toBeDefined();
        expect(q?.choices[q.answerIndex]).toBe("a.ts");
        expect(q?.choices).not.toContain("cjs.js");
        expect([...(q?.choices ?? [])].sort()).toEqual(["a.ts", "f.ts", "g.ts"]);
      }
    });
  }

  it("control: a CommonJS file with other, readable exports is still a valid wrong answer", () => {
    for (const code of ["exports.unrelated = 1;", "module.exports = { unrelated: 1 };", "module.exports.unrelated = 1;"]) {
      const map = cjsMap(code);
      const cjs = map.files.find((f) => f.path === "cjs.js") as FileEntry;
      expect(cjs.hasUnknownExports, code).toBe(false);
      const q = questionFor(map, "export-owner:target", 0);
      expect([...(q?.choices ?? [])].sort(), code).toEqual(["a.ts", "cjs.js", "f.ts", "g.ts"]);
    }
  });

  it("the CommonJS facts do not add ES exports, so a CommonJS name is never asked about as a subject", () => {
    const map = cjsMap("exports.fromCommonjs = 1;");
    expect(map.files.find((f) => f.path === "cjs.js")?.exports).toEqual([]);
    for (const seed of SEEDS) {
      expect(idsOf(generateStructuralQuestions(map, { seed, count: 50 }), "export-owner")).not.toContain("export-owner:fromCommonjs");
    }
  });
});

describe("param-count position (re-review)", () => {
  /** `perCount` functions for each parameter count from 0 to 6, never exported, never calling anything. */
  function paramsMap(perCount: number): StructureMap {
    const lines: string[] = [];
    for (let p = 0; p <= 6; p++) {
      for (let i = 0; i < perCount; i++) {
        const params = Array.from({ length: p }, (_, k) => `a${k}`).join(", ");
        lines.push(`function f${p}_${i}(${params}) {}`);
      }
    }
    return mapOf(["src/p.ts", lines.join("\n")]);
  }
  const manyParams = paramsMap(6); // 42 functions: every question is a param-count question

  it("P12: on attempt 0 the correct answer is not always choice B, and its position varies", () => {
    fc.assert(
      fc.property(fc.nat(), (seed) => {
        const questions = generateStructuralQuestions(manyParams, { seed, attempt: 0, count: 50 });
        expect(questions).toHaveLength(42);
        const indexes = questions.map((q) => q.answerIndex);
        expect(new Set(indexes).size, "answerIndex must not be constant").toBeGreaterThan(1);
        expect(indexes.some((i) => i !== 1), "the correct answer must not always be the second-lowest").toBe(true);
        // With p >= 2 every choice position is possible; they must not all be the same one.
        const fromTwo = questions.filter((q) => Number(q.choices[q.answerIndex]) >= 2).map((q) => q.answerIndex);
        expect(new Set(fromTwo).size).toBeGreaterThan(1);
        for (const q of questions) {
          const p = Number(q.choices[q.answerIndex]);
          expect(q.choices).toHaveLength(4);
          for (const choice of q.choices) {
            expect(Number(choice)).toBeGreaterThanOrEqual(Math.max(0, p - 2));
            expect(Number(choice)).toBeLessThanOrEqual(p + 3);
          }
          expectExactlyOneCorrect(manyParams, q);
        }
      }),
    );
  });

  it("the old fixed offsets are gone: a function with 3 parameters sometimes gets p-2 or p+3 as a wrong answer", () => {
    const seen = new Set<number>();
    for (const seed of SEEDS) {
      const q = questionFor(manyParams, "param-count:f3_0", seed);
      for (const choice of q?.choices ?? []) seen.add(Number(choice));
    }
    expect(seen.has(1)).toBe(true); // p-2
    expect(seen.has(6)).toBe(true); // p+3
  });

  it("for 0 parameters the choices are 0 and three of 1, 2, 3, and for 1 parameter never negative", () => {
    for (const seed of SEEDS) {
      expect(questionFor(manyParams, "param-count:f0_0", seed)?.choices).toEqual(["0", "1", "2", "3"]);
      const one = questionFor(manyParams, "param-count:f1_0", seed);
      for (const choice of one?.choices ?? []) expect(Number(choice)).toBeGreaterThanOrEqual(0);
    }
  });
});

// A project with many questions per template, all with 4 choices (or 2 for async-pick).
function buildVariedMap(): StructureMap {
  const util: string[] = [];
  for (let i = 0; i < 16; i++) {
    const params = Array.from({ length: i % 7 }, (_, k) => `p${k}`).join(", ");
    util.push(`export ${i % 2 === 0 ? "async " : ""}function u${i}(${params}) { u${(i + 1) % 16}(); }`);
  }
  const classes: string[] = [];
  for (let i = 0; i < 12; i++) classes.push(`export class K${i} { k${i}a() {} k${i}b(x) {} k${i}c(x, y) {} }`);
  const files: [string, string][] = [
    ["src/util.ts", util.join("\n")],
    ["src/classes.ts", classes.join("\n")],
  ];
  for (let i = 0; i < 12; i++) files.push([`src/imp${i}.ts`, `import { u${i}, u${(i + 3) % 16} } from "./util";`]);
  return mapOf(...files);
}
const variedMap = buildVariedMap();

describe("answer position guard (re-review)", () => {
  it("P11: for every template the correct answer is not always at the same position on attempt 0", () => {
    fc.assert(
      fc.property(fc.nat(100_000), (firstSeed) => {
        // 5 seeds give each template about 40 questions, so a position leak shows and chance does not.
        const positions = new Map<string, Set<number>>(TEMPLATE_NAMES.map((name) => [name, new Set<number>()]));
        for (let seed = firstSeed; seed < firstSeed + 5; seed++) {
          for (const q of generateStructuralQuestions(variedMap, { seed, attempt: 0, count: 50 })) {
            positions.get(templateOf(q))?.add(q.answerIndex);
          }
        }
        for (const [template, set] of positions) {
          expect(set.size, `${template} answer positions ${[...set].join(",")}`).toBeGreaterThanOrEqual(2);
        }
      }),
      { numRuns: 20 },
    );
  });

  it("the varied map gives every template several questions, with 3 or more choices", () => {
    const questions = generateStructuralQuestions(variedMap, { count: 50 });
    for (const template of TEMPLATE_NAMES) {
      const own = questions.filter((q) => templateOf(q) === template);
      expect(own.length, template).toBeGreaterThanOrEqual(5);
      expect(own.some((q) => q.choices.length >= 3), template).toBe(true);
    }
  });
});

// A project big enough that every template can offer 4 choices (used by the per-template checks).
const richMap = mapOf(
  [
    "src/util.ts",
    [
      "export function load(a) { save(a); }",
      "export function save(a, b) { load(a); }",
      "export async function fetchAll(a) { load(a); }",
      "export async function fetchOne(a, b) { load(a); }",
      "export function parse(a) { load(a); }",
      "export function format(a, b, c) { parse(a); }",
      "export function trim(a) {}",
      "export function join(a) {}",
    ].join("\n"),
  ],
  [
    "src/service.ts",
    [
      'import { load, save, parse } from "./util";',
      "export class Service { start() { load(1); } stop() {} async run() {} }",
      "export class Other { go() {} }",
    ].join("\n"),
  ],
  ["src/other.ts", 'import { trim, join } from "./util";\nexport const x = 1;'],
  ["src/third.ts", 'import { format, fetchAll } from "./util";\nexport const y = 2;'],
);

// ---------------------------------------------------------------------------
// Properties P5-P10
// ---------------------------------------------------------------------------

const arbMap = arbProject.map((project) => buildStructureMap(toSourceFiles(project)));
// A generated project plus part of the edge corpus: decorators, odd exports, member chains, `__proto__`, `default`, CommonJS.
const arbEdgeMap = arbProjectWithEdges.map((files) => buildStructureMap(files));
const arbCount = fc.integer({ min: 0, max: 50 });
const MAP_KINDS: [string, fc.Arbitrary<StructureMap>][] = [
  ["generated projects", arbMap],
  ["generated projects plus the edge corpus", arbEdgeMap],
];

describe("generateStructuralQuestions properties", () => {
  it("P10: the generated maps reach all six templates, and both 2-choice and 4-choice questions", () => {
    const templates = new Set<string>();
    const choiceCounts = new Set<number>();
    for (const map of fc.sample(arbMap, { numRuns: 300, seed: 42 })) {
      for (const q of generateStructuralQuestions(map, { count: 50 })) {
        templates.add(templateOf(q));
        choiceCounts.add(q.choices.length);
      }
    }
    expect([...templates].sort()).toEqual([...TEMPLATE_NAMES].sort());
    expect(choiceCounts.has(2)).toBe(true);
    expect(choiceCounts.has(4)).toBe(true);
  });

  for (const [label, arb] of MAP_KINDS) {
    it(`P5: every question has 2 to 4 unique choices and a valid answerIndex (${label})`, () => {
      fc.assert(
        fc.property(arb, fc.nat(), (map, seed) => {
          for (const q of generateStructuralQuestions(map, { seed, count: 50 })) {
            expect(q.choices.length).toBeGreaterThanOrEqual(2);
            expect(q.choices.length).toBeLessThanOrEqual(4);
            expect(new Set(q.choices).size).toBe(q.choices.length);
            expect(Number.isInteger(q.answerIndex)).toBe(true);
            expect(q.answerIndex).toBeGreaterThanOrEqual(0);
            expect(q.answerIndex).toBeLessThan(q.choices.length);
          }
        }),
      );
    });

    it(`P6: exactly one choice is correct, checked against the map by a per-template oracle (${label})`, () => {
      fc.assert(
        fc.property(arb, fc.nat(), (map, seed) => {
          for (const q of generateStructuralQuestions(map, { seed, count: 50 })) expectExactlyOneCorrect(map, q);
        }),
      );
    });

    it(`P7: every choice is a real name in the map, never an ambiguous display name or default (${label})`, () => {
      fc.assert(
        fc.property(arb, fc.nat(), (map, seed) => {
          for (const q of generateStructuralQuestions(map, { seed, count: 50 })) expectChoicesAreReal(map, q);
        }),
      );
    });
  }

  it("P5a: a new attempt keeps ids, prompts, choice sets and the correct text; only the order changes", () => {
    fc.assert(
      fc.property(arbEdgeMap, fc.nat(), fc.nat(1000), fc.nat(1000), (map, seed, a, b) => {
        fc.pre(a !== b);
        const first = generateStructuralQuestions(map, { seed, attempt: a, count: 50 });
        const second = generateStructuralQuestions(map, { seed, attempt: b, count: 50 });
        expect(second.map((q) => [q.id, q.prompt, q.concept, q.source])).toEqual(first.map((q) => [q.id, q.prompt, q.concept, q.source]));
        for (const [i, q] of first.entries()) {
          const other = second[i] as StructuralQuestion;
          expect([...other.choices].sort()).toEqual([...q.choices].sort());
          expect(other.choices[other.answerIndex]).toBe(q.choices[q.answerIndex]);
        }
      }),
    );
  });

  it("P5a: over 20 attempts the correct answer of a 4-choice question moves around, for every template", () => {
    fc.assert(
      fc.property(fc.nat(), (seed) => {
        const base = generateStructuralQuestions(richMap, { seed, count: 50 });
        for (const template of TEMPLATE_NAMES) {
          const target = base.find((q) => templateOf(q) === template && q.choices.length === 4);
          expect(target, `a 4-choice ${template} question must exist`).toBeDefined();
          const positions = new Set<number>();
          for (let attempt = 0; attempt < 20; attempt++) {
            const q = generateStructuralQuestions(richMap, { seed, attempt, count: 50 }).find((item) => item.id === target?.id);
            positions.add(q?.answerIndex ?? -1);
          }
          expect(positions.size, `${template} ${target?.id}`).toBeGreaterThan(1);
        }
      }),
      { numRuns: 30 },
    );
  });

  it("P8: ids are unique, the count is respected, and the same input gives the same output", () => {
    fc.assert(
      fc.property(arbEdgeMap, fc.nat(), fc.nat(1000), arbCount, (map, seed, attempt, count) => {
        const options = { seed, attempt, count };
        const result = generateStructuralQuestions(map, options);
        expect(result.length).toBeLessThanOrEqual(count);
        expect(new Set(result.map((q) => q.id)).size).toBe(result.length);
        expect(generateStructuralQuestions(map, options)).toEqual(result);
      }),
    );
  });

  it("P9: a bigger count starts with the smaller result", () => {
    fc.assert(
      fc.property(arbEdgeMap, fc.nat(), arbCount, arbCount, (map, seed, x, y) => {
        const [small, big] = x <= y ? [x, y] : [y, x];
        const few = generateStructuralQuestions(map, { seed, count: small });
        const many = generateStructuralQuestions(map, { seed, count: big });
        expect(many.slice(0, small)).toEqual(few);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// T1: timing (req 2.20). The first build took 22 s for 4,000 functions and 7.8 s for 2,000 classes.
// These maps are built directly (not from source text), so the test only measures the generator.
// ---------------------------------------------------------------------------

function emptyFile(path: string): FileEntry {
  return {
    path,
    language: "typescript",
    lines: 1,
    parsed: true,
    errors: [],
    imports: [],
    exports: [],
    functions: [],
    classes: [],
    commonjsExports: [],
    hasUnknownExports: false,
  };
}

function fnEntry(name: string, line: number, over: Partial<FunctionEntry> = {}): FunctionEntry {
  const base = { name, params: line % 4, plainParams: true, async: line % 3 === 0, exported: true, line, calls: [], calledNames: [] };
  return { ...base, mentionedNames: over.calledNames ?? [], ...over };
}

/** `files` files with `perFile` functions each; every function calls its neighbour and every file imports from the next one. */
function bigFunctionMap(files: number, perFile: number): StructureMap {
  const list: FileEntry[] = [];
  for (let i = 0; i < files; i++) {
    const file = emptyFile(`src/f${i}.ts`);
    for (let j = 0; j < perFile; j++) {
      const callee = `fn${i}_${(j + 1) % perFile}`;
      file.functions.push(fnEntry(`fn${i}_${j}`, j + 1, { calls: [callee], calledNames: [callee] }));
      file.exports.push({ name: `fn${i}_${j}`, kind: "named", line: j + 1 });
    }
    file.imports.push({ source: `./f${(i + 1) % files}`, kind: "import", names: [`fn${(i + 1) % files}_0`, `fn${(i + 1) % files}_1`], typeOnly: false, line: 1 });
    list.push(file);
  }
  return { schemaVersion: 1, files: list };
}

/** `files` files with `perFile` classes each, two methods per class. */
function bigClassMap(files: number, perFile: number): StructureMap {
  const list: FileEntry[] = [];
  for (let i = 0; i < files; i++) {
    const file = emptyFile(`src/c${i}.ts`);
    for (let j = 0; j < perFile; j++) {
      const method = (name: string, line: number): MethodEntry => ({
        name,
        params: 1,
        plainParams: true,
        async: false,
        static: false,
        line,
        calls: [],
        calledNames: [],
        mentionedNames: [],
      });
      file.classes.push({
        name: `Class${i}_${j}`,
        exported: true,
        line: j + 1,
        accessors: [],
        methods: [method(`run${j}`, j + 2), method(`stop${j}`, j + 3)],
      });
      file.exports.push({ name: `Class${i}_${j}`, kind: "named", line: j + 1 });
    }
    list.push(file);
  }
  return { schemaVersion: 1, files: list };
}

function secondsFor(map: StructureMap): { ms: number; questions: StructuralQuestion[] } {
  const started = performance.now();
  const questions = generateStructuralQuestions(map, { count: 5 });
  return { ms: performance.now() - started, questions };
}

describe("generateStructuralQuestions speed (T1)", () => {
  it("1,000 functions with count 5 take under 500 ms", () => {
    const { ms, questions } = secondsFor(bigFunctionMap(25, 40));
    expect(questions).toHaveLength(5);
    expect(ms).toBeLessThan(500);
  });

  it("2,000 classes with count 5 take under 500 ms", () => {
    const { ms, questions } = secondsFor(bigClassMap(40, 50));
    expect(questions.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(500);
  });

  it("4,000 functions (the case that took 22 s) take under 1 s, and count 50 as well", () => {
    const map = bigFunctionMap(50, 80);
    expect(secondsFor(map).ms).toBeLessThan(1000);
    const started = performance.now();
    expect(generateStructuralQuestions(map, { count: 50 })).toHaveLength(50);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("1,000 functions that each mention 500 names (mentionedNames) still take under 1 s, with count 5 and 50", () => {
    const map = bigFunctionMap(25, 40);
    const names = Array.from({ length: 498 }, (_, i) => `name${i}`); // plus the called name = 499; a full 500 would mean "cut"
    for (const file of map.files) for (const fn of file.functions) fn.mentionedNames = [...names, ...fn.calledNames].sort();
    expect(secondsFor(map).ms).toBeLessThan(1000);
    const started = performance.now();
    expect(generateStructuralQuestions(map, { count: 50 }).length).toBeGreaterThan(5);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("the big maps still give questions with one correct choice", () => {
    for (const map of [bigFunctionMap(10, 20), bigClassMap(10, 20)]) {
      for (const q of generateStructuralQuestions(map, { count: 20 })) {
        expect(q.choices.length).toBeGreaterThanOrEqual(2);
        expectExactlyOneCorrect(map, q);
      }
    }
  });
});
