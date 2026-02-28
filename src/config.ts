/**
 * Application configuration module.
 *
 * `createConfig()` builds the single source of truth for URLs, CSS selectors,
 * timeouts, retry limits, and download format combinations.
 *
 * The config is created once at startup and passed as a dependency rather than
 * accessed as a module-level global, making it easy to override in tests or
 * alternative entry points.
 */

import type { DownloaderConfig } from './types.js';

/**
 * Creates and returns the application configuration object.
 *
 * Centralises all magic strings, selectors, and constants in one place so
 * they can be updated when the TailwindPlus site structure changes.
 */
export function createConfig(): DownloaderConfig {
  const base = 'https://tailwindcss.com';

  // CSS selector building blocks for locating component controls on the page.
  // The site renders components inside <section id="component-{uuid}"> elements,
  // each with a controls area (2nd child) and a code panel (3rd child).
  const components = 'nav ~ div > div > section[id^="component-"]';
  const controlsRelative = 'div > :nth-child(2)';
  const codePanelRelative = 'div > :nth-child(3)';
  const componentControls = `${components} > ${controlsRelative}`;
  const codePanel = `${components} > ${codePanelRelative}`;

  // Timestamp used for both the output filename and embedded metadata.
  // Format: YYYYMMDD-HHmmss (filesystem-safe, sortable)
  const version = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/:/g, '')
    .replace('T', '-');

  const outputBase = 'tailwindplus-components';

  return {
    outputBase,
    version,
    output: `${outputBase}-${version}.json`,

    session: '.ts-tailwindplus-downloader-session.json',
    credentials: '.ts-tailwindplus-downloader-credentials.json',

    urls: {
      base,
      login: `${base}/plus/login`,
      plus: `${base}/plus`,
      discovery: `${base}/plus/ui-blocks`,
      eCommerce: `${base}/plus/ui-blocks/ecommerce`,
    },

    selectors: {
      // "Code" buttons that reveal the version control when clicked.
      codeButtons: `${componentControls} button:has-text("Code")`,

      // Format controls — the script reads/writes the first of each per page.
      modeInput: `${componentControls} input[name^="theme-"]`,
      frameworkSelect: `${componentControls} select`,
      versionSelect: `${codePanel} select`,
    },

    // Lower than Playwright's default to detect stalls sooner.
    timeout: 10_000,
    loginTimeout: 15_000,

    retries: {
      maxRetries: 3,
    },

    download: {
      frameworks: ['react', 'vue', 'html'] as const,
      versions: [3, 4] as const,
      modes: ['system', 'light', 'dark'] as const,
    },
  };
}
