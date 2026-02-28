/**
 * JSON sorting utilities for producing stable, diff-friendly output.
 *
 * When component data is written to JSON, reproducible key and snippet ordering
 * ensures that running the downloader twice produces identical files for the
 * same input, making diffs between runs meaningful.
 */

import type { Snippet } from '../types.js';

// =============================================================================
// Snippet Sorting
// =============================================================================

/**
 * Recursively finds and in-place sorts any array property named "snippets"
 * within the given data structure.
 *
 * Sort order: framework name → Tailwind version (numeric) → mode.
 * This ensures a consistent ordering regardless of download order.
 */
export function sortSnippetsRecursively(data: unknown): void {
  if (typeof data !== 'object' || data === null) return;

  const obj = data as Record<string, unknown>;

  if (Array.isArray(obj['snippets'])) {
    (obj['snippets'] as Snippet[]).sort((a, b) => {
      // 1. Sort by framework name
      const nameCompare = String(a.name ?? '').localeCompare(String(b.name ?? ''));
      if (nameCompare !== 0) return nameCompare;

      // 2. Sort by Tailwind version (numeric)
      const aVersion = a.version ?? -Infinity;
      const bVersion = b.version ?? -Infinity;
      if (aVersion !== bVersion) return aVersion - bVersion;

      // 3. Sort by mode
      return String(a.mode ?? '').localeCompare(String(b.mode ?? ''));
    });
  }

  // Recurse into every value regardless (handles nested product/category/subcategory)
  for (const value of Object.values(obj)) {
    sortSnippetsRecursively(value);
  }
}

// =============================================================================
// Key Sorting
// =============================================================================

/**
 * JSON.stringify replacer that sorts object keys alphabetically.
 *
 * Produces deterministic key order in the output JSON independent of insertion
 * order, making the file easier to diff and review.
 *
 * Note: Using a replacer disables V8's fast-path JSON serialisation.
 * See: https://v8.dev/blog/json-stringify#limitations
 */
export function sortedObjectKeys(key: string, value: unknown): unknown {
  if (value instanceof Object && !(value instanceof Array)) {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map(k => [k, (value as Record<string, unknown>)[k]])
    );
  }
  return value;
}
