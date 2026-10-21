/**
 * Execution logic for submitted Python code, shared by the two places that
 * can run it:
 *
 * - `python.worker.ts` — the browser Web Worker that owns the Pyodide
 *   (CPython/WebAssembly) instance, so compiling and running a submission
 *   never blocks the render loop.
 * - `pythonRunner.ts` — the main-thread path, used where no Web Worker exists
 *   (the Node test harness that runs the real Pyodide 0.27 build).
 *
 * Everything here works on an already-initialised Pyodide instance and returns
 * real Python stdout and error messages, so feedback shows exactly what Python
 * would report.
 */

export interface PythonResult {
  success: boolean;
  output: string;
  error: string;
}

/** First line of a real Python traceback, where the useful message starts. */
const PYTHON_ERROR_LINE =
  /^\s*(NameError|SyntaxError|IndentationError|TypeError|ValueError|ZeroDivisionError|IndexError|KeyError|AttributeError|RuntimeError|UnboundLocalError):/;

export function executeWithPyodide(pyodide: any, code: string): PythonResult {
  // Redirect stdout/stderr into string buffers so we can capture output.
  pyodide.runPython(`
      import sys, io
      sys.stdout = io.StringIO()
      sys.stderr = io.StringIO()
    `);

  // Each attempt is a new program. Variables from a previous correct attempt
  // must not make incorrectly ordered code appear to work on the next one.
  const globals = pyodide.toPy({});
  try {
    pyodide.runPython(code, { globals });
    const output = String(pyodide.runPython("sys.stdout.getvalue()"));
    return { success: true, output, error: "" };
  } catch (err: any) {
    // Grab any partial stdout that was produced before the error.
    let partial = "";
    try {
      partial = String(pyodide.runPython("sys.stdout.getvalue()"));
    } catch {
      /* ignore */
    }

    // Pyodide wraps Python tracebacks in its own JS error.  Extract just
    // the Python-relevant portion (from the error type line onward).
    let errorMsg: string = err?.message ?? "";
    // With stderr redirected, Pyodide can leave PythonError.message empty
    // and write the actual traceback into our buffer instead.
    if (!errorMsg.trim()) {
      errorMsg = String(pyodide.runPython("sys.stderr.getvalue()")) || String(err);
    }
    const lines = errorMsg.split("\n");
    const errorLine = lines.findIndex((l: string) => PYTHON_ERROR_LINE.test(l));
    if (errorLine >= 0) {
      errorMsg = lines.slice(errorLine).join("\n").trim();
    }

    return { success: false, output: partial, error: errorMsg };
  } finally {
    globals.destroy();
  }
}

/** Message shown when the compiler itself could not be started. */
export function compilerStartError(err: unknown): PythonResult {
  return {
    success: false,
    output: "",
    error:
      "Could not start the Python compiler.\n" +
      ((err as any)?.message ?? String(err)),
  };
}
