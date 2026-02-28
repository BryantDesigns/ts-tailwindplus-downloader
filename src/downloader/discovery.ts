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
 * Navigates to the discovery URL and extracts the `props.products` array from
 * the `data-page` JSON attribute, then flattens
 * `products[].categories[].subcategories[].url` into a URL list.
 *
 * A retry loop handles transient navigation failures (network blips, page timeouts).
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

      // Wait for the product data to be present in the data-page attribute.
      // The page embeds an InertiaJS JSON payload with the full product tree
      // under props.products — we wait for that array to be non-empty.
      const productsHandle = await page.waitForFunction(() => {
        try {
          const app = document.querySelector('div#app');
          if (!app) return false;

          const json = app.getAttribute('data-page');
          if (!json) return false;

          const pageData = JSON.parse(json);
          const products = pageData?.props?.products;

          if (!Array.isArray(products) || products.length === 0) return false;
          return products;
        } catch {
          return false;
        }
      }, undefined, { timeout: config.timeout });

      // Extract the products array from the JSHandle
      type SubcategoryEntry = { name?: string; url?: string; components?: string };
      type CategoryEntry = { subcategories?: SubcategoryEntry[] };
      type ProductEntry = { categories?: CategoryEntry[] };

      const products: ProductEntry[] = await productsHandle.evaluate(
        (data) => data as ProductEntry[]
      );

      // Flatten products → categories → subcategories
      const subcategories = products.flatMap(
        p => (p.categories ?? []).flatMap(c => c.subcategories ?? [])
      );

      const urls: string[] = [];
      let totalComponentCount = 0;

      for (const sub of subcategories) {
        if (!sub?.name || !sub.url || !sub.components) continue;

        const match = sub.components.match(/^(?<componentCount>\d+)/);
        const count = parseInt(match?.groups?.componentCount ?? '0', 10) || 0;

        urls.push(sub.url);
        totalComponentCount += count;
      }

      logger.debug(
        `Discovered ${urls.length} component URLs with ${totalComponentCount} individual components`
      );
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
