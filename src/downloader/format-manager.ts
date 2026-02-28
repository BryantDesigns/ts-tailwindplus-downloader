/// <reference lib="dom" />
/**
 * Format manager — detects, generates, and switches the active component format.
 *
 * "Format" refers to the combination of framework (html/react/vue), Tailwind
 * version (3/4), and theme mode (system/light/dark) that controls which code
 * variant the TailwindPlus site displays. On authenticated accounts the format
 * is a server-side setting, so it must be changed via UI controls and the
 * script must wait for the resulting XHR responses to confirm the switch.
 *
 * Extracted into its own module so format-switching logic can evolve
 * independently from the download orchestration.
 */

import type { Page } from 'playwright';

import { DownloaderError } from '../errors.js';
import { Format } from '../models/format.js';
import { ReflectingArray } from '../models/reflecting-array.js';
import type { DownloaderConfig } from '../types.js';
import type { Logger } from '../logger.js';

// =============================================================================
// Format Detection
// =============================================================================

/**
 * Reads the currently selected format from a page by inspecting the UI controls
 * (framework select, version select, mode radio inputs).
 *
 * The page must already be loaded and a code panel must be visible before
 * calling this function.
 */
export async function readCurrentFormat(page: Page, config: DownloaderConfig): Promise<Format> {
  const frameworkSelect = page.locator(config.selectors.frameworkSelect).first();
  const versionSelect = page.locator(config.selectors.versionSelect).first();
  const checkedModeInput = page.locator(`${config.selectors.modeInput}:checked`).first();

  const framework = await frameworkSelect.inputValue();
  const versionStr = await versionSelect.inputValue();
  const mode = await checkedModeInput.inputValue().catch(() => null);

  const version = parseInt(versionStr, 10);

  if (!framework || isNaN(version)) {
    throw new DownloaderError(
      'Failed to read format controls: required selectors not found on page'
    );
  }

  return new Format({ framework, version, mode });
}

/**
 * Navigates to the first URL and reads the active format from the visible
 * UI controls. Used at startup to detect the user's account default.
 */
export async function detectCurrentFormat(
  page: Page,
  urls: string[],
  config: DownloaderConfig,
  logger: Logger
): Promise<Format> {
  if (urls.length === 0) {
    throw new DownloaderError('No URLs available to detect current format');
  }

  logger.debug('Detecting current format from page controls...');

  await page.goto(urls[0]!, { waitUntil: 'domcontentloaded' });

  // Wait for React/InertiaJS to hydrate data-page
  await page.waitForFunction(() => {
    const app = document.querySelector('div#app');
    return app?.getAttribute('data-page') !== null;
  });

  // Reveal version controls by clicking a Code button
  const codeButton = page.locator(config.selectors.codeButtons).first();
  await codeButton.click();

  const format = await readCurrentFormat(page, config);
  logger.debug(`Detected format: ${format}`);
  return format;
}

// =============================================================================
// Format Generation
// =============================================================================

/**
 * Generates all possible format combinations ordered to minimise the number
 * of format changes between consecutive downloads.
 *
 * Uses `ReflectingArray` to alternate traversal direction on each dimension,
 * so adjacent formats in the list differ by at most one setting (similar to
 * Gray code), minimising redundant UI interactions.
 *
 * @param startFormat  The currently active format (placed first in the list).
 */
export function generateFormats(startFormat: Format, config: DownloaderConfig): Format[] {
  const { framework: startFw, version: startV, mode: startM } = startFormat;

  const frameworks = new ReflectingArray(
    startFw,
    ...config.download.frameworks.filter(f => f !== startFw)
  );
  const versions = new ReflectingArray(
    startV,
    ...config.download.versions.filter(v => v !== startV)
  );
  const modes = new ReflectingArray(
    startM ?? config.download.modes[0]!,
    ...config.download.modes.filter(m => m !== startM)
  );

  const formats: Format[] = [];
  for (const fw of frameworks) {
    for (const v of versions) {
      for (const m of modes) {
        formats.push(new Format({ framework: fw, version: v, mode: m }));
      }
    }
  }

  return formats;
}

// =============================================================================
// Format Switching (authenticated mode only)
// =============================================================================

/** Returns a predicate that checks whether an XHR response contains data in the target format. */
function makeFormatResponseChecker(target: Format) {
  return async (response: { request(): { method(): string }; status(): number; headers(): Record<string, string>; json(): Promise<unknown> }): Promise<boolean> => {
    if (response.request().method() !== 'GET' || response.status() !== 200) return false;

    const ct = response.headers()['content-type'];
    if (!ct?.includes('application/json')) return false;

    try {
      const data = await response.json() as {
                props?: { subcategory?: { components?: Array<{ snippet: { name: string; version: number; mode: string | null } }> } };
            };
      const components = data.props?.subcategory?.components;
      if (!Array.isArray(components) || components.length === 0) return false;

      return components.every(c =>
        c.snippet.name === target.framework &&
                c.snippet.version === target.version &&
                c.snippet.mode === target.mode
      );
    } catch {
      return false;
    }
  };
}

/**
 * Changes the active format on the TailwindPlus site by interacting with the
 * UI controls and waiting for the corresponding XHR responses to confirm
 * each change.
 *
 * Changes are applied sequentially (framework → version → mode) rather than
 * in parallel to ensure each response is received before the next change,
 * preventing race conditions.
 *
 * @throws {DownloaderError} If any control interaction or response wait fails.
 */
export async function setFormat(
  page: Page,
  targetFormat: Format,
  urls: string[],
  config: DownloaderConfig,
  logger: Logger
): Promise<void> {
  // Navigate to first page to access format controls
  await page.goto(urls[0]!, { waitUntil: 'domcontentloaded' });

  const app = page.locator('div#app');
  const pageDataJson = await app.getAttribute('data-page');
  if (!pageDataJson) {
    throw new DownloaderError(`No data-page attribute found on ${urls[0]}`);
  }

  // Reveal version controls
  const codeButton = page.locator(config.selectors.codeButtons).first();
  await codeButton.click();

  let currentFormat = await readCurrentFormat(page, config);

  if (currentFormat.equals(targetFormat)) {
    logger.debug(`Format already set: ${targetFormat}`);
    return;
  }

  logger.debug(`Setting format: ${currentFormat} → ${targetFormat}`);

  const { framework: targetFw, version: targetV, mode: targetMode } = targetFormat;
  const frameworkSelect = page.locator(config.selectors.frameworkSelect).first();
  const versionSelect = page.locator(config.selectors.versionSelect).first();

  try {
    if (currentFormat.framework !== targetFw) {
      const interim = new Format({ framework: targetFw, version: currentFormat.version, mode: currentFormat.mode });
      const responsePromise = page.waitForResponse(makeFormatResponseChecker(interim));
      await frameworkSelect.selectOption(targetFw);
      await responsePromise;
      currentFormat = interim;
    }

    if (currentFormat.version !== targetV) {
      const interim = new Format({ framework: currentFormat.framework, version: targetV, mode: currentFormat.mode });
      const responsePromise = page.waitForResponse(makeFormatResponseChecker(interim));
      await versionSelect.selectOption(String(targetV));
      await responsePromise;
      currentFormat = interim;
    }

    if (targetMode !== null && currentFormat.mode !== targetMode) {
      const targetModeInput = page.locator(`${config.selectors.modeInput}[value="${targetMode}"]`).first();
      const interim = new Format({ framework: currentFormat.framework, version: currentFormat.version, mode: targetMode });
      const responsePromise = page.waitForResponse(makeFormatResponseChecker(interim));
      await targetModeInput.click();
      await responsePromise;
    }

    // Verify format was actually applied
    const verified = await readCurrentFormat(page, config);
    if (!verified.equals(targetFormat)) {
      throw new DownloaderError(
        `Format verification failed: expected ${targetFormat}, got ${verified}`
      );
    }

    logger.debug(`Format set successfully: ${targetFormat}`);
  } catch (error) {
    if (error instanceof DownloaderError) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw new DownloaderError(`Failed to set format to ${targetFormat}: ${msg}`);
  }
}
