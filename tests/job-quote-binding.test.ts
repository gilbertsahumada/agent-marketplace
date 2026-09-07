import { expect, it } from "vitest";
import { buildJobDescription } from "@bnbagent/sdk/erc8183";
import { keccak256, toBytes } from "viem";
import { assertJobQuoteBinding } from "../src/business/policies/job-quote-binding";

it("matches SDK signed content including Unicode, nested terms and expired quotes", () => {
  const envelope = {
    request: { task_description: "Revisión café 🚀" },
    response: { accepted: true, terms: { price: "100", currency: `0x${"11".repeat(20)}`, deliverables: "Un análisis", quality_standards: "Exactitud", success_criteria: ["sí", "完成"] } },
    negotiated_at: 100,
    quote_expires_at: 200,
    chain_id: 97,
    verifying_contract: `0x${"22".repeat(20)}`,
  };
  const hash = keccak256(toBytes(buildJobDescription(envelope)));
  const description = buildJobDescription({ ...envelope, negotiation_hash: hash, provider_sig: "0x12" });
  // JSON formatting/order is not part of the signed content.
  const reordered = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(description)).reverse()), null, 2);
  expect(() => assertJobQuoteBinding(reordered, hash.toUpperCase().replace("0X", "0x"))).not.toThrow();
  expect(() => assertJobQuoteBinding(JSON.stringify({ ...JSON.parse(description), price: "101" }), hash)).toThrow(/original verified quote/);
});
it.each(["plain text", "null", "[]", "{}", '{"version":2}', '{"version":1,"negotiation_hash":3}'])("rejects invalid description %s", description => {
  expect(() => assertJobQuoteBinding(description, `0x${"ab".repeat(32)}`)).toThrow(/original verified quote/);
});
