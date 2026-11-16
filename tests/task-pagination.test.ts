import { test } from "node:test";
import assert from "node:assert/strict";
import { lastPageOffset } from "../src/instructor/task-pagination.ts";

test("task pages advance without repeating rows on the last page", () => {
  for (const [count, expected] of [[0, 0], [6, 0], [7, 6], [11, 6], [12, 6], [13, 12]]) {
    assert.equal(lastPageOffset(count, 6), expected);
  }
  let offset = 0;
  const seen: number[] = [];
  const count = 11;
  do {
    seen.push(...Array.from({ length: Math.min(6, count - offset) }, (_, i) => offset + i));
    if (offset === lastPageOffset(count, 6)) break;
    offset = Math.min(lastPageOffset(count, 6), offset + 6);
  } while (true);
  assert.deepEqual(seen, Array.from({ length: count }, (_, i) => i));
  assert.equal(Math.max(0, offset - 6), 0);
});

test("student pages also preserve page boundaries", () => {
  assert.equal(lastPageOffset(11, 10), 10);
  assert.equal(lastPageOffset(20, 10), 10);
});
