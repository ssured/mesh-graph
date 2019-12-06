export function generateId(): string {
  return Math.random()
    .toString(36)
    .substr(2);
}

let lastMainState = '';
let lastSubState = 0;
const RADIX = 36;
export function getCurrentState(): string {
  let state = Date.now().toString(RADIX);
  if (state === lastMainState) {
    let subState = (lastSubState++).toString(RADIX - 1);
    state +=
      `.` +
      (subState.length > 1
        ? (RADIX - 1).toString(RADIX).repeat(subState.length - 1)
        : '') +
      subState;
  } else {
    lastSubState = 0;
  }
  return state;
}

export class LRUSet {
  private static createCache(): Record<string, true> {
    return Object.create(null);
  }

  private cache = LRUSet.createCache();
  private _cache = LRUSet.createCache();
  private size = 0;

  constructor(public maxSize: number) {
    if (!(maxSize > 0)) {
      throw new TypeError('`maxSize` must be a number greater than 0');
    }
  }

  public has(value: string): boolean {
    return this.cache[value] || this._cache[value] || false;
  }

  public add(value: string): void {
    if (this.cache[value]) return;

    this.cache[value] = true;
    this.size++;

    if (this.size >= this.maxSize) {
      this.size = 0;
      this._cache = this.cache;
      this.cache = LRUSet.createCache();
    }
  }
}
