/**
 * Runs Python code submitted from a puzzle's Submit button and reports the real
 * stdout / traceback.
 *
 * The compiler runs inside a dedicated Web Worker (python.worker.ts). Pyodide
 * is a ~10 MB download that is then instantiated and unpacked synchronously in
 * JS; on the main thread that stalled the render loop for the length of the
 * check, blacking out the scene until the check finished. Environments without
 * Web Workers — the Node test harness, which uses the same real Pyodide 0.27
 * build — run on the current thread through `window.loadPyodide`.
 */

import { executeWithPyodide, compilerStartError } from "./pyodide-exec.js";
import type { PythonResult } from "./pyodide-exec.js";

export type { PythonResult };

const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.27.0/full";

// ── Web Worker path (browser) ─────────────────────────────────

let worker: Worker | null = null;
let nextRequestId = 1;
const pendingRuns = new Map<number, (result: PythonResult) => void>();

function failAllPending(error: string): void {
  for (const resolve of pendingRuns.values()) {
    resolve({ success: false, output: "", error });
  }
  pendingRuns.clear();
}

function getWorker(): Worker {
  if (worker) return worker;

  const instance = new Worker(new URL("./python.worker.ts", import.meta.url), {
    type: "module",
  });

  instance.onmessage = (
    event: MessageEvent<{ id: number; result: PythonResult }>,
  ) => {
    const resolve = pendingRuns.get(event.data.id);
    if (!resolve) return;
    pendingRuns.delete(event.data.id);
    resolve(event.data.result);
  };

  // A worker that never loaded (script error, blocked by the browser) must not
  // leave the player on "Running…" forever. Drop it so the next Submit retries.
  instance.onerror = () => {
    worker = null;
    failAllPending(
      "Could not start the Python compiler.\nThe Python worker failed to load.",
    );
  };

  worker = instance;
  return instance;
}

function runInWorker(code: string): Promise<PythonResult> {
  return new Promise((resolve) => {
    let instance: Worker;
    try {
      instance = getWorker();
    } catch (err) {
      resolve(compilerStartError(err));
      return;
    }
    const id = nextRequestId++;
    pendingRuns.set(id, resolve);
    instance.postMessage({ id, code });
  });
}

// ── Main-thread path (no Web Worker available) ────────────────

let pyodidePromise: Promise<any> | null = null;

async function getPyodide(): Promise<any> {
  if (pyodidePromise) return pyodidePromise;

  pyodidePromise = (async () => {
    // Inject the Pyodide bootstrap script from CDN if not already present.
    if (!(window as any).loadPyodide) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = `${PYODIDE_CDN}/pyodide.js`;
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error("Could not load the Python compiler (Pyodide)."));
        document.head.appendChild(script);
      });
    }

    return (window as any).loadPyodide();
  })();

  return pyodidePromise;
}

async function runOnMainThread(code: string): Promise<PythonResult> {
  try {
    return executeWithPyodide(await getPyodide(), code);
  } catch (err) {
    return compilerStartError(err);
  }
}

export async function runPython(code: string): Promise<PythonResult> {
  if (typeof window !== "undefined" && typeof Worker !== "undefined") {
    return runInWorker(code);
  }
  return runOnMainThread(code);
}
