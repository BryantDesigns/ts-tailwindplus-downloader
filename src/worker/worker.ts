/**
 * Worker — processes jobs from the downloader's job queue.
 *
 * Each Worker creates its own Playwright BrowserContext (isolated session)
 * and page, then pulls jobs off the shared queue until it is empty.
 *
 * Key improvements over the reference:
 *   - Worker communicates with Downloader through a typed interface (`WorkerHost`)
 *     rather than accessing the Downloader class directly. This decouples them
 *     and makes the Worker independently testable.
 *   - Extraction logic lives in `authenticated.ts` and `unauthenticated.ts`,
 *     keeping this file focused on job-loop orchestration.
 */

import type { Browser, BrowserContext, Page } from 'playwright';

import { startTracing, stopTracing } from '../browser/tracing.js';
import { extractAuthenticatedPageData } from './authenticated.js';
import { extractUnauthenticatedPageData } from './unauthenticated.js';
import type { ComponentData, DownloaderConfig, DownloaderOptions, Job } from '../types.js';
import type { Format } from '../models/format.js';
import type { Logger, PrefixedLogger } from '../logger.js';

// =============================================================================
// WorkerHost interface — decouples Worker from TailwindPlusDownloader
// =============================================================================

/**
 * The subset of `TailwindPlusDownloader` that Workers need access to.
 *
 * Programming against this interface instead of the concrete class:
 *   - Prevents Workers from accessing Downloader internals they shouldn't touch
 *   - Makes Workers independently testable with a mock host
 */
export interface WorkerHost {
    readonly options: DownloaderOptions;
    readonly config: DownloaderConfig;
    readonly jobQueue: Job[];
    readonly currentFormat: Format | null;
    readonly formats: Format[];
    processJobResult(job: Job): void;
}

// =============================================================================
// Worker
// =============================================================================

type WorkerState = 'stopped' | 'started';

export class Worker {
    private readonly id: number;
    private readonly browser: Browser;
    private readonly contextOptions: Record<string, unknown>;
    private readonly host: WorkerHost;
    private readonly logger: PrefixedLogger;

    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private state: WorkerState = 'stopped';

    constructor(
        id: number,
        browser: Browser,
        contextOptions: Record<string, unknown>,
        host: WorkerHost,
        baseLogger: Logger
    ) {
        this.id = id;
        this.browser = browser;
        this.contextOptions = contextOptions;
        this.host = host;
        // Pad the id so "Worker  1" and "Worker 10" align in log output
        this.logger = baseLogger.prefix(`Worker ${String(id).padStart(2, ' ')}`);
    }

    // =============================================================================
    // Lifecycle
    // =============================================================================

    /**
     * Starts the worker and processes jobs until the queue is empty.
     *
     * If a job fails it is returned to the Downloader for re-queuing (up to
     * `maxRetries`). Persistent failures are logged and skipped. There is no
     * support for partial downloads — if `maxRetries` is reached, the run must
     * be restarted.
     */
    async start(): Promise<void> {
        if (this.state === 'started') {
            this.logger.warn('Already started, skipping');
            return;
        }

        this.state = 'started';
        this.context = await this.browser.newContext(this.contextOptions);
        this.context.setDefaultTimeout(this.host.config.timeout);

        if (this.host.options.debugTrace) {
            const traceLabel = this.host.options.unauthenticated
                ? 'unauthenticated'
                : String(this.host.currentFormat);
            await startTracing(
                this.context,
                `worker-${this.id}-${traceLabel}`,
                { title: `Worker ${this.id} (${traceLabel})` }
            );
        }

        this.page = await this.context.newPage();

        // Job processing loop — Workers compete for jobs by shift()-ing from the queue
        while (this.host.jobQueue.length > 0) {
            const job = this.host.jobQueue.shift();
            if (!job) break;

            try {
                this.logger.debug(`Starting job: ${job.url}`);
                job.status = 'processing';

                const data: ComponentData = this.host.options.unauthenticated
                    ? await extractUnauthenticatedPageData(
                        this.page,
                        job.url,
                        this.host.formats,
                        this.host.config,
                        this.logger as unknown as import('../logger.js').Logger
                    )
                    : await extractAuthenticatedPageData(
                        this.page,
                        job.url,
                        this.host.currentFormat!,
                        this.host.config,
                        this.logger as unknown as import('../logger.js').Logger
                    );

                job.data = data;
                job.status = 'completed';
                this.logger.debug(`Completed job: ${job.url}`);
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                this.logger.warn(`Job failed: ${job.url}: ${msg}`);
                job.error = msg;
                job.status = 'failed';
            }

            this.host.processJobResult(job);
        }

        this.logger.debug('Queue empty, stopping');
    }

    /**
     * Stops tracing and closes the browser context and page.
     */
    async stop(): Promise<void> {
        if (this.host.options.debugTrace && this.context) {
            const traceLabel = this.host.options.unauthenticated
                ? 'unauthenticated'
                : String(this.host.currentFormat);
            const tracesDir = `${this.host.options.output}.traces`;
            await stopTracing(this.context, tracesDir, `worker-${this.id}-${traceLabel}`);
        }

        if (this.page) {
            await this.context?.close();
            this.page = null;
        }

        this.state = 'stopped';
    }
}
