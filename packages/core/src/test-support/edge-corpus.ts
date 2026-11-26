// Test helper (not part of the build): a fixed list of small source files for the cases that the
// random generator never reaches (decorators, odd exports, member chains, special names, CommonJS).
// Some entries say what a correct map must show, so tests compare the map with something else than itself.
import fc from "fast-check";
import type { SourceFile } from "../structure-map.js";
import { arbProject, toSourceFiles } from "./arb-project.js";

export interface EdgeFile extends SourceFile {
  /** Exact, sorted export names the map must record. */
  exports: string[];
  /** Exact, sorted names of the classes and of the functions. */
  classes: string[];
  functions: string[];
  /** Exact `calledNames` per function name, as [name, calledNames] pairs (an array, so names like `__proto__` are safe). */
  calledNames?: [string, string[]][];
  /** Exact CommonJS facts; when left out the file must have none (`[]` and `false`). */
  commonjsExports?: string[];
  hasUnknownExports?: boolean;
}

export const EDGE_CORPUS: EdgeFile[] = [
  {
    path: "edge/decorators.ts",
    content: [
      '@Component({ selector: "app-a" })',
      "export class A {",
      '  @Input() title = "";',
      '  run(@Inject("dep") dep: string) { helper(); }',
      "}",
      "@dec class B { go() {} }",
      "function helper() {}",
    ].join("\n"),
    exports: ["A"],
    classes: ["A", "B"],
    functions: ["helper"],
  },
  {
    path: "edge/destructured.ts",
    content: ["export const { a, b: { c }, d = 1, ...rest } = source;", "export const [e, [f], ...tail] = list;"].join("\n"),
    exports: ["a", "c", "d", "e", "f", "rest", "tail"],
    classes: [],
    functions: [],
  },
  {
    path: "edge/namespace.ts",
    content: [
      "export namespace NS { export const x = 1; }",
      "export module M {}",
      "export declare namespace D {}",
      "export namespace P.Q {}",
    ].join("\n"),
    exports: ["D", "M", "NS", "P"],
    classes: [],
    functions: [],
  },
  {
    path: "edge/export-equals.ts",
    content: ["function foo() { bar(); }", "function bar() {}", "export = foo;"].join("\n"),
    exports: ["foo"],
    classes: [],
    functions: ["bar", "foo"],
  },
  {
    path: "edge/export-import.ts",
    content: 'export import Legacy = require("./legacy");',
    exports: ["Legacy"],
    classes: [],
    functions: [],
  },
  {
    path: "edge/member-chains.ts",
    content: [
      "function helper() {}",
      "function other() { helper(); }",
      "function third() { obj.a.helper(); }",
      'function fourth() { console.log("x"); this.db.get(); list[0](); make()(); obj["go"](); }',
      "function fifth() {}",
      "function sixth() {}",
    ].join("\n"),
    exports: [],
    classes: [],
    functions: ["fifth", "fourth", "helper", "other", "sixth", "third"],
    calledNames: [
      ["fifth", []],
      ["fourth", ["get", "go", "log", "make"]],
      ["helper", []],
      ["other", ["helper"]],
      ["sixth", []],
      ["third", ["helper"]],
    ],
  },
  {
    path: "edge/relative.ts",
    content: [
      'import * as ns from "./member-chains";',
      'import { helper } from "./member-chains";',
      "export function useNs() { ns.helper(); }",
      "export function useNamed() { helper(); }",
      "export function viaVariable(v: any) { v.helper(); }",
      "export function idle() {}",
    ].join("\n"),
    exports: ["idle", "useNamed", "useNs", "viaVariable"],
    classes: [],
    functions: ["idle", "useNamed", "useNs", "viaVariable"],
  },
  {
    path: "edge/proto-names.ts",
    content: [
      "export function __proto__(constructor: number) { constructor_(); }",
      "export function constructor() { __proto__(1); }",
      "function constructor_() {}",
      "class toString { hasOwnProperty() { this.valueOf(); } valueOf() {} }",
      "export const hasOwnProperty = () => new toString();",
    ].join("\n"),
    exports: ["__proto__", "constructor", "hasOwnProperty"],
    classes: ["toString"],
    functions: ["__proto__", "constructor", "constructor_", "hasOwnProperty"],
  },
  {
    path: "edge/default-function.ts",
    content: ["export default function () { helper(); }", "function helper() {}"].join("\n"),
    exports: ["default"],
    classes: [],
    functions: ["default", "helper"],
  },
  {
    path: "edge/default-class.ts",
    content: "export default class { run() {} stop() {} }",
    exports: ["default"],
    classes: ["default"],
    functions: [],
  },
  {
    path: "edge/default-interface.ts",
    content: "export default interface I { a: number }",
    exports: ["default"],
    classes: [],
    functions: [],
  },
  {
    // `with` is only valid in a script, so this file needs the script fallback to parse without errors.
    path: "edge/commonjs.js",
    content: [
      'const fs = require("fs");',
      'const { join } = require("./path-util");',
      "function readAll(p) { return fs.readFileSync(join(p)); }",
      "module.exports = { readAll };",
      "with (fs) { readAll(); }",
    ].join("\n"),
    exports: [],
    classes: [],
    functions: ["readAll"],
    commonjsExports: ["readAll"],
  },
  {
    path: "edge/commonjs-exports.js",
    content: [
      "const d = 1;",
      "exports.a = 1;",
      "module.exports.b = 2;",
      'Object.defineProperty(exports, "c", { value: 3 });',
      "module.exports = { d, e: 1, f() {} };",
    ].join("\n"),
    exports: [],
    classes: [],
    functions: [],
    commonjsExports: ["a", "b", "c", "d", "e", "f"],
  },
  {
    path: "edge/commonjs-unknown.js",
    content: "module.exports = make();",
    exports: [],
    classes: [],
    functions: [],
    commonjsExports: ["default"],
    hasUnknownExports: true,
  },
  {
    // Parents inside the map, a loop, a parent outside the map, a mixin, and top-level functions named like inherited members.
    path: "edge/inheritance.ts",
    content: [
      "class Base { save() {} get size() { return 1; } }",
      "class Admin extends Base { ban() {} }",
      "class Super extends Admin { fly() {} }",
      "class Loop1 extends Loop2 { a() {} }",
      "class Loop2 extends Loop1 { b() {} }",
      "class Ext extends React.Component { render() {} }",
      "class Mix extends mixin(Base) { mixed() {} }",
      "function save() {}",
      "function ban() {}",
      "function size() {}",
    ].join("\n"),
    exports: [],
    classes: ["Admin", "Base", "Ext", "Loop1", "Loop2", "Mix", "Super"],
    functions: ["ban", "save", "size"],
  },
  {
    // `shared` is used in many ways besides a plain call. Only `viaCall` and `viaDefault` call it in a way the map records.
    path: "edge/mentions.ts",
    content: [
      "function shared() {}",
      "function viaCall() { shared(); }",
      "function viaBind() { shared.bind(null)(); }",
      "function viaCallback() { [1].map(shared); }",
      "function viaDefault(a = shared()) {}",
      "function viaAlias() { const h = shared; h(); }",
      "function viaTag() { shared`x`; }",
      "function idle1() {}",
      "function idle2() {}",
      "function idle3() {}",
    ].join("\n"),
    exports: [],
    classes: [],
    functions: ["idle1", "idle2", "idle3", "shared", "viaAlias", "viaBind", "viaCall", "viaCallback", "viaDefault", "viaTag"],
  },
  {
    path: "edge/declare-function.d.ts",
    content: "export declare function f(a: number): void;",
    exports: ["f"],
    classes: [],
    functions: [],
  },
  {
    path: "edge/params.ts",
    content: [
      "export function withDefault(a = 1) {}",
      "export function withRest(...rest: number[]) {}",
      "export function withPattern({ a, b }: Opts) {}",
      "export function plain(a: number, b?: string) {}",
      "export async function caller(x: number) { plain(x); withDefault(); }",
    ].join("\n"),
    exports: ["caller", "plain", "withDefault", "withPattern", "withRest"],
    classes: [],
    functions: ["caller", "plain", "withDefault", "withPattern", "withRest"],
  },
];

/** The corpus files as plain source files. */
export function edgeSourceFiles(files: EdgeFile[] = EDGE_CORPUS): SourceFile[] {
  return files.map((f) => ({ path: f.path, content: f.content }));
}

/** A generated project plus a random, non-empty part of the corpus (paths never collide: `src/` vs `edge/`). */
export const arbProjectWithEdges: fc.Arbitrary<SourceFile[]> = fc
  .tuple(arbProject, fc.subarray(EDGE_CORPUS, { minLength: 1 }))
  .map(([project, edge]) => [...toSourceFiles(project), ...edgeSourceFiles(edge)]);
