interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class AsyncTtlCache {
  private readonly values = new Map<string, CacheEntry<unknown>>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private generation = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 256,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      throw new Error("maxEntries must be a positive integer");
    }
  }

  /**
   * Drop all entries after an external write changes their source. In-flight
   * requests are allowed to finish for the caller that started them, but their
   * result must not be reused by a read that starts after this invalidation.
   */
  clear(): void {
    this.values.clear();
    this.generation += 1;
    this.pending.clear();
  }

  async get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key);
    if (cached && cached.expiresAt > this.now()) {
      this.values.delete(key);
      this.values.set(key, cached);
      return cached.value as T;
    }
    if (cached) this.values.delete(key);

    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight as Promise<T>;
    if (this.pending.size >= this.maxEntries) {
      throw new Error("cache request capacity exceeded");
    }

    const generation = this.generation;
    const promise = load().then((value) => {
      if (this.generation !== generation) return value;
      while (this.values.size >= this.maxEntries) {
        const oldest = this.values.keys().next().value;
        if (oldest === undefined) break;
        this.values.delete(oldest);
      }
      this.values.set(key, { value, expiresAt: this.now() + ttlMs });
      return value;
    }).finally(() => {
      if (this.generation === generation) this.pending.delete(key);
    });
    this.pending.set(key, promise);
    return promise;
  }
}
