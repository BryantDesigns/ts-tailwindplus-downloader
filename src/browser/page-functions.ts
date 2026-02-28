/// <reference lib="dom" />
/**
 * Browser-evaluate functions for extracting page data from TailwindPlus pages.
 *
 * These are the functions passed to `page.waitForFunction()` and `page.evaluate()`.
 * By extracting them here instead of defining them inline inside class methods,
 * they become:
 *   1. Independently testable without spinning up a browser
 *   2. Easy to locate and update when the TailwindPlus site structure changes
 *   3. Clearly named with typed args/return shapes
 *
 * IMPORTANT: These functions are serialised and run inside the browser's JS engine.
 * They must NOT reference any Node.js APIs, external imports, or closure variables.
 * All required data must be passed via the `args` parameter.
 */

import type { Snippet } from '../types.js';

// =============================================================================
// Types for browser-evaluate arguments and return values
// =============================================================================

/** Arguments passed into `waitForAuthenticatedData`. */
export interface AuthenticatedDataArgs {
    url: string;
    expectedFormat: {
        framework: string;
        version: number;
        mode: string | null;
    };
    ecommerceUrl: string;
}

/** The subcategory object returned from the page's data-page JSON. */
export interface SubcategoryPageData {
    name: string;
    components: AuthenticatedComponent[];
    category: {
        name: string;
        product: { name: string };
    };
}

export interface AuthenticatedComponent {
    name: string;
    uuid: string;
    downloadable: boolean;
    preview: string;
    snippet: Snippet;
}

/** Arguments passed into `waitForPageReady`. */
export interface PageReadyArgs {
    selector?: string;
}

// =============================================================================
// Page evaluate functions
// =============================================================================

/**
 * Browser-evaluate predicate for authenticated page data extraction.
 *
 * Waits until the `#app[data-page]` attribute contains component data in the
 * expected format. Returns the subcategory object if valid, false otherwise.
 *
 * This is the primary data-extraction mechanism for authenticated mode —
 * reading from the InertiaJS `data-page` JSON attribute is far more reliable
 * and faster than scraping the rendered DOM.
 *
 * @param args - Must be JSON-serialisable (passed from Node → browser context)
 * @returns The subcategory object if valid data is found, false otherwise
 */
export function waitForAuthenticatedData(
  args: AuthenticatedDataArgs
): SubcategoryPageData | false {
  try {
    const app = document.querySelector('div#app');
    if (!app) return false;

    const pageDataJson = app.getAttribute('data-page');
    if (!pageDataJson) return false;

    const pageData = JSON.parse(pageDataJson) as {
            props?: {
                subcategory?: SubcategoryPageData & {
                    components: Array<{
                        snippet: { name: string; version: number; mode: string | null };
                    }>;
                };
            };
        };

    const subcategory = pageData?.props?.subcategory;
    const components = subcategory?.components;

    if (!Array.isArray(components) || components.length === 0) return false;

    // For eCommerce pages, mode is null (not a format dimension)
    const isEcommerce = args.url.startsWith(args.ecommerceUrl);
    const expectedMode = isEcommerce ? null : args.expectedFormat.mode;

    const allSnippetsValid = components.every(component => {
      const snippet = component.snippet;
      return (
        snippet.name === args.expectedFormat.framework &&
                snippet.version === args.expectedFormat.version &&
                snippet.mode === expectedMode
      );
    });

    if (!allSnippetsValid) return false;

    return subcategory as SubcategoryPageData;
  } catch {
    return false;
  }
}

/**
 * Browser-evaluate predicate that waits for the InertiaJS `data-page`
 * attribute to be populated on `#app`.
 *
 * Used as a lightweight readiness check before reading page data.
 */
export function waitForPageReady(): boolean {
  const app = document.querySelector('#app');
  return !!(app && app.getAttribute('data-page'));
}

/**
 * Browser-evaluate function to read page structure and downloadable components
 * from the `data-page` JSON attribute.
 *
 * Used in unauthenticated mode to identify which components on the page are
 * downloadable (free tier) and to extract the product/category/subcategory
 * hierarchy.
 */
export function extractUnauthenticatedPageInfo(): {
    product: string;
    category: string;
    subcategory: string;
    downloadableComponents: Array<{
        uuid: string;
        name: string;
        initialSnippet: Snippet;
    }>;
    } {
  const appEl = document.querySelector('#app');
  if (!appEl) throw new Error('No #app element found');

  const raw = appEl.getAttribute('data-page');
  if (!raw) throw new Error('No data-page attribute on #app');

  const data = JSON.parse(raw) as {
        props: {
            subcategory: {
                name: string;
                components: Array<{
                    uuid: string;
                    name: string;
                    downloadable: boolean;
                    preview: string;
                    snippet: Snippet;
                }>;
                category: { name: string; product: { name: string } };
            };
        };
    };

  const sub = data.props.subcategory;

  return {
    product: sub.category.product.name,
    category: sub.category.name,
    subcategory: sub.name,
    downloadableComponents: sub.components
      .filter(c => c.downloadable && c.preview === 'light')
      .map(c => ({ uuid: c.uuid, name: c.name, initialSnippet: c.snippet })),
  };
}
