import { describe, expect, it, vi } from "vitest";
import { discoverNegotiationInput, probeMcpSeller } from "../src/lib/seller-client";
import { NEGOTIATION_INPUT_EXTENSION, buildContractRequest } from "../../src/shared/negotiation-input";

const contract = { taskDescriptionPrefix: "SERVICE_V1:", inputSchema: { type: "object", required: ["topic"], properties: { topic: { type: "string", minLength: 1 } } }, terms: {
  deliverables: "Report", quality_standards: "Cited", evaluation_required: true, evaluator_type: "uma_oov3",
} };
const response = (value: unknown) => Response.json(value);
describe("negotiation discovery", () => {
  it.each([[401, "SELLER_ACCESS_DENIED"], [403, "SELLER_ACCESS_DENIED"], [429, "SELLER_RATE_LIMITED"]])("classifies HTTP %s without publishing provider HTML", async (status, code) => {
    const fetch = vi.fn(async () => new Response("private provider error", { status: Number(status) }));
    await expect(discoverNegotiationInput({ endpoint: "https://seller.example.com/health", transport: "erc8183_http", request: {}, timeoutMs: 5000, maxResponseBytes: 32768, fetch })).rejects.toThrow(String(code));
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([undefined, "2024-11-05", "2099-01-01"])("rejects unsupported MCP negotiation version %s before notifications or tools", async protocolVersion => {
    const fetch = vi.fn(async (_url, init) => response({ jsonrpc: "2.0", id: JSON.parse(init.body).id, result: { protocolVersion } }));
    const input = { endpoint: "https://seller.example.com/mcp", transport: "mcp", request: {}, timeoutMs: 5000, maxResponseBytes: 32768, fetch };
    await expect(discoverNegotiationInput(input)).rejects.toThrow("MCP_PROTOCOL_VERSION_UNSUPPORTED");
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockClear();
    await expect(probeMcpSeller({ ...input, taskDescription: "Test", terms: { deliverables: "Report", quality_standards: "Cited", evaluation_required: true, evaluator_type: "uma_oov3" } })).rejects.toThrow("MCP_PROTOCOL_VERSION_UNSUPPORTED");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("discovers a compatible MCP request schema without calling its tool", async () => {
    const terms = contract.terms;
    const fetch = vi.fn(async (_url, init) => {
      const rpc = JSON.parse(init.body);
      return response({ jsonrpc: "2.0", id: rpc.id, result: rpc.method === "initialize" ? { protocolVersion: "2025-06-18" } : { tools: [{
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
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body).method)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
  });
  it("preserves an explicitly published MCP probe sample and rejects invalid samples", async () => {
    const terms = { deliverables: "Report", quality_standards: "Cited", evaluation_required: true, evaluator_type: "uma_oov3" };
    const sample = { task_description: "Public capability sample", terms };
    const inputSchema = { type: "object", required: ["task_description", "terms"], properties: { task_description: { type: "string" }, terms: { type: "object", required: Object.keys(terms), properties: { deliverables: { type: "string" }, quality_standards: { type: "string" }, evaluation_required: { type: "boolean" }, evaluator_type: { type: "string" } } } } };
    const input = (capabilityProbeParameters: unknown) => ({ endpoint: "https://seller.example.com/mcp", transport: "mcp", request: {}, timeoutMs: 5000, maxResponseBytes: 32768, fetch: vi.fn(async (_url, init) => {
      const rpc = JSON.parse(init.body);
      return response({ jsonrpc: "2.0", id: rpc.id, result: rpc.method === "initialize" ? { protocolVersion: "2025-06-18" } : { tools: [{ name: "request_quote", inputSchema, capabilityProbeParameters }] } });
    }) });
    const found = await discoverNegotiationInput(input(sample));
    expect(found.capabilityProbeParameters).toEqual(sample);
    await expect(discoverNegotiationInput(input({ ...sample, unknown: true }))).rejects.toThrow();
    await expect(discoverNegotiationInput(input({ ...sample, terms: { ...terms, evaluation_required: false } }))).rejects.toThrow();
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
      return response({ jsonrpc: "2.0", id: rpc.id, result: rpc.method === "initialize" ? { protocolVersion: "2025-06-18" } : { tools: [{ name: "search", inputSchema: {} }] } });
    });
    await expect(discoverNegotiationInput({ endpoint: "https://seller.example.com/mcp", transport: "mcp", request: {}, timeoutMs: 5000, maxResponseBytes: 32768, fetch })).rejects.toThrow("MCP_QUOTE_TOOL_REQUIRED");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("does not follow redirects or private endpoints", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://127.0.0.1" } }));
    const input = { endpoint: "https://seller.example.com/a2a", transport: "a2a", request: {}, timeoutMs: 5000, maxResponseBytes: 32768, fetch };
    await expect(discoverNegotiationInput(input)).rejects.toThrow("SELLER_REDIRECT");
    await expect(discoverNegotiationInput({ ...input, endpoint: "https://127.0.0.1" })).rejects.toThrow("SELLER_UNSAFE_URL");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
