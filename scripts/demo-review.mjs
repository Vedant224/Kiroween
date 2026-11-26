// Demo: runs the SM-2 review engine on a 4-step story (5, 5, 2, 4) and prints each step.
// Run with `npm run demo:review` (it builds @seance/core first).
import { newCard, nextReview } from "../packages/core/dist/index.js";

const ratings = [5, 5, 2, 4];
let card = newCard("2026-11-27");

console.log(`start: ease ${card.ease.toFixed(2)}, due ${card.dueAt}`);
for (const [i, rating] of ratings.entries()) {
  // Each review happens on the day the previous one was due.
  card = nextReview(card, rating, card.dueAt);
  console.log(
    `step ${i + 1}: rating ${rating} -> ease ${card.ease.toFixed(2)}, interval ${card.interval}, due ${card.dueAt}`,
  );
}
