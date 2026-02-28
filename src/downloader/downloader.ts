/**
 * TailwindPlusDownloader — main orchestrator.
 *
 * Coordinates the end-to-end download process by composing the individual
 * modules (auth, discovery, format-manager, output, workers).
 *
 * This class is intentionally thin. All heavy logic lives in the modules it
 * imports: each concern is testable independently, and this file reads as a
 * clear orchestration narrative.
 */

import { createRequire } from 'node:module';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json') as { version: string };
import type { Browser, BrowserContext } from 'playwright';

import { DownloaderError } from '../errors.js';
import { Logger } from '../logger.js';
import { Format } from '../models/format.js';
import { startTracing, stopTracing } from '../browser/tracing.js';
import { ensureAuthenticated, loadSession } from './auth.js';
import { discoverUrls, loadUrlsFromFile } from './discovery.js';
import { detectCurrentFormat, generateFormats, setFormat } from './format-manager.js';
import {
  countComponents,
  deduplicateEcommerceSnippets,
  mergeComponentData,
  writeDirectoryOutput,
  writeJsonOutput,
} from './output.js';

import type {
  ComponentData,
  DownloadMetadata,
  DownloaderConfig,
  DownloaderOptions,
  Job,
} from '../types.js';

// =============================================================================
// Downloader
// =============================================================================

export class TailwindPlusDownloader {
  readonly options: DownloaderOptions;
  readonly config: DownloaderConfig;

  // Public for Worker access — see Worker class for usage notes
  readonly logger: Logger;
  currentFormat: Format | null = null;
  formats: Format[] = [];
  jobQueue: Job[] = [];
  componentData: ComponentData = {};

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private contextOptions: Record<string, unknown> = {};
  private mainPage: import('playwright').Page | null = null;
  private tracesDir: string = '';
  private startTime: Date = new Date();
  private urlCount = 0;
  private componentCount = 0;

  constructor(options: DownloaderOptions, config: DownloaderConfig) {
    this.options = options;
    this.config = config;
    this.logger = new Logger({
      debug: options.debug,
      log: typeof options.log === 'string' ? options.log : undefined,
    });
  }

  // =============================================================================
  // Lifecycle
  // =============================================================================

  async start(): Promise<void> {
    this.startTime = new Date();

    // Check if output already exists
    if (fs.existsSync(this.options.output) && !this.options.overwrite) {
      const prompt = await import('read').then(m => m.read);
      const answer = await prompt({
        prompt: `Output "${this.options.output}" already exists. Overwrite? [y/N] `,
      });
      if (!answer.trim().toLowerCase().startsWith('y')) {
        throw new DownloaderError('Aborted: output already exists');
      }
    }

    this._logStartMessage();

    try {
      await this._initializeBrowser();
      await this._discoverUrls();
      await this._runDownload();
      this._writeOutput();
    } catch (error) {
      if (error instanceof DownloaderError) {
        this.logger.error(error.message);
        process.exit(1);
      }
      throw error;
    } finally {
      await this.stop();
    }
  }

  async stop(): Promise<void> {
    this.logger.debug('--- Shutting down ---');
    this._logStopMessage();

    if (this.mainPage && !this.mainPage.isClosed()) {
      await this.mainPage.close();
    }

    if (this.options.debugTrace && this.context) {
      await stopTracing(this.context, this.tracesDir, 'main');
    }

    if (this.browser) {
      await this.browser.close();
    }

    this.logger.close();
  }

  // =============================================================================
  // Process job results (called by Workers)
  // =============================================================================

  processJobResult(job: Job): void {
    if (job.status === 'completed' && job.data) {
      const count = countComponents(job.data as unknown as Record<string, unknown>);
      this.logger.debug(`Merged ${count} components from ${job.url}`);
      mergeComponentData(
                this.componentData as unknown as Record<string, unknown>,
                job.data as unknown as Record<string, unknown>
      );
    } else if (job.status === 'failed') {
      this.logger.warn(`Job failed: ${job.url} — ${job.error}`);

      if (job.retryCount < this.config.retries.maxRetries) {
        job.retryCount++;
        job.status = 'pending';
        delete job.error;
        this.jobQueue.push(job);
        this.logger.warn(`Retrying ${job.url} (${job.retryCount}/${this.config.retries.maxRetries})`);
      } else {
        this.logger.error(`Max retries exceeded for ${job.url}, skipping`);
      }
    }
  }

  // =============================================================================
  // Private orchestration steps
  // =============================================================================

  private async _initializeBrowser(): Promise<void> {
    this.logger.debug('Initializing browser...');

    const session = loadSession(this.options.session, this.logger);
    this.contextOptions = session ? { storageState: session } : {};

    this.browser = await chromium.launch({ headless: !this.options.debugHeaded });

    this.context = await this.browser.newContext(this.contextOptions);
    this.context.setDefaultTimeout(this.config.timeout);

    if (this.options.debugTrace) {
      this.tracesDir = `${this.options.output}.traces`;
      fs.mkdirSync(this.tracesDir, { recursive: true });
      await startTracing(this.context, 'main', { title: 'Main context' });
    }

    this.mainPage = await this.context.newPage();

    if (!this.options.unauthenticated) {
      await ensureAuthenticated(this.mainPage, this.context, this.config, this.logger);
    }
  }

  private async _discoverUrls(): Promise<void> {
    const page = this.mainPage!;

    let urls: string[];

    if (this.options.debugUrlFile) {
      urls = loadUrlsFromFile(this.options.debugUrlFile, this.logger);
    } else {
      urls = await discoverUrls(page, this.config, this.logger);
    }

    if (this.options.debugShortTest) {
      urls = urls.slice(0, 2);
      this.logger.info('Short test mode: limited to 2 URLs');
    }

    this.urlCount = urls.length;
    this._urls = urls;
  }

  // Not on config — stored as instance property for worker access
  _urls: string[] = [];

  private async _runDownload(): Promise<void> {
    if (this.options.unauthenticated) {
      this.formats = generateFormats(
        new Format({ framework: 'html', version: 3, mode: 'light' }),
        this.config
      );
    } else {
      const startFormat = await detectCurrentFormat(this.mainPage!, this._urls, this.config, this.logger);
      this.formats = generateFormats(startFormat, this.config);
    }

    await this._processFormats();
  }

  private async _processFormats(): Promise<void> {
    // Inline import to avoid circular dependency  — Worker imports Downloader
    const { Worker } = await import('../worker/worker.js');

    const numWorkers = Math.min(this.options.workers, this._urls.length);
    const workers = Array.from({ length: numWorkers }, (_, i) =>
      new Worker(i + 1, this.browser!, this.contextOptions, this, this.logger)
    );

    this.logger.debug(`Created ${numWorkers} workers`);

    if (this.options.unauthenticated) {
      this.logger.info(`Unauthenticated mode: downloading ${this.formats.length} formats per page`);
      this._populateJobQueue();
      await Promise.all(workers.map(w => w.start()));
      await Promise.all(workers.map(w => w.stop()));
    } else {
      for (const format of this.formats) {
        this.logger.info(`Downloading format: ${format}`);
        this.currentFormat = format;
        await setFormat(this.mainPage!, format, this._urls, this.config, this.logger);
        this._populateJobQueue();
        await Promise.all(workers.map(w => w.start()));
        await Promise.all(workers.map(w => w.stop()));
        this.logger.info(`Completed format: ${format}`);
      }
    }

    this.logger.debug('All formats downloaded');
  }

  private _populateJobQueue(): void {
    let urls = [...this._urls];
    if (this.options.debugShortTest) {
      urls = urls.slice(0, 2);
    }

    this.jobQueue = urls.map(url => ({
      url,
      status: 'pending' as const,
      retryCount: 0,
    }));

    this.logger.debug(`Populated job queue: ${this.jobQueue.length} jobs`);
  }

  private _writeOutput(): void {
    let data = this.componentData;

    // Deduplicate eCommerce snippets (they don't have a mode dimension)
    data = deduplicateEcommerceSnippets(data);

    this.componentCount = countComponents(data as unknown as Record<string, unknown>);

    const metadata: DownloadMetadata = {
      component_count: this.componentCount,
      download_duration: `${this._elapsedSeconds()}s`,
      downloaded_at: this.startTime.toISOString(),
      downloader_version: packageJson.version,
      version: this.config.version,
    };

    if (this.options.outputFormat === 'dir') {
      writeDirectoryOutput(this.options.output, data, metadata, this.logger);
    } else {
      writeJsonOutput(this.options.output, data, metadata, this.logger);
    }
  }

  // =============================================================================
  // Utilities
  // =============================================================================

  private _elapsedSeconds(): number {
    return Math.round((Date.now() - this.startTime.getTime()) / 1000);
  }

  private _logStartMessage(): void {
    if (this.options.unauthenticated) this.logger.info('Unauthenticated mode: free components only');
    if (this.options.debugTrace) this.logger.info(`Tracing enabled → ${this.options.output}.traces`);
    if (this.options.debugShortTest) this.logger.info('Short test mode: 2 URLs only');
    this.logger.info(`Starting download to ${this.options.output} with ${this.options.workers} workers`);
  }

  private _logStopMessage(): void {
    const elapsed = this._elapsedSeconds();
    if (fs.existsSync(this.options.output)) {
      const stats = fs.statSync(this.options.output);
      const size = Math.round(stats.size / 1024);
      this.logger.info(
        `Download complete! Saved to ${this.options.output} (${size} KB). ` +
                `${this.urlCount} pages, ${this.componentCount} components in ${elapsed}s.`
      );
    } else {
      this.logger.info(`Completed in ${elapsed}s. ${this.urlCount} pages, ${this.componentCount} components.`);
    }
  }
}
