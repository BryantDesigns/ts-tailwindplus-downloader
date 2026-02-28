/**
 * Output module — processes collected component data and writes it to disk.
 *
 * Supports two output formats:
 *  - `json`: Single file with all components and metadata
 *  - `dir`:  Directory tree with one file per component snippet
 *
 * Separated from the orchestrator so output concerns don't mix with
 * download orchestration logic.
 */

import fs from 'fs';
import path from 'path';

import type { ComponentData, ComponentEntry, DownloadMetadata, Snippet } from '../types.js';
import { sortSnippetsRecursively, sortedObjectKeys } from '../utils/json-sorting.js';
import type { Logger } from '../logger.js';

// =============================================================================
// Component Data Helpers
// =============================================================================

/**
 * Deeply merges `source` component data into `target` in-place.
 *
 * Traverses the product → category → subcategory → component hierarchy.
 * When a component with snippets is found, its snippets array is concatenated
 * rather than replaced, accumulating results across multiple format downloads.
 */
export function mergeComponentData(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(source)) {
    if (!value || typeof value !== 'object') continue;

    const obj = value as Record<string, unknown>;

    if (Array.isArray(obj['snippets'])) {
      // This is a component entry — merge its snippets
      const targetEntry = target[key] as ComponentEntry | undefined;
      if (!targetEntry) {
        target[key] = { name: obj['name'], snippets: [...(obj['snippets'] as Snippet[])] };
      } else {
        targetEntry.snippets = targetEntry.snippets.concat(obj['snippets'] as Snippet[]);
      }
    } else {
      // This is a container (product/category/subcategory) — recurse
      if (!target[key] || typeof target[key] !== 'object') {
        target[key] = {};
      }
      mergeComponentData(target[key] as Record<string, unknown>, obj);
    }
  }
}

/**
 * Recursively counts individual component entries (objects with a `snippets` array)
 * within the full component data tree.
 */
export function countComponents(data: Record<string, unknown>): number {
  let count = 0;
  for (const value of Object.values(data)) {
    if (!value || typeof value !== 'object') continue;
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj['snippets'])) {
      count++;
    } else {
      count += countComponents(obj);
    }
  }
  return count;
}

/**
 * Removes duplicate component snippets for eCommerce components (which lack a
 * `mode` field). Duplicates can arise when the same snippet is captured under
 * different format passes.
 */
export function deduplicateEcommerceSnippets(data: ComponentData): ComponentData {
  const cloned = structuredClone(data) as Record<string, unknown>;

  function deduplicate(obj: Record<string, unknown>): void {
    const snippets = obj['snippets'];
    if (Array.isArray(snippets)) {
      const seen = new Map<string, Snippet>();
      for (const snippet of snippets as Snippet[]) {
        const key = `${snippet.name}|${snippet.version}|${snippet.supportsDarkMode}`;
        if (!seen.has(key)) {
          seen.set(key, snippet);
        }
      }
      obj['snippets'] = Array.from(seen.values());
    } else {
      for (const value of Object.values(obj)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          deduplicate(value as Record<string, unknown>);
        }
      }
    }
  }

  deduplicate(cloned);
  return cloned as ComponentData;
}

// =============================================================================
// Output Writers
// =============================================================================

/**
 * Writes all component data and metadata to a single JSON file.
 */
export function writeJsonOutput(
  outputFile: string,
  componentData: ComponentData,
  metadata: DownloadMetadata,
  logger: Logger
): void {
  logger.debug(`Writing JSON output to ${outputFile}`);

  sortSnippetsRecursively(componentData);

  const output = {
    ...metadata,
    tailwindplus: componentData,
  };

  // Note: using a replacer disables V8's fast-path JSON serialisation.
  // See: https://v8.dev/blog/json-stringify#limitations
  fs.writeFileSync(outputFile, JSON.stringify(output, sortedObjectKeys, 2));
  logger.info(`Saved ${metadata.component_count} components to ${outputFile}`);
}

/**
 * Writes each component snippet as an individual file in a directory tree.
 *
 * Tree structure: `<outputDir>/<product>/<category>/<subcategory>/<component>/<vX>/<framework>[-<mode>].<ext>`
 */
export function writeDirectoryOutput(
  outputDir: string,
  componentData: ComponentData,
  metadata: DownloadMetadata,
  logger: Logger
): void {
  logger.debug(`Writing directory output to ${outputDir}`);

  fs.mkdirSync(outputDir, { recursive: true });
  writeComponentFiles(outputDir, componentData as unknown as Record<string, unknown>, []);
  fs.writeFileSync(
    path.join(outputDir, 'metadata.json'),
    JSON.stringify(metadata, sortedObjectKeys, 2)
  );

  logger.info(`Saved ${metadata.component_count} components to directory ${outputDir}`);
}

function writeComponentFiles(
  outputDir: string,
  data: Record<string, unknown>,
  pathParts: string[]
): void {
  for (const [key, value] of Object.entries(data)) {
    if (!value || typeof value !== 'object') continue;

    const obj = value as Record<string, unknown>;

    if (Array.isArray(obj['snippets'])) {
      for (const snippet of obj['snippets'] as Snippet[]) {
        let ext: string;
        switch (snippet.name) {
        case 'react': ext = 'jsx'; break;
        case 'vue': ext = 'vue'; break;
        default: ext = 'html';
        }

        const modePart = snippet.mode ? `-${snippet.mode}` : '';
        const filename = `${snippet.name}${modePart}.${ext}`;
        const versionDir = `v${snippet.version}`;
        const snippetDir = path.join(outputDir, ...pathParts, key, versionDir);

        fs.mkdirSync(snippetDir, { recursive: true });
        fs.writeFileSync(path.join(snippetDir, filename), snippet.code);
      }
    } else {
      writeComponentFiles(outputDir, obj, [...pathParts, key]);
    }
  }
}
