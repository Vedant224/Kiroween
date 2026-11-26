// Structure map: reads JS/TS source text with Babel and lists each file's imports, exports,
// functions, classes and calls. Pure function: no disk, clock, network or randomness.
import { parse, type ParserPlugin } from "@babel/parser";
import { VISITOR_KEYS } from "@babel/types";
import type * as t from "@babel/types";

export type Language = "javascript" | "typescript" | "python" | "json" | "markdown" | "css" | "html" | "other";

export interface ImportEntry {
  source: string;
  kind: "import" | "require";
  defaultName?: string;
  namespace?: string;
  names: string[];
  typeOnly: boolean;
  line: number;
}

export interface ExportEntry {
  name: string; // `export *` is recorded with the name "*"
  kind: "named" | "default" | "reexport";
  from?: string;
  line: number;
}

// `plainParams` is true when every parameter is a plain identifier (no default, rest or destructuring).
// `calls` holds `foo`, `obj.foo` and `this.foo`; `calledNames` holds the last name of every call
// (`obj.a.helper()` gives `helper`), so a question can tell that a function really calls something.
// `mentionedNames` holds every name the function mentions at all (a call, a callback argument, an alias,
// `helper.call(null)`, a default value), so a question can tell that a function never touches a name.
export interface FunctionEntry {
  name: string;
  params: number;
  plainParams: boolean;
  async: boolean;
  exported: boolean;
  line: number;
  calls: string[];
  calledNames: string[];
  mentionedNames: string[];
}

export interface MethodEntry {
  name: string;
  params: number;
  plainParams: boolean;
  async: boolean;
  static: boolean;
  line: number;
  calls: string[];
  calledNames: string[];
  mentionedNames: string[];
}

// `superClass` is the text after `extends` (`Base`, `React.Component`), or "(expression)" for anything
// else, such as `mixin(Base)`; it is left out when the class has no `extends`.
// `accessors` lists getter and setter names, which are not in `methods`.
export interface ClassEntry {
  name: string;
  exported: boolean;
  line: number;
  superClass?: string;
  accessors: string[];
  methods: MethodEntry[];
}

/** One parse problem. `line` is 0 when Babel gives no position. */
export interface ParseIssue {
  message: string;
  line: number;
}

export interface FileEntry {
  path: string;
  language: Language;
  lines: number;
  parsed: boolean;
  errors: ParseIssue[];
  imports: ImportEntry[];
  exports: ExportEntry[];
  functions: FunctionEntry[];
  classes: ClassEntry[];
  /** Names from top-level `exports.x =`, `module.exports.x =` and `module.exports = { a, b }`; `default` for `module.exports = value`. */
  commonjsExports: string[];
  /** True when `module.exports` is given something whose names cannot be read (`module.exports = make()`, a spread). */
  hasUnknownExports: boolean;
}

export interface StructureMap {
  schemaVersion: 1;
  files: FileEntry[];
}

export interface SourceFile {
  path: string;
  content: string;
}

export const MAP_LIMITS = { maxFiles: 50, maxTotalBytes: 102_400 } as const;

const MAX_RECORDED_ERRORS = 10;

/** Most names kept in `mentionedNames`. A list of exactly this length may have been cut. */
export const MAX_MENTIONED_NAMES = 500;

/** `superClass` text for an `extends` expression that is not a name or a dotted name, for example `mixin(Base)`. */
export const UNKNOWN_SUPERCLASS = "(expression)";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Compares two strings by UTF-16 code unit, so the order never depends on the locale. */
function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** Sorted copy without duplicates. */
function sortedUnique(items: Iterable<string>): string[] {
  return [...new Set(items)].sort(compareText);
}

function lineOf(node: t.Node): number {
  return node.loc?.start.line ?? 0;
}

// ---------------------------------------------------------------------------
// Input checks (the only place that throws)
// ---------------------------------------------------------------------------

/**
 * Replaces `\` with `/`, collapses repeated slashes, drops every `.` segment (`./a`, `a/./b`),
 * a leading `/` and a trailing `/`. `..` segments are kept.
 */
function normalisePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
}

/** Checks the limits and returns the files with normalised paths. Throws RangeError. */
function checkInput(files: SourceFile[]): SourceFile[] {
  if (!Array.isArray(files)) throw new RangeError("files must be an array");
  if (files.length > MAP_LIMITS.maxFiles) {
    throw new RangeError(`got ${files.length} files, limit ${MAP_LIMITS.maxFiles}`);
  }
  const encoder = new TextEncoder();
  const seen = new Set<string>();
  let totalChars = 0;
  let totalBytes = 0;
  const result: SourceFile[] = [];
  for (const file of files) {
    if (typeof file?.path !== "string" || file.path === "") {
      throw new RangeError("every file needs a non-empty string path");
    }
    if (typeof file.content !== "string") {
      throw new RangeError(`content of ${file.path} must be a string`);
    }
    const path = normalisePath(file.path);
    if (path === "") throw new RangeError(`path ${file.path} is empty after normalising`);
    if (seen.has(path)) throw new RangeError(`duplicate path after normalising: ${path}`);
    seen.add(path);
    // A string never has fewer UTF-8 bytes than characters, so reject before encoding anything huge.
    totalChars += file.content.length;
    if (totalChars > MAP_LIMITS.maxTotalBytes) {
      throw new RangeError(`total content is at least ${totalChars} bytes, limit ${MAP_LIMITS.maxTotalBytes}`);
    }
    totalBytes += encoder.encode(file.content).length;
    result.push({ path, content: file.content });
  }
  if (totalBytes > MAP_LIMITS.maxTotalBytes) {
    throw new RangeError(`total content is ${totalBytes} bytes, limit ${MAP_LIMITS.maxTotalBytes}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// File-level facts: language and line count
// ---------------------------------------------------------------------------

const LANGUAGE_BY_EXTENSION = new Map<string, Language>([
  ["js", "javascript"],
  ["jsx", "javascript"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["ts", "typescript"],
  ["tsx", "typescript"],
  ["mts", "typescript"],
  ["cts", "typescript"],
  ["py", "python"],
  ["json", "json"],
  ["md", "markdown"],
  ["css", "css"],
  ["html", "html"],
]);

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

function languageOf(path: string): Language {
  return LANGUAGE_BY_EXTENSION.get(extensionOf(path)) ?? "other";
}

/** Counts lines: `""` is 0, `"a\n"` is 1, `"a\nb"` is 2. Handles \r\n, \r and \n. */
function countLines(content: string): number {
  const pieces = content.split(/\r\n|\r|\n/);
  if (pieces[pieces.length - 1] === "") pieces.pop();
  return pieces.length;
}

function emptyEntry(path: string, content: string): FileEntry {
  return {
    path,
    language: languageOf(path),
    lines: countLines(content),
    parsed: false,
    errors: [],
    imports: [],
    exports: [],
    functions: [],
    classes: [],
    commonjsExports: [],
    hasUnknownExports: false,
  };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Babel plugins by file extension: TypeScript syntax for TS files, JSX for JS and TSX, and
 * `decorators-legacy` for all of them (Angular and NestJS style `@Component({...}) export class`).
 */
function pluginsFor(path: string): ParserPlugin[] {
  const lower = path.toLowerCase();
  if (lower.endsWith(".d.ts") || lower.endsWith(".d.mts") || lower.endsWith(".d.cts")) {
    return [["typescript", { dts: true }], "decorators-legacy"];
  }
  const ext = extensionOf(path);
  if (ext === "tsx") return ["typescript", "jsx", "decorators-legacy"];
  if (ext === "ts" || ext === "mts" || ext === "cts") return ["typescript", "decorators-legacy"];
  return ["jsx", "decorators-legacy"];
}

const STACK_OVERFLOW_TEXT = "Maximum call stack size exceeded";

/** Turns anything that was thrown or recorded by Babel into a ParseIssue. */
function toIssue(error: unknown): ParseIssue {
  let message = "unknown parse error";
  let line = 0;
  try {
    if (error instanceof Error) message = error.message;
    else message = String(error);
    // Babel is recursive and runs out of stack at about 500 nested levels; say so in plain words.
    if (error instanceof Error && message.includes(STACK_OVERFLOW_TEXT)) {
      return { message: "nested too deeply to parse", line: 0 };
    }
    const loc = (error as { loc?: { line?: unknown } } | null)?.loc;
    if (typeof loc?.line === "number") line = loc.line;
  } catch {
    // An object that cannot be turned into text keeps the default message.
  }
  return { message, line };
}

type ParseOutcome =
  | { ok: true; ast: ReturnType<typeof parse>; errorCount: number }
  | { ok: false; issue: ParseIssue };

/** One parse attempt. Catches anything that is thrown. */
function tryParse(path: string, content: string, sourceType: "module" | "script"): ParseOutcome {
  try {
    const ast = parse(content, { sourceType, errorRecovery: true, plugins: pluginsFor(path) });
    return { ok: true, ast, errorCount: ast.errors?.length ?? 0 };
  } catch (error) {
    return { ok: false, issue: toIssue(error) };
  }
}

/**
 * Parses as a module first. When that throws or records errors, also parses as a script and keeps
 * the result with fewer errors (a tie keeps the module). Old CommonJS code with `with` or legacy
 * octal numbers only parses cleanly as a script. If both attempts throw, the module issue is reported.
 */
function parseSource(path: string, content: string): ParseOutcome {
  const asModule = tryParse(path, content, "module");
  if (asModule.ok && asModule.errorCount === 0) return asModule;
  const asScript = tryParse(path, content, "script");
  if (!asScript.ok) return asModule; // the module attempt: errors recorded, or the module issue
  if (!asModule.ok) return asScript;
  return asScript.errorCount < asModule.errorCount ? asScript : asModule;
}

// ---------------------------------------------------------------------------
// Call collection
// ---------------------------------------------------------------------------

function isNode(value: unknown): value is t.Node {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

/** Adds the child nodes of `node` to the stack, using Babel's list of child keys. */
function pushChildren(stack: t.Node[], node: t.Node): void {
  const keys = (VISITOR_KEYS as Record<string, string[] | undefined>)[node.type] ?? [];
  for (const key of keys) {
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) stack.push(item);
    } else if (isNode(value)) {
      stack.push(value);
    }
  }
}

/** `foo`, `obj.foo` or `this.foo`. Any other callee (`a.b.c()`, `fn()()`) gives undefined. */
function calleeName(callee: t.Node): string | undefined {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type !== "MemberExpression" && callee.type !== "OptionalMemberExpression") return undefined;
  if (callee.computed || callee.property.type !== "Identifier") return undefined;
  if (callee.object.type === "Identifier") return `${callee.object.name}.${callee.property.name}`;
  if (callee.object.type === "ThisExpression") return `this.${callee.property.name}`;
  return undefined;
}

/** Last name of any call: `foo()`, `a.b.foo()` and `a["foo"]()` give `foo`. Other callees give undefined. */
function lastCalledName(callee: t.Node): string | undefined {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type !== "MemberExpression" && callee.type !== "OptionalMemberExpression") return undefined;
  const property = callee.property;
  if (!callee.computed) return property.type === "Identifier" ? property.name : undefined;
  return property.type === "StringLiteral" ? property.value : undefined;
}

interface UsageLists {
  calls: string[];
  calledNames: string[];
  mentionedNames: string[];
}

/**
 * Lists what a function does with names, sorted and without duplicates: `calls` in the short forms
 * of req 1.9, `calledNames` with the last name of every call, and `mentionedNames` with every
 * identifier it contains (so `helper.call(null)`, `map(helper)` and `const h = helper` all count).
 * It walks the parameters as well as the body, so a default value like `a = helper()` is seen.
 * It uses its own stack instead of recursion, so a deeply nested body cannot overflow our own code,
 * and Sets, so a long function costs one pass.
 */
function collectUsage(fn: t.Function): UsageLists {
  const calls = new Set<string>();
  const calledNames = new Set<string>();
  const mentioned = new Set<string>();
  const stack: t.Node[] = [...fn.params, fn.body];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node.type === "CallExpression" || node.type === "OptionalCallExpression") {
      const name = calleeName(node.callee);
      if (name !== undefined) calls.add(name);
      const last = lastCalledName(node.callee);
      if (last !== undefined) calledNames.add(last);
    } else if (node.type === "Identifier" || node.type === "JSXIdentifier") {
      mentioned.add(node.name);
    } else if ((node.type === "MemberExpression" || node.type === "OptionalMemberExpression") && node.computed) {
      // `obj["helper"]` mentions `helper` with a string instead of an identifier.
      if (node.property.type === "StringLiteral") mentioned.add(node.property.value);
    }
    pushChildren(stack, node);
  }
  return {
    calls: sortedUnique(calls),
    calledNames: sortedUnique(calledNames),
    mentionedNames: sortedUnique(mentioned).slice(0, MAX_MENTIONED_NAMES),
  };
}

// ---------------------------------------------------------------------------
// Extraction of imports, exports, functions and classes
// ---------------------------------------------------------------------------

/** Everything collected from one file while walking its top-level statements. */
interface Collected {
  imports: ImportEntry[];
  exports: Map<string, ExportEntry>;
  functions: FunctionEntry[];
  classes: ClassEntry[];
  /** Local names listed in `export { a }` or `export default a`; they mark functions as exported. */
  localExports: Set<string>;
  /** CommonJS export names (`exports.x = ...`) and whether some name could not be read. */
  commonjs: Set<string>;
  unknownExports: boolean;
}

type FunctionNode = t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression;

/** Name of an identifier or string literal (`export { a as "b-c" }`). */
function nameOf(node: t.Identifier | t.StringLiteral): string {
  return node.type === "Identifier" ? node.name : node.value;
}

/** Parameters without a TypeScript `this` parameter, which does not count. */
function realParams(params: readonly t.Node[]): t.Node[] {
  return params.filter((p) => !(p.type === "Identifier" && p.name === "this"));
}

/** What the map records about the parameters of a function. */
function readParams(params: readonly t.Node[]): { params: number; plainParams: boolean } {
  const real = realParams(params);
  return { params: real.length, plainParams: real.every((p) => p.type === "Identifier") };
}

/** Records an export. The same (name, kind, from) is kept once, with the lowest line. */
function addExport(c: Collected, name: string, kind: ExportEntry["kind"], node: t.Node, from?: string): void {
  const key = `${kind}|${from ?? ""}|${name}`;
  const line = lineOf(node);
  const existing = c.exports.get(key);
  if (existing) {
    existing.line = Math.min(existing.line, line);
    return;
  }
  const entry: ExportEntry = { name, kind, line };
  if (from !== undefined) entry.from = from;
  c.exports.set(key, entry);
}

function addFunction(c: Collected, name: string, fn: FunctionNode, exported: boolean, lineNode: t.Node): void {
  c.functions.push({
    name,
    ...readParams(fn.params),
    async: fn.async === true,
    exported,
    line: lineOf(lineNode),
    ...collectUsage(fn),
  });
}

/** Method name from a class member key; computed and private names are skipped. */
function memberName(key: t.Node, computed: boolean): string | undefined {
  if (computed) return undefined;
  if (key.type === "Identifier") return key.name;
  if (key.type === "StringLiteral") return key.value;
  return undefined;
}

function isFunctionExpression(node: t.Node | null | undefined): node is t.FunctionExpression | t.ArrowFunctionExpression {
  return node?.type === "FunctionExpression" || node?.type === "ArrowFunctionExpression";
}

/**
 * Class methods and arrow-function properties, plus the names of getters and setters.
 * Constructors are skipped; getters and setters go into `accessors`, not `methods`.
 */
function readMembers(body: t.ClassBody): { methods: MethodEntry[]; accessors: string[] } {
  const methods: MethodEntry[] = [];
  const accessors = new Set<string>();
  const add = (member: t.ClassMethod | t.ClassProperty, fn: t.Function): void => {
    const name = memberName(member.key, member.computed === true);
    if (name === undefined) return;
    methods.push({
      name,
      ...readParams(fn.params),
      async: fn.async === true,
      static: member.static === true,
      line: lineOf(member),
      ...collectUsage(fn),
    });
  };
  for (const member of body.body) {
    if (member.type === "ClassMethod" && member.kind === "method") {
      add(member, member);
    } else if (member.type === "ClassMethod" && (member.kind === "get" || member.kind === "set")) {
      const name = memberName(member.key, member.computed === true);
      if (name !== undefined) accessors.add(name);
    } else if (member.type === "ClassProperty" && isFunctionExpression(member.value)) {
      add(member, member.value);
    }
  }
  return {
    methods: sortWith(methods, byText((m) => m.name), byNumber((m) => Number(m.static)), byNumber((m) => m.line)),
    accessors: sortedUnique(accessors),
  };
}

/**
 * Text of an `extends` expression: `Base`, or `React.Component` for a chain of plain members.
 * Anything else (`mixin(Base)`, `a[b]`) gives UNKNOWN_SUPERCLASS, which never equals a class name.
 */
function superClassText(node: t.Expression): string {
  const parts: string[] = [];
  let current: t.Node = node;
  while (current.type === "MemberExpression" && !current.computed && current.property.type === "Identifier") {
    parts.push(current.property.name);
    current = current.object;
  }
  if (current.type !== "Identifier") return UNKNOWN_SUPERCLASS;
  parts.push(current.name);
  return parts.reverse().join(".");
}

function addClass(c: Collected, name: string, node: t.ClassDeclaration, exported: boolean): void {
  const { methods, accessors } = readMembers(node.body);
  const entry: ClassEntry = { name, exported, line: lineOf(node), accessors, methods };
  if (node.superClass) entry.superClass = superClassText(node.superClass);
  c.classes.push(entry);
}

/** `const x = require("m")` and `const { a, b } = require("m")`. */
function readRequire(c: Collected, declarator: t.VariableDeclarator): void {
  const init = declarator.init;
  if (init?.type !== "CallExpression") return;
  if (init.callee.type !== "Identifier" || init.callee.name !== "require") return;
  const arg = init.arguments[0];
  if (init.arguments.length !== 1 || arg?.type !== "StringLiteral") return;

  const entry: ImportEntry = { source: arg.value, kind: "require", names: [], typeOnly: false, line: lineOf(declarator) };
  if (declarator.id.type === "Identifier") entry.defaultName = declarator.id.name;
  if (declarator.id.type === "ObjectPattern") {
    const names: string[] = [];
    for (const prop of declarator.id.properties) {
      if (prop.type !== "ObjectProperty") continue;
      const name = memberName(prop.key, prop.computed);
      if (name !== undefined) names.push(name);
    }
    entry.names = sortedUnique(names);
  }
  c.imports.push(entry);
}

/** Every name bound by an identifier or a destructuring pattern, found with an explicit stack. */
function boundNames(pattern: t.Node): string[] {
  const names: string[] = [];
  const stack: t.Node[] = [pattern];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node.type === "Identifier") {
      names.push(node.name);
    } else if (node.type === "ObjectPattern") {
      for (const prop of node.properties) stack.push(prop.type === "RestElement" ? prop : prop.value);
    } else if (node.type === "ArrayPattern") {
      for (const element of node.elements) if (element) stack.push(element);
    } else if (node.type === "AssignmentPattern") {
      stack.push(node.left);
    } else if (node.type === "RestElement") {
      stack.push(node.argument);
    }
  }
  return names;
}

/** Handles `const` / `let` / `var` at top level. Returns the declared names (for `export const`). */
function addVariables(c: Collected, node: t.VariableDeclaration, exported: boolean): string[] {
  const names: string[] = [];
  for (const declarator of node.declarations) {
    const id = declarator.id;
    names.push(...boundNames(id));
    if (node.kind !== "const") continue;
    readRequire(c, declarator);
    if (id.type === "Identifier" && isFunctionExpression(declarator.init)) {
      addFunction(c, id.name, declarator.init, exported, declarator);
    }
  }
  return names;
}

/**
 * Records a top-level declaration (function, class, variable, TS type) and returns its names.
 * `exported` is true when the declaration sits inside `export ...`.
 */
function addDeclaration(c: Collected, node: t.Node, exported: boolean): string[] {
  switch (node.type) {
    case "FunctionDeclaration": {
      const name = node.id?.name ?? "default";
      addFunction(c, name, node, exported, node);
      return [name];
    }
    case "TSDeclareFunction":
      // An overload signature or `export declare function f(): void;` has no body: the name is
      // exported (the caller records that) but there is no function entry.
      return node.id ? [node.id.name] : [];
    case "TSModuleDeclaration":
      // `namespace A.B.C {}` is named `A`; `declare module "x"` and `declare global` bind no name.
      return node.id.type === "Identifier" && node.global !== true ? [node.id.name] : [];
    case "ClassDeclaration": {
      const name = node.id?.name ?? "default";
      addClass(c, name, node, exported);
      return [name];
    }
    case "VariableDeclaration":
      return addVariables(c, node, exported);
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
    case "TSEnumDeclaration":
      return [node.id.name];
    default:
      return [];
  }
}

function readImport(c: Collected, node: t.ImportDeclaration): void {
  const entry: ImportEntry = { source: node.source.value, kind: "import", names: [], typeOnly: false, line: lineOf(node) };
  const names: string[] = [];
  let allTypeSpecifiers = node.specifiers.length > 0;
  for (const spec of node.specifiers) {
    if (spec.type === "ImportDefaultSpecifier") entry.defaultName = spec.local.name;
    if (spec.type === "ImportNamespaceSpecifier") entry.namespace = spec.local.name;
    if (spec.type === "ImportSpecifier") names.push(nameOf(spec.imported));
    if (spec.type !== "ImportSpecifier" || spec.importKind !== "type") allTypeSpecifiers = false;
  }
  entry.names = sortedUnique(names);
  entry.typeOnly = node.importKind === "type" || allTypeSpecifiers;
  c.imports.push(entry);
}

/** `export const a`, `export { a }`, `export { a } from "m"`, `export * as ns from "m"`. */
function readNamedExport(c: Collected, node: t.ExportNamedDeclaration): void {
  if (node.declaration) {
    for (const name of addDeclaration(c, node.declaration, true)) addExport(c, name, "named", node);
    return;
  }
  const from = node.source?.value;
  for (const spec of node.specifiers) {
    const exportedName = nameOf(spec.exported);
    if (from !== undefined) {
      addExport(c, exportedName, "reexport", node, from);
    } else if (spec.type === "ExportSpecifier") {
      c.localExports.add(spec.local.name);
      if (exportedName === "default") {
        // `export { a as default }` is a default export of `a`.
        addExport(c, spec.local.name, "default", node);
      } else {
        addExport(c, exportedName, "named", node);
      }
    }
  }
}

/** `export default function main() {}`, `export default class {}`, `export default value`. */
function readDefaultExport(c: Collected, node: t.ExportDefaultDeclaration): void {
  const decl = node.declaration;
  let name = "default";
  if (decl.type === "FunctionDeclaration") {
    name = decl.id?.name ?? "default";
    addFunction(c, name, decl, true, decl);
  } else if (decl.type === "ClassDeclaration") {
    name = decl.id?.name ?? "default";
    addClass(c, name, decl, true);
  } else if (decl.type === "TSDeclareFunction") {
    name = decl.id?.name ?? "default";
  } else if (isFunctionExpression(decl)) {
    addFunction(c, "default", decl, true, decl);
  } else if (decl.type === "Identifier") {
    name = decl.name;
    c.localExports.add(decl.name);
  }
  // Anything else, such as `export default interface I {}` or `export default 42`, keeps the name
  // "default": it is recorded as the export `default:default` and has no function or class entry.
  addExport(c, name, "default", node);
}

/** `export = foo;` (TypeScript, CommonJS style) is a default export of `foo`. */
function readExportAssignment(c: Collected, node: t.TSExportAssignment): void {
  const expression = node.expression;
  if (expression.type === "Identifier") {
    c.localExports.add(expression.name);
    addExport(c, expression.name, "default", node);
  } else {
    addExport(c, "default", "default", node);
  }
}

// --- CommonJS exports: `exports.x = ...`, `module.exports = ...` (top-level statements only) ---

/** `module.exports` */
function isModuleExports(node: t.Node): boolean {
  return (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.object.type === "Identifier" &&
    node.object.name === "module" &&
    node.property.type === "Identifier" &&
    node.property.name === "exports"
  );
}

/** `exports` or `module.exports`: the objects whose properties are the exports. */
function isExportsObject(node: t.Node): boolean {
  return (node.type === "Identifier" && node.name === "exports") || isModuleExports(node);
}

/** What the left side of an assignment writes to: all of `module.exports`, or one property of the exports object. */
type CommonjsTarget = { kind: "whole" } | { kind: "property"; name: string | undefined };

function commonjsTarget(left: t.Node): CommonjsTarget | undefined {
  if (isModuleExports(left)) return { kind: "whole" };
  if (left.type !== "MemberExpression" || !isExportsObject(left.object)) return undefined;
  const key = left.property;
  if (left.computed) return { kind: "property", name: key.type === "StringLiteral" ? key.value : undefined };
  return { kind: "property", name: key.type === "Identifier" ? key.name : undefined };
}

/** Adds the keys of `{ a, b: c, d() {} }`. A spread or a computed key means a name we cannot read. */
function readExportedObject(c: Collected, object: t.ObjectExpression): void {
  for (const prop of object.properties) {
    const name = prop.type === "SpreadElement" ? undefined : memberName(prop.key, prop.computed);
    if (name === undefined) c.unknownExports = true;
    else c.commonjs.add(name);
  }
}

/** The value given to all of `module.exports`: an object literal gives names, anything else gives `default`. */
function readWholeExports(c: Collected, value: t.Node): void {
  if (value.type === "ObjectExpression") return readExportedObject(c, value);
  c.commonjs.add("default");
  c.unknownExports = true;
}

/** `Object.assign(exports, { a })` and `Object.defineProperty(exports, "x", ...)`. */
function readCommonjsCall(c: Collected, call: t.CallExpression): void {
  const callee = call.callee;
  const [target, second] = call.arguments;
  if (callee.type !== "MemberExpression" || callee.computed || callee.object.type !== "Identifier") return;
  if (callee.object.name !== "Object" || callee.property.type !== "Identifier" || !target || !isExportsObject(target)) return;
  if (callee.property.name === "defineProperty") {
    if (second?.type === "StringLiteral") c.commonjs.add(second.value);
    else c.unknownExports = true;
  } else if (callee.property.name === "assign") {
    for (const source of call.arguments.slice(1)) {
      if (source.type === "ObjectExpression") readExportedObject(c, source);
      else c.unknownExports = true;
    }
  }
}

/** Reads one top-level expression statement; most of them have nothing to do with exports. */
function readCommonjs(c: Collected, expression: t.Expression): void {
  if (expression.type === "CallExpression") return readCommonjsCall(c, expression);
  // `a = b = value`: every left side receives the final value.
  const targets: CommonjsTarget[] = [];
  let value: t.Node = expression;
  while (value.type === "AssignmentExpression" && value.operator === "=") {
    const target = commonjsTarget(value.left);
    if (target) targets.push(target);
    value = value.right;
  }
  for (const target of targets) {
    if (target.kind === "whole") readWholeExports(c, value);
    else if (target.name === undefined) c.unknownExports = true;
    else c.commonjs.add(target.name);
  }
}

function readStatement(c: Collected, node: t.Statement): void {
  if (node.type === "ExpressionStatement") return readCommonjs(c, node.expression);
  if (node.type === "ImportDeclaration") return readImport(c, node);
  if (node.type === "ExportNamedDeclaration") return readNamedExport(c, node);
  if (node.type === "ExportDefaultDeclaration") return readDefaultExport(c, node);
  if (node.type === "ExportAllDeclaration") return addExport(c, "*", "reexport", node, node.source.value);
  if (node.type === "TSExportAssignment") return readExportAssignment(c, node);
  // `export import X = require("m")`; a plain `import X = require("m")` is not recorded.
  if (node.type === "TSImportEqualsDeclaration") {
    if (node.isExport) addExport(c, node.id.name, "named", node);
    return;
  }
  addDeclaration(c, node, false);
}

// ---------------------------------------------------------------------------
// Sorting: a fixed order, so the output never depends on source order or input order
// ---------------------------------------------------------------------------

type Comparator<T> = (a: T, b: T) => number;

/** Compares two entries by a text field. */
function byText<T>(get: (item: T) => string): Comparator<T> {
  return (a, b) => compareText(get(a), get(b));
}

/** Compares two entries by a number field. */
function byNumber<T>(get: (item: T) => number): Comparator<T> {
  return (a, b) => get(a) - get(b);
}

/** Sorts by the comparators in order, then by JSON text so that two different entries never tie. */
function sortWith<T extends object>(list: T[], ...order: Comparator<T>[]): T[] {
  return list.sort((a, b) => {
    for (const compare of order) {
      const result = compare(a, b);
      if (result !== 0) return result;
    }
    return compareText(JSON.stringify(a), JSON.stringify(b));
  });
}

function sortImports(list: ImportEntry[]): ImportEntry[] {
  return sortWith(list, byText((i) => i.source), byNumber((i) => i.line));
}

function sortExports(list: ExportEntry[]): ExportEntry[] {
  return sortWith(list, byText((e) => e.name), byText((e) => e.from ?? ""), byNumber((e) => e.line));
}

function sortFunctions(list: FunctionEntry[]): FunctionEntry[] {
  return sortWith(list, byText((f) => f.name), byNumber((f) => f.line));
}

function sortClasses(list: ClassEntry[]): ClassEntry[] {
  return sortWith(list, byText((c) => c.name), byNumber((c) => c.line));
}

// ---------------------------------------------------------------------------
// One file
// ---------------------------------------------------------------------------

/** Parses a JS/TS file and fills the lists. Throws only for bugs; the caller catches them. */
function fillFromSource(entry: FileEntry, content: string): void {
  const outcome = parseSource(entry.path, content);
  if (!outcome.ok) {
    entry.errors = [outcome.issue];
    return;
  }
  const collected: Collected = {
    imports: [],
    exports: new Map(),
    functions: [],
    classes: [],
    localExports: new Set(),
    commonjs: new Set(),
    unknownExports: false,
  };
  for (const statement of outcome.ast.program.body) readStatement(collected, statement);
  for (const fn of collected.functions) if (collected.localExports.has(fn.name)) fn.exported = true;
  for (const cls of collected.classes) if (collected.localExports.has(cls.name)) cls.exported = true;

  entry.parsed = true;
  entry.errors = (outcome.ast.errors ?? []).slice(0, MAX_RECORDED_ERRORS).map(toIssue);
  entry.imports = sortImports(collected.imports);
  entry.exports = sortExports([...collected.exports.values()]);
  entry.functions = sortFunctions(collected.functions);
  entry.classes = sortClasses(collected.classes);
  entry.commonjsExports = sortedUnique(collected.commonjs);
  entry.hasUnknownExports = collected.unknownExports;
}

function buildFileEntry(file: SourceFile): FileEntry {
  const entry = emptyEntry(file.path, file.content);
  if (entry.language !== "javascript" && entry.language !== "typescript") return entry;
  try {
    fillFromSource(entry, file.content);
    return entry;
  } catch (error) {
    // Requirement 1.15: file content must never make the whole map throw.
    return { ...emptyEntry(file.path, file.content), errors: [toIssue(error)] };
  }
}

/** Builds the structure map of up to 50 files (100 KB in total). Throws RangeError for bad input only. */
export function buildStructureMap(files: SourceFile[]): StructureMap {
  const entries = checkInput(files).map(buildFileEntry);
  entries.sort((a, b) => compareText(a.path, b.path));
  return { schemaVersion: 1, files: entries };
}
