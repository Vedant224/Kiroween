// Tests for scoring.ts: example cases from the spec plus fast-check properties.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { scoreQuiz, type QuizAnswer, type QuizQuestion } from "./scoring.js";

// The quiz from example E3: 3 choice questions, 1 what-if, 1 explain.
const quiz: QuizQuestion[] = [
  { id: "a", concept: "variables", kind: "mcq", choices: ["x", "y"], answerIndex: 0 },
  { id: "b", concept: "loops", kind: "mcq", choices: ["x", "y", "z"], answerIndex: 2 },
  { id: "c", concept: "closures", kind: "mcq", choices: ["x", "y"], answerIndex: 1 },
  { id: "d", concept: "async", kind: "what-if", choices: ["x", "y"], answerIndex: 0 },
  { id: "e", concept: "modules", kind: "explain" },
];

function e3Answers(explainScore: number): QuizAnswer[] {
  return [
    { questionId: "a", kind: "choice", choiceIndex: 0 }, // correct
    { questionId: "b", kind: "choice", choiceIndex: 2 }, // correct
    { questionId: "c", kind: "choice", choiceIndex: 0 }, // wrong
    // "d" is left unanswered
    { questionId: "e", kind: "graded", score: explainScore },
  ];
}

describe("scoreQuiz examples", () => {
  it("E3: mixed answers give 0.48 and three missed concepts", () => {
    const result = scoreQuiz(quiz, e3Answers(0.4));
    expect(result.score).toBeCloseTo(0.48, 10);
    expect(result.missedConcepts).toEqual(["closures", "async", "modules"]);
    expect(result.answered).toBe(4);
    expect(result.total).toBe(5);
  });

  it("E3: a better explain score gives 0.56 and does not miss `modules`", () => {
    const result = scoreQuiz(quiz, e3Answers(0.8));
    expect(result.score).toBeCloseTo(0.56, 10);
    expect(result.missedConcepts).toEqual(["closures", "async"]);
  });

  it("an explain score of exactly 0.5 is not missed", () => {
    const result = scoreQuiz([{ id: "e", concept: "modules", kind: "explain" }], [
      { questionId: "e", kind: "graded", score: 0.5 },
    ]);
    expect(result.missedConcepts).toEqual([]);
  });

  it("lists a concept once even if two questions miss it", () => {
    const questions: QuizQuestion[] = [
      { id: "1", concept: "loops", kind: "mcq", choices: ["x", "y"], answerIndex: 0 },
      { id: "2", concept: "loops", kind: "what-if", choices: ["x", "y"], answerIndex: 0 },
    ];
    expect(scoreQuiz(questions, []).missedConcepts).toEqual(["loops"]);
  });

  it("returns zeros for an empty quiz", () => {
    expect(scoreQuiz([], [])).toEqual({ score: 0, missedConcepts: [], answered: 0, total: 0 });
  });
});

describe("scoreQuiz input checks", () => {
  it("rejects an answer with an unknown question id", () => {
    expect(() => scoreQuiz(quiz, [{ questionId: "zzz", kind: "choice", choiceIndex: 0 }])).toThrow(RangeError);
  });

  it("rejects two answers with the same id", () => {
    const twice: QuizAnswer[] = [
      { questionId: "a", kind: "choice", choiceIndex: 0 },
      { questionId: "a", kind: "choice", choiceIndex: 1 },
    ];
    expect(() => scoreQuiz(quiz, twice)).toThrow(RangeError);
  });

  it("rejects two questions with the same id", () => {
    const first = quiz[0] as QuizQuestion;
    expect(() => scoreQuiz([first, first], [])).toThrow(RangeError);
  });

  it("rejects a choice index that is out of range or not an integer", () => {
    for (const choiceIndex of [-1, 2, 0.5, Number.NaN]) {
      expect(() => scoreQuiz(quiz, [{ questionId: "a", kind: "choice", choiceIndex }])).toThrow(RangeError);
    }
  });

  it("rejects an answer kind that does not match the question", () => {
    expect(() => scoreQuiz(quiz, [{ questionId: "a", kind: "graded", score: 1 }])).toThrow(RangeError);
    expect(() => scoreQuiz(quiz, [{ questionId: "e", kind: "choice", choiceIndex: 0 }])).toThrow(RangeError);
  });

  it("rejects a graded score outside [0, 1]", () => {
    for (const score of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => scoreQuiz(quiz, [{ questionId: "e", kind: "graded", score }])).toThrow(RangeError);
    }
  });
});

// ---- Properties (fast-check) ----

const CONCEPTS = ["variables", "loops", "closures", "async", "modules"];

// Question number `i` gets id `q${i}`. Concepts come from a small pool so duplicates occur.
const questionArb = (i: number): fc.Arbitrary<QuizQuestion> =>
  fc.oneof(
    fc
      .record({
        concept: fc.constantFrom(...CONCEPTS),
        kind: fc.constantFrom("mcq" as const, "what-if" as const),
        choices: fc.array(fc.string(), { minLength: 2, maxLength: 4 }),
        pick: fc.nat(),
      })
      .map(({ concept, kind, choices, pick }) => ({
        id: `q${i}`,
        concept,
        kind,
        choices,
        answerIndex: pick % choices.length,
      })),
    fc.constantFrom(...CONCEPTS).map((concept) => ({ id: `q${i}`, concept, kind: "explain" as const })),
  );

const quizArb: fc.Arbitrary<QuizQuestion[]> = fc
  .integer({ min: 0, max: 8 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => questionArb(i))))
  .map((questions) => questions as QuizQuestion[]);

// A valid answer for a question: a random choice index, or a random 0..1 grade.
function randomAnswer(q: QuizQuestion, pick: number, grade: number): QuizAnswer {
  if (q.kind === "explain") return { questionId: q.id, kind: "graded", score: grade };
  return { questionId: q.id, kind: "choice", choiceIndex: pick % q.choices.length };
}

// A quiz plus a random subset of valid answers.
const quizWithAnswers = quizArb.chain((questions) =>
  fc
    .array(
      fc.record({ keep: fc.boolean(), pick: fc.nat(), grade: fc.double({ min: 0, max: 1, noNaN: true }) }),
      { minLength: questions.length, maxLength: questions.length },
    )
    .map((rolls) => ({
      questions,
      answers: questions.flatMap((q, i) => {
        const roll = rolls[i]!;
        return roll.keep ? [randomAnswer(q, roll.pick, roll.grade)] : [];
      }),
    })),
);

describe("scoreQuiz properties", () => {
  it("P7: score is always between 0 and 1", () => {
    fc.assert(
      fc.property(quizWithAnswers, ({ questions, answers }) => {
        const { score } = scoreQuiz(questions, answers);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("P8: answering everything correctly gives score 1 and no missed concepts", () => {
    fc.assert(
      fc.property(quizArb, (questions) => {
        const answers: QuizAnswer[] = questions.map((q) =>
          q.kind === "explain"
            ? { questionId: q.id, kind: "graded", score: 1 }
            : { questionId: q.id, kind: "choice", choiceIndex: q.answerIndex },
        );
        const result = scoreQuiz(questions, answers);
        expect(result.missedConcepts).toEqual([]);
        // An empty quiz scores 0 by definition (req 3.8).
        expect(result.score).toBe(questions.length === 0 ? 0 : 1);
      }),
    );
  });

  it("P9: missed concepts have no duplicates and come from the quiz", () => {
    fc.assert(
      fc.property(quizWithAnswers, ({ questions, answers }) => {
        const { missedConcepts } = scoreQuiz(questions, answers);
        expect(new Set(missedConcepts).size).toBe(missedConcepts.length);
        const known = new Set(questions.map((q) => q.concept));
        for (const concept of missedConcepts) expect(known.has(concept)).toBe(true);
      }),
    );
  });
});
