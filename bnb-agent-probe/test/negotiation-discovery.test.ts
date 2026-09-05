import { describe, expect, it, vi } from "vitest";
import { discoverNegotiationInput } from "../src/lib/seller-client";
import { NEGOTIATION_INPUT_EXTENSION, buildContractRequest } from "../../src/shared/negotiation-input";

const contract = { taskDescriptionPrefix: "SERVICE_V1:", inputSchema: { type: "object", required: ["topic"], properties: { topic: { type: "string", minLength: 1 } } }, terms: {
  deliverables: "Report", quality_standards: "Cited", evaluation_required: true, evaluator_type: "uma_oov3",
} };
const response = (value: unknown) => Response.json(value);
describe("negotiation discovery", () => {
  it("discovers a compatible MCP request schema without calling its tool", async () => {
    const terms = contract.terms;
    const fetch = vi.fn(async (_url, init) => {
      const rpc = JSON.parse(init.body);
      return response({ jsonrpc: "2.0", id: rpc.id, result: rpc.method === "initialize" ? {} : { tools: [{
        name: "request_quote", inputSchema: { type: "object", required: ["task_description", "terms"], properties: {
          task_description: { type: "string" }, terms: { type: "object", required: Object.keys(terms), properties: {
            deliverables: { type: "string" }, quality_standards: { type: "string" },
            evaluation_required: { type: "boolean", const: true }, evaluator_type: { type: "string", const: "uma_oov3" },
          } },
        } },
      }] } });
    });
    const discovered = await discoverNegotiationInput({ endpoint: "https://seller.example.com/mcp", transport: "mcp", request: {}, timeoutMs: 5000, maxResponseBytes: 32768, fetch });
    expect(buildContractRequest(discovered, { task_description: "Research", terms })).toEqual({ task_description: "Research", terms });
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body).method)).toEqual(["initialize", "tools/list"]);
  });
  it.each(["a2a", "erc8183_http"])("reads an explicit %s contract without negotiating", async transport => {
    const fetch = vi.fn().mockResolvedValue(response(transport === "a2a"
      ? { url: "https://seller.example.com/a2a", skills: [{ id: "negotiate" }], capabilities: { extensions: [{ uri: NEGOTIATION_INPUT_EXTENSION, params: contract }] } }
      : { negotiationInput: contract }));
    const discovered = await discoverNegotiationInput({ endpoint: "https://seller.example.com/a2a", transport, request: {}, timeoutMs: 5000, maxResponseBytes: 32768, fetch });
    expect(buildContractRequest(discovered, { topic: "Weather" }).task_description).toBe('SERVICE_V1:{"topic":"Weather"}');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.method).toBeUndefined();
  });
  it("does not turn a generic MCP tool into a seller", async () => {
    const fetch = vi.fn(async (_url, init) => {
      const rpc = JSON.parse(init.body);
      return response({ jsonrpc: "2.0", id: rpc.id, result: rpc.method === "initialize" ? {} : { tools: [{ name: "search", inputSchema: {} }] } });
    });
    await expect(discoverNegotiationInput({ endpoint: "https://seller.example.com/mcp", transport: "mcp", request: {}, timeoutMs: 5000, maxResponseBytes: 32768, fetch })).rejects.toThrow("MCP_QUOTE_TOOL_REQUIRED");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not follow redirects or private endpoints", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://127.0.0.1" } }));
    const input = { endpoint: "https://seller.example.com/a2a", transport: "a2a", request: {}, timeoutMs: 5000, maxResponseBytes: 32768, fetch };
    await expect(discoverNegotiationInput(input)).rejects.toThrow("SELLER_REDIRECT");
    await expect(discoverNegotiationInput({ ...input, endpoint: "https://127.0.0.1" })).rejects.toThrow("SELLER_UNSAFE_URL");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
