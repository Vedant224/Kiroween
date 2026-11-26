// Tests for sm2.ts: example cases from the spec plus fast-check properties.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { MAX_INTERVAL_DAYS, nextReview, newCard, type Card } from "./sm2.js";

describe("newCard", () => {
  it("returns the default values, due today", () => {
    expect(newCard("2026-11-27")).toEqual({
      ease: 2.5,
      interval: 0,
      repetitions: 0,
      dueAt: "2026-11-27",
    });
  });

  it("rejects dates that are not real ISO dates", () => {
    expect(() => newCard("2026-02-30")).toThrow(RangeError);
    expect(() => newCard("27-11-2026")).toThrow(RangeError);
    expect(() => newCard("")).toThrow(RangeError);
  });
});

describe("nextReview examples", () => {
  it("follows the demo sequence 5, 5, 2, 4 (E1)", () => {
    const expected = [
      { q: 5, today: "2026-11-27", ease: 2.6, interval: 1, repetitions: 1, dueAt: "2026-11-28" },
      { q: 5, today: "2026-11-28", ease: 2.7, interval: 6, repetitions: 2, dueAt: "2026-12-04" },
      { q: 2, today: "2026-12-04", ease: 2.38, interval: 1, repetitions: 0, dueAt: "2026-12-05" },
      { q: 4, today: "2026-12-05", ease: 2.38, interval: 1, repetitions: 1, dueAt: "2026-12-06" },
    ];
    let card = newCard("2026-11-27");
    for (const step of expected) {
      card = nextReview(card, step.q, step.today);
      expect(card).toEqual({
        ease: step.ease,
        interval: step.interval,
        repetitions: step.repetitions,
        dueAt: step.dueAt,
      });
    }
  });

  it("uses the OLD ease to grow the interval", () => {
    const card: Card = { ease: 2.5, interval: 6, repetitions: 2, dueAt: "2026-11-27" };
    expect(nextReview(card, 4, "2026-11-27")).toEqual({
      ease: 2.5,
      interval: 15,
      repetitions: 3,
      dueAt: "2026-12-12",
    });
  });

  it("caps the interval at 365 days", () => {
    const card: Card = { ease: 2.5, interval: 300, repetitions: 5, dueAt: "2026-11-27" };
    const next = nextReview(card, 5, "2026-11-27");
    expect(next.interval).toBe(MAX_INTERVAL_DAYS);
    expect(next.dueAt).toBe("2027-11-27");
  });

  it("lowers ease on a failed review but never below 1.3", () => {
    const low: Card = { ease: 1.3, interval: 6, repetitions: 2, dueAt: "2026-11-27" };
    expect(nextReview(low, 0, "2026-11-27").ease).toBe(1.3);
  });

  it("does not change the input card", () => {
    const card = newCard("2026-11-27");
    nextReview(card, 5, "2026-11-27");
    expect(card).toEqual(newCard("2026-11-27"));
  });
});

describe("nextReview input checks", () => {
  const card = newCard("2026-11-27");

  it("rejects a quality outside 0..5 or not an integer", () => {
    for (const q of [-1, 6, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => nextReview(card, q, "2026-11-27")).toThrow(RangeError);
    }
  });

  it("rejects a bad today or bad dueAt", () => {
    expect(() => nextReview(card, 4, "2026-02-30")).toThrow(RangeError);
    expect(() => nextReview({ ...card, dueAt: "nope" }, 4, "2026-11-27")).toThrow(RangeError);
  });

  it("rejects bad card fields", () => {
    expect(() => nextReview({ ...card, ease: 1.2 }, 4, "2026-11-27")).toThrow(RangeError);
    expect(() => nextReview({ ...card, ease: Number.NaN }, 4, "2026-11-27")).toThrow(RangeError);
    expect(() => nextReview({ ...card, interval: -1 }, 4, "2026-11-27")).toThrow(RangeError);
    expect(() => nextReview({ ...card, interval: 1.5 }, 4, "2026-11-27")).toThrow(RangeError);
    expect(() => nextReview({ ...card, repetitions: -1 }, 4, "2026-11-27")).toThrow(RangeError);
    expect(() => nextReview({ ...card, repetitions: 0.5 }, 4, "2026-11-27")).toThrow(RangeError);
  });
});

// ---- Properties (fast-check) ----

const MS_PER_DAY = 86_400_000;

// A date from 2000 to 2100 as YYYY-MM-DD.
const isoDate = fc
  .date({ min: new Date("2000-01-01T00:00:00Z"), max: new Date("2100-01-01T00:00:00Z"), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

const validCard: fc.Arbitrary<Card> = fc.record({
  ease: fc.double({ min: 1.3, max: 5, noNaN: true }),
  interval: fc.nat({ max: 3650 }),
  repetitions: fc.nat({ max: 3650 }),
  dueAt: isoDate,
});

const quality = fc.integer({ min: 0, max: 5 });

function daysBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / MS_PER_DAY;
}

describe("nextReview properties", () => {
  it("P1: ease is never below 1.3", () => {
    fc.assert(
      fc.property(validCard, quality, isoDate, (card, q, today) => {
        expect(nextReview(card, q, today).ease).toBeGreaterThanOrEqual(1.3);
      }),
    );
  });

  it("P2: a failed review (q < 3) resets repetitions to 0 and interval to 1", () => {
    fc.assert(
      fc.property(validCard, fc.integer({ min: 0, max: 2 }), isoDate, (card, q, today) => {
        const next = nextReview(card, q, today);
        expect(next.repetitions).toBe(0);
        expect(next.interval).toBe(1);
      }),
    );
  });

  it("P3: intervals never shrink across a run of successes", () => {
    fc.assert(
      fc.property(
        isoDate,
        fc.array(fc.integer({ min: 3, max: 5 }), { minLength: 1, maxLength: 10 }),
        (today, qualities) => {
          let card = newCard(today);
          let previous = 0;
          for (const q of qualities) {
            card = nextReview(card, q, card.dueAt);
            expect(card.interval).toBeGreaterThanOrEqual(previous);
            previous = card.interval;
          }
        },
      ),
    );
  });

  it("P4: dueAt is exactly `interval` days after today", () => {
    fc.assert(
      fc.property(validCard, quality, isoDate, (card, q, today) => {
        const next = nextReview(card, q, today);
        expect(daysBetween(today, next.dueAt)).toBe(next.interval);
      }),
    );
  });

  it("P4a: interval is at most 365 and ease has at most 2 decimals", () => {
    fc.assert(
      fc.property(validCard, quality, isoDate, (card, q, today) => {
        const next = nextReview(card, q, today);
        expect(next.interval).toBeLessThanOrEqual(MAX_INTERVAL_DAYS);
        expect(Math.round(next.ease * 100) / 100).toBe(next.ease);
      }),
    );
  });

  it("P5: the input card is never changed", () => {
    fc.assert(
      fc.property(validCard, quality, isoDate, (card, q, today) => {
        const copy = structuredClone(card);
        nextReview(card, q, today);
        expect(card).toEqual(copy);
      }),
    );
  });

  it("P6: a quality outside 0..5 or not an integer throws RangeError", () => {
    const badQuality = fc.oneof(
      fc.integer({ min: -1000, max: -1 }),
      fc.integer({ min: 6, max: 1000 }),
      fc.double({ noNaN: false }).filter((x) => !Number.isInteger(x)),
    );
    fc.assert(
      fc.property(validCard, badQuality, isoDate, (card, q, today) => {
        expect(() => nextReview(card, q, today)).toThrow(RangeError);
      }),
    );
  });
});
