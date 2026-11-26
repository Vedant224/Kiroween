// Fixture for the structure map tests: a re-export, a namespace import and a default export.
export { loadUser } from "./user-service";
import * as math from "./math";

export default function main() {
  return math.add(1, 2);
}
