// Fixture for the structure map tests: imports, a class with an async method, and an async function.
import { add } from "./math";
import { log } from "./logger";

export class UserService {
  db: any;

  async findUser(id: string) {
    log(id);
    return this.db.get(id);
  }

  countAll(a: number, b: number) {
    return add(a, b);
  }
}

export async function loadUser(id: string) {
  const s = new UserService();
  return s.findUser(id);
}
