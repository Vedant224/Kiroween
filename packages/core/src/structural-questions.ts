// Structural questions: turns a structure map into multiple-choice quiz questions with no AI.
// Pure and deterministic: the same map and options always give the same questions.
import {
  MAX_MENTIONED_NAMES,
  type ClassEntry,
  type FileEntry,
  type FunctionEntry,
  type MethodEntry,
  type StructureMap,
} from "./structure-map.js";

/** The skill a question tests. These tags become SM-2 card names, so do not rename them. */
export type StructuralConcept = "exports" | "imports" | "call-graph" | "classes" | "async-functions" | "parameters";

/** A multiple-choice question. It fits Task 2's `QuizQuestion` (kind "mcq") and adds a prompt and a source. */
export interface StructuralQuestion {
  id: string;
  concept: StructuralConcept;
  kind: "mcq";
  choices: string[];
  answerIndex: number;
  prompt: string;
  source: { path: string; line: number };
}

export interface StructuralQuestionOptions {
  /** How many questions to return, 0 to 50. Default 5. */
  count?: number;
  /** Picks which questions and wrong answers appear. Default 0. One per sync. */
  seed?: number;
  /** Only changes the order of the choices, so a retake cannot be passed by remembering positions. Default 0. */
  attempt?: number;
}

const DEFAULT_COUNT = 5;
const MAX_COUNT = 50;
const MAX_DISTRACTORS = 3;

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

const encoder = new TextEncoder(); // made once; creating one per call is slow

/**
 * FNV-1a, a tiny 32-bit hash. It gives the same number for the same text on every machine,
 * which is what we need instead of Math.random: order and picks stay repeatable.
 */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5; // the FNV offset basis
  for (const byte of encoder.encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193); // multiply by the FNV prime, keeping 32 bits
  }
  return hash >>> 0; // show it as an unsigned number
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** Sorts a copy by hash value, computing each hash once. Equal hashes fall back to text order. */
function sortByHash<T>(items: readonly T[], keyOf: (item: T) => string, hash: (text: string) => number): T[] {
  const keyed = items.map((item) => {
    const key = keyOf(item);
    return { item, key, value: hash(key) };
  });
  keyed.sort((a, b) => a.value - b.value || compareText(a.key, b.key));
  return keyed.map((entry) => entry.item);
}

function lastSegment(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1);
}

// ---------------------------------------------------------------------------
// Shared context: everything is looked up once per call, so a template never scans the whole map
// inside a loop. Every lookup by name is a Map or Set, so names like `__proto__` are safe.
// ---------------------------------------------------------------------------

/** A function or method that questions may ask about. */
interface PoolFunction {
  display: string; // `fn` for a function, `Class.method` for a method
  isMethod: boolean;
  path: string;
  line: number;
  params: number;
  plainParams: boolean;
  async: boolean;
  calledNames: Set<string>; // the last name of every call it makes
  mentioned: Set<string>; // every name it mentions at all: callbacks, aliases, `helper.call(null)` ...
  mentionsCut: boolean; // true when the mentioned list was cut at its limit, so a name may be missing from it
  resolvedCalls: string[]; // its `calls` that point at something inside the project (req 2.16)
}

/** What one file imports from one module (all import lines for that pair are merged). */
interface ImportPair {
  path: string;
  source: string;
  line: number;
  names: Set<string>; // imported names and the default name
  everything: Set<string>; // the same plus the namespace name
}

interface Owner {
  path: string;
  line: number;
}

interface ClassInFile {
  path: string;
  cls: ClassEntry;
}

interface Context {
  files: FileEntry[]; // only files that were parsed
  attempt: number;
  /** h(x): depends on the seed only. Used to pick questions and wrong answers. */
  hash: (text: string) => number;
  /**
   * hc(x): depends on seed and attempt. Used only to order the choices. It is a second function
   * because `attempt` must change the order of the choices and nothing else (req 2.15): if it
   * were mixed into `hash`, a retake would pick other questions and other wrong answers.
   */
  choiceHash: (text: string) => number;
  pool: PoolFunction[]; // functions with a display name that is unique in the map
  poolByFile: Map<string, PoolFunction[]>;
  calleeToCallers: Map<string, PoolFunction[]>; // resolved callee -> pooled functions that call it
  topLevelNames: string[]; // display names of the pooled top-level functions
  classes: ClassInFile[]; // every class except one named `default`
  classNameCounts: Map<string, number>;
  classesByName: Map<string, ClassEntry[]>; // every class, to find the parents of a class by name
  exportOwners: Map<string, Owner[]>; // named export -> files that export it
  exportNamesByFile: Map<string, Set<string>>; // every export name of a file, of any kind, CommonJS included
  filesWithUnknownExports: Set<string>; // files with `module.exports = something we cannot read`
  importPairs: Map<string, ImportPair>;
}

/** What a file can call by a short name: names imported from relative modules, and namespaces. */
interface FileScope {
  names: Set<string>;
  namespaces: Set<string>;
}

function isRelativeModule(source: string): boolean {
  return source.startsWith("./") || source.startsWith("../");
}

function readScope(file: FileEntry): FileScope {
  const scope: FileScope = { names: new Set(), namespaces: new Set() };
  for (const imp of file.imports) {
    if (!isRelativeModule(imp.source)) continue;
    for (const name of imp.names) scope.names.add(name);
    if (imp.defaultName !== undefined) scope.names.add(imp.defaultName);
    if (imp.namespace !== undefined) scope.namespaces.add(imp.namespace);
  }
  return scope;
}

/**
 * Keeps the calls that point at something inside the project (req 2.16): a top-level function of
 * the map or a name imported from a relative module; `this.m` for a method of the same class;
 * `obj.x` when `obj` is a namespace import from a relative module. `console.log` and the like drop out.
 */
function resolveCalls(calls: string[], scope: FileScope, topLevel: Set<string>, ownMethods: Set<string> | undefined): string[] {
  const resolved: string[] = [];
  for (const call of calls) {
    const dot = call.indexOf(".");
    if (dot === -1) {
      if (topLevel.has(call) || scope.names.has(call)) resolved.push(call);
    } else if (call.slice(0, dot) === "this") {
      if (ownMethods?.has(call.slice(dot + 1))) resolved.push(call);
    } else if (scope.namespaces.has(call.slice(0, dot))) {
      resolved.push(call);
    }
  }
  return resolved;
}

function toPoolFunction(
  display: string,
  path: string,
  entry: FunctionEntry | MethodEntry,
  scope: FileScope,
  topLevel: Set<string>,
  ownMethods: Set<string> | undefined,
): PoolFunction {
  return {
    display,
    isMethod: ownMethods !== undefined,
    path,
    line: entry.line,
    params: entry.params,
    plainParams: entry.plainParams,
    async: entry.async,
    calledNames: new Set(entry.calledNames),
    mentioned: new Set(entry.mentionedNames),
    mentionsCut: entry.mentionedNames.length >= MAX_MENTIONED_NAMES,
    resolvedCalls: resolveCalls(entry.calls, scope, topLevel, ownMethods),
  };
}

/** Functions and methods whose display name occurs once in the map. Ambiguous names and `default` are dropped. */
function buildPool(files: FileEntry[], scopes: Map<string, FileScope>, topLevel: Set<string>): PoolFunction[] {
  const all: PoolFunction[] = [];
  for (const file of files) {
    const scope = scopes.get(file.path) ?? { names: new Set<string>(), namespaces: new Set<string>() };
    for (const fn of file.functions) {
      if (fn.name === "default") continue;
      all.push(toPoolFunction(fn.name, file.path, fn, scope, topLevel, undefined));
    }
    for (const cls of file.classes) {
      if (cls.name === "default") continue;
      const ownMethods = new Set(cls.methods.map((m) => m.name));
      for (const m of cls.methods) all.push(toPoolFunction(`${cls.name}.${m.name}`, file.path, m, scope, topLevel, ownMethods));
    }
  }
  const counts = new Map<string, number>();
  for (const f of all) counts.set(f.display, (counts.get(f.display) ?? 0) + 1);
  return all.filter((f) => counts.get(f.display) === 1);
}

function groupImports(files: FileEntry[]): Map<string, ImportPair> {
  const pairs = new Map<string, ImportPair>();
  for (const file of files) {
    for (const imp of file.imports) {
      // NUL cannot be part of a path or a module name, so it is a safe separator.
      const key = `${file.path}\u0000${imp.source}`;
      let pair = pairs.get(key);
      if (!pair) {
        pair = { path: file.path, source: imp.source, line: imp.line, names: new Set(), everything: new Set() };
        pairs.set(key, pair);
      }
      pair.line = Math.min(pair.line, imp.line);
      for (const name of imp.names) {
        pair.names.add(name);
        pair.everything.add(name);
      }
      if (imp.defaultName !== undefined) {
        pair.names.add(imp.defaultName);
        pair.everything.add(imp.defaultName);
      }
      if (imp.namespace !== undefined) pair.everything.add(imp.namespace);
    }
  }
  return pairs;
}

function buildContext(map: StructureMap, seed: number, attempt: number): Context {
  const files = map.files.filter((f) => f.parsed);

  const scopes = new Map<string, FileScope>();
  const topLevel = new Set<string>();
  const classes: ClassInFile[] = [];
  const classNameCounts = new Map<string, number>();
  const classesByName = new Map<string, ClassEntry[]>();
  const exportOwners = new Map<string, Owner[]>();
  const exportNamesByFile = new Map<string, Set<string>>();
  const filesWithUnknownExports = new Set<string>();
  for (const file of files) {
    scopes.set(file.path, readScope(file));
    for (const fn of file.functions) if (fn.name !== "default") topLevel.add(fn.name);
    for (const cls of file.classes) {
      const sameName = classesByName.get(cls.name);
      if (sameName) sameName.push(cls);
      else classesByName.set(cls.name, [cls]);
      if (cls.name === "default") continue;
      classes.push({ path: file.path, cls });
      classNameCounts.set(cls.name, (classNameCounts.get(cls.name) ?? 0) + 1);
    }
    if (file.hasUnknownExports) filesWithUnknownExports.add(file.path);
    const names = new Set<string>(file.commonjsExports);
    for (const e of file.exports) {
      names.add(e.name);
      if (e.kind !== "named" || e.name === "default") continue;
      const owner = { path: file.path, line: e.line };
      const owners = exportOwners.get(e.name);
      if (owners) owners.push(owner);
      else exportOwners.set(e.name, [owner]);
    }
    exportNamesByFile.set(file.path, names);
  }

  const pool = buildPool(files, scopes, topLevel);
  const poolByFile = new Map<string, PoolFunction[]>();
  const calleeToCallers = new Map<string, PoolFunction[]>();
  for (const f of pool) {
    const inFile = poolByFile.get(f.path);
    if (inFile) inFile.push(f);
    else poolByFile.set(f.path, [f]);
    for (const callee of f.resolvedCalls) {
      const callers = calleeToCallers.get(callee);
      if (callers) callers.push(f);
      else calleeToCallers.set(callee, [f]);
    }
  }

  return {
    files,
    attempt,
    hash: (text) => fnv1a32(`${seed}|${text}`),
    choiceHash: (text) => fnv1a32(`${seed}|${attempt}|${text}`),
    pool,
    poolByFile,
    calleeToCallers,
    topLevelNames: pool.filter((f) => !f.isMethod).map((f) => f.display),
    classes,
    classNameCounts,
    classesByName,
    exportOwners,
    exportNamesByFile,
    filesWithUnknownExports,
    importPairs: groupImports(files),
  };
}

// ---------------------------------------------------------------------------
// Building one question
// ---------------------------------------------------------------------------

/** A question that can be built later: the id is known, the choices are made only in `build`. */
interface Candidate {
  id: string;
  build: () => StructuralQuestion | undefined;
}

/** Everything a template needs to make one question. */
interface QuestionSpec {
  template: string;
  key: string; // the subject, for example a function name; the id is `template:key`
  concept: StructuralConcept;
  prompt: string;
  correct: string;
  distractors: string[];
  source: { path: string; line: number };
  /** Choices are numbers: on the first attempt they are shown in ascending order (req 2.18). */
  numeric?: boolean;
}

/** Up to 3 wrong answers: the pool without the correct answer and duplicates, in hash order. */
function pickDistractors(ctx: Context, id: string, correct: string, pool: string[]): string[] {
  const candidates = [...new Set(pool)].filter((choice) => choice !== correct);
  return sortByHash(candidates, (choice) => `${id}|${choice}`, ctx.hash).slice(0, MAX_DISTRACTORS);
}

/** Builds the question, or returns undefined when there is no wrong answer to offer (req 2.6). */
function makeQuestion(ctx: Context, spec: QuestionSpec): StructuralQuestion | undefined {
  if (spec.distractors.length === 0) return undefined;
  const id = `${spec.template}:${spec.key}`;
  const all = [spec.correct, ...spec.distractors];
  // The choice order depends on the attempt; everything else does not.
  const choices =
    spec.numeric && ctx.attempt === 0
      ? all.sort((a, b) => Number(a) - Number(b))
      : sortByHash(all, (choice) => `${id}#${choice}`, ctx.choiceHash);
  return {
    id,
    concept: spec.concept,
    kind: "mcq",
    choices,
    answerIndex: choices.indexOf(spec.correct),
    prompt: spec.prompt,
    source: spec.source,
  };
}

// ---------------------------------------------------------------------------
// The six templates. Each lists cheap candidates; the choices are made later, only for the
// candidates that are really needed.
// ---------------------------------------------------------------------------

/**
 * caller (concept: call-graph). "In `file`, which function calls `Y`?"
 * Subject: a call `Y` that points inside the project (req 2.16) and has at least one caller.
 * The correct answer is one of its callers; `file` is that caller's file.
 * Wrong answers: functions of the same file that do not call anything named like Y (req 2.17),
 * so `obj.a.helper()` or `console.log()` makes a function an invalid wrong answer.
 */
function callerCandidates(ctx: Context): Candidate[] {
  const candidates: Candidate[] = [];
  for (const [callee, callers] of ctx.calleeToCallers) {
    const id = `caller:${callee}`;
    candidates.push({ id, build: () => buildCaller(ctx, id, callee, callers) });
  }
  return candidates;
}

function buildCaller(ctx: Context, id: string, callee: string, callers: PoolFunction[]): StructuralQuestion | undefined {
  const correct = sortByHash(callers, (f) => `${id}|${f.display}`, ctx.hash)[0];
  if (!correct) return undefined;
  const name = lastSegment(callee);
  const others: string[] = [];
  for (const f of ctx.poolByFile.get(correct.path) ?? []) {
    // A wrong answer must not touch the name in any way: not by a call, not as a callback or alias.
    // A function whose mention list was cut may hide the name, so it is never offered.
    const touches = f.calledNames.has(name) || f.mentioned.has(name) || f.mentionsCut;
    if (lastSegment(f.display) !== name && !touches) others.push(f.display);
  }
  return makeQuestion(ctx, {
    template: "caller",
    key: callee,
    concept: "call-graph",
    prompt: `In \`${correct.path}\`, which function calls \`${callee}\`?`,
    correct: correct.display,
    distractors: pickDistractors(ctx, id, correct.display, others),
    source: { path: correct.path, line: correct.line },
  });
}

/**
 * class-method (concept: classes). "Which of these is a method of class `C`?"
 * Subject: a class with at least one method whose name is used by only one class.
 * Wrong answers: methods of other classes and top-level function names, minus every method, getter
 * and setter of C and of its parent classes (a subclass has its parents' methods too). When a parent
 * is not in the map (`extends React.Component`), the question is skipped: its methods are unknown.
 */
function classMethodCandidates(ctx: Context): Candidate[] {
  const candidates: Candidate[] = [];
  for (const { path, cls } of ctx.classes) {
    if (cls.methods.length === 0 || ctx.classNameCounts.get(cls.name) !== 1) continue;
    const id = `class-method:${cls.name}`;
    candidates.push({ id, build: () => buildClassMethod(ctx, id, path, cls) });
  }
  return candidates;
}

/**
 * Method, getter and setter names that `cls` gets from its parent classes, found by class name
 * inside the map, up the whole chain. Returns undefined when some parent is not in the map.
 * A name that was already visited is not visited again, so a loop (`A extends B`, `B extends A`) ends.
 */
function inheritedNames(ctx: Context, cls: ClassEntry): Set<string> | undefined {
  const names = new Set<string>();
  const visited = new Set<string>();
  const todo: string[] = cls.superClass === undefined ? [] : [cls.superClass];
  for (let parentName = todo.pop(); parentName !== undefined; parentName = todo.pop()) {
    if (visited.has(parentName)) continue;
    visited.add(parentName);
    const parents = ctx.classesByName.get(parentName);
    if (!parents) return undefined;
    for (const parent of parents) {
      for (const m of parent.methods) names.add(m.name);
      for (const accessor of parent.accessors) names.add(accessor);
      if (parent.superClass !== undefined) todo.push(parent.superClass);
    }
  }
  return names;
}

function buildClassMethod(ctx: Context, id: string, path: string, cls: ClassEntry): StructuralQuestion | undefined {
  const own = new Set(cls.methods.map((m) => m.name));
  const correct = sortByHash([...own], (name) => `${id}|${name}`, ctx.hash)[0];
  if (correct === undefined) return undefined;
  const inherited = inheritedNames(ctx, cls);
  if (inherited === undefined) return undefined;
  // Names that must not be offered as wrong answers because the class has them too.
  const hasToo = new Set([...own, ...cls.accessors, ...inherited]);
  const others: string[] = [];
  for (const other of ctx.classes) {
    if (other.cls === cls) continue;
    for (const m of other.cls.methods) if (!hasToo.has(m.name)) others.push(m.name);
  }
  for (const name of ctx.topLevelNames) if (!hasToo.has(name)) others.push(name);
  return makeQuestion(ctx, {
    template: "class-method",
    key: cls.name,
    concept: "classes",
    prompt: `Which of these is a method of class \`${cls.name}\`?`,
    correct,
    distractors: pickDistractors(ctx, id, correct, others),
    source: { path, line: cls.line },
  });
}

/**
 * import-from (concept: imports). "Which of these does `file` import from `module`?"
 * Subject: a (file, module) pair with at least one imported name.
 * Wrong answers: names imported by other pairs, minus every name this file takes from this module.
 */
function importFromCandidates(ctx: Context): Candidate[] {
  const candidates: Candidate[] = [];
  for (const [key, pair] of ctx.importPairs) {
    if (pair.names.size === 0) continue;
    const id = `import-from:${key}`;
    candidates.push({ id, build: () => buildImportFrom(ctx, id, key, pair) });
  }
  return candidates;
}

function buildImportFrom(ctx: Context, id: string, key: string, pair: ImportPair): StructuralQuestion | undefined {
  const correct = sortByHash([...pair.names], (name) => `${id}|${name}`, ctx.hash)[0];
  if (correct === undefined) return undefined;
  const others: string[] = [];
  for (const other of ctx.importPairs.values()) {
    if (other === pair) continue;
    for (const name of other.names) if (!pair.everything.has(name)) others.push(name);
  }
  return makeQuestion(ctx, {
    template: "import-from",
    key,
    concept: "imports",
    prompt: `Which of these does \`${pair.path}\` import from \`${pair.source}\`?`,
    correct,
    distractors: pickDistractors(ctx, id, correct, others),
    source: { path: pair.path, line: pair.line },
  });
}

/**
 * export-owner (concept: exports). "Which file exports `X`?"
 * Subject: a named export that exactly one file has.
 * Wrong answers: parsed files with no export called X (ES or CommonJS), no `export *`, and no
 * `module.exports` whose names are unknown, so a file that re-exports or may export X is never
 * offered as a wrong answer.
 */
function exportOwnerCandidates(ctx: Context): Candidate[] {
  const candidates: Candidate[] = [];
  for (const [name, owners] of ctx.exportOwners) {
    const owner = owners[0];
    if (owners.length !== 1 || !owner) continue;
    const id = `export-owner:${name}`;
    candidates.push({ id, build: () => buildExportOwner(ctx, id, name, owner) });
  }
  return candidates;
}

function buildExportOwner(ctx: Context, id: string, name: string, owner: Owner): StructuralQuestion | undefined {
  const others: string[] = [];
  for (const file of ctx.files) {
    if (ctx.filesWithUnknownExports.has(file.path)) continue;
    const exported = ctx.exportNamesByFile.get(file.path);
    if (!exported?.has(name) && !exported?.has("*")) others.push(file.path);
  }
  return makeQuestion(ctx, {
    template: "export-owner",
    key: name,
    concept: "exports",
    prompt: `Which file exports \`${name}\`?`,
    correct: owner.path,
    distractors: pickDistractors(ctx, id, owner.path, others),
    source: owner,
  });
}

/**
 * async-pick (concept: async-functions). "In `file`, which function is async?"
 * Subject: each async function. Wrong answers: functions of the same file that are not async,
 * so the prompt is true for every choice.
 */
function asyncPickCandidates(ctx: Context): Candidate[] {
  const candidates: Candidate[] = [];
  for (const f of ctx.pool) {
    if (!f.async) continue;
    const id = `async-pick:${f.display}`;
    candidates.push({ id, build: () => buildAsyncPick(ctx, id, f) });
  }
  return candidates;
}

function buildAsyncPick(ctx: Context, id: string, f: PoolFunction): StructuralQuestion | undefined {
  const notAsync: string[] = [];
  for (const other of ctx.poolByFile.get(f.path) ?? []) if (!other.async) notAsync.push(other.display);
  return makeQuestion(ctx, {
    template: "async-pick",
    key: f.display,
    concept: "async-functions",
    prompt: `In \`${f.path}\`, which function is async?`,
    correct: f.display,
    distractors: pickDistractors(ctx, id, f.display, notAsync),
    source: { path: f.path, line: f.line },
  });
}

/**
 * param-count (concept: parameters). "How many parameters does `fn` in `file` take?"
 * Subject: each function whose parameters are all plain identifiers (a default, rest or
 * destructured parameter makes the count unclear). Wrong answers: three of the nearby numbers
 * p-2, p-1, p+1, p+2, p+3 (not below 0), picked by hash like every other template. A fixed set of
 * offsets would put the correct number at the same place in the sorted list every time.
 */
function paramCountCandidates(ctx: Context): Candidate[] {
  const candidates: Candidate[] = [];
  for (const f of ctx.pool) {
    if (!f.plainParams) continue;
    const id = `param-count:${f.display}`;
    candidates.push({ id, build: () => buildParamCount(ctx, id, f) });
  }
  return candidates;
}

function buildParamCount(ctx: Context, id: string, f: PoolFunction): StructuralQuestion | undefined {
  const p = f.params;
  const nearby = [p - 2, p - 1, p + 1, p + 2, p + 3].filter((n) => n >= 0).map(String);
  return makeQuestion(ctx, {
    template: "param-count",
    key: f.display,
    concept: "parameters",
    prompt: `How many parameters does \`${f.display}\` in \`${f.path}\` take?`,
    correct: String(p),
    distractors: pickDistractors(ctx, id, String(p), nearby),
    source: { path: f.path, line: f.line },
    numeric: true,
  });
}

/** The fixed order of the templates, from the idea that is most useful to learn to the simplest (req 2.9). */
const TEMPLATE_ORDER: ((ctx: Context) => Candidate[])[] = [
  callerCandidates,
  classMethodCandidates,
  importFromCandidates,
  exportOwnerCandidates,
  asyncPickCandidates,
  paramCountCandidates,
];

// ---------------------------------------------------------------------------
// Ordering and options
// ---------------------------------------------------------------------------

/**
 * Round-robin over the templates in their fixed order, so a short quiz covers many concepts.
 * Inside a template the candidates are ordered by the hash of their id. Questions are built one at
 * a time and only until `count` exist; a candidate that cannot be built is skipped. The sequence
 * does not depend on `count`, so a longer quiz always starts with the shorter one (req 2.12).
 */
function pickQuestions(ctx: Context, count: number): StructuralQuestion[] {
  const result: StructuralQuestion[] = [];
  if (count === 0) return result;
  const queues = TEMPLATE_ORDER.map((candidatesOf) => ({
    list: sortByHash(candidatesOf(ctx), (c) => c.id, ctx.hash),
    next: 0,
  }));
  let madeOne = true;
  while (madeOne && result.length < count) {
    madeOne = false;
    for (const queue of queues) {
      if (result.length >= count) break;
      while (queue.next < queue.list.length) {
        const question = queue.list[queue.next++]?.build();
        if (question) {
          result.push(question);
          madeOne = true;
          break;
        }
      }
    }
  }
  return result;
}

function checkNonNegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer, got ${String(value)}`);
  }
}

/** Makes up to `count` multiple-choice questions from the map. Throws RangeError for bad options. */
export function generateStructuralQuestions(map: StructureMap, options: StructuralQuestionOptions = {}): StructuralQuestion[] {
  const { count = DEFAULT_COUNT, seed = 0, attempt = 0 } = options;
  if (!Number.isInteger(count) || count < 0 || count > MAX_COUNT) {
    throw new RangeError(`count must be an integer from 0 to ${MAX_COUNT}, got ${String(count)}`);
  }
  checkNonNegativeInteger("seed", seed);
  checkNonNegativeInteger("attempt", attempt);
  return pickQuestions(buildContext(map, seed, attempt), count);
}
