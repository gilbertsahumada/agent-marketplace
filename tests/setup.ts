class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    return this.items.get(String(key)) ?? null;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(String(key));
  }

  setItem(key: string, value: string): void {
    this.items.set(String(key), String(value));
  }
}

const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
if (localStorageDescriptor === undefined || localStorageDescriptor.value === undefined) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
}
