// Quiz scoring: turns a quiz plus the developer's answers into a 0..1 score and missed concepts.
// Pure function. Any invalid input throws a RangeError that names the problem.

export type QuizQuestion =
  | { id: string; concept: string; kind: "mcq" | "what-if"; choices: string[]; answerIndex: number }
  | { id: string; concept: string; kind: "explain" };

export type QuizAnswer =
  | { questionId: string; kind: "choice"; choiceIndex: number }
  | { questionId: string; kind: "graded"; score: number }; // score comes from the AI grader

export interface QuizResult {
  /** Average points per question, from 0 to 1. */
  score: number;
  /** Concepts of missed questions, each once, in question order. */
  missedConcepts: string[];
  /** How many questions have an answer. */
  answered: number;
  /** How many questions the quiz has. */
  total: number;
}

/** An explain answer graded below this counts as a missed concept. */
export const EXPLAIN_MISS_BELOW = 0.5;

/** Makes a lookup by id. Throws on a repeated id. */
function indexById<T>(items: T[], getId: (item: T) => string, label: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    const id = getId(item);
    if (map.has(id)) throw new RangeError(`duplicate ${label} id: ${id}`);
    map.set(id, item);
  }
  return map;
}

/** Throws unless the answer fits its question (same kind, valid index or score). */
function checkAnswer(question: QuizQuestion, answer: QuizAnswer): void {
  const id = question.id;
  if (question.kind === "explain") {
    if (answer.kind !== "graded") {
      throw new RangeError(`question ${id} is an explain question and needs a graded answer`);
    }
    const s = answer.score;
    if (typeof s !== "number" || !Number.isFinite(s) || s < 0 || s > 1) {
      throw new RangeError(`graded score for ${id} must be a finite number in [0, 1], got ${String(s)}`);
    }
    return;
  }
  if (answer.kind !== "choice") {
    throw new RangeError(`question ${id} is a choice question and needs a choice answer`);
  }
  const i = answer.choiceIndex;
  if (!Number.isInteger(i) || i < 0 || i >= question.choices.length) {
    throw new RangeError(`choiceIndex for ${id} must be an integer in 0..${question.choices.length - 1}, got ${String(i)}`);
  }
}

/** Points for one question: 0 to 1. A missing answer earns 0. */
function pointsFor(question: QuizQuestion, answer: QuizAnswer | undefined): number {
  if (!answer) return 0;
  if (question.kind === "explain") {
    return answer.kind === "graded" ? answer.score : 0;
  }
  if (answer.kind !== "choice") return 0;
  return answer.choiceIndex === question.answerIndex ? 1 : 0;
}

/** Is the question a missed concept? Choice: 0 points. Explain: graded below 0.5. */
function isMissed(question: QuizQuestion, points: number): boolean {
  if (question.kind === "explain") return points < EXPLAIN_MISS_BELOW;
  return points === 0;
}

export function scoreQuiz(questions: QuizQuestion[], answers: QuizAnswer[]): QuizResult {
  if (questions.length === 0) {
    return { score: 0, missedConcepts: [], answered: 0, total: 0 };
  }

  const questionById = indexById(questions, (q) => q.id, "question");
  const answerById = indexById(answers, (a) => a.questionId, "answer");
  for (const [id, answer] of answerById) {
    const question = questionById.get(id);
    if (!question) throw new RangeError(`answer refers to unknown question id: ${id}`);
    checkAnswer(question, answer);
  }

  let totalPoints = 0;
  const missed: string[] = [];
  for (const question of questions) {
    const points = pointsFor(question, answerById.get(question.id));
    totalPoints += points;
    if (isMissed(question, points) && !missed.includes(question.concept)) {
      missed.push(question.concept);
    }
  }

  // Clamp so floating point error can never push the score outside 0..1.
  const score = Math.min(1, Math.max(0, totalPoints / questions.length));
  return { score, missedConcepts: missed, answered: answerById.size, total: questions.length };
}
