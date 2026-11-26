// Fixture for the structure map tests: two exported functions and one private helper.
export function add(a: number, b: number): number {
  return a + b;
}

export const square = (x: number) => multiply(x, x);

function multiply(a: number, b: number): number {
  return a * b;
}
