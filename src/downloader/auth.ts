/**
 * Authentication module for TailwindPlus.
 *
 * Handles loading a saved session, validating it against the live site,
 * prompting for credentials when needed, and performing login via Playwright.
 *
 * Separating auth from the main downloader orchestrator makes it easy to:
 *   - Unit test credential loading without a browser
 *   - Swap in a different auth strategy without touching download logic
 */

import fs from 'fs';
import path from 'path';
import { read } from 'read';
import type { BrowserContext, Page } from 'playwright';

import { DownloaderError } from '../errors.js';
import type { Credentials, DownloaderConfig } from '../types.js';
import type { Logger } from '../logger.js';

// =============================================================================
// Session
// =============================================================================

/**
 * Attempts to load a Playwright storage state (cookies + localStorage) from a
 * file on disk. Returns the parsed state or null if the file doesn't exist.
 */
export function loadSession(sessionPath: string, logger: Logger): object | null {
    if (!fs.existsSync(sessionPath)) {
        logger.debug(`No session file found at ${sessionPath}`);
        return null;
    }

    try {
        const raw = fs.readFileSync(sessionPath, 'utf-8');
        logger.debug(`Loaded session from ${sessionPath}`);
        return JSON.parse(raw) as object;
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to parse session file: ${msg}`);
        return null;
    }
}

/**
 * Saves a Playwright storage state snapshot to disk for reuse on the next run.
 */
export async function saveSession(
    context: BrowserContext,
    sessionPath: string,
    logger: Logger
): Promise<void> {
    try {
        const state = await context.storageState();
        fs.writeFileSync(sessionPath, JSON.stringify(state, null, 2));
        logger.debug(`Session saved to ${sessionPath}`);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to save session: ${msg}`);
    }
}

// =============================================================================
// Session validation
// =============================================================================

/**
 * Validates whether the given page is already in an authenticated state by
 * navigating to the protected Plus URL and checking the resulting URL.
 *
 * If the site redirects to the login page, the session is invalid.
 */
export async function validateSession(
    page: Page,
    config: DownloaderConfig,
    logger: Logger
): Promise<boolean> {
    logger.debug('Validating session...');

    try {
        const response = await page.goto(config.urls.plus, { waitUntil: 'domcontentloaded' });

        if (!response) {
            logger.debug('No response from validation page');
            return false;
        }

        // If redirected to login, the session has expired
        if (page.url().includes('/login')) {
            logger.debug('Session invalid: redirected to login');
            return false;
        }

        logger.debug('Session is valid');
        return true;
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.debug(`Session validation error: ${msg}`);
        return false;
    }
}

// =============================================================================
// Credentials
// =============================================================================

/**
 * Loads credentials from a JSON file on disk.
 * Returns null if the file doesn't exist or can't be parsed.
 *
 * Security note: Storing credentials in a plain-text file is a risk. The user
 * should prefer interactive prompts and rely on saved sessions where possible.
 */
export function loadCredentials(
    credentialsPath: string,
    logger: Logger
): Pick<Credentials, 'email' | 'password'> | null {
    if (!fs.existsSync(credentialsPath)) {
        logger.debug(`No credentials file at ${credentialsPath}`);
        return null;
    }

    try {
        const raw = fs.readFileSync(credentialsPath, 'utf-8');
        const parsed = JSON.parse(raw) as { email: string; password: string };
        logger.debug(`Loaded credentials from ${credentialsPath}`);
        return { email: parsed.email, password: parsed.password };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to parse credentials file: ${msg}`);
        return null;
    }
}

/**
 * Prompts the user interactively for their TailwindPlus email and password.
 */
export async function promptCredentials(): Promise<Pick<Credentials, 'email' | 'password'>> {
    const email = await read({ prompt: 'TailwindPlus email: ' });
    const password = await read({ prompt: 'TailwindPlus password: ', silent: true });
    return { email: email.trim(), password };
}

/**
 * Resolves credentials from available sources (file → prompt).
 * Exits if no credentials are available.
 */
export async function resolveCredentials(
    credentialsPath: string,
    logger: Logger
): Promise<Credentials> {
    const fromFile = loadCredentials(credentialsPath, logger);
    if (fromFile) {
        return { ...fromFile, source: 'file' };
    }

    logger.info('No credentials file found, prompting for credentials...');
    const fromPrompt = await promptCredentials();
    return { ...fromPrompt, source: 'prompt' };
}

// =============================================================================
// Login
// =============================================================================

/**
 * Performs a full login flow on `page` using the provided credentials.
 *
 * Navigates to the login page, fills the email and password fields, submits,
 * then waits for a redirect away from the login page to confirm success.
 *
 * @throws {DownloaderError} If login fails or the page doesn't redirect.
 */
export async function login(
    page: Page,
    credentials: Pick<Credentials, 'email' | 'password'>,
    config: DownloaderConfig,
    logger: Logger
): Promise<void> {
    logger.info('Logging in to TailwindPlus...');

    await page.goto(config.urls.login, { waitUntil: 'domcontentloaded' });

    try {
        await page.fill('input[name="email"]', credentials.email);
        await page.fill('input[name="password"]', credentials.password);
        await page.click('button[type="submit"]');

        // Wait until we navigate away from the login page
        await page.waitForURL(url => !url.toString().includes('/login'), {
            timeout: config.timeout,
        });

        if (page.url().includes('/login')) {
            throw new DownloaderError('Login failed: still on login page after submit');
        }

        logger.info('Login successful');
    } catch (error) {
        if (error instanceof DownloaderError) throw error;
        const msg = error instanceof Error ? error.message : String(error);
        throw new DownloaderError(`Login failed: ${msg}`);
    }
}

/**
 * Ensures there is a valid authenticated session on `context`.
 *
 * 1. Validates the existing session (from loaded cookies).
 * 2. If invalid, resolves credentials and performs login.
 * 3. Saves the new session for future runs.
 */
export async function ensureAuthenticated(
    page: Page,
    context: BrowserContext,
    config: DownloaderConfig,
    logger: Logger
): Promise<void> {
    const isValid = await validateSession(page, config, logger);
    if (isValid) {
        logger.info('Using existing session');
        return;
    }

    const credentials = await resolveCredentials(config.credentials, logger);
    await login(page, credentials, config, logger);
    await saveSession(context, config.session, logger);
}

// =============================================================================
// Output path helpers
// =============================================================================

/** Returns true if the given path already exists on disk. */
export function outputExists(outputPath: string): boolean {
    return fs.existsSync(outputPath);
}

/**
 * Ensures that the parent directory of `outputPath` exists, creating it if needed.
 */
export function ensureOutputDirectory(outputPath: string): void {
    const dir = path.dirname(outputPath);
    if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
