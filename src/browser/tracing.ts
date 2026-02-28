/**
 * Playwright tracing helpers.
 *
 * Tracing records browser interactions (snapshots, screenshots, source) to a
 * ZIP file that can be opened in Playwright Trace Viewer for debugging
 * navigation failures or unexpected page states.
 *
 * These are extracted into their own module so they can be imported by both
 * TailwindPlusDownloader (main context) and Worker (individual page contexts)
 * without duplication.
 */

import path from 'path';
import type { BrowserContext } from 'playwright';

/** Options for starting a trace. */
export interface TracingStartOptions {
    /** Human-readable title shown in Trace Viewer. */
    title: string;
}

/**
 * Starts recording a Playwright trace on the given browser context.
 *
 * @param context   The Playwright BrowserContext to trace.
 * @param label     Short identifier used for the output filename.
 * @param options   Optional tracing options.
 */
export async function startTracing(
  context: BrowserContext,
  label: string,
  options?: TracingStartOptions
): Promise<void> {
  await context.tracing.start({
    snapshots: true,
    screenshots: true,
    sources: true,
    title: options?.title ?? label,
  });
}

/**
 * Stops recording and saves the trace to `<tracesDir>/<label>.zip`.
 *
 * Errors are caught and logged rather than thrown so that a tracing failure
 * never masks the original download error.
 *
 * @param context   The Playwright BrowserContext being traced.
 * @param tracesDir Directory to write the trace ZIP file into.
 * @param label     Short identifier used for the output filename.
 */
export async function stopTracing(
  context: BrowserContext,
  tracesDir: string,
  label: string
): Promise<void> {
  try {
    const traceFile = path.join(tracesDir, `${label}.zip`);
    await context.tracing.stop({ path: traceFile });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[WARN] Failed to save trace for "${label}": ${message}`);
  }
}
