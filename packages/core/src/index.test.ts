import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { AUTO_END, AUTO_START, MAP_LIMITS, buildStructureMap, generateStructuralQuestions, hasAutoSection } from "./index.js";

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

describe("public exports", () => {
  it("exposes the structure map and question generator", () => {
    expect(MAP_LIMITS.maxFiles).toBe(50);
    const map = buildStructureMap([{ path: "a.ts", content: "export function f(a) {}" }]);
    expect(map.files).toHaveLength(1);
    expect(generateStructuralQuestions(map).map((q) => q.id)).toEqual(["param-count:f"]);
  });
});
