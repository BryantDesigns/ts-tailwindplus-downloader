#!/usr/bin/env node
/**
 * TailwindPlus Component Diff Tool
 *
 * Compares TailwindPlus component files between downloads, supporting
 * version-specific comparisons (v3 vs v4) and framework-specific diffs.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { hideBin } from 'yargs/helpers';
import yargs from 'yargs';

// =============================================================================
// Types
// =============================================================================

interface DiffOptions {
    oldFile?: string;
    newFile?: string;
    version?: string;
    fromVersion?: string;
    toVersion?: string;
    framework?: string;
    verbose?: boolean;
    namesOnly?: boolean;
}

interface Snippet {
    version: number;
    name: string;
    mode: string | null;
    code: string;
}

interface ComponentEntry {
    snippets: Snippet[];
}

type ComponentData = Record<string, Record<string, Record<string, Record<string, ComponentEntry>>>>;

interface Comparison {
    oldVersion: number;
    newVersion: number;
    label: string;
}

interface CompareState {
    diffs: number;
    hasDifferences: boolean;
    headerPrinted: boolean;
    componentHeader: string;
}

// =============================================================================
// Constants
// =============================================================================

const DIFF_DIR = 'diffs';

// =============================================================================
// Argument Parsing
// =============================================================================

function parseArgs(): DiffOptions {
  const argv = yargs(hideBin(process.argv))
    .version(false)
    .strict()
    .option('old-file', {
      type: 'string',
      requiresArg: true,
      describe: 'Old component file (auto-detected if not specified)',
    })
    .option('new-file', {
      type: 'string',
      requiresArg: true,
      describe: 'New component file (auto-detected if not specified)',
    })
    .option('tw', {
      type: 'string',
      choices: ['3', '4'] as const,
      requiresArg: true,
      describe: 'Compare only this version between old and new files',
    })
    .option('tw-from', {
      type: 'string',
      choices: ['3', '4'] as const,
      requiresArg: true,
      describe: 'Source version (requires --tw-to)',
    })
    .option('tw-to', {
      type: 'string',
      choices: ['3', '4'] as const,
      requiresArg: true,
      describe: 'Target version (requires --tw-from)',
    })
    .option('framework', {
      type: 'string',
      choices: ['html', 'react', 'vue'] as const,
      requiresArg: true,
      describe: 'Only diff this framework (default: all)',
    })
    .option('verbose', {
      type: 'boolean',
      describe: 'Show "No changes" messages for matching components',
    })
    .option('names-only', {
      type: 'boolean',
      describe: 'Only compare component names (no content comparison)',
    })
    .check(argv => {
      const hasVersion = argv['tw'] !== undefined;
      const hasFromTo = argv['tw-from'] !== undefined || argv['tw-to'] !== undefined;
      if (hasVersion && hasFromTo) throw new Error('--tw cannot be used with --tw-from/--tw-to');
      if ((argv['tw-from'] !== undefined) !== (argv['tw-to'] !== undefined)) {
        throw new Error('Both --tw-from and --tw-to must be specified together');
      }
      return true;
    })
    .usage('Usage: $0 [options]')
    .example('$0 --tw=4', 'Compare v4 components between two most recent downloads')
    .example('$0 --tw-from=3 --tw-to=4', 'Compare v3 to v4 for upgrade planning')
    .example('$0 --old-file=old.json --new-file=new.json --tw=4', 'Compare specific files')
    .help('help')
    .alias('help', 'h')
    .wrap(yargs().terminalWidth())
    .parseSync();

  return {
    oldFile: argv['old-file'] as string | undefined,
    newFile: argv['new-file'] as string | undefined,
    version: argv['tw'] as string | undefined,
    fromVersion: argv['tw-from'] as string | undefined,
    toVersion: argv['tw-to'] as string | undefined,
    framework: argv['framework'] as string | undefined,
    verbose: argv['verbose'] as boolean | undefined,
    namesOnly: argv['names-only'] as boolean | undefined,
  };
}

// =============================================================================
// File Discovery & Loading
// =============================================================================

function discoverFiles(options: DiffOptions): void {
  if (options.oldFile && options.newFile) return;

  const files = fs.readdirSync('.')
    .filter(f => f.startsWith('tailwindplus-components-') && f.endsWith('.json'))
    .sort();

  if (files.length < 2) {
    console.error('Error: Need at least 2 component files for comparison');
    console.error('Available files:', files);
    process.exit(1);
  }

  if (!options.oldFile) options.oldFile = files[files.length - 2];
  if (!options.newFile) options.newFile = files[files.length - 1];

  console.log('Auto-discovered files:');
  console.log(`  Old: ${options.oldFile}`);
  console.log(`  New: ${options.newFile}`);
}

function loadFiles(options: Required<Pick<DiffOptions, 'oldFile' | 'newFile'>>): {
    oldData: Record<string, unknown>;
    newData: Record<string, unknown>;
    oldComponents: ComponentData;
    newComponents: ComponentData;
} {
  const oldData = JSON.parse(fs.readFileSync(options.oldFile, 'utf-8')) as Record<string, unknown>;
  const newData = JSON.parse(fs.readFileSync(options.newFile, 'utf-8')) as Record<string, unknown>;

  const oldComponents = (oldData['tailwindplus'] ?? oldData) as ComponentData;
  const newComponents = (newData['tailwindplus'] ?? newData) as ComponentData;

  return { oldData, newData, oldComponents, newComponents };
}

// =============================================================================
// Diff Utilities
// =============================================================================

function ensureDiffDir(): void {
  if (!fs.existsSync(DIFF_DIR)) {
    fs.mkdirSync(DIFF_DIR, { recursive: true });
  }
}

const EXTENSIONS: Record<string, string> = {
  html: 'html',
  react: 'jsx',
  vue: 'vue',
};

function writeTempFile(content: string, suffix: string, framework: string, safeName: string): string {
  const ext = EXTENSIONS[framework] ?? 'html';
  const tempFile = path.join(DIFF_DIR, `${safeName}_${suffix}.${ext}`);
  fs.writeFileSync(tempFile, content);
  return tempFile;
}

function generateDiff(
  oldContent: string,
  newContent: string,
  outputFile: string,
  framework: string,
  safeName: string
): Promise<void> {
  const oldFile = writeTempFile(oldContent, 'old', framework, safeName);
  const newFile = writeTempFile(newContent, 'new', framework, safeName);

  return new Promise(resolve => {
    const gitProcess = spawn('git', ['diff', '--no-index', '--word-diff=color', oldFile, newFile], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    gitProcess.stdout.on('data', (d: Buffer) => { output += d.toString(); });

    gitProcess.on('close', (code: number | null) => {
      if ((code === 0 || code === 1) && output.trim()) {
        fs.writeFileSync(outputFile, output);
        console.log(`        Diff saved: ${outputFile}`);
        cleanup();
        resolve();
        return;
      }

      // Fall back to regular diff
      const diffProcess = spawn('diff', ['-u', oldFile, newFile], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let diffOutput = '';
      diffProcess.stdout.on('data', (d: Buffer) => { diffOutput += d.toString(); });

      diffProcess.on('close', (diffCode: number | null) => {
        if (diffCode === 1 && diffOutput.trim()) {
          fs.writeFileSync(outputFile, diffOutput);
          console.log(`        Diff saved: ${outputFile}`);
        } else if (diffCode === 0) {
          console.log('        No differences found');
        } else {
          console.log('        Error generating diff');
        }
        cleanup();
        resolve();
      });
    });

    function cleanup() {
      try { fs.unlinkSync(oldFile); } catch { /* ignore */ }
      try { fs.unlinkSync(newFile); } catch { /* ignore */ }
    }
  });
}

// =============================================================================
// Component Traversal
// =============================================================================

function findSnippetCode(
  component: ComponentEntry,
  version: number,
  framework: string,
  mode: string | null = null
): string | null {
  const snippet = component.snippets?.find(
    s => s.version === version && s.name === framework && s.mode === mode
  );
  return snippet?.code ?? null;
}

function getComponentPaths(components: ComponentData): string[] {
  const paths: string[] = [];
  for (const [cat, catData] of Object.entries(components)) {
    for (const [sub, subData] of Object.entries(catData)) {
      for (const [group, groupData] of Object.entries(subData)) {
        for (const [comp, compData] of Object.entries(groupData)) {
          if (compData?.snippets) {
            paths.push(`${cat} > ${sub} > ${group} > ${comp}`);
          }
        }
      }
    }
  }
  return paths.sort();
}

function collectModes(components: ComponentData): (string | null)[] {
  const modes = new Set<string | null>();

  function scan(obj: Record<string, unknown>): void {
    for (const value of Object.values(obj)) {
      if (!value || typeof value !== 'object') continue;
      const entry = value as Record<string, unknown>;
      if (Array.isArray(entry['snippets'])) {
        (entry['snippets'] as Snippet[]).forEach(s => modes.add(s.mode));
      } else {
        scan(entry);
      }
    }
  }

  scan(components as unknown as Record<string, unknown>);

  return Array.from(modes).sort((a, b) => {
    if (a === null) return -1;
    if (b === null) return 1;
    return String(a).localeCompare(String(b));
  });
}

// =============================================================================
// Version Handling
// =============================================================================

function collectVersions(components: ComponentData): number[] {
  const versions = new Set<number>();

  function scan(obj: Record<string, unknown>): void {
    for (const value of Object.values(obj)) {
      if (!value || typeof value !== 'object') continue;
      const entry = value as Record<string, unknown>;
      if (Array.isArray(entry['snippets'])) {
        (entry['snippets'] as Snippet[]).forEach(s => { if (s.version) versions.add(s.version); });
      } else {
        scan(entry);
      }
    }
  }

  scan(components as unknown as Record<string, unknown>);
  return Array.from(versions).sort((a, b) => a - b);
}

function getComparisons(options: DiffOptions, old: ComponentData, newC: ComponentData): Comparison[] {
  if (options.fromVersion && options.toVersion) {
    return [{
      oldVersion: parseInt(options.fromVersion, 10),
      newVersion: parseInt(options.toVersion, 10),
      label: `v${options.fromVersion} -> v${options.toVersion}`,
    }];
  }

  if (options.version) {
    const v = parseInt(options.version, 10);
    return [{ oldVersion: v, newVersion: v, label: `v${options.version}` }];
  }

  const allVersions = new Set([...collectVersions(old), ...collectVersions(newC)]);
  const sorted = Array.from(allVersions).sort((a, b) => a - b);
  console.log(`Auto-detected versions: ${sorted.map(v => `v${v}`).join(', ')}`);
  return sorted.map(v => ({ oldVersion: v, newVersion: v, label: `v${v}` }));
}

// =============================================================================
// Names-only Comparison
// =============================================================================

function compareComponentNames(old: ComponentData, newC: ComponentData, options: DiffOptions): void {
  const oldPaths = getComponentPaths(old);
  const newPaths = getComponentPaths(newC);
  const oldSet = new Set(oldPaths);
  const newSet = new Set(newPaths);

  console.log(`Comparing component names:`);
  console.log(`  Old: ${options.oldFile} (${oldPaths.length} components)`);
  console.log(`  New: ${options.newFile} (${newPaths.length} components)\n`);

  const onlyOld = oldPaths.filter(p => !newSet.has(p));
  const onlyNew = newPaths.filter(p => !oldSet.has(p));

  if (onlyOld.length > 0) { console.log('Only in old:\n' + onlyOld.join('\n') + '\n'); }
  if (onlyNew.length > 0) { console.log('Only in new:\n' + onlyNew.join('\n') + '\n'); }
  if (onlyOld.length === 0 && onlyNew.length === 0) {
    console.log('Component names are identical between files.');
  } else {
    console.log(`Summary: ${onlyOld.length} only in old, ${onlyNew.length} only in new`);
  }
}

// =============================================================================
// Content Comparison
// =============================================================================

function ensureHeaderPrinted(header: string, printed: boolean): boolean {
  if (!printed) console.log(header);
  return true;
}

async function compareSnippetCombination(
  oldComp: ComponentEntry,
  newComp: ComponentEntry,
  comparison: Comparison,
  framework: string,
  mode: string | null,
  componentPath: string,
  options: DiffOptions,
  state: CompareState
): Promise<CompareState> {
  const oldCode = findSnippetCode(oldComp, comparison.oldVersion, framework, mode);
  const newCode = findSnippetCode(newComp, comparison.newVersion, framework, mode);

  if (!oldCode && !newCode) return state;

  const modeStr = mode === null ? '' : `.${mode}`;

  if (!oldCode || !newCode) {
    state.headerPrinted = ensureHeaderPrinted(state.componentHeader, state.headerPrinted);
    console.log(`        Missing ${comparison.label}.${framework}${modeStr} in ${!oldCode ? options.oldFile : options.newFile}`);
    state.hasDifferences = true;
    return state;
  }

  if (oldCode !== newCode) {
    state.headerPrinted = ensureHeaderPrinted(state.componentHeader, state.headerPrinted);
    const modeFileStr = mode === null ? '' : `_${mode}`;
    const safeName = `${componentPath}_${comparison.label}_${framework}${modeFileStr}`
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/__+/g, '_');
    const diffPath = path.join(DIFF_DIR, `${safeName}.diff`);
    await generateDiff(oldCode, newCode, diffPath, framework, safeName);
    state.diffs++;
    state.hasDifferences = true;
  } else if (options.verbose) {
    state.headerPrinted = ensureHeaderPrinted(state.componentHeader, state.headerPrinted);
    console.log(`        No changes in ${comparison.label}.${framework}${modeStr}`);
  }

  return state;
}

async function compareComponents(old: ComponentData, newC: ComponentData, options: DiffOptions): Promise<void> {
  console.log('Processing components...\n');

  const comparisons = getComparisons(options, old, newC);
  const oldModes = collectModes(old);
  const newModes = collectModes(newC);
  const allModes = [...new Set([...oldModes, ...newModes])].sort((a, b) => {
    if (a === null) return -1;
    if (b === null) return 1;
    return String(a).localeCompare(String(b));
  });

  console.log(`Available modes: ${allModes.map(m => m === null ? 'null' : m).join(', ')}\n`);

  const frameworks = options.framework ? [options.framework] : ['html', 'react', 'vue'];
  let totalDiffs = 0;
  let differencesFound = false;

  for (const cat of Object.keys(newC)) {
    console.log(`Processing category: ${cat}`);
    for (const sub of Object.keys(newC[cat]!)) {
      console.log(`  Processing subcategory: ${sub}`);
      for (const group of Object.keys(newC[cat]![sub]!)) {
        console.log(`    Processing group: ${group}`);
        for (const comp of Object.keys(newC[cat]![sub]![group]!)) {
          const oldComp = old[cat]?.[sub]?.[group]?.[comp];
          const newComp = newC[cat]![sub]![group]![comp]!;
          const header = `      ${cat} > ${sub} > ${group} > "${comp}"`;

          if (!oldComp) {
            console.log(header);
            console.log('        Component not found in old file');
            differencesFound = true;
            continue;
          }

          let state: CompareState = { diffs: 0, hasDifferences: false, headerPrinted: false, componentHeader: header };
          const compPath = `${cat}_${sub}_${group}_${comp}`;

          for (const comparison of comparisons) {
            for (const fw of frameworks) {
              for (const mode of allModes) {
                state = await compareSnippetCombination(oldComp, newComp, comparison, fw, mode, compPath, options, state);
              }
            }
          }

          if (state.hasDifferences) differencesFound = true;
          totalDiffs += state.diffs;
        }
      }
    }
  }

  if (differencesFound) {
    console.log(`\nComparison complete. Generated ${totalDiffs} diff files in '${DIFF_DIR}/' directory.`);
  } else {
    console.log('\nTailwindPlus components are identical.');
  }
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const options = parseArgs();
  discoverFiles(options);

  const resolvedOptions = options as Required<Pick<DiffOptions, 'oldFile' | 'newFile'>> & DiffOptions;
  const { oldData, newData, oldComponents, newComponents } = loadFiles(resolvedOptions);

  if (options.namesOnly) {
    compareComponentNames(oldComponents, newComponents, options);
    return;
  }

  console.log(`Comparing:\n  Old: ${options.oldFile}\n  New: ${options.newFile}`);

  const oldVersion = (oldData['version'] as string | undefined) ?? 'unknown';
  const newVersion = (newData['version'] as string | undefined) ?? 'unknown';
  console.log(`\nVersions:\n  Old: ${oldVersion}\n  New: ${newVersion}\n`);

  ensureDiffDir();
  await compareComponents(oldComponents, newComponents, options);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
