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
// Navigation helpers
// =============================================================================

/**
 * Navigates to `url`, retrying up to `maxRetries` times on TimeoutError.
 * Other errors are thrown immediately.
 */
async function retryGoto(
  page: Page,
  url: string,
  maxRetries: number,
  logger: Logger
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      return;
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'TimeoutError';
      if (!isTimeout) throw error;
      if (attempt === maxRetries) {
        throw new DownloaderError(
          `Navigation to ${url} failed after ${maxRetries} attempts. Please re-run.`
        );
      }
      logger.warn(`Navigation timeout (attempt ${attempt}/${maxRetries}): ${url}`);
    }
  }
}

// =============================================================================
// Session validation
// =============================================================================

/**
 * Validates whether the given page is already in an authenticated state by
 * navigating to the Plus URL and checking page elements.
 *
 * Checks for the absence of a "Sign in" link and presence of an "Account"
 * button, which is far more reliable than URL-based redirect detection.
 */
export async function validateSession(
  page: Page,
  config: DownloaderConfig,
  logger: Logger
): Promise<boolean> {
  logger.debug('Validating session...');

  try {
    await retryGoto(page, config.urls.plus, config.retries.maxRetries, logger);

    const signInLink = page.getByRole('link', { name: 'Sign in' });
    const accountButton = page.getByRole('button', { name: 'Account' });

    const isSignInAbsent = !(await signInLink.isVisible());
    const isAccountPresent = await accountButton.isVisible();

    const isAuthenticated = isSignInAbsent && isAccountPresent;
    logger.debug(`Session validation: ${isAuthenticated ? 'valid' : 'invalid'}`);

    return isAuthenticated;
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
 * Performs login with resilience to React re-renders clearing filled inputs.
 *
 * Uses Promise.race() to detect:
 *   - Successful navigation away from login page
 *   - Bad credentials error message appearing
 *   - Native form validation failure (React re-render clears inputs → retry)
 *
 * Returns 'success' | 'bad_credentials' | 'timeout'
 * @throws {DownloaderError} if the login form is not found
 */
async function resilientLogin(
  page: Page,
  credentials: Pick<Credentials, 'email' | 'password'>,
  config: DownloaderConfig,
  logger: Logger
): Promise<'success' | 'bad_credentials' | 'timeout'> {
  const startTime = Date.now();
  const loginTimeout = config.loginTimeout ?? 15000;
  const outcomeTimeout = 5000;

  const emailInput = page.getByRole('textbox', { name: 'Email' });
  const passwordInput = page.getByRole('textbox', { name: 'Password' });
  const submitButton = page.getByRole('button', { name: 'Sign in to account' });

  while (Date.now() - startTime < loginTimeout) {
    await emailInput.fill(credentials.email);
    await passwordInput.fill(credentials.password);

    // Outcome 1: Successful navigation away from login page
    const navigationPromise = page
      .waitForURL((url) => !url.toString().includes('/login'), { timeout: outcomeTimeout })
      .then(() => 'success' as const);

    // Outcome 2: Bad credentials error message
    const badCredentialsPromise = page
      .getByText('These credentials do not match our records')
      .waitFor({ state: 'visible', timeout: outcomeTimeout })
      .then(() => 'bad_credentials' as const);

    // Outcome 3: Native HTML5 form validation failure (React re-render cleared inputs)
    const validationFailedPromise = page
      .evaluate((selector: string) => {
        return new Promise<'validation_failed' | 'form_not_found'>((resolve) => {
          const form = document.querySelector(selector);
          if (!form) return resolve('form_not_found');
          const requiredInputs = form.querySelectorAll<HTMLInputElement>('[required]');
          if (requiredInputs.length === 0) return;
          requiredInputs.forEach((input) => {
            input.addEventListener(
              'invalid',
              (e) => {
                e.preventDefault();
                resolve('validation_failed');
              },
              { once: true }
            );
          });
        });
      }, 'form')
      .catch((error: Error) => {
        if (error.message.includes('Execution context was destroyed')) {
          return 'context_destroyed_by_navigation' as const;
        }
        throw error;
      });

    await submitButton.click();

    const winner = await Promise.race([
      navigationPromise,
      badCredentialsPromise,
      validationFailedPromise,
    ]).catch((error: Error) => {
      if (error.name === 'TimeoutError') return 'timeout' as const;
      throw error;
    });

    if (winner === 'form_not_found') {
      throw new DownloaderError('Login failed: could not find the login form on the page.');
    }
    if (winner === 'bad_credentials') {
      return 'bad_credentials';
    }
    if (winner === 'success' || winner === 'context_destroyed_by_navigation') {
      return 'success';
    }

    // validation_failed or timeout on individual outcome → wait briefly and retry fill
    logger.debug(`Login attempt: ${winner}, retrying fill...`);
    await page.waitForTimeout(100);
  }

  return 'timeout';
}

/**
 * Performs login, prompting for new credentials if they are wrong.
 * Navigates to the login page before each attempt to clear any error state.
 *
 * @throws {DownloaderError} If login fails or the user aborts.
 */
export async function login(
  page: Page,
  initialCredentials: Pick<Credentials, 'email' | 'password'>,
  config: DownloaderConfig,
  logger: Logger
): Promise<void> {
  logger.info('Logging in to TailwindPlus...');
  let credentials = initialCredentials;

  while (true) {
    await retryGoto(page, config.urls.login, config.retries.maxRetries, logger);

    const result = await resilientLogin(page, credentials, config, logger);

    if (result === 'success') {
      logger.info('Login successful');
      return;
    }

    if (result === 'bad_credentials') {
      logger.error('Login failed: bad credentials.');
      if (!process.stdin.isTTY) {
        throw new DownloaderError(
          'Login failed: bad credentials. Cannot prompt in non-interactive mode.'
        );
      }
      const answer = (await read({ prompt: 'Try again with new credentials? [Y/n]: ' })).toLowerCase();
      if (answer === 'n' || answer === 'no') {
        throw new DownloaderError('User aborted after failed login attempt.');
      }
      credentials = await promptCredentials();
      continue;
    }

    // result === 'timeout'
    throw new DownloaderError('Login failed: timed out waiting for login to complete.');
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
