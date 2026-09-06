import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { CONCIERGE_ERROR_COPY, describeConciergeError, projectConciergeMessages } from "../components/marketplace/concierge-request.ts";
import { CONCIERGE_LIMITS, parseConciergeMessages } from "../src/business/entities/concierge.ts";

function text(role: UIMessage["role"], value: string, extraParts: UIMessage["parts"] = []): Pick<UIMessage, "role" | "parts"> {
  return { role, parts: [...extraParts, { type: "text", text: value }] };
}

describe("projectConciergeMessages", () => {
  it("keeps only the text of each turn, dropping tool parts", () => {
    const projected = projectConciergeMessages([
      text("user", "grid please"),
      text("assistant", "Here you go.", [
        { type: "tool-search_agents", toolCallId: "c1", state: "output-available", input: { q: "grid" }, output: { agents: [] } },
      ]),
      text("user", "thanks"),
    ]);

    expect(projected).toEqual([
      { role: "user", content: "grid please" },
      { role: "assistant", content: "Here you go." },
      { role: "user", content: "thanks" },
    ]);
    expect(() => parseConciergeMessages(projected)).not.toThrow();
  });

  it("merges consecutive same-role turns and drops empty ones so the history still alternates", () => {
    const projected = projectConciergeMessages([
      { role: "system", parts: [{ type: "text", text: "ignored" }] },
      { role: "assistant", parts: [{ type: "text", text: "leading assistant turn" }] },
      text("user", "first"),
      { role: "assistant", parts: [] }, // failed turn: nothing came back
      text("user", "second"),
      text("assistant", "answer"),
      text("user", "third"),
    ]);

    expect(projected).toEqual([
      { role: "user", content: "first\n\nsecond" },
      { role: "assistant", content: "answer" },
      { role: "user", content: "third" },
    ]);
    expect(() => parseConciergeMessages(projected)).not.toThrow();
  });

  it("keeps the most recent window and bounds every message", () => {
    const turns: Array<Pick<UIMessage, "role" | "parts">> = [];
    for (let index = 0; index < 20; index += 1) {
      turns.push(text(index % 2 === 0 ? "user" : "assistant", `turn ${index} ${"x".repeat(5_000)}`));
    }
    turns.push(text("user", "latest"));

    const projected = projectConciergeMessages(turns);

    expect(projected.length).toBeLessThanOrEqual(CONCIERGE_LIMITS.messages);
    expect(projected[0]!.role).toBe("user");
    expect(projected[projected.length - 1]).toEqual({ role: "user", content: "latest" });
    for (const message of projected) {
      const limit = message.role === "user" ? CONCIERGE_LIMITS.userChars : CONCIERGE_LIMITS.assistantChars;
      expect(message.content.length).toBeLessThanOrEqual(limit);
    }
    expect(() => parseConciergeMessages(projected)).not.toThrow();
  });
});

describe("describeConciergeError", () => {
  it("maps the marketplace JSON error bodies", () => {
    expect(describeConciergeError(new Error(JSON.stringify({ error: { code: "MarketplaceRateLimitError", message: "x" } })))).toBe(CONCIERGE_ERROR_COPY.busy);
    expect(describeConciergeError(new Error(JSON.stringify({ error: { code: "MarketplaceDataUnavailableError", message: "x" } })))).toBe(CONCIERGE_ERROR_COPY.offline);
    expect(describeConciergeError(new Error(JSON.stringify({ error: { code: "InvalidMarketplaceInputError", message: "x" } })))).toBe(CONCIERGE_ERROR_COPY.generic);
  });

  it("passes through the stream's own error copy and hides anything else", () => {
    expect(describeConciergeError(new Error("This took too long. Try again with a shorter request."))).toBe("This took too long. Try again with a shorter request.");
    expect(describeConciergeError(new Error("The concierge is temporarily at capacity. Try again in a moment."))).toBe("The concierge is temporarily at capacity. Try again in a moment.");
    expect(describeConciergeError(new Error("TypeError: Failed to fetch"))).toBe(CONCIERGE_ERROR_COPY.generic);
    expect(describeConciergeError("nope")).toBe(CONCIERGE_ERROR_COPY.generic);
  });
});

it("keeps the newest user text when merging across a textless assistant turn", () => {
  const messages = [
    { role: "user", parts: [{ type: "text", text: "a".repeat(1_190) }] },
    { role: "assistant", parts: [{ type: "tool-search_agents", toolCallId: "c1", state: "input-available", input: { q: "grid" } }] },
    { role: "user", parts: [{ type: "text", text: "second question" }] },
  ] as const;

  const projected = projectConciergeMessages(messages as never);

  expect(projected.at(-1)!.role).toBe("user");
  expect(projected.at(-1)!.content.endsWith("second question")).toBe(true);
  expect(projected.at(-1)!.content.length).toBeLessThanOrEqual(1_200);
});
