import { describe, expect, it } from "vitest";
import { extractA2aEndpoint } from "../src/identity.ts";

describe("ERC-8004 endpoint extraction", () => {
  it("requires exactly one HTTPS A2A endpoint", () => {
    expect(
      extractA2aEndpoint({
        services: [{ name: "A2A", endpoint: "https://seller.example/a2a" }],
      }),
    ).toBe("https://seller.example/a2a");
    expect(() => extractA2aEndpoint({ services: [] })).toThrow(/exactly one/);
    expect(() =>
      extractA2aEndpoint({
        services: [{ name: "A2A", endpoint: "http://seller.example/a2a" }],
      }),
    ).toThrow(/HTTPS/);
  });
});
