// SM-2 spaced repetition: decides when a missed concept comes back for review.
// Pure functions only. The caller passes "today" in, so nothing here reads the clock.

/** How well you remembered: 0 = blackout ... 5 = perfect. */
export type Quality = 0 | 1 | 2 | 3 | 4 | 5;

/** One concept's review state. `dueAt` is a calendar date written YYYY-MM-DD. */
export interface Card {
  ease: number;
  interval: number;
  repetitions: number;
  dueAt: string;
}

/** Longest wait between two reviews, so every card returns at least once a year. */
export const MAX_INTERVAL_DAYS = 365;

const MIN_EASE = 1.3;
const MS_PER_DAY = 86_400_000;

/** Reads "YYYY-MM-DD" into a UTC timestamp. Throws RangeError for fake dates like 2026-02-30. */
function parseIsoDate(value: string, field: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError(`${field} must be an ISO date (YYYY-MM-DD), got ${String(value)}`);
  }
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const time = Date.UTC(year, month - 1, day);
  // Round trip: a date like 2026-02-30 rolls over to March, so it will not match.
  if (new Date(time).toISOString().slice(0, 10) !== value) {
    throw new RangeError(`${field} must be a real calendar date, got ${value}`);
  }
  return time;
}

/** Adds whole days to an ISO date. UTC avoids daylight-saving bugs. Years above 9999 are out of range (unreachable in practice). */
function addDays(isoDate: string, days: number): string {
  const time = parseIsoDate(isoDate, "date") + days * MS_PER_DAY;
  return new Date(time).toISOString().slice(0, 10);
}

/** A brand-new card: default ease, no history, due today. */
export function newCard(today: string): Card {
  parseIsoDate(today, "today");
  return { ease: 2.5, interval: 0, repetitions: 0, dueAt: today };
}

/** Rounds to 2 decimals so saved files show 2.38 and not 2.3800000000000003. */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function isNonNegativeInteger(x: unknown): boolean {
  return typeof x === "number" && Number.isInteger(x) && x >= 0;
}

/** Throws RangeError when any card field is out of range. */
function validateCard(card: Card): void {
  if (typeof card.ease !== "number" || !Number.isFinite(card.ease) || card.ease < MIN_EASE) {
    throw new RangeError(`ease must be a finite number >= ${MIN_EASE}, got ${String(card.ease)}`);
  }
  if (!isNonNegativeInteger(card.interval)) {
    throw new RangeError(`interval must be a non-negative integer, got ${String(card.interval)}`);
  }
  if (!isNonNegativeInteger(card.repetitions)) {
    throw new RangeError(
      `repetitions must be a non-negative integer, got ${String(card.repetitions)}`,
    );
  }
  parseIsoDate(card.dueAt, "card.dueAt");
}

/**
 * Returns the card after one review. The input card is never changed.
 * `quality` is typed `number` on purpose so bad values from untyped callers are caught.
 */
export function nextReview(card: Card, quality: number, today: string): Card {
  if (!Number.isInteger(quality) || quality < 0 || quality > 5) {
    throw new RangeError(`quality must be an integer 0..5, got ${String(quality)}`);
  }
  validateCard(card);
  parseIsoDate(today, "today");

  // How far from a perfect answer (0 for q = 5, 5 for q = 0).
  const d = 5 - quality;
  // SM-2 ease formula; ease never drops below 1.3.
  const ease = round2(Math.max(MIN_EASE, card.ease + 0.1 - d * (0.08 + d * 0.02)));

  let repetitions: number;
  let interval: number;
  if (quality < 3) {
    // Failed: start the learning steps over and see the card again tomorrow.
    repetitions = 0;
    interval = 1;
  } else {
    repetitions = card.repetitions + 1;
    if (repetitions === 1) {
      interval = 1; // first success: tomorrow
    } else if (repetitions === 2) {
      interval = 6; // second success: in 6 days
    } else {
      // Later successes: grow by the OLD ease (the rating judges the last interval).
      // At least 1 day, so a card with interval 0 is never due again on the same day.
      interval = Math.max(1, Math.min(MAX_INTERVAL_DAYS, Math.round(card.interval * card.ease)));
    }
  }

  return { ease, interval, repetitions, dueAt: addDays(today, interval) };
}
