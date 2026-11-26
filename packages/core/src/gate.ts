// Learning gate: decides if the developer may move on after a quiz score.
// Pure function. "strict" blocks below the pass mark, "soft" only warns, "off" never blocks.

export type GateMode = "off" | "soft" | "strict";
export type GateReason = "passed" | "gate-off" | "soft-below" | "strict-below";

export interface GateResult {
  /** May the developer continue? */
  allowed: boolean;
  /** Did the score reach the pass mark? (true or false in every mode) */
  understood: boolean;
  reason: GateReason;
}

export const DEFAULT_PASS_MARK = 0.7;

const MODES: readonly string[] = ["off", "soft", "strict"];

/** Throws RangeError unless the value is a finite number from 0 to 1. */
function checkFraction(value: number, field: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${field} must be a finite number in [0, 1], got ${String(value)}`);
  }
}

export function gateDecision(
  score: number,
  passMark: number = DEFAULT_PASS_MARK,
  mode: GateMode = "strict",
): GateResult {
  checkFraction(score, "score");
  checkFraction(passMark, "passMark");
  if (!MODES.includes(mode)) {
    throw new RangeError(`mode must be "off", "soft" or "strict", got ${String(mode)}`);
  }

  const understood = score >= passMark;
  if (mode === "off") return { allowed: true, understood, reason: "gate-off" };
  if (understood) return { allowed: true, understood: true, reason: "passed" };
  if (mode === "soft") return { allowed: true, understood: false, reason: "soft-below" };
  return { allowed: false, understood: false, reason: "strict-below" };
}
