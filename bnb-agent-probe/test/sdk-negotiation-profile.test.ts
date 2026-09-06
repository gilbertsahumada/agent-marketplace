import { describe, expect, it, vi } from "vitest";
import { discoverNegotiationInput } from "../src/lib/seller-client";
import { buildContractRequest } from "../../src/shared/negotiation-input";

const skill = { id: "negotiate-erc8183-job", description: 'Send task_description and terms to receive negotiation_hash and provider_sig.' };
const card = { url: "https://seller.example.com/a2a", protocolVersion: "0.3.0", skills: [skill] };
const input = (value: unknown) => ({ endpoint: "https://seller.example.com", transport: "a2a", request: {}, timeoutMs: 5000, maxResponseBytes: 32768, fetch: vi.fn(async () => Response.json(value)) });
describe("SDK profile discovery", () => {
  it("renders the documented SDK A2A contract without our extension, without a quote call", async () => {
    const request = input(card);
    const contract = await discoverNegotiationInput(request);
    expect(contract.provenance).toMatchObject({ profile: "bnb-sdk-v1", source: "a2a-declaration", detectorVersion: 2 });
    expect(buildContractRequest(contract, { task_description: "Summarize BNB news", terms: { deliverables: "Summary", quality_standards: "Cite sources" } }))
      .toEqual({ task_description: "Summarize BNB news", terms: { deliverables: "Summary", quality_standards: "Cite sources" } });
    expect(request.fetch).toHaveBeenCalledOnce();
    expect(contract.capabilityProbeParameters).toBeUndefined();
  });
  it.each([
    { ...card, skills: [{ id: "negotiate" }] },
    { ...card, skills: [{ id: "negotiate-erc8183-job", description: "Custom negotiation" }] },
    { ...card, url: "http://localhost:9000" },
    { ...card, capabilities: { extensions: [{ uri: "https://seller.example.com/task-input-schema/v1", params: {} }] } },
    { ...card, skills: [{ id: "negotiate-erc8183-job" }, { ...skill, id: "negotiate" }] },
  ])("does not infer a contract from a name or unsafe card", async value => {
    await expect(discoverNegotiationInput(input(value))).rejects.toThrow();
  });
  it("does not fall back when an explicit seller contract is invalid", async () => {
    await expect(discoverNegotiationInput(input({ ...card, capabilities: { extensions: [{ uri: "https://marketplace.trust8004.xyz/extensions/negotiation-input/v1", params: {} }] } }))).rejects.toThrow();
  });
});
