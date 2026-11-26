// Tests for structure-map.ts: example cases from the spec (E1-E4) and fast-check properties (P1-P4).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildStructureMap, MAP_LIMITS, type FileEntry, type SourceFile, type StructureMap } from "./structure-map.js";
import { arbProject, toSourceFiles } from "./test-support/arb-project.js";
import { EDGE_CORPUS, edgeSourceFiles } from "./test-support/edge-corpus.js";

// Reads every file under packages/core/fixtures/ (tests may do I/O; the core module may not).
function loadFixtures(): SourceFile[] {
  const root = fileURLToPath(new URL("../fixtures/", import.meta.url));
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((name) => statSync(root + name).isFile())
    .map((name) => ({ path: name, content: readFileSync(root + name, "utf8") }));
}

const fixtureMap: StructureMap = buildStructureMap(loadFixtures());

function fileOf(map: StructureMap, path: string): FileEntry {
  const file = map.files.find((f) => f.path === path);
  if (!file) throw new Error(`no file ${path} in the map`);
  return file;
}

describe("buildStructureMap: file-level facts", () => {
  it("returns one entry per file, sorted by path, with schemaVersion 1", () => {
    expect(fixtureMap.schemaVersion).toBe(1);
    const paths = fixtureMap.files.map((f) => f.path);
    expect(paths).toEqual([
      "broken.ts",
      "component.jsx",
      "project/src/index.ts",
      "project/src/logger.ts",
      "project/src/math.ts",
      "project/src/user-service.ts",
      "script.py",
    ]);
  });

  it("E3: a python file only gets path, language and line count", () => {
    expect(fileOf(fixtureMap, "script.py")).toEqual({
      path: "script.py",
      language: "python",
      lines: 3,
      parsed: false,
      errors: [],
      imports: [],
      exports: [],
      functions: [],
      classes: [],
      commonjsExports: [],
      hasUnknownExports: false,
    });
  });

  it("detects the language from the extension, ignoring case", () => {
    const map = buildStructureMap([
      { path: "a.MJS", content: "" },
      { path: "b.tsx", content: "" },
      { path: "c.json", content: "{}" },
      { path: "d.md", content: "# hi" },
      { path: "e.css", content: "" },
      { path: "f.html", content: "" },
      { path: "constructor", content: "" },
      { path: "g.unknown", content: "" },
    ]);
    const languages = Object.fromEntries(map.files.map((f) => [f.path, f.language]));
    expect(languages).toEqual({
      "a.MJS": "javascript",
      "b.tsx": "typescript",
      "c.json": "json",
      "d.md": "markdown",
      "e.css": "css",
      "f.html": "html",
      constructor: "other",
      "g.unknown": "other",
    });
  });

  it("counts lines like req 1.12", () => {
    const linesOf = (content: string) => buildStructureMap([{ path: "x.txt", content }]).files[0]?.lines;
    expect(linesOf("")).toBe(0);
    expect(linesOf("a")).toBe(1);
    expect(linesOf("a\n")).toBe(1);
    expect(linesOf("a\nb")).toBe(2);
    expect(linesOf("a\r\nb\r\n")).toBe(2);
    expect(linesOf("a\rb\rc")).toBe(3);
    expect(linesOf("\n")).toBe(1);
    expect(linesOf("a\n\n")).toBe(2);
  });

  it("normalises backslashes, ./ segments anywhere, repeated slashes and a leading slash in paths", () => {
    const map = buildStructureMap([
      { path: ".\\src\\a.ts", content: "" },
      { path: "./b.ts", content: "" },
      { path: "c//d.ts", content: "" },
      { path: "e/./f.ts", content: "" },
      { path: "/g.ts", content: "" },
      { path: "././h.ts", content: "" },
    ]);
    expect(map.files.map((f) => f.path)).toEqual(["b.ts", "c/d.ts", "e/f.ts", "g.ts", "h.ts", "src/a.ts"]);
  });
});

describe("buildStructureMap: extraction (E1-E3)", () => {
  it("E1: user-service.ts has the class, its methods and the async function", () => {
    const file = fileOf(fixtureMap, "project/src/user-service.ts");
    const service = file.classes.find((c) => c.name === "UserService");
    expect(service?.exported).toBe(true);
    expect(service?.methods.map((m) => m.name)).toEqual(["countAll", "findUser"]);

    const findUser = service?.methods.find((m) => m.name === "findUser");
    expect(findUser).toMatchObject({ params: 1, plainParams: true, async: true, static: false });
    // `this.db.get(id)` has a member chain as its callee, so `calls` skips it (req 1.9) ...
    expect(findUser?.calls).toEqual(["log"]);
    // ... but `calledNames` keeps the last name of every call (req 1.9a).
    expect(findUser?.calledNames).toEqual(["get", "log"]);

    const countAll = service?.methods.find((m) => m.name === "countAll");
    expect(countAll).toMatchObject({ params: 2, async: false, calls: ["add"], calledNames: ["add"] });

    const loadUser = file.functions.find((f) => f.name === "loadUser");
    expect(loadUser).toMatchObject({ params: 1, async: true, exported: true, calls: ["s.findUser"], calledNames: ["findUser"] });
  });

  it("E1: imports are recorded with their names", () => {
    const file = fileOf(fixtureMap, "project/src/user-service.ts");
    expect(file.imports.map((i) => [i.source, i.names, i.kind, i.typeOnly])).toEqual([
      ["./logger", ["log"], "import", false],
      ["./math", ["add"], "import", false],
    ]);
  });

  it("E2: math.ts has add, multiply and square, and only multiply is private", () => {
    const file = fileOf(fixtureMap, "project/src/math.ts");
    expect(file.functions.map((f) => f.name)).toEqual(["add", "multiply", "square"]);
    expect(file.functions.find((f) => f.name === "multiply")?.exported).toBe(false);
    expect(file.functions.find((f) => f.name === "add")?.exported).toBe(true);
    expect(file.functions.find((f) => f.name === "square")).toMatchObject({ exported: true, params: 1, calls: ["multiply"] });
    expect(file.exports.map((e) => [e.name, e.kind])).toEqual([
      ["add", "named"],
      ["square", "named"],
    ]);
  });

  it("E2: index.ts has a re-export, a namespace import and a default export", () => {
    const file = fileOf(fixtureMap, "project/src/index.ts");
    expect(file.exports).toContainEqual(expect.objectContaining({ name: "loadUser", kind: "reexport", from: "./user-service" }));
    expect(file.exports).toContainEqual(expect.objectContaining({ name: "main", kind: "default" }));
    expect(file.imports).toContainEqual(expect.objectContaining({ source: "./math", namespace: "math", names: [] }));
    expect(file.functions).toEqual([expect.objectContaining({ name: "main", exported: true, calls: ["math.add"] })]);
  });

  it("E3: a syntax error gives parsed false with an error, and the other files are still mapped", () => {
    const broken = fileOf(fixtureMap, "broken.ts");
    expect(broken.parsed).toBe(false);
    expect(broken.errors.length).toBeGreaterThanOrEqual(1);
    expect(broken.functions).toEqual([]);
    expect(fixtureMap.files).toHaveLength(7);
    expect(fileOf(fixtureMap, "project/src/math.ts").parsed).toBe(true);
  });

  it("E3: JSX parses in a .jsx file and gives the default export", () => {
    const component = fileOf(fixtureMap, "component.jsx");
    expect(component.parsed).toBe(true);
    expect(component.errors).toEqual([]);
    expect(component.functions).toEqual([expect.objectContaining({ name: "App", params: 1, exported: true })]);
    expect(component.exports).toEqual([expect.objectContaining({ name: "App", kind: "default" })]);
  });

  it("omits optional fields instead of setting them to undefined", () => {
    const math = fileOf(fixtureMap, "project/src/math.ts");
    expect(Object.keys(math.exports[0] ?? {}).sort()).toEqual(["kind", "line", "name"]);
    const logger = fileOf(fixtureMap, "project/src/user-service.ts").imports[0];
    expect(Object.keys(logger ?? {}).sort()).toEqual(["kind", "line", "names", "source", "typeOnly"]);
  });

  it("snapshot of the full fixture map", () => {
    expect(fixtureMap).toMatchSnapshot();
  });
});

describe("buildStructureMap: more syntax", () => {
  const one = (path: string, content: string): FileEntry => {
    const entry = buildStructureMap([{ path, content }]).files[0];
    if (!entry) throw new Error("no entry");
    return entry;
  };

  it("reads require imports, default and type-only imports", () => {
    const file = one(
      "a.ts",
      [
        'const fs = require("node:fs");',
        'const { join, "x-y": xy } = require("node:path");',
        'import type { A, B } from "./types";',
        'import def, { type C, d as e } from "./mix";',
        'import { type F } from "./only-types";',
      ].join("\n"),
    );
    const bySource = Object.fromEntries(file.imports.map((i) => [i.source, i]));
    expect(bySource["node:fs"]).toMatchObject({ kind: "require", defaultName: "fs", names: [] });
    expect(bySource["node:path"]).toMatchObject({ kind: "require", names: ["join", "x-y"] });
    expect(bySource["./types"]).toMatchObject({ kind: "import", names: ["A", "B"], typeOnly: true });
    expect(bySource["./mix"]).toMatchObject({ defaultName: "def", names: ["C", "d"], typeOnly: false });
    expect(bySource["./only-types"]).toMatchObject({ names: ["F"], typeOnly: true });
  });

  it("reads every kind of export", () => {
    const file = one(
      "a.ts",
      [
        "export const x = 1;",
        "export interface Shape { a: number }",
        "export type Id = string;",
        "export enum Color { Red }",
        "function local() {}",
        "class Local {}",
        "export { local, Local as Renamed };",
        'export { y as z } from "./other";',
        'export * from "./all";',
        'export * as ns from "./space";',
        "export default local;",
      ].join("\n"),
    );
    const pairs = file.exports.map((e) => `${e.kind}:${e.name}${e.from ? `<${e.from}` : ""}`);
    expect(pairs).toEqual([
      "reexport:*<./all",
      "named:Color",
      "named:Id",
      "named:Renamed",
      "named:Shape",
      "named:local",
      "default:local",
      "reexport:ns<./space",
      "named:x",
      "reexport:z<./other",
    ]);
    // `export { local, Local as Renamed }` marks the local function and class as exported.
    expect(file.functions[0]).toMatchObject({ name: "local", exported: true });
    expect(file.classes[0]).toMatchObject({ name: "Local", exported: true });
  });

  it("`export { a as default }` is a default export of a", () => {
    const file = one("a.js", "function a() {}\nexport { a as default };");
    expect(file.exports).toEqual([{ name: "a", kind: "default", line: 2 }]);
  });

  it("names an anonymous default export `default`", () => {
    const file = one("a.js", "export default async (a, b) => a + b;");
    expect(file.functions).toEqual([
      { name: "default", params: 2, plainParams: true, async: true, exported: true, line: 1, calls: [], calledNames: [], mentionedNames: ["a", "b"] },
    ]);
    expect(file.exports).toEqual([{ name: "default", kind: "default", line: 1 }]);
  });

  it("counts rest and default parameters once and ignores a TypeScript `this` parameter", () => {
    const file = one("a.ts", "function f(this: Window, a = 1, ...rest: number[]) {}");
    expect(file.functions[0]?.params).toBe(2);
  });

  it("skips TS overload signatures and records the implementation once", () => {
    const file = one("a.ts", "export function f(a: string): void;\nexport function f(a: number): void;\nexport function f(a: any) {}");
    expect(file.functions).toHaveLength(1);
    expect(file.exports.map((e) => e.name)).toEqual(["f"]);
  });

  it("reads static methods and arrow-function properties, and skips constructors, getters and setters", () => {
    const file = one(
      "a.ts",
      [
        "class A {",
        "  constructor(private x: number) {}",
        "  get size() { return 1; }",
        "  set size(v: number) {}",
        "  static make() { return A.build(); }",
        "  run = async (n: number) => { this.stop(); };",
        "  [computed]() {}",
        "  #secret() {}",
        "}",
      ].join("\n"),
    );
    expect(file.classes[0]?.methods).toEqual([
      { name: "make", params: 0, plainParams: true, async: false, static: true, line: 5, calls: ["A.build"], calledNames: ["build"], mentionedNames: ["A", "build"] },
      { name: "run", params: 1, plainParams: true, async: true, static: false, line: 6, calls: ["this.stop"], calledNames: ["stop"], mentionedNames: ["n", "stop"] },
    ]);
    // The getter and the setter are not methods; their name is recorded once in `accessors`.
    expect(file.classes[0]?.accessors).toEqual(["size"]);
  });

  it("records `superClass`: a name, a dotted name, or `(expression)`; the field is left out without `extends`", () => {
    const file = one(
      "a.ts",
      [
        "class A {}",
        "class B extends A {}",
        "class C extends React.Component {}",
        "class D extends a.b.C<Props> {}",
        "class E extends mixin(A) {}",
        "class F extends a['b'] {}",
        "class G extends (cond ? A : B) {}",
      ].join("\n"),
    );
    const supers = Object.fromEntries(file.classes.map((c) => [c.name, c.superClass]));
    expect(supers).toEqual({ A: undefined, B: "A", C: "React.Component", D: "a.b.C", E: "(expression)", F: "(expression)", G: "(expression)" });
    expect("superClass" in (file.classes.find((c) => c.name === "A") ?? {})).toBe(false);
  });

  it("records getter and setter names sorted and without duplicates, including string and computed-skipped ones", () => {
    const file = one("a.ts", 'class A { get z() { return 1; } set z(v) {} get a() { return 1; } get "b-c"() { return 1; } get [k]() { return 1; } run() {} }');
    expect(file.classes[0]?.accessors).toEqual(["a", "b-c", "z"]);
    expect(file.classes[0]?.methods.map((m) => m.name)).toEqual(["run"]);
  });

  it("records every name a function mentions, in params (defaults included) and body", () => {
    const file = one(
      "a.ts",
      [
        "function f(a, b = dflt(), { c }: Opts, ...rest) {",
        "  helper.call(null); list.map(cb); app.get('/', route); obj['quoted'](); `x${tpl}`; other?.deep.chain;",
        "}",
        "const g = () => 1;",
      ].join("\n"),
    );
    const f = file.functions.find((fn) => fn.name === "f");
    expect(f?.mentionedNames).toEqual(
      ["Opts", "a", "app", "b", "c", "call", "cb", "chain", "deep", "dflt", "get", "helper", "list", "map", "obj", "other", "quoted", "rest", "route", "tpl"],
    );
    expect(file.functions.find((fn) => fn.name === "g")?.mentionedNames).toEqual([]);
  });

  it("mentionedNames covers each way of using a name: call(), bind(), tagged template, default value, alias, callbacks", () => {
    const cases: [string, string][] = [
      ["helper.call(null)", "function f() { helper.call(null); }"],
      ["helper.bind(null)()", "function f() { helper.bind(null)(); }"],
      ["tagged template", "function f() { helper`x`; }"],
      ["default parameter", "function f(a = helper()) {}"],
      ["alias", "function f() { const h = helper; h(); }"],
      ["callback", "function f() { [1].map(helper); }"],
      ["route", "function f() { app.get('/', helper); }"],
      ["then", "function f() { p.then(helper); }"],
      ["computed string member", "function f() { this['helper'](); }"],
      ["JSX component", "function f() { return <helper />; }"],
    ];
    for (const [label, code] of cases) {
      expect(one("a.tsx", code).functions[0]?.mentionedNames, label).toContain("helper");
    }
  });

  it("walks parameters for calls too: `function f(a = helper())` calls helper", () => {
    const file = one("a.ts", "function f(a = helper(), b = obj.go()) {}\nconst g = (x = make()) => x;");
    expect(file.functions.find((fn) => fn.name === "f")).toMatchObject({ calls: ["helper", "obj.go"], calledNames: ["go", "helper"] });
    expect(file.functions.find((fn) => fn.name === "g")).toMatchObject({ calls: ["make"] });
  });

  it("keeps at most 500 mentioned names, the first 500 in sorted order", () => {
    const names = Array.from({ length: 700 }, (_, i) => `n${String(i).padStart(3, "0")}`);
    const file = one("a.ts", `function f() { ${names.map((n) => `${n};`).join(" ")} }`);
    const mentioned = file.functions[0]?.mentionedNames ?? [];
    expect(mentioned).toHaveLength(500);
    expect(mentioned[0]).toBe("n000");
    expect(mentioned[499]).toBe("n499");
  });

  it("records CommonJS exports: exports.x, module.exports.x, object literal, chains, defineProperty, assign", () => {
    const names = (code: string) => {
      const file = one("a.js", code);
      return [file.commonjsExports, file.hasUnknownExports, file.exports] as const;
    };
    expect(names("exports.a = 1; exports['b'] = 2; module.exports.c = 3;")).toEqual([["a", "b", "c"], false, []]);
    expect(names("module.exports = { a, b: 1, 'c-d': 2, e() {}, async f() {}, get g() { return 1; } };")).toEqual([["a", "b", "c-d", "e", "f", "g"], false, []]);
    expect(names("exports.a = exports.b = module.exports.c = void 0;")).toEqual([["a", "b", "c"], false, []]);
    expect(names("Object.defineProperty(exports, '__esModule', { value: true });")).toEqual([["__esModule"], false, []]);
    expect(names("Object.assign(module.exports, { a, b: 1 }, { c });")).toEqual([["a", "b", "c"], false, []]);
    expect(names("module.exports = {};\nmodule.exports.late = 1;")).toEqual([["late"], false, []]);
    expect(names("const a = 1;")).toEqual([[], false, []]);
  });

  it("records `module.exports = something` as `default` with unknown exports, and other unreadable forms as unknown", () => {
    const facts = (code: string) => {
      const file = one("a.js", code);
      return [file.commonjsExports, file.hasUnknownExports];
    };
    expect(facts("module.exports = make();")).toEqual([["default"], true]);
    expect(facts("module.exports = require('./x');")).toEqual([["default"], true]);
    expect(facts("module.exports = function () {};")).toEqual([["default"], true]);
    expect(facts("exports = module.exports = fn;")).toEqual([["default"], true]);
    expect(facts("module.exports = { a, ...rest };")).toEqual([["a"], true]);
    expect(facts("module.exports = { [key]: 1, b: 2 };")).toEqual([["b"], true]);
    expect(facts("exports[name] = 1;")).toEqual([[], true]);
    expect(facts("Object.assign(exports, other);")).toEqual([[], true]);
    expect(facts("Object.defineProperty(exports, name, {});")).toEqual([[], true]);
  });

  it("does not mistake other code for CommonJS exports", () => {
    const code = [
      "foo.exports = 1;",
      "module.other = 2;",
      "exports = 3;", // reassigns a local, not an export
      "const x = { exports: 1 };",
      "function f() { exports.inner = 1; module.exports = 2; }", // not a top-level statement
      "Object.assign(local, { a });",
      "Object.keys(exports);",
    ].join("\n");
    const file = one("a.js", code);
    expect([file.commonjsExports, file.hasUnknownExports]).toEqual([[], false]);
  });

  it("gives an unparsed or non-JS file no CommonJS facts", () => {
    for (const [path, content] of [["a.py", "module.exports = 1"], ["b.ts", "module.exports = {"]] as const) {
      const file = one(path, content);
      expect([file.commonjsExports, file.hasUnknownExports], path).toEqual([[], false]);
    }
  });

  it("keeps a static and an instance method of the same name, and orders ties by line", () => {
    const file = one("a.ts", "class A {\n  go() {}\n  static go() {}\n  go2() {}\n}");
    expect(file.classes[0]?.methods.map((m) => [m.name, m.static, m.line])).toEqual([
      ["go", false, 2],
      ["go", true, 3],
      ["go2", false, 4],
    ]);
  });

  it("marks parameters as plain only when every one is a plain identifier", () => {
    const file = one(
      "a.ts",
      [
        "function plain(a: number, b?: string) {}",
        "function withThis(this: Window, a) {}",
        "function withDefault(a = 1) {}",
        "function withRest(...r: number[]) {}",
        "function withObject({ a }: X) {}",
        "function withArray([a]: X) {}",
        "const arrow = ({ a }) => a;",
      ].join("\n"),
    );
    const plain = Object.fromEntries(file.functions.map((f) => [f.name, f.plainParams]));
    expect(plain).toEqual({ plain: true, withThis: true, withDefault: false, withRest: false, withObject: false, withArray: false, arrow: false });
    expect(file.functions.find((f) => f.name === "withObject")?.params).toBe(1);
  });

  it("collects calls inside nested functions, optional calls and `this.x`; skips other callees", () => {
    const file = one(
      "a.ts",
      [
        "function f() {",
        "  const inner = () => { helper(); };",
        "  obj.run();",
        "  a?.b();",
        "  this.go();",
        "  a.b.c();",
        "  make()();",
        "  list[0]();",
        "  obj['x']();",
        "  helper();",
        "}",
      ].join("\n"),
    );
    expect(file.functions[0]?.calls).toEqual(["a.b", "helper", "make", "obj.run", "this.go"]);
    // calledNames: the last name of every call, also of member chains and of obj['x']; `list[0]()` has none.
    expect(file.functions[0]?.calledNames).toEqual(["b", "c", "go", "helper", "make", "run", "x"]);
  });

  it("sorts top-level entries by name, so source order does not matter", () => {
    const file = one("a.ts", "function b() {}\nfunction a() {}\nclass Z {}\nclass Y {}");
    expect(file.functions.map((f) => f.name)).toEqual(["a", "b"]);
    expect(file.classes.map((c) => c.name)).toEqual(["Y", "Z"]);
  });

  it("uses script mode when it records fewer errors than module mode (CommonJS with `with` or octal)", () => {
    // In module mode Babel records these as errors without throwing; as a script they are fine.
    const withStatement = one("a.js", "with (a) { b(); }\nfunction f() { g(); }");
    expect(withStatement.errors).toEqual([]);
    expect(withStatement.parsed).toBe(true);
    expect(withStatement.functions[0]).toMatchObject({ name: "f", calls: ["g"] });

    const octal = one("b.js", "var n = 010;\nfunction h() {}");
    expect(octal.errors).toEqual([]);
    expect(octal.functions.map((f) => f.name)).toEqual(["h"]);
  });

  it("keeps the module result on a tie or when script mode is worse", () => {
    // Module mode: 1 error (redeclared `a`). Script mode: that error plus `import` outside a module.
    const file = one("a.js", 'import x from "./y";\nlet a = 1;\nlet a = 2;');
    expect(file.errors).toHaveLength(1);
    expect(file.imports.map((i) => i.source)).toEqual(["./y"]);
  });

  it("treats a file with errors in both modes as parsed with the module errors (tie keeps module)", () => {
    const file = one("a.ts", "let a = 1;\nlet a = 2;\nexport function ok() {}");
    expect(file.parsed).toBe(true);
    expect(file.errors).toHaveLength(1);
    expect(file.exports.map((e) => e.name)).toEqual(["ok"]);
  });

  it("records recovered errors (at most 10) and still extracts what it can", () => {
    const content = "let a = 1;\n".repeat(1) + "let a = 2;\n".repeat(15) + "function ok() {}";
    const file = one("a.ts", content);
    expect(file.parsed).toBe(true);
    expect(file.errors.length).toBe(10);
    expect(file.errors[0]?.line).toBeGreaterThan(0);
    expect(file.functions.map((f) => f.name)).toEqual(["ok"]);
  });

  it("reports very deep nesting as `parsed: false` with a readable message and does not throw", () => {
    // Babel itself overflows its stack at about 500 levels (probed with 7.29.14: 300 parses, 500 throws).
    const deep = "[".repeat(600) + "]".repeat(600);
    let entry: FileEntry | undefined;
    expect(() => {
      entry = buildStructureMap([{ path: "deep.js", content: deep }]).files[0];
    }).not.toThrow();
    expect(entry?.parsed).toBe(false);
    expect(entry?.errors).toEqual([{ message: "nested too deeply to parse", line: 0 }]);
    expect(entry?.errors[0]?.message).not.toMatch(/call stack/i);
  });

  it("still parses moderate nesting", () => {
    const nested = "[".repeat(100) + "]".repeat(100);
    expect(one("ok.js", `function f() { return ${nested}; }`).parsed).toBe(true);
  });

  it("parses decorated classes (Angular and NestJS style)", () => {
    const exported = one("a.ts", '@Component({ selector: "x" })\nexport class A { go() {} }');
    expect(exported.parsed).toBe(true);
    expect(exported.errors).toEqual([]);
    expect(exported.classes.map((c) => [c.name, c.exported])).toEqual([["A", true]]);
    expect(exported.exports.map((e) => e.name)).toEqual(["A"]);

    const plain = one("b.ts", "@dec class A {}");
    expect(plain.parsed).toBe(true);
    expect(plain.classes.map((c) => c.name)).toEqual(["A"]);

    // The same plugin list is used for .tsx and JavaScript.
    expect(one("c.tsx", "@dec class C { render() { return <div />; } }").classes.map((c) => c.name)).toEqual(["C"]);
    expect(one("d.js", "@dec class D {}").classes.map((c) => c.name)).toEqual(["D"]);
  });

  it("records the names of destructured exports, nested, with defaults and rest", () => {
    const file = one("a.ts", "export const { a, b: { c }, d = 1, ...rest } = x;\nexport const [e, [f], ...tail] = y;");
    expect(file.exports.map((e) => e.name)).toEqual(["a", "c", "d", "e", "f", "rest", "tail"]);
    expect(file.exports.every((e) => e.kind === "named")).toBe(true);
  });

  it("records exported namespaces and modules", () => {
    const file = one("a.ts", "export namespace NS { export const x = 1; }\nexport module M {}\nexport declare namespace D {}\nexport namespace P.Q {}\ndeclare global { }");
    expect(file.exports.map((e) => e.name)).toEqual(["D", "M", "NS", "P"]);
  });

  it("records `export = foo` as the default export foo, and marks the function as exported", () => {
    const file = one("a.ts", "function foo() {}\nexport = foo;");
    expect(file.exports).toEqual([{ name: "foo", kind: "default", line: 2 }]);
    expect(file.functions[0]).toMatchObject({ name: "foo", exported: true });
    expect(one("b.ts", "export = { a: 1 };").exports).toEqual([{ name: "default", kind: "default", line: 1 }]);
  });

  it("records `export import X = require(...)` but not a plain `import X = require(...)`", () => {
    const file = one("a.ts", 'export import X = require("./x");\nexport import Y = A.B;\nimport Z = require("./z");');
    expect(file.exports.map((e) => e.name)).toEqual(["X", "Y"]);
  });

  it("records `export default interface I {}` as default:default without a function entry", () => {
    const file = one("a.ts", "export default interface I { a: number }");
    expect(file.exports).toEqual([{ name: "default", kind: "default", line: 1 }]);
    expect(file.functions).toEqual([]);
  });

  it("records `export declare function f()` as an export without a function entry", () => {
    const file = one("a.ts", "export declare function f(a: number): void;");
    expect(file.exports.map((e) => [e.name, e.kind])).toEqual([["f", "named"]]);
    expect(file.functions).toEqual([]);
  });

  it("treats .d.ts, .d.mts and .d.cts as declaration files, which allow a bare `const x: number;`", () => {
    const content = "export const x: number;";
    for (const path of ["a.d.ts", "a.d.mts", "a.d.cts"]) expect(one(path, content).errors, path).toEqual([]);
    // Control: a normal .mts file reports the missing initializer.
    expect(one("a.mts", content).errors.length).toBeGreaterThanOrEqual(1);
  });
});

describe("edge corpus", () => {
  const map = buildStructureMap(edgeSourceFiles());

  it("every corpus file parses without errors", () => {
    for (const file of map.files) {
      expect(file.parsed, file.path).toBe(true);
      expect(file.errors, file.path).toEqual([]);
    }
  });

  it("every corpus file shows exactly the facts written next to it", () => {
    for (const expected of EDGE_CORPUS) {
      const file = fileOf(map, expected.path);
      expect(file.exports.map((e) => e.name), `${expected.path} exports`).toEqual(expected.exports);
      expect(file.classes.map((c) => c.name), `${expected.path} classes`).toEqual(expected.classes);
      expect(file.functions.map((f) => f.name), `${expected.path} functions`).toEqual(expected.functions);
      for (const [name, calledNames] of expected.calledNames ?? []) {
        expect(file.functions.find((f) => f.name === name)?.calledNames, `${expected.path} ${name}`).toEqual(calledNames);
      }
      expect(file.commonjsExports, `${expected.path} commonjsExports`).toEqual(expected.commonjsExports ?? []);
      expect(file.hasUnknownExports, `${expected.path} hasUnknownExports`).toBe(expected.hasUnknownExports ?? false);
    }
  });
});

describe("buildStructureMap: E4 limits", () => {
  const ts = (n: number): SourceFile[] => Array.from({ length: n }, (_, i) => ({ path: `f${i}.ts`, content: "" }));

  it("exports the limits", () => {
    expect(MAP_LIMITS).toEqual({ maxFiles: 50, maxTotalBytes: 102_400 });
  });

  it("accepts 50 files and rejects 51", () => {
    expect(buildStructureMap(ts(50)).files).toHaveLength(50);
    expect(() => buildStructureMap(ts(51))).toThrow(RangeError);
  });

  it("accepts exactly 102400 bytes and rejects 102401", () => {
    expect(() => buildStructureMap([{ path: "big.txt", content: "a".repeat(102_400) }])).not.toThrow();
    expect(() => buildStructureMap([{ path: "big.txt", content: "a".repeat(102_401) }])).toThrow(RangeError);
  });

  it("counts bytes, not characters", () => {
    const content = "é".repeat(51_200) + "a"; // 102 401 bytes, 51 201 characters
    expect(() => buildStructureMap([{ path: "big.txt", content }])).toThrow(/102401 bytes, limit 102400/);
  });

  it("counts the total over all files", () => {
    const half = "a".repeat(51_201);
    expect(() =>
      buildStructureMap([
        { path: "a.txt", content: half },
        { path: "b.txt", content: half },
      ]),
    ).toThrow(RangeError);
  });

  it("rejects paths that collide after normalising", () => {
    const pairs: [string, string][] = [
      ["a/b.ts", "a\\b.ts"],
      ["././a.ts", "a.ts"],
      ["a//b.ts", "a/b.ts"],
      ["a/./b.ts", "a/b.ts"],
      ["/a.ts", "a.ts"],
    ];
    for (const [first, second] of pairs) {
      const files = [
        { path: first, content: "" },
        { path: second, content: "" },
      ];
      expect(() => buildStructureMap(files), `${first} vs ${second}`).toThrow(RangeError);
    }
  });

  it("rejects empty paths, including `./`, `/` and `.//.` that normalise to empty", () => {
    for (const path of ["", "./", "/", ".//."]) {
      expect(() => buildStructureMap([{ path, content: "" }]), JSON.stringify(path)).toThrow(RangeError);
    }
  });

  it("rejects a huge string by its length, before encoding it", () => {
    const started = performance.now();
    expect(() => buildStructureMap([{ path: "huge.txt", content: "a".repeat(50_000_000) }])).toThrow(/at least 50000000 bytes, limit 102400/);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("rejects a non-string content", () => {
    expect(() => buildStructureMap([{ path: "a.ts", content: 5 as unknown as string }])).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Properties P1-P4
// ---------------------------------------------------------------------------

// Random text, and random piles of JS/TS keywords that look almost like code.
const arbContent = fc.oneof(
  fc.string({ unit: "binary", maxLength: 2000 }),
  fc
    .array(
      fc.constantFrom("import", "export", "function", "class", "async", "=>", "(", ")", "{", "}", "<div>", "`", "/*", '"', "require(", ";", "\n"),
      { maxLength: 300 },
    )
    .map((pieces) => pieces.join(" ")),
);
const arbCodePath = fc.constantFrom("a.ts", "a.tsx", "a.js", "a.jsx", "a.cjs");

/** The last segment of each call (`obj.run` -> `run`), sorted and without duplicates. */
function lastNames(calls: string[]): string[] {
  return [...new Set(calls.map((call) => call.slice(call.lastIndexOf(".") + 1)))].sort();
}

function isSortedUnique(list: string[]): boolean {
  return list.every((item, i) => i === 0 || (list[i - 1] ?? "") < item);
}

describe("buildStructureMap properties", () => {
  it("P1: never throws on any content or corpus file; a failed parse leaves empty lists and an error", () => {
    // The corpus files come in with their own paths, and also mangled (cut at a random point).
    const arbCorpusCase = fc
      .tuple(fc.constantFrom(...EDGE_CORPUS), fc.nat(400))
      .map(([file, cut]) => ({ path: file.path, content: file.content.slice(0, file.content.length - cut) }));
    const arbCase = fc.oneof(
      fc.record({ path: arbCodePath, content: arbContent }),
      fc.constantFrom(...edgeSourceFiles()),
      arbCorpusCase,
    );
    fc.assert(
      fc.property(arbCase, ({ path, content }) => {
        const map = buildStructureMap([{ path, content }]);
        expect(map.files).toHaveLength(1);
        const file = map.files[0] as FileEntry;
        if (!file.parsed) {
          expect(file.errors.length).toBeGreaterThanOrEqual(1);
          expect([file.imports, file.exports, file.functions, file.classes, file.commonjsExports]).toEqual([[], [], [], [], []]);
          expect(file.hasUnknownExports).toBe(false);
        }
        expect(file.errors.length).toBeLessThanOrEqual(10);
      }),
      { numRuns: 200 },
    );
  });

  it("P2: files are sorted, paths have no backslash, and every name list is sorted and unique", () => {
    fc.assert(
      fc.property(arbProject, (project) => {
        // Feed the paths with backslashes; the map must give them back with slashes.
        const input = toSourceFiles(project).map((f) => ({ ...f, path: f.path.replace("/", "\\") }));
        const map = buildStructureMap(input);
        const paths = map.files.map((f) => f.path);
        expect(paths.some((p) => p.includes("\\"))).toBe(false);
        expect(isSortedUnique(paths)).toBe(true);
        for (const file of map.files) {
          expect(isSortedUnique(file.functions.map((f) => f.name))).toBe(true);
          expect(isSortedUnique(file.classes.map((c) => c.name))).toBe(true);
          for (const imp of file.imports) expect(isSortedUnique(imp.names)).toBe(true);
          for (const fn of file.functions) {
            expect(isSortedUnique(fn.calls)).toBe(true);
            expect(isSortedUnique(fn.mentionedNames)).toBe(true);
          }
          for (const cls of file.classes) {
            expect(isSortedUnique(cls.accessors)).toBe(true);
            for (const method of cls.methods) {
              expect(isSortedUnique(method.calls)).toBe(true);
              expect(isSortedUnique(method.mentionedNames)).toBe(true);
            }
          }
          expect(isSortedUnique(file.commonjsExports)).toBe(true);
        }
      }),
    );
  });

  it("P3: the map does not depend on the input order, and a second call gives the same map", () => {
    const arbShuffled = arbProject.chain((project) =>
      fc
        .shuffledSubarray(toSourceFiles(project), { minLength: project.files.length, maxLength: project.files.length })
        .map((shuffled) => ({ project, shuffled })),
    );
    fc.assert(
      fc.property(arbShuffled, ({ project, shuffled }) => {
        const files = toSourceFiles(project);
        const map = buildStructureMap(files);
        expect(buildStructureMap(shuffled)).toEqual(map);
        expect(buildStructureMap(files)).toEqual(map);
      }),
    );
  });

  it("P4: every rendered function, class, method and import appears with the rendered facts", () => {
    fc.assert(
      fc.property(arbProject, (project) => {
        const map = buildStructureMap(toSourceFiles(project));
        for (const rendered of project.files) {
          const file = fileOf(map, rendered.path);
          expect(file.parsed).toBe(true);
          expect(file.errors).toEqual([]);

          expect(file.functions.map((f) => f.name)).toEqual(rendered.functions.map((f) => f.name).sort());
          for (const fn of rendered.functions) {
            const found = file.functions.find((f) => f.name === fn.name);
            expect(found).toMatchObject({
              params: fn.params,
              plainParams: true,
              async: fn.async,
              exported: fn.exported,
              calls: fn.calls,
              calledNames: lastNames(fn.calls),
            });
            // Every call target is also a mentioned name, and so is every parameter (`p0`, `p1`, ...).
            expect(found?.mentionedNames).toEqual(expect.arrayContaining([...lastNames(fn.calls), ...Array.from({ length: fn.params }, (_, k) => `p${k}`)]));
            const exportEntry = file.exports.find((e) => e.name === fn.name);
            expect(exportEntry !== undefined).toBe(fn.exported);
          }

          expect(file.classes.map((c) => c.name)).toEqual(rendered.classes.map((c) => c.name).sort());
          for (const cls of rendered.classes) {
            const found = file.classes.find((c) => c.name === cls.name);
            expect(found?.exported).toBe(cls.exported);
            expect(found?.methods.map((m) => m.name)).toEqual(cls.methods.map((m) => m.name).sort());
            for (const method of cls.methods) {
              expect(found?.methods.find((m) => m.name === method.name)).toMatchObject({
                params: method.params,
                plainParams: true,
                async: method.async,
                static: method.static,
                calls: method.calls,
                calledNames: lastNames(method.calls),
              });
              expect(found?.methods.find((m) => m.name === method.name)?.mentionedNames).toEqual(
                expect.arrayContaining([...lastNames(method.calls), ...Array.from({ length: method.params }, (_, k) => `p${k}`)]),
              );
            }
          }

          for (const imp of rendered.imports) {
            expect(file.imports).toContainEqual(expect.objectContaining({ source: imp.module, names: imp.names, kind: "import" }));
          }
        }
      }),
    );
  });
});
