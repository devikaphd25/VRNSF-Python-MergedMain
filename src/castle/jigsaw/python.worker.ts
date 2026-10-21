/**
 * Runs submitted Python code off the main thread.
 *
 * Pyodide (CPython on WebAssembly) is a ~10 MB download that is then
 * instantiated and unpacked synchronously in JS. Doing that on the main thread
 * stalled the render loop for the whole length of the check, which blacked out
 * the scene until the check finished. Inside this worker the download,
 * instantiation and execution leave the scene fully responsive, and the
 * feedback panel simply changes from "Running…" to the result.
 *
 * The worker keeps one Pyodide instance alive for every submission. It is
 * loaded from the same CDN build the app used before (see pythonRunner.ts).
 */

import { executeWithPyodide, compilerStartError } from "./pyodide-exec.js";

const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.27.0/full";

let pyodidePromise: Promise<any> | null = null;

function getPyodide(): Promise<any> {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      const mod: any = await import(/* @vite-ignore */ `${PYODIDE_CDN}/pyodide.mjs`);
      return mod.loadPyodide({ indexURL: PYODIDE_CDN });
    })();
  }
  return pyodidePromise;
}

interface RunRequest {
  id: number;
  code: string;
}

// Submissions run one at a time: a second Submit cannot interleave with a
// running program's stdout/stdin state.
let queue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<RunRequest>) => {
  const { id, code } = event.data;
  queue = queue.then(async () => {
    let result;
    try {
      result = executeWithPyodide(await getPyodide(), code);
    } catch (err) {
      result = compilerStartError(err);
    }
    self.postMessage({ id, result });
  });
};
