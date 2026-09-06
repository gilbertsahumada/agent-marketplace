import { expect, it } from "vitest";
import { quoteProvider } from "../src/shared/quote-provider";
const provider = "0x1111111111111111111111111111111111111111";
it("uses trusted identity when optional provider metadata is absent", () => {
  expect(quoteProvider(undefined, provider)).toBe(provider);
  expect(quoteProvider(provider, provider)).toBe(provider);
});
it.each([null, "", 1, "0x2222222222222222222222222222222222222222"])("rejects invalid or mismatching explicit metadata %s", metadata => {
  expect(() => quoteProvider(metadata, provider)).toThrow();
});
