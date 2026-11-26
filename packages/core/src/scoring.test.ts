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
    expect(result.score).toBe(0.48);
    expect(result.missedConcepts).toEqual(["closures", "async", "modules"]);
    expect(result.answered).toBe(4);
    expect(result.total).toBe(5);
  });

  it("E3: a better explain score gives 0.56 and does not miss `modules`", () => {
    const result = scoreQuiz(quiz, e3Answers(0.8));
    expect(result.score).toBe(0.56);
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

  it("ignores answers on an empty quiz, even invalid ones (req 3.14)", () => {
    const empty = { score: 0, missedConcepts: [], answered: 0, total: 0 };
    expect(scoreQuiz([], [{ questionId: "a", kind: "choice", choiceIndex: 0 }])).toEqual(empty);
    expect(scoreQuiz([], [{ questionId: "a", kind: "graded", score: 99 }])).toEqual(empty);
  });

  it("rounds the score to 4 decimals so float sums match the pass mark exactly (req 3.2)", () => {
    const explain = (n: number): QuizQuestion[] =>
      Array.from({ length: n }, (_, i) => ({ id: `e${i}`, concept: `c${i}`, kind: "explain" as const }));
    const graded = (n: number, score: number): QuizAnswer[] =>
      Array.from({ length: n }, (_, i) => ({ questionId: `e${i}`, kind: "graded" as const, score }));

    // Without rounding, 0.7 + 0.7 + 0.7 over 3 gives 0.6999999999999998 and 7 x 0.7 over 7 gives 0.7000000000000001.
    expect((0.7 + 0.7 + 0.7) / 3).not.toBe(0.7);
    expect(scoreQuiz(explain(3), graded(3, 0.7)).score).toBe(0.7);
    expect(scoreQuiz(explain(7), graded(7, 0.7)).score).toBe(0.7);

    // 0.1 + 0.2 = 0.30000000000000004, so the raw average is 0.15000000000000002.
    const mixed: QuizAnswer[] = [
      { questionId: "e0", kind: "graded", score: 0.1 },
      { questionId: "e1", kind: "graded", score: 0.2 },
    ];
    expect(scoreQuiz(explain(2), mixed).score).toBe(0.15);
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

  it("rejects a choice question with fewer than 2 choices, naming the question id (req 3.13)", () => {
    const one: QuizQuestion = { id: "one-choice", concept: "loops", kind: "mcq", choices: ["x"], answerIndex: 0 };
    const none: QuizQuestion = { id: "no-choice", concept: "loops", kind: "what-if", choices: [], answerIndex: 0 };
    expect(() => scoreQuiz([one], [])).toThrow(/one-choice/);
    expect(() => scoreQuiz([none], [])).toThrow(/no-choice/);
  });

  it("rejects a correct answerIndex that is out of range or not an integer, naming the id (req 3.13)", () => {
    for (const answerIndex of [-1, 2, 0.5, Number.NaN]) {
      const bad: QuizQuestion = { id: "bad-index", concept: "loops", kind: "mcq", choices: ["x", "y"], answerIndex };
      expect(() => scoreQuiz([bad], [])).toThrow(RangeError);
      expect(() => scoreQuiz([bad], [])).toThrow(/bad-index/);
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

  it("P9a: every unanswered question's concept is in missedConcepts", () => {
    fc.assert(
      fc.property(quizWithAnswers, ({ questions, answers }) => {
        const answeredIds = new Set(answers.map((a) => a.questionId));
        const { missedConcepts } = scoreQuiz(questions, answers);
        for (const q of questions) {
          if (!answeredIds.has(q.id)) expect(missedConcepts).toContain(q.concept);
        }
      }),
    );
  });

  it("P9b: answering nothing misses every distinct concept, in question order", () => {
    fc.assert(
      fc.property(quizArb, (questions) => {
        const result = scoreQuiz(questions, []);
        expect(result.missedConcepts).toEqual([...new Set(questions.map((q) => q.concept))]);
        expect(result.score).toBe(0);
        expect(result.answered).toBe(0);
      }),
    );
  });
});
