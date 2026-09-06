import { describe, expect, it } from "vitest";
import { CONCIERGE_HANDOFF_TTL_MS, handoffKey, saveConciergeHandoff, takeConciergeHandoff } from "@/components/marketplace/concierge-handoff";
import type { ConciergeBrief } from "@/src/business/entities/concierge";

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

const validBrief: ConciergeBrief = {
  objective: "Test objective",
  deliverable: "Test deliverable",
  acceptanceCriteria: "Test criteria",
};

describe("concierge-handoff", () => {
  describe("handoffKey", () => {
    it("returns prefixed agent ID", () => {
      expect(handoffKey("303779")).toBe("concierge:303779");
    });
  });

  describe("saveConciergeHandoff and takeConciergeHandoff", () => {
    it("saves and retrieves a valid handoff", () => {
      const storage = new MemoryStorage();
      const now = 1000;

      saveConciergeHandoff(
        storage,
        {
          agentId: "303779",
          contractHash: "a".repeat(64),
          parameters: { pair: "BNB/USDT", capital: 1000 },
          brief: validBrief,
        },
        () => now
      );

      const handoff = takeConciergeHandoff(storage, "303779", () => now + 1000);
      expect(handoff).toEqual({
        schemaVersion: 1,
        agentId: "303779",
        contractHash: "a".repeat(64),
        parameters: { pair: "BNB/USDT", capital: 1000 },
        brief: validBrief,
        savedAt: now,
      });
    });

    it("removes key after successful take", () => {
      const storage = new MemoryStorage();
      const now = 1000;

      saveConciergeHandoff(
        storage,
        {
          agentId: "303779",
          contractHash: "a".repeat(64),
          parameters: {},
          brief: null,
        },
        () => now
      );

      expect(storage.getItem(handoffKey("303779"))).not.toBeNull();
      takeConciergeHandoff(storage, "303779", () => now + 1000);
      expect(storage.getItem(handoffKey("303779"))).toBeNull();
    });

    it("returns null when TTL has expired and removes key", () => {
      const storage = new MemoryStorage();
      const now = 1000;

      saveConciergeHandoff(
        storage,
        {
          agentId: "303779",
          contractHash: "a".repeat(64),
          parameters: {},
          brief: null,
        },
        () => now
      );

      // Check at savedAt + TTL exactly (expired).
      const result = takeConciergeHandoff(storage, "303779", () => now + CONCIERGE_HANDOFF_TTL_MS);
      expect(result).toBeNull();
      expect(storage.getItem(handoffKey("303779"))).toBeNull();
    });

    it("returns null when TTL has expired (just past)", () => {
      const storage = new MemoryStorage();
      const now = 1000;

      saveConciergeHandoff(
        storage,
        {
          agentId: "303779",
          contractHash: "a".repeat(64),
          parameters: {},
          brief: null,
        },
        () => now
      );

      // Check past TTL.
      const result = takeConciergeHandoff(storage, "303779", () => now + CONCIERGE_HANDOFF_TTL_MS + 1);
      expect(result).toBeNull();
      expect(storage.getItem(handoffKey("303779"))).toBeNull();
    });

    it("returns null for malformed JSON and removes key", () => {
      const storage = new MemoryStorage();
      storage.setItem(handoffKey("303779"), "not valid json");

      const result = takeConciergeHandoff(storage, "303779");
      expect(result).toBeNull();
      expect(storage.getItem(handoffKey("303779"))).toBeNull();
    });

    it("returns null when agentId does not match", () => {
      const storage = new MemoryStorage();
      const now = 1000;

      saveConciergeHandoff(
        storage,
        {
          agentId: "303779",
          contractHash: "a".repeat(64),
          parameters: {},
          brief: null,
        },
        () => now
      );

      const result = takeConciergeHandoff(storage, "999999", () => now + 1000);
      expect(result).toBeNull();
      // Original handoff remains since we looked at a different key.
      expect(storage.getItem(handoffKey("303779"))).not.toBeNull();
    });

    it("returns null and removes key when stored agentId does not match", () => {
      const storage = new MemoryStorage();
      const now = 1000;

      storage.setItem(
        handoffKey("303779"),
        JSON.stringify({
          schemaVersion: 1,
          agentId: "999999",
          contractHash: "a".repeat(64),
          parameters: {},
          brief: null,
          savedAt: now,
        })
      );

      const result = takeConciergeHandoff(storage, "303779", () => now + 1000);
      expect(result).toBeNull();
      // Key is removed even though stored agentId does not match.
      expect(storage.getItem(handoffKey("303779"))).toBeNull();
    });

    it("returns null when schemaVersion is not 1", () => {
      const storage = new MemoryStorage();
      const now = 1000;

      storage.setItem(
        handoffKey("303779"),
        JSON.stringify({
          schemaVersion: 2,
          agentId: "303779",
          contractHash: "a".repeat(64),
          parameters: {},
          brief: null,
          savedAt: now,
        })
      );

      const result = takeConciergeHandoff(storage, "303779", () => now + 1000);
      expect(result).toBeNull();
      expect(storage.getItem(handoffKey("303779"))).toBeNull();
    });

    it("returns null when contractHash is not 64-hex", () => {
      const storage = new MemoryStorage();
      const now = 1000;

      storage.setItem(
        handoffKey("303779"),
        JSON.stringify({
          schemaVersion: 1,
          agentId: "303779",
          contractHash: "invalid",
          parameters: {},
          brief: null,
          savedAt: now,
        })
      );

      const result = takeConciergeHandoff(storage, "303779", () => now + 1000);
      expect(result).toBeNull();
      expect(storage.getItem(handoffKey("303779"))).toBeNull();
    });

    it("returns null when contractHash is too short", () => {
      const storage = new MemoryStorage();
      const now = 1000;

      storage.setItem(
        handoffKey("303779"),
        JSON.stringify({
          schemaVersion: 1,
          agentId: "303779",
          contractHash: "a".repeat(63),
          parameters: {},
          brief: null,
          savedAt: now,
        })
      );

      const result = takeConciergeHandoff(storage, "303779", () => now + 1000);
      expect(result).toBeNull();
      expect(storage.getItem(handoffKey("303779"))).toBeNull();
    });

    it("returns null when parameters is not a plain object", () => {
      const storage = new MemoryStorage();
      const now = 1000;

      storage.setItem(
        handoffKey("303779"),
        JSON.stringify({
          schemaVersion: 1,
          agentId: "303779",
          contractHash: "a".repeat(64),
          parameters: "not an object",
          brief: null,
          savedAt: now,
        })
      );

      const result = takeConciergeHandoff(storage, "303779", () => now + 1000);
      expect(result).toBeNull();
      expect(storage.getItem(handoffKey("303779"))).toBeNull();
    });

    it("returns null when brief is invalid (missing field)", () => {
      const storage = new MemoryStorage();
      const now = 1000;

      storage.setItem(
        handoffKey("303779"),
        JSON.stringify({
          schemaVersion: 1,
          agentId: "303779",
          contractHash: "a".repeat(64),
          parameters: {},
          brief: { objective: "Test", deliverable: "Test" },
          savedAt: now,
        })
      );

      const result = takeConciergeHandoff(storage, "303779", () => now + 1000);
      expect(result).toBeNull();
      expect(storage.getItem(handoffKey("303779"))).toBeNull();
    });

    it("returns null when brief has field > 500 chars", () => {
      const storage = new MemoryStorage();
      const now = 1000;

      storage.setItem(
        handoffKey("303779"),
        JSON.stringify({
          schemaVersion: 1,
          agentId: "303779",
          contractHash: "a".repeat(64),
          parameters: {},
          brief: {
            objective: "a".repeat(501),
            deliverable: "Test",
            acceptanceCriteria: "Test",
          },
          savedAt: now,
        })
      );

      const result = takeConciergeHandoff(storage, "303779", () => now + 1000);
      expect(result).toBeNull();
      expect(storage.getItem(handoffKey("303779"))).toBeNull();
    });

    it("returns null when brief field is empty after trim", () => {
      const storage = new MemoryStorage();
      const now = 1000;

      storage.setItem(
        handoffKey("303779"),
        JSON.stringify({
          schemaVersion: 1,
          agentId: "303779",
          contractHash: "a".repeat(64),
          parameters: {},
          brief: {
            objective: "   ",
            deliverable: "Test",
            acceptanceCriteria: "Test",
          },
          savedAt: now,
        })
      );

      const result = takeConciergeHandoff(storage, "303779", () => now + 1000);
      expect(result).toBeNull();
      expect(storage.getItem(handoffKey("303779"))).toBeNull();
    });

    it("accepts null brief", () => {
      const storage = new MemoryStorage();
      const now = 1000;

      saveConciergeHandoff(
        storage,
        {
          agentId: "303779",
          contractHash: "a".repeat(64),
          parameters: {},
          brief: null,
        },
        () => now
      );

      const result = takeConciergeHandoff(storage, "303779", () => now + 1000);
      expect(result).not.toBeNull();
      expect(result?.brief).toBeNull();
    });

    it("does not throw when storage is null on save", () => {
      expect(() => {
        saveConciergeHandoff(null, {
          agentId: "303779",
          contractHash: "a".repeat(64),
          parameters: {},
          brief: null,
        });
      }).not.toThrow();
    });

    it("does not throw when storage is null on take", () => {
      expect(() => {
        takeConciergeHandoff(null, "303779");
      }).not.toThrow();
    });

    it("returns null when storage throws on take", () => {
      const storage = new MemoryStorage();
      const now = 1000;

      saveConciergeHandoff(
        storage,
        {
          agentId: "303779",
          contractHash: "a".repeat(64),
          parameters: {},
          brief: null,
        },
        () => now
      );

      // Mock a throwing storage.
      const throwingStorage = {
        getItem: () => {
          throw new Error("Storage access denied");
        },
        removeItem: () => {
          // noop
        },
      } as any as Storage;

      const result = takeConciergeHandoff(throwingStorage, "303779", () => now + 1000);
      expect(result).toBeNull();
    });

    it("does not throw when storage throws on save", () => {
      const throwingStorage = {
        setItem: () => {
          throw new Error("Quota exceeded");
        },
      } as any as Storage;

      expect(() => {
        saveConciergeHandoff(throwingStorage, {
          agentId: "303779",
          contractHash: "a".repeat(64),
          parameters: {},
          brief: null,
        });
      }).not.toThrow();
    });

    it("does not throw when storage throws on removeItem", () => {
      const throwingStorage = {
        getItem: () => JSON.stringify({
          schemaVersion: 1,
          agentId: "303779",
          contractHash: "a".repeat(64),
          parameters: {},
          brief: null,
          savedAt: 1000,
        }),
        removeItem: () => {
          throw new Error("Remove denied");
        },
      } as any as Storage;

      const result = takeConciergeHandoff(throwingStorage, "303779", () => 2000);
      // Should still return the value and not throw.
      expect(result).not.toBeNull();
    });
  });
});
