import { expect, it } from "vitest";
import { assertClosureAllowed, type ClosureFacts } from "../src/business/use-cases/close-hire-job";
const binding = { chainId: 97, commerce: "commerce", wallet: "buyer", jobId: "1066", action: "refund" as const };
const facts: ClosureFacts = { supported: true, status: "FUNDED", buyer: "buyer", disputed: false, verdict: 0, now: 201n, deadline: 200n, reviewEndsAt: 0n };
it("allows the expired funded buyer refund", () => expect(() => assertClosureAllowed(binding, facts)).not.toThrow());
it.each([{ now: 200n }, { now: 199n }, { buyer: "other" }, { status: "SUBMITTED" }, { status: "EXPIRED" }, { supported: false }])("rejects unsafe refund %#", change => {
  expect(() => assertClosureAllowed(binding, { ...facts, ...change })).toThrow();
});
it("does not enable Mainnet refunds", () => expect(() => assertClosureAllowed({ ...binding, chainId: 56 }, facts)).toThrow(/Testnet/));
