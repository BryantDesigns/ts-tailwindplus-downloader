/// <reference lib="dom" />
/**
 * URL discovery module.
 *
 * Discovers all downloadable component page URLs by navigating the TailwindPlus
 * "ui-blocks" listing page and collecting links to each subcategory.
 *
 * Extracted from the monolith so URL discovery can be:
 *   - Tested with a mock page object
 *   - Replaced with file-based URL loading for development/debugging
 */

import fs from 'fs';
import type { Page } from 'playwright';

import { DownloaderError } from '../errors.js';
import type { DiscoveryResult, DownloaderConfig } from '../types.js';
import type { Logger } from '../logger.js';

// =============================================================================
// URL Discovery
// =============================================================================

/**
 * Discovers all component page URLs from the TailwindPlus ui-blocks listing.
 *
 * Navigates to the discovery URL and extracts all subcategory links. A retry
 * loop handles transient navigation failures (network blips, page timeouts).
 *
 * @param page     Playwright page to use for navigation
 * @param config   App config (URLs, selectors, timeouts)
 * @param logger   Logger instance
 * @param maxRetries  Number of retries before throwing
 */
export async function discoverUrls(
    page: Page,
    config: DownloaderConfig,
    logger: Logger,
    maxRetries = 3
): Promise<string[]> {
    logger.info('Discovering component URLs...');

    let attempt = 0;
    while (attempt <= maxRetries) {
        try {
            await page.goto(config.urls.discovery, { waitUntil: 'domcontentloaded' });

            // Wait for navigation links to render
            await page.waitForFunction(() => {
                const app = document.querySelector('div#app');
                return app?.getAttribute('data-page') !== null;
            }, { timeout: config.timeout });

            const urls = await page.evaluate((baseUrl: string) => {
                const data = document.querySelector('div#app')?.getAttribute('data-page');
                if (!data) return [];

                const parsed = JSON.parse(data) as {
                    props?: { categories?: Array<{ subcategories?: Array<{ url?: string }> }> };
                };

                return (parsed.props?.categories ?? []).flatMap(
                    cat => (cat.subcategories ?? []).map(sub => sub.url).filter((u): u is string => !!u)
                ).map(relativeUrl => `${baseUrl}${relativeUrl}`);
            }, config.urls.base);

            logger.info(`Discovered ${urls.length} component pages`);
            return urls;
        } catch (error) {
            attempt++;
            const msg = error instanceof Error ? error.message : String(error);

            if (attempt > maxRetries) {
                throw new DownloaderError(`URL discovery failed after ${maxRetries} retries: ${msg}`);
            }

            logger.warn(`URL discovery attempt ${attempt} failed: ${msg}, retrying...`);
        }
    }

    throw new DownloaderError('URL discovery failed unexpectedly');
}

// =============================================================================
// File-based URL loading (debug mode)
// =============================================================================

/**
 * Loads URLs from a plain-text file (one URL per line, `#` comments allowed).
 * Used when `--debug-url-file` is provided to test against a specific subset.
 */
export function loadUrlsFromFile(filePath: string, logger: Logger): string[] {
    logger.debug(`Loading URLs from file: ${filePath}`);

    const content = fs.readFileSync(filePath, 'utf-8');
    const urls = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));

    logger.info(`Loaded ${urls.length} URLs from ${filePath}`);
    return urls;
}

// =============================================================================
// Counting helpers
// =============================================================================

/**
 * Counts the total number of downloadable components across all discovered URLs.
 * Used after URL discovery to populate the DiscoveryResult metadata.
 */
export function buildDiscoveryResult(urls: string[], componentCount: number): DiscoveryResult {
    return { urls, urlCount: urls.length, componentCount };
}
