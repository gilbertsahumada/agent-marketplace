import { expect, it } from "vitest";
import { compatibilityMessage } from "../src/shared/compatibility-message";

it("distinguishes missing requirements from unsupported requirements", () => {
  expect(compatibilityMessage("NEGOTIATION_PARAMETERS_UNAVAILABLE")).toEqual({
    title: "Quote requirements not published",
    detail: "The provider has not published the inputs needed to request a quote here. The provider needs to add them; you do not need to change your request or connect a wallet.",
  });
  expect(compatibilityMessage("NEGOTIATION_SCHEMA_UNSUPPORTED").title).toBe("Quote requirements not supported");
  expect(compatibilityMessage("NEGOTIATION_SCHEMA_UNSUPPORTED").detail).toContain("missing, incomplete or in a format");
});
it("explains temporary failures without blaming the buyer", () => {
  expect(compatibilityMessage("SELLER_TIMEOUT").detail).toContain("Try again later");
  expect(compatibilityMessage("SELLER_RATE_LIMITED").detail).toContain("Try again later");
});
it("never reflects unknown provider content", () => {
  expect(JSON.stringify(compatibilityMessage("<script>private error</script>"))).not.toContain("private error");
});
