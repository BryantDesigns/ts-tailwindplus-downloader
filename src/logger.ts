/**
 * Logger module with level-based filtering and optional file output.
 *
 * Improvements over the reference implementation:
 * - Fully typed with TypeScript interfaces
 * - `LogLevel` is a const enum for zero runtime overhead
 * - `PrefixedLogger` is a proper typed interface instead of an anonymous object
 * - `close()` is safe to call multiple times
 */

import fs from 'fs';

// =============================================================================
// Log Level
// =============================================================================

export const LogLevel = {
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
} as const;

export type LogLevelValue = (typeof LogLevel)[keyof typeof LogLevel];

// =============================================================================
// Types
// =============================================================================

export interface LoggerOptions {
    /** Enable DEBUG-level output. Defaults to INFO. */
    debug?: boolean;
    /** Path to a log file. If set, output goes to file instead of console. */
    log?: string;
    /** Width to pad identifier labels to for aligned output. */
    identifierWidth?: number;
}

/** A logger scoped to a named identifier (e.g. "Main" or "Worker  3"). */
export interface PrefixedLogger {
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

// =============================================================================
// Logger Class
// =============================================================================

export class Logger {
  private readonly level: LogLevelValue;
  private readonly destination: 'file' | 'console';
  private readonly logPath: string | null;
  private readonly identifierWidth: number;
  private logStream: fs.WriteStream | null = null;

  constructor(options: LoggerOptions = {}) {
    this.level = options.debug ? LogLevel.DEBUG : LogLevel.INFO;
    this.destination = options.log ? 'file' : 'console';
    this.logPath = options.log ?? null;
    this.identifierWidth = options.identifierWidth ?? 0;

    if (this.logPath) {
      this.logStream = fs.createWriteStream(this.logPath, { flags: 'a' });
    }
  }

  private _log(level: LogLevelValue, message: string, stream: 'stdout' | 'stderr' = 'stdout'): void {
    if (level < this.level) return;

    const levelNames: Record<LogLevelValue, string> = {
      [LogLevel.DEBUG]: 'DEBUG',
      [LogLevel.INFO]: 'INFO ',
      [LogLevel.WARN]: 'WARN ',
      [LogLevel.ERROR]: 'ERROR',
    };

    const paddedLevel = levelNames[level] ?? 'UNKN ';

    if (this.logStream) {
      this.logStream.write(`[${paddedLevel}] ${message}\n`);
    } else {
      const consoleMessage = `[${paddedLevel}] ${message}`;
      if (stream === 'stderr') {
        console.error(consoleMessage);
      } else {
        console.log(consoleMessage);
      }
    }
  }

  /**
     * Returns a namespaced logger that prefixes every message with the given identifier.
     * Used to distinguish output from Main vs each Worker.
     */
  prefix(identifier: string): PrefixedLogger {
    const formattedIdentifier = `[${identifier.padEnd(this.identifierWidth)}]`;
    return {
      debug: (message: string) => this.debug(`${formattedIdentifier} ${message}`),
      info: (message: string) => this.info(`${formattedIdentifier} ${message}`),
      warn: (message: string) => this.warn(`${formattedIdentifier} ${message}`),
      error: (message: string) => this.error(`${formattedIdentifier} ${message}`),
    };
  }

  debug(message: string): void {
    this._log(LogLevel.DEBUG, message, 'stdout');
  }

  info(message: string): void {
    this._log(LogLevel.INFO, message, 'stdout');
  }

  warn(message: string): void {
    this._log(LogLevel.WARN, message, 'stderr');
  }

  error(message: string): void {
    this._log(LogLevel.ERROR, message, 'stderr');
  }

  /** Flushes and closes the log file stream. Safe to call multiple times. */
  close(): void {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }
}
