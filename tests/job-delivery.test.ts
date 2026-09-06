import { describe, expect, it } from "vitest";
import { DeliverableManifest } from "@bnbagent/sdk/erc8183";
import { verifyDelivery, closureState } from "../src/mainnet/job-delivery";
import { ERC8183_MAINNET as pins } from "../src/mainnet/contracts";
const contracts = { commerce: pins.commerce, router: pins.router, policy: pins.policy };
const manifest = new DeliverableManifest({ version: 1, jobId: 56719, chainId: 56, contracts, response: { content: "<script>untrusted</script>", contentType: "text/plain" }, metadata: {} });
const binding = { jobId: "56719", hash: manifest.manifestHash(), policy: pins.policy };
describe("external job delivery integrity", () => {
  it("verifies the exact SDK manifest without claiming quality", () => {
    expect(verifyDelivery(manifest.toDict(), binding)).toMatchObject({ status: "verified", content: "<script>untrusted</script>" });
  });
  it("rejects modified content", () => {
    expect(verifyDelivery({ ...manifest.toDict(), response: { content: "changed" } }, binding).status).toBe("mismatch");
  });
  it.each([{ job_id: 1 }, { chain_id: 97 }, { contracts: { ...contracts, commerce: pins.token } }])("rejects wrong job/network/contract binding %j", (change) => {
    expect(verifyDelivery({ ...manifest.toDict(), ...change }, binding).status).toBe("mismatch");
  });
  it("does not invent missing bindings in a legacy response", () => {
    expect(verifyDelivery({ version: 1, job_id: 56719, response: { content: "legacy" } }, binding)).toMatchObject({ status: "unsupported", content: "legacy" });
  });
  it("rejects non-string and oversized output", () => {
    expect(verifyDelivery({ ...manifest.toDict(), response: { content: {} } }, binding).status).toBe("unsupported");
    expect(verifyDelivery({ ...manifest.toDict(), response: { content: "x".repeat(33000) } }, binding).content).toBeNull();
  });
});
describe("closure is not elapsed time alone", () => {
  it("requires a chain completion, even after the window", () => {
    expect(closureState("SUBMITTED", false, 1, 100, 200)).toBe("settlement_available");
    expect(closureState("SUBMITTED", false, 0, 100, 200)).toBe("awaiting_policy");
    expect(closureState("COMPLETED", false, 1, 100, 200)).toBe("completed");
  });
  it("keeps disputed and review states separate", () => {
    expect(closureState("SUBMITTED", true, 0, 100, 200)).toBe("disputed");
    expect(closureState("SUBMITTED", false, 0, 300, 200)).toBe("review_window");
  });
});
