/**
 * Authenticated page data extraction.
 *
 * Extracts component data from a TailwindPlus page in authenticated mode.
 * Reads directly from the InertiaJS `data-page` JSON attribute rather than
 * scraping the rendered DOM — this is significantly faster and more reliable.
 *
 * The function waits until the data in the `data-page` attribute matches the
 * expected format before returning. This guards against race conditions where
 * the page has loaded but React has not yet updated the attribute with the
 * correct format data.
 */

import type { Page } from 'playwright';

import { DownloaderError } from '../errors.js';
import { waitForAuthenticatedData } from '../browser/page-functions.js';
import type { ComponentData, DownloaderConfig, Snippet } from '../types.js';
import type { Format } from '../models/format.js';
import type { Logger } from '../logger.js';

// =============================================================================
// Snippet shaping
// =============================================================================

/**
 * Whitelist only the properties we want to persist in the output JSON.
 * Excludes internal Inertia fields that are not part of the public data model.
 */
export function shapeSnippet(raw: Record<string, unknown>): Snippet {
  return {
    code: raw['code'] as string,
    name: raw['name'] as string,
    language: raw['language'] as string,
    version: raw['version'] as number,
    mode: raw['mode'] as string | null,
    supportsDarkMode: raw['supportsDarkMode'] as boolean,
    preview: raw['preview'] as string,
  };
}

// =============================================================================
// Authenticated extraction
// =============================================================================

/**
 * Extracts component data from a single page in authenticated mode.
 *
 * Navigates to the job URL, waits for the `data-page` attribute to contain
 * data in the expected format, then builds and returns a typed ComponentData
 * object for the page's subcategory.
 *
 * @throws {DownloaderError} When navigation fails, times out, or format validation fails.
 */
export async function extractAuthenticatedPageData(
  page: Page,
  url: string,
  expectedFormat: Format,
  config: DownloaderConfig,
  logger: Logger
): Promise<ComponentData> {
  // Navigate without waiting for full load — we only need domcontentloaded
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  let subcategory;
  try {
    const dataHandle = await page.waitForFunction(
      waitForAuthenticatedData,
      {
        url,
        expectedFormat: {
          framework: expectedFormat.framework,
          version: expectedFormat.version,
          mode: expectedFormat.mode,
        },
        ecommerceUrl: config.urls.eCommerce,
      },
      { timeout: config.timeout }
    );

    subcategory = await dataHandle.evaluate(d => d);
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new DownloaderError(
        `Timeout waiting for format "${expectedFormat}" on ${url}. ` +
                `The account format may have been changed manually during download.`
      );
    }
    throw error;
  }

  if (!subcategory) {
    throw new DownloaderError(`Received no data from ${url} for format "${expectedFormat}"`);
  }

  // At this point data is guaranteed to be available and in the correct format
  const { components, name: subcategoryName, category } = subcategory;
  const categoryName = category.name;
  const productName = category.product.name;

  const componentData: ComponentData = {
    [productName]: {
      [categoryName]: {
        [subcategoryName]: {},
      },
    },
  };

  for (const component of components) {
        componentData[productName]![categoryName]![subcategoryName]![component.name] = {
          name: component.name,
          snippets: [shapeSnippet(component.snippet as unknown as Record<string, unknown>)],
        };
  }

  logger.debug(
    `Extracted ${components.length} components from ${productName}/${categoryName}/${subcategoryName}`
  );

  return componentData;
}
