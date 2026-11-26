// Test helper (not part of the build): fast-check generators for small TypeScript projects.
// A generated project also returns what it rendered, so tests can check the map against it.
import fc from "fast-check";
import type { SourceFile } from "../structure-map.js";

export interface RenderedFunction {
  name: string;
  params: number;
  async: boolean;
  exported: boolean;
  arrow: boolean;
  calls: string[]; // sorted, without duplicates
}

export interface RenderedMethod {
  name: string;
  params: number;
  async: boolean;
  static: boolean;
  calls: string[]; // sorted, without duplicates
}

export interface RenderedClass {
  name: string;
  exported: boolean;
  methods: RenderedMethod[];
}

export interface RenderedImport {
  module: string; // for example "./f1"
  names: string[]; // sorted
}

export interface RenderedFile {
  path: string;
  content: string;
  functions: RenderedFunction[];
  classes: RenderedClass[];
  imports: RenderedImport[];
}

export interface Project {
  files: RenderedFile[];
}

const FUNCTION_NAMES = ["fn0", "fn1", "fn2", "fn3", "fn4", "fn5", "fn6", "fn7"];
const METHOD_NAMES = ["m0", "m1", "m2", "m3", "m4"];
const CLASS_NAMES = ["C0", "C1", "C2"];

// Calls a plain function can make, and calls a method can make (methods may also call `this.mN`).
const arbFunctionCall = fc.constantFrom(...FUNCTION_NAMES, "obj.run", "util.helper");
const arbMethodCall = fc.constantFrom(...FUNCTION_NAMES, "obj.run", "this.m0", "this.m1", "this.m2");

function sortedUnique(items: string[]): string[] {
  return [...new Set(items)].sort();
}

const arbFunction: fc.Arbitrary<RenderedFunction> = fc
  .record({
    name: fc.constantFrom(...FUNCTION_NAMES),
    params: fc.nat(3),
    async: fc.boolean(),
    exported: fc.boolean(),
    arrow: fc.boolean(),
    calls: fc.array(arbFunctionCall, { maxLength: 3 }),
  })
  .map((f) => ({ ...f, calls: sortedUnique(f.calls) }));

const arbMethod: fc.Arbitrary<RenderedMethod> = fc
  .record({
    name: fc.constantFrom(...METHOD_NAMES),
    params: fc.nat(3),
    async: fc.boolean(),
    static: fc.boolean(),
    calls: fc.array(arbMethodCall, { maxLength: 3 }),
  })
  .map((m) => ({ ...m, calls: sortedUnique(m.calls) }));

const arbClass: fc.Arbitrary<RenderedClass> = fc.record({
  name: fc.constantFrom(...CLASS_NAMES),
  exported: fc.boolean(),
  methods: fc.uniqueArray(arbMethod, { selector: (m) => m.name, maxLength: 3 }),
});

// What one file will contain before imports are chosen. Names are unique inside a file.
interface FileSpec {
  functions: RenderedFunction[];
  classes: RenderedClass[];
  imports: { target: number; names: string[] }[];
}

function arbFileSpec(fileCount: number): fc.Arbitrary<FileSpec> {
  return fc.record({
    functions: fc.uniqueArray(arbFunction, { selector: (f) => f.name, maxLength: 4 }),
    classes: fc.uniqueArray(arbClass, { selector: (c) => c.name, maxLength: 2 }),
    imports: fc.array(
      fc.record({
        target: fc.nat(fileCount - 1),
        names: fc.uniqueArray(fc.constantFrom(...FUNCTION_NAMES), { minLength: 1, maxLength: 3 }),
      }),
      { maxLength: 2 },
    ),
  });
}

function renderCalls(calls: string[]): string {
  return calls.map((call) => `${call}();`).join(" ");
}

function renderParams(count: number): string {
  return Array.from({ length: count }, (_, i) => `p${i}: number`).join(", ");
}

function renderFunction(f: RenderedFunction): string {
  const exported = f.exported ? "export " : "";
  const asyncText = f.async ? "async " : "";
  const body = `{ ${renderCalls(f.calls)} }`;
  if (f.arrow) return `${exported}const ${f.name} = ${asyncText}(${renderParams(f.params)}) => ${body};`;
  return `${exported}${asyncText}function ${f.name}(${renderParams(f.params)}) ${body}`;
}

function renderMethod(m: RenderedMethod): string {
  const modifiers = `${m.static ? "static " : ""}${m.async ? "async " : ""}`;
  return `  ${modifiers}${m.name}(${renderParams(m.params)}) { ${renderCalls(m.calls)} }`;
}

function renderClass(c: RenderedClass): string {
  return `${c.exported ? "export " : ""}class ${c.name} {\n${c.methods.map(renderMethod).join("\n")}\n}`;
}

function renderImport(i: RenderedImport): string {
  return `import { ${i.names.join(", ")} } from "${i.module}";`;
}

/** Builds one rendered file. Import names that clash with local functions or earlier imports are dropped. */
function buildFile(index: number, spec: FileSpec): RenderedFile {
  const taken = new Set(spec.functions.map((f) => f.name));
  const imports: RenderedImport[] = [];
  for (const wanted of spec.imports) {
    const names = sortedUnique(wanted.names.filter((n) => !taken.has(n)));
    for (const name of names) taken.add(name);
    if (names.length > 0) imports.push({ module: `./f${wanted.target}`, names });
  }
  const content = [
    ...imports.map(renderImport),
    ...spec.functions.map(renderFunction),
    ...spec.classes.map(renderClass),
  ].join("\n");
  return { path: `src/f${index}.ts`, content, functions: spec.functions, classes: spec.classes, imports };
}

/** 1 to 5 files `src/f0.ts`, `src/f1.ts`, ... that always parse. */
export const arbProject: fc.Arbitrary<Project> = fc
  .integer({ min: 1, max: 5 })
  .chain((count) => fc.array(arbFileSpec(count), { minLength: count, maxLength: count }))
  .map((specs) => ({ files: specs.map((spec, index) => buildFile(index, spec)) }));

export function toSourceFiles(project: Project): SourceFile[] {
  return project.files.map((f) => ({ path: f.path, content: f.content }));
}
