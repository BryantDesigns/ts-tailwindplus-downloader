/**
 * Format value object representing a component format combination.
 *
 * A Format is the combination of framework (html/react/vue), Tailwind version
 * (3/4), and theme mode (system/light/dark/null for eCommerce). It is immutable
 * and can be compared by string value.
 *
 * Improvements over the reference:
 * - Typed constructor overloads replaced by a single typed options object
 * - `equals()` uses strict equality check (`===`) typed properly
 * - Frozen via Object.freeze() after construction for immutability guarantee
 */

// =============================================================================
// Types
// =============================================================================

export interface FormatOptions {
    framework: string;
    version: number;
    mode: string | null;
}

// =============================================================================
// Format Class
// =============================================================================

export class Format {
  readonly framework: string;
  readonly version: number;
  readonly mode: string | null;

  private readonly _stringValue: string;

  constructor(options: FormatOptions) {
    this.framework = options.framework;
    this.version = options.version;
    this.mode = options.mode;

    // String representation: "react-v4-light" or "html-v3" (eCommerce has no mode)
    this._stringValue =
            this.mode === null
              ? `${this.framework}-v${this.version}`
              : `${this.framework}-v${this.version}-${this.mode}`;

    Object.freeze(this);
  }

  /** Returns the string key for comparison and display. */
  valueOf(): string {
    return this._stringValue;
  }

  toString(): string {
    return this._stringValue;
  }

  /** Strict equality check against another Format instance. */
  equals(other: Format): boolean {
    return other instanceof Format && this._stringValue === other._stringValue;
  }
}
