/**
 * ReflectingArray — an iterable that alternates direction on each traversal.
 *
 * Used by the format generator to minimise the number of format-change requests
 * to the TailwindPlus server. By alternating forward and reverse iteration,
 * successive format combinations differ by only one dimension at a time
 * (similar to Gray code), reducing redundant setting changes.
 *
 * Example with [a, b, c]:
 *   1st iteration: a → b → c
 *   2nd iteration: c → b → a
 *   3rd iteration: a → b → c
 */

export class ReflectingArray<T> implements Iterable<T> {
  private readonly _items: T[];
  private _direction: 1 | -1 = 1;

  constructor(...items: T[]) {
    this._items = items;
  }

  *[Symbol.iterator](): Generator<T> {
    if (this._direction === 1) {
      yield* this._items;
    } else {
      for (let i = this._items.length - 1; i >= 0; i--) {
        // Safe: bounds are controlled by the loop
        yield this._items[i] as T;
      }
    }
    // Flip direction for the next traversal
    this._direction = this._direction === 1 ? -1 : 1;
  }
}
