// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SellerParameters, initialSellerParameters } from "../components/marketplace/seller-parameters";
import { sdkNegotiationProfile } from "../src/shared/negotiation-profiles";
afterEach(cleanup);
it("renders exactly three buyer fields with no made-up values or technical settings", () => {
  const contract = sdkNegotiationProfile();
  render(<SellerParameters schema={contract.inputSchema} value={initialSellerParameters(contract.inputSchema)} onChange={() => {}} />);
  expect(screen.getAllByRole("textbox")).toHaveLength(3);
  for (const label of ["What do you need?", "Expected deliverable", "Acceptance criteria"]) {
    expect(screen.getByRole("textbox", { name: `${label} *` })).toHaveValue("");
  }
});
