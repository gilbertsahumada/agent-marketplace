import { describe, expect, it } from "vitest";
import {
  BANNED_COPY,
  CONCIERGE_LIMITS,
  parseConciergeBrief,
  parseConciergeMessages,
} from "../src/business/entities/concierge.ts";
import { InvalidMarketplaceInputError } from "../src/business/errors/marketplace-errors.ts";

function messages(overrides: unknown[] = []): unknown[] {
  return overrides.length > 0 ? overrides : [{ role: "user", content: "I need a grid trading agent" }];
}

function brief(overrides: Record<string, unknown> = {}) {
  return {
    objective: "Rebalance my BNB/USDT position",
    deliverable: "A running grid strategy",
    acceptanceCriteria: "Orders placed within the configured range",
    ...overrides,
  };
}

describe("parseConciergeMessages", () => {
  it("accepts a single trailing user message", () => {
    expect(parseConciergeMessages(messages())).toEqual([{ role: "user", content: "I need a grid trading agent" }]);
  });

  it("accepts an alternating conversation that ends on user", () => {
    const value = [
      { role: "user", content: "I need a grid trading agent" },
      { role: "assistant", content: "What pair do you want to trade?" },
      { role: "user", content: "BNB/USDT" },
    ];
    expect(parseConciergeMessages(value)).toEqual(value);
  });

  it("rejects more than 12 messages", () => {
    const value = Array.from({ length: 13 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: index % 2 === 0 ? "hi" : "hello",
    }));
    expect(() => parseConciergeMessages(value)).toThrow(InvalidMarketplaceInputError);
    expect(() => parseConciergeMessages(value)).toThrow("Concierge messages are invalid");
  });

  it("rejects an empty array", () => {
    expect(() => parseConciergeMessages([])).toThrow("Concierge messages are invalid");
  });

  it("rejects a conversation whose last message is not from the user", () => {
    const value = [
      { role: "user", content: "I need a grid trading agent" },
      { role: "assistant", content: "What pair do you want to trade?" },
    ];
    expect(() => parseConciergeMessages(value)).toThrow("Concierge messages are invalid");
  });

  it("rejects roles that do not alternate starting with user", () => {
    expect(() => parseConciergeMessages([
      { role: "assistant", content: "hello" },
    ])).toThrow("Concierge messages are invalid");
    expect(() => parseConciergeMessages([
      { role: "user", content: "hi" },
      { role: "user", content: "hi again" },
    ])).toThrow("Concierge messages are invalid");
  });

  it("rejects empty or overlong content per role", () => {
    expect(() => parseConciergeMessages([{ role: "user", content: "   " }])).toThrow("Concierge messages are invalid");
    expect(() => parseConciergeMessages([{ role: "user", content: "a".repeat(CONCIERGE_LIMITS.userChars + 1) }]))
      .toThrow("Concierge messages are invalid");
    expect(() => parseConciergeMessages([
      { role: "user", content: "hi" },
      { role: "assistant", content: "a".repeat(CONCIERGE_LIMITS.assistantChars + 1) },
      { role: "user", content: "ok" },
    ])).toThrow("Concierge messages are invalid");
    // At the exact limit is still valid.
    expect(parseConciergeMessages([{ role: "user", content: "a".repeat(CONCIERGE_LIMITS.userChars) }])).toHaveLength(1);
  });

  it("rejects messages with extra or missing keys", () => {
    expect(() => parseConciergeMessages([{ role: "user", content: "hi", extra: true }])).toThrow("Concierge messages are invalid");
    expect(() => parseConciergeMessages([{ role: "user" }])).toThrow("Concierge messages are invalid");
    expect(() => parseConciergeMessages([{ content: "hi" }])).toThrow("Concierge messages are invalid");
  });

  it("rejects an unknown role value", () => {
    expect(() => parseConciergeMessages([{ role: "system", content: "hi" }])).toThrow("Concierge messages are invalid");
  });

  it("rejects a non-array value", () => {
    expect(() => parseConciergeMessages({ role: "user", content: "hi" })).toThrow("Concierge messages are invalid");
    expect(() => parseConciergeMessages("hi")).toThrow("Concierge messages are invalid");
    expect(() => parseConciergeMessages(null)).toThrow("Concierge messages are invalid");
    expect(() => parseConciergeMessages(undefined)).toThrow("Concierge messages are invalid");
  });
});

describe("parseConciergeBrief", () => {
  it("returns the brief when all three fields are valid", () => {
    expect(parseConciergeBrief(brief())).toEqual(brief());
  });

  it("returns null when a key is missing", () => {
    const { objective: _objective, ...rest } = brief();
    expect(parseConciergeBrief(rest)).toBeNull();
  });

  it("returns null when a key is extra", () => {
    expect(parseConciergeBrief({ ...brief(), extra: "nope" })).toBeNull();
  });

  it("returns null when a field exceeds 500 characters", () => {
    expect(parseConciergeBrief(brief({ objective: "a".repeat(501) }))).toBeNull();
    expect(parseConciergeBrief(brief({ objective: "a".repeat(500) }))).not.toBeNull();
  });

  it("returns null when a field is not a string", () => {
    expect(parseConciergeBrief(brief({ deliverable: 42 }))).toBeNull();
  });

  it("returns null when a field is empty after trimming", () => {
    expect(parseConciergeBrief(brief({ acceptanceCriteria: "   " }))).toBeNull();
  });

  it("returns null for non-object input instead of throwing", () => {
    expect(parseConciergeBrief(null)).toBeNull();
    expect(parseConciergeBrief("brief")).toBeNull();
    expect(parseConciergeBrief([brief()])).toBeNull();
  });
});

describe("BANNED_COPY", () => {
  it("matches the banned words case-insensitively as whole words", () => {
    expect(BANNED_COPY.test("This agent is proven to work")).toBe(true);
    expect(BANNED_COPY.test("PROVEN results")).toBe(true);
    expect(BANNED_COPY.test("a solid track record")).toBe(true);
    expect(BANNED_COPY.test("we guarantee delivery")).toBe(true);
    expect(BANNED_COPY.test("guaranteed delivery")).toBe(true);
    expect(BANNED_COPY.test("guarantees delivery")).toBe(true);
    expect(BANNED_COPY.test("as applied here")).toBe(true);
  });

  it("does not match unrelated copy", () => {
    expect(BANNED_COPY.test("Here is what I found based on indexed activity.")).toBe(false);
    expect(BANNED_COPY.test("approved and provenance")).toBe(false);
  });
});
