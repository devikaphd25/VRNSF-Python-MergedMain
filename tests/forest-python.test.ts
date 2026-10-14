import assert from "node:assert/strict";
import { after, test } from "node:test";
import { loadPyodide } from "pyodide";
import { runForestPython } from "../src/forest/jigsaw/forestPythonRunner.ts";
import { FOREST_PUZZLE_LINES, FOREST_EXPECTED_OUTPUT } from "../src/forest/jigsaw/forestPuzzleData.ts";

// Use the same real CPython/WebAssembly version as the browser's CDN runner.
const originalWindow = globalThis.window;
globalThis.window = { loadPyodide: () => loadPyodide() } as any;
after(() => { globalThis.window = originalWindow; });

const solution = FOREST_PUZZLE_LINES.map(line =>
  "    ".repeat(line.correctIndent) + line.text,
).join("\n");

test("Puzzle 3 executes the assembled solution with the exact expected output", async () => {
  const result = await runForestPython(solution);
  assert.equal(result.success, true, result.error);
  assert.equal(result.output.trim(), FOREST_EXPECTED_OUTPUT);
});

test("Puzzle 3 reports a real indentation error for unindented branches", async () => {
  const result = await runForestPython(FOREST_PUZZLE_LINES.map(line => line.text).join("\n"));
  assert.equal(result.success, false);
  assert.match(result.error, /IndentationError/);
});

test("Puzzle 3 reports a real name error for incorrectly ordered lines", async () => {
  // A previous successful attempt must not supply this attempt's guests value.
  const result = await runForestPython(FOREST_PUZZLE_LINES[6].text + "\n" + solution);
  assert.equal(result.success, false);
  assert.match(result.error, /NameError/);
});

test("Puzzle 3 distinguishes valid Python with incorrect output", async () => {
  const result = await runForestPython(solution.replace("'Cai', ", ""));
  assert.equal(result.success, true, result.error);
  assert.notEqual(result.output.trim(), FOREST_EXPECTED_OUTPUT);
  assert.match(result.output, /Sorry, Cai is not on the list/);
});

test("Repeated attempts reset the mocked input and captured output", async () => {
  const result = await runForestPython(solution);
  assert.equal(result.success, true, result.error);
  assert.equal(result.output.trim(), FOREST_EXPECTED_OUTPUT);
});
