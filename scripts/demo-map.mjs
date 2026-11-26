// Demo: builds the structure map of packages/core/fixtures/, prints one line per file, then 5 quiz questions.
// Run with `npm run demo:map` (it builds @seance/core first).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildStructureMap, generateStructuralQuestions } from "../packages/core/dist/index.js";

// Read every fixture file (the core library never reads files itself).
const root = fileURLToPath(new URL("../packages/core/fixtures/", import.meta.url));
const files = readdirSync(root, { recursive: true, encoding: "utf8" })
  .filter((name) => statSync(root + name).isFile())
  .map((name) => ({ path: name, content: readFileSync(root + name, "utf8") }));

const map = buildStructureMap(files);

console.log("STRUCTURE MAP");
for (const f of map.files) {
  console.log(
    `${f.path} [${f.language}, ${f.lines} lines] imports ${f.imports.length}, exports ${f.exports.length}, ` +
      `functions ${f.functions.length}, classes ${f.classes.length}, errors ${f.errors.length}` +
      (f.parsed ? "" : " (not parsed)"),
  );
}

console.log("\nQUESTIONS (seed 0)");
const questions = generateStructuralQuestions(map, { count: 5, seed: 0 });
for (const [i, q] of questions.entries()) {
  console.log(`\n${i + 1}. [${q.concept}] ${q.prompt}   (${q.source.path}:${q.source.line})`);
  for (const [j, choice] of q.choices.entries()) {
    const letter = String.fromCharCode(65 + j);
    console.log(`   ${letter}) ${choice}${j === q.answerIndex ? "   <- correct" : ""}`);
  }
}
