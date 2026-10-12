/**
 * Runs Python code with a mocked `input()` for the forest jigsaw puzzle.
 * Reuses the Pyodide instance from the castle python runner and prepends
 * an input mock that returns "Cai" (a name on the guest list) so the
 * assembled code produces the expected sample-run output.
 */
import { runPython, type PythonResult } from "../../castle/jigsaw/pythonRunner.js";

const INPUT_MOCK = `import builtins
_inputs = ['Cai']
_idx = [0]
def _mock_input(prompt=''):
    print(prompt, end='')
    val = _inputs[_idx[0]] if _idx[0] < len(_inputs) else ''
    _idx[0] += 1
    print(val)
    return val
builtins.input = _mock_input
`;

export async function runForestPython(code: string): Promise<PythonResult> {
  return runPython(INPUT_MOCK + "\n" + code);
}
