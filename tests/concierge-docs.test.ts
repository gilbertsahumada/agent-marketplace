import { describe, expect, it } from "vitest";
import { DOCS_MARKDOWN } from "../app/docs/markdown.ts";

describe("concierge docs", () => {
  const section = DOCS_MARKDOWN.api ?? "";

  it("names the package that exports useChat", () => {
    expect(section).toMatch(/`useChat`[^\n]*`@ai-sdk\/react`/);
    expect(section).not.toMatch(/`useChat` or `readUIMessageStream` from the `ai` package/);
  });
});
