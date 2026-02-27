/**
 * Unauthenticated page data extraction.
 *
 * Extracts component data from a TailwindPlus page without authentication,
 * collecting only free-tier (downloadable) components.
 *
 * Strategy:
 *   1. Read the page structure from `data-page` to identify downloadable components
 *   2. For each component (by UUID), iterate through all format combinations
 *   3. Change format controls (framework select, version select, mode radio) as needed
 *   4. Capture the snippet from the XHR JSON response or the initial data-page
 *
 * Because format controls work per-component in unauthenticated mode (unlike
 * authenticated mode where they are account-level), all formats can be captured
 * in a single page visit.
 */

import type { Page } from 'playwright';

import { DownloaderError } from '../errors.js';
import { extractUnauthenticatedPageInfo } from '../browser/page-functions.js';
import { shapeSnippet } from './authenticated.js';
import type { ComponentData, DownloaderConfig, Snippet } from '../types.js';
import type { Format } from '../models/format.js';
import type { Logger } from '../logger.js';

// =============================================================================
// Relative CSS selectors within a component section
// =============================================================================

const CONTROLS_RELATIVE = 'div > :nth-child(2)';
const CODE_BUTTON_RELATIVE = `${CONTROLS_RELATIVE} button:has-text("Code")`;
const FRAMEWORK_SELECT_RELATIVE = `${CONTROLS_RELATIVE} select`;
const modeInputRelative = (mode: string) => `${CONTROLS_RELATIVE} input[value="${mode}"]`;
const MODE_INPUTS_RELATIVE = `${CONTROLS_RELATIVE} input[type="radio"]`;

// =============================================================================
// Unauthenticated extraction
// =============================================================================

/**
 * Extracts all free-tier component snippets from a single page for all format
 * combinations, without requiring authentication.
 *
 * @throws {DownloaderError} When navigation or data extraction fails.
 */
export async function extractUnauthenticatedPageData(
    page: Page,
    url: string,
    formats: Format[],
    config: DownloaderConfig,
    logger: Logger
): Promise<ComponentData> {
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Wait for InertiaJS to populate data-page
    await page.waitForFunction(() => {
        const app = document.querySelector('#app');
        return !!(app && app.getAttribute('data-page'));
    }, {}, { timeout: config.timeout });

    // Read page structure and downloadable component list
    let pageInfo: Awaited<ReturnType<typeof extractUnauthenticatedPageInfo>>;
    try {
        pageInfo = await page.evaluate(extractUnauthenticatedPageInfo);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new DownloaderError(`Failed to read page structure from ${url}: ${msg}`);
    }

    const { product, category, subcategory, downloadableComponents } = pageInfo;

    if (downloadableComponents.length === 0) {
        logger.debug(`No downloadable components on ${url}`);
        return {};
    }

    logger.debug(`Found ${downloadableComponents.length} downloadable components on ${url}`);

    // Predicate for XHR JSON responses from this page
    const isInertiaJsonResponse = (response: { url(): string; status(): number; headers(): Record<string, string> }) =>
        response.url() === url &&
        response.status() === 200 &&
        (response.headers()['content-type'] ?? '').includes('application/json');

    const componentData: ComponentData = {
        [product]: { [category]: { [subcategory]: {} } },
    };

    for (const comp of downloadableComponents) {
        const snippets: Snippet[] = [];

        // Locate the component section by UUID
        const section = page.locator(`#component-${comp.uuid}`);
        await section.waitFor({ state: 'visible', timeout: config.timeout });

        // Reveal the format controls
        await section.locator(CODE_BUTTON_RELATIVE).click();

        const frameworkSelect = section.locator(FRAMEWORK_SELECT_RELATIVE).first();
        const versionSelect = section.locator(FRAMEWORK_SELECT_RELATIVE).nth(1);
        const modeInputCount = await section.locator(MODE_INPUTS_RELATIVE).count();
        const hasModeInputs = modeInputCount > 0;

        // eCommerce pages don't have mode inputs — deduplicate by framework/version only
        let formatsToUse = formats;
        if (!hasModeInputs) {
            const seen = new Set<string>();
            formatsToUse = formats.filter(f => {
                const key = `${f.framework}-${f.version}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }

        for (const format of formatsToUse) {
            let responseJson: unknown = null;

            // Change framework if needed
            const currentFramework = await frameworkSelect.inputValue();
            if (currentFramework !== format.framework) {
                const resp = page.waitForResponse(isInertiaJsonResponse);
                await frameworkSelect.selectOption(format.framework);
                responseJson = await (await resp).json();
            }

            // Change version if needed
            const currentVersion = await versionSelect.inputValue();
            if (currentVersion !== String(format.version)) {
                const resp = page.waitForResponse(isInertiaJsonResponse);
                await versionSelect.selectOption(String(format.version));
                responseJson = await (await resp).json();
            }

            // Change mode if needed (only for pages with mode inputs)
            if (hasModeInputs && format.mode !== null) {
                const modeInput = section.locator(modeInputRelative(format.mode)).first();
                const isChecked = await modeInput.isChecked();
                if (!isChecked) {
                    const resp = page.waitForResponse(isInertiaJsonResponse);
                    await modeInput.click();
                    responseJson = await (await resp).json();
                }
            }

            // Extract snippet from XHR response or fall back to initial data-page snippet
            let snippet: Record<string, unknown> | undefined;
            if (responseJson) {
                const data = responseJson as {
                    props: { subcategory: { components: Array<{ uuid: string; snippet: Record<string, unknown> }> } };
                };
                const match = data.props.subcategory.components.find(c => c.uuid === comp.uuid);
                snippet = match?.snippet;
            } else {
                snippet = comp.initialSnippet as unknown as Record<string, unknown>;
            }

            if (snippet) {
                snippets.push(shapeSnippet(snippet));
            }
        }

        componentData[product]![category]![subcategory]![comp.name] = {
            name: comp.name,
            snippets,
        };

        logger.debug(`Collected ${snippets.length} snippets for ${comp.name}`);
    }

    logger.debug(`Extracted ${downloadableComponents.length} components from ${product}/${category}/${subcategory}`);
    return componentData;
}
