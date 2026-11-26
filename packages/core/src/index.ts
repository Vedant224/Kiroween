// Public entry point for @seance/core.
// Re-exports the review engine (sm2, gate, scoring) and the structure map with its question generator.
// More modules are added from Task 4 onward.

export { MAX_INTERVAL_DAYS, newCard, nextReview } from "./sm2.js";
export type { Card, Quality } from "./sm2.js";
export { DEFAULT_PASS_MARK, gateDecision } from "./gate.js";
export type { GateMode, GateReason, GateResult } from "./gate.js";
export { EXPLAIN_MISS_BELOW, scoreQuiz } from "./scoring.js";
export type { QuizAnswer, QuizQuestion, QuizResult } from "./scoring.js";
export { buildStructureMap, MAP_LIMITS } from "./structure-map.js";
export type {
  ClassEntry,
  ExportEntry,
  FileEntry,
  FunctionEntry,
  ImportEntry,
  Language,
  MethodEntry,
  ParseIssue,
  SourceFile,
  StructureMap,
} from "./structure-map.js";
export { generateStructuralQuestions } from "./structural-questions.js";
export type { StructuralConcept, StructuralQuestion, StructuralQuestionOptions } from "./structural-questions.js";

/** Markers that delimit the auto-generated sections of PROJECT.md. */
export const AUTO_START = "<!-- seance:auto:start -->";
export const AUTO_END = "<!-- seance:auto:end -->";

/** Returns true when the text contains a well-formed auto section (start before end). */
export function hasAutoSection(text: string): boolean {
  const start = text.indexOf(AUTO_START);
  if (start === -1) return false;
  return text.indexOf(AUTO_END, start + AUTO_START.length) !== -1;
}
