// Public entry point for @seance/core.
// Real modules (sm2, gate, scoring, structure map, ...) are added from Task 2 onward.

/** Markers that delimit the auto-generated sections of PROJECT.md. */
export const AUTO_START = "<!-- seance:auto:start -->";
export const AUTO_END = "<!-- seance:auto:end -->";

/** Returns true when the text contains a well-formed auto section (start before end). */
export function hasAutoSection(text: string): boolean {
  const start = text.indexOf(AUTO_START);
  if (start === -1) return false;
  return text.indexOf(AUTO_END, start + AUTO_START.length) !== -1;
}
