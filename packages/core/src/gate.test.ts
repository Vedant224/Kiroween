// Tests for gate.ts: example cases from the spec plus fast-check properties.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_PASS_MARK, gateDecision, type GateMode } from "./gate.js";

describe("gateDecision examples", () => {
  it("soft mode below the pass mark lets you continue but is not understood", () => {
    expect(gateDecision(0.6, 0.7, "soft")).toEqual({
      allowed: true,
      understood: false,
      reason: "soft-below",
    });
  });

  it("strict mode below the pass mark blocks", () => {
    expect(gateDecision(0.6, 0.7, "strict")).toEqual({
      allowed: false,
      understood: false,
      reason: "strict-below",
    });
  });

  it("passes exactly at the pass mark (defaults)", () => {
    expect(gateDecision(0.7)).toEqual({ allowed: true, understood: true, reason: "passed" });
  });

  it("defaults to strict mode", () => {
    expect(gateDecision(0.6)).toEqual({
      allowed: false,
      understood: false,
      reason: "strict-below",
    });
    expect(DEFAULT_PASS_MARK).toBe(0.7);
  });

  it("off mode always allows and reports gate-off", () => {
    expect(gateDecision(0.1, 0.7, "off")).toEqual({
      allowed: true,
      understood: false,
      reason: "gate-off",
    });
    expect(gateDecision(0.9, 0.7, "off").understood).toBe(true);
  });

  it("rejects an unknown mode", () => {
    expect(() => gateDecision(0.5, 0.7, "hard" as GateMode)).toThrow(RangeError);
  });
});

// ---- Properties (fast-check) ----

const fraction = fc.double({ min: 0, max: 1, noNaN: true });
const mode = fc.constantFrom<GateMode>("off", "soft", "strict");

// A (score, passMark) pair. Half the time both are equal, so the boundary score === passMark is tested often.
const scoreAndMark = fc.oneof(
  fc.tuple(fraction, fraction),
  fraction.map((x): [number, number] => [x, x]),
);

describe("gateDecision properties", () => {
  it("P10: strict mode allows exactly when score >= passMark", () => {
    fc.assert(
      fc.property(scoreAndMark, ([score, passMark]) => {
        expect(gateDecision(score, passMark, "strict").allowed).toBe(score >= passMark);
      }),
    );
  });

  it("P10a: soft mode always allows", () => {
    fc.assert(
      fc.property(scoreAndMark, ([score, passMark]) => {
        expect(gateDecision(score, passMark, "soft").allowed).toBe(true);
      }),
    );
  });

  it("P10b: reason matches the mode and whether the score reached the pass mark", () => {
    fc.assert(
      fc.property(scoreAndMark, mode, ([score, passMark], m) => {
        const passed = score >= passMark;
        const expected = m === "off" ? "gate-off" : passed ? "passed" : m === "soft" ? "soft-below" : "strict-below";
        expect(gateDecision(score, passMark, m).reason).toBe(expected);
      }),
    );
  });

  it("P11: off mode always allows", () => {
    fc.assert(
      fc.property(fraction, fraction, (score, passMark) => {
        expect(gateDecision(score, passMark, "off").allowed).toBe(true);
      }),
    );
  });

  it("P12: understood is score >= passMark in every mode", () => {
    fc.assert(
      fc.property(scoreAndMark, mode, ([score, passMark], m) => {
        expect(gateDecision(score, passMark, m).understood).toBe(score >= passMark);
      }),
    );
  });

  it("P13: a score or passMark outside [0, 1] (or NaN) throws RangeError", () => {
    const bad = fc.oneof(
      fc.double({ min: 1.0000001, max: 1e9, noNaN: true }),
      fc.double({ min: -1e9, max: -0.0000001, noNaN: true }),
      fc.constant(Number.NaN),
      fc.constant(Number.POSITIVE_INFINITY),
      fc.constant(Number.NEGATIVE_INFINITY),
    );
    fc.assert(
      fc.property(bad, fraction, mode, (badValue, good, m) => {
        expect(() => gateDecision(badValue, good, m)).toThrow(RangeError);
        expect(() => gateDecision(good, badValue, m)).toThrow(RangeError);
      }),
    );
  });
});
