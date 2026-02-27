/**
 * Custom error classes for the TailwindPlus Downloader.
 *
 * Using a custom error class allows callers to distinguish between
 * expected operational errors (user-facing messages) and unexpected
 * programming errors (bugs), making error handling explicit and typed.
 */

/**
 * Represents a known, recoverable operational error.
 *
 * Thrown when a user-facing condition prevents the download from completing —
 * such as failed authentication, missing files, navigation timeouts, or
 * invalid configuration. The `main()` entry point catches this and exits
 * gracefully with a user-readable message instead of a stack trace.
 */
export class DownloaderError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DownloaderError';

        // Maintains proper prototype chain in transpiled ES5
        Object.setPrototypeOf(this, DownloaderError.prototype);
    }
}
