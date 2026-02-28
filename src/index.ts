#!/usr/bin/env node
/**
 * CLI entry point for the TailwindPlus Downloader.
 *
 * Parses command-line arguments and launches the downloader.
 * Kept intentionally thin — argument parsing is the only responsibility here.
 * All business logic lives in the imported modules.
 */

import { hideBin } from 'yargs/helpers';
import yargs from 'yargs';

import { createConfig } from './config.js';
import { TailwindPlusDownloader } from './downloader/downloader.js';
import type { DownloaderOptions } from './types.js';

// =============================================================================
// Argument parsing
// =============================================================================

function parseArgs(): DownloaderOptions {
  const config = createConfig();

  const argv = yargs(hideBin(process.argv))
    .wrap(null)
    .strict()
    .option('output', {
      type: 'string',
      requiresArg: true,
      describe: `Path to save downloaded components. Default: ${config.output}`,
    })
    .option('workers', {
      type: 'number',
      requiresArg: true,
      default: 15,
      describe: 'Number of pages to download in parallel',
    })
    .option('session', {
      type: 'string',
      requiresArg: true,
      default: config.session,
      describe: 'Path to session file (optional)',
    })
    .option('credentials', {
      type: 'string',
      requiresArg: true,
      default: config.credentials,
      describe: 'Path to credentials file (optional)',
    })
    .option('log', {
      describe: 'Path to log file. If used as a flag (no path), defaults to <output>.log',
    })
    .option('debug', {
      type: 'boolean',
      default: false,
      describe: 'Enable debug level logging',
    })
    .option('debug-short-test', {
      type: 'boolean',
      describe: 'Limit download to 2 URLs for fast testing',
    })
    .option('debug-url-file', {
      type: 'string',
      requiresArg: true,
      describe: 'Only download URLs listed in a file (comments with # allowed)',
    })
    .option('debug-headed', {
      type: 'boolean',
      describe: 'Run browser in headed mode (shows browser window)',
    })
    .option('debug-trace', {
      type: 'boolean',
      describe: 'Enable Playwright tracing, saved to <output>.traces/',
    })
    .option('unauthenticated', {
      type: 'boolean',
      default: false,
      describe: 'Download free components only (no login required)',
    })
    .option('output-format', {
      choices: ['json', 'dir'] as const,
      default: 'json' as const,
      describe: 'Output format: json (single file) or dir (directory tree)',
    })
    .option('overwrite', {
      type: 'boolean',
      default: false,
      describe: 'Overwrite existing output without prompting',
    })
    .check(argv => {
      if (argv.workers <= 0) throw new Error('--workers must be a positive number');
      if (argv.workers > 50) throw new Error('--workers should not exceed 50');
      return true;
    })
    .usage('Usage: $0 [options]')
    .example('$0', 'Download all components to a timestamped JSON file')
    .example('$0 --output=components.json', 'Download to a specific file')
    .example('$0 --output-format=dir --output=components/', 'Write as directory tree')
    .example('$0 --unauthenticated', 'Download only free components')
    .example('$0 --workers=5 --debug', 'Slower download with debug logging')
    .epilog('Options can be specified as --option=value or --option value')
    .help('help')
    .alias('help', 'h')
    .parseSync();

  // Resolve default output path based on format
  let output = argv.output;
  if (!output) {
    output = argv['outputFormat'] === 'dir'
      ? `${config.outputBase}-${config.version}`
      : config.output;
  }

  // Resolve log path when --log is used as a boolean flag
  let log: string | boolean | undefined = argv.log as string | boolean | undefined;
  if (log === true) {
    log = output.endsWith('.json')
      ? output.replace(/\.json$/, '.log')
      : `${output}.log`;
  }

  return {
    output,
    outputFormat: argv['outputFormat'] as 'json' | 'dir',
    overwrite: argv.overwrite ?? false,
    workers: argv.workers,
    session: argv.session ?? config.session,
    credentials: argv.credentials ?? config.credentials,
    log,
    debug: argv.debug,
    debugShortTest: argv['debugShortTest'] as boolean | undefined,
    debugUrlFile: argv['debugUrlFile'] as string | undefined,
    debugHeaded: argv['debugHeaded'] as boolean | undefined,
    debugTrace: argv['debugTrace'] as boolean | undefined,
    unauthenticated: argv.unauthenticated ?? false,
  };
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const options = parseArgs();
  const config = createConfig();
  const downloader = new TailwindPlusDownloader(options, config);
  await downloader.start();
}

main().catch(error => {
  console.error('[FATAL]', error);
  process.exit(1);
});
