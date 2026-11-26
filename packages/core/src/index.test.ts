import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { AUTO_END, AUTO_START, hasAutoSection } from "./index.js";

describe("hasAutoSection", () => {
  it("finds a section when start comes before end", () => {
    expect(hasAutoSection(`intro\n${AUTO_START}\nauto\n${AUTO_END}\noutro`)).toBe(true);
  });

  it("rejects text with the markers in the wrong order", () => {
    expect(hasAutoSection(`${AUTO_END}\n${AUTO_START}`)).toBe(false);
  });

  // Smoke test that fast-check is wired up; real properties start in Task 2.
  it("is true for any text wrapped in the markers", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.string(), (before, inside, after) => {
        expect(hasAutoSection(before + AUTO_START + inside + AUTO_END + after)).toBe(true);
      }),
    );
  });
});
