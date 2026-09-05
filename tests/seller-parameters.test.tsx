// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QuoteRequestPanel } from "../components/marketplace/quote-request-panel";
vi.mock("../components/spikes/erc8183-browser-spike", () => ({ Erc8183MarketplaceHire: () => <div>Review enabled</div> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("does not imply earlier quotes or readiness when the marketplace service is unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "quote_service_unavailable" }, { status: 503 })));
  render(<QuoteRequestPanel agentId="304169" />);
  await screen.findByText(/Cannot connect to the marketplace quote service/);
  expect(screen.queryByText(/previous quotes/i)).not.toBeInTheDocument();
  expect(screen.queryByText("Ready to request")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Request quote" })).not.toBeInTheDocument();
});
const contract = { encoding: "prefixed-json", taskDescriptionPrefix: "SERVICE_V1:", inputSchema: { type: "object", required: ["topic"], properties: { topic: { type: "string", title: "Research topic", minLength: 1 } } }, terms: { deliverables: "Report", quality_standards: "Cited", evaluation_required: true, evaluator_type: "uma_oov3" } };
it("shows only one loader while checking compatibility", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  const { container } = render(<QuoteRequestPanel agentId="304169" />);
  expect(container.querySelectorAll("#quote-request .lucide-loader-circle")).toHaveLength(1);
  expect(screen.queryByText("Loading seller parameters")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Checking…" })).not.toBeInTheDocument();
});
it("shows a placeholder and loads a validated seller example without submitting", async () => {
  const withExample = { ...contract, inputSchema: { ...contract.inputSchema, examples: [{ topic: "Compare public RPC providers" }] } };
  const fetcher = vi.fn(async () => Response.json({ contract: withExample, endpointKey: "a".repeat(64), contractHash: "b".repeat(64) }));
  vi.stubGlobal("fetch", fetcher);
  render(<QuoteRequestPanel agentId="42" />);
  const input = await screen.findByPlaceholderText("e.g. Compare public RPC providers");
  expect(input).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Load example" }));
  expect(input).toHaveValue("Compare public RPC providers");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Example loaded/)).toBeInTheDocument();
  fireEvent.change(input, { target: { value: "My request" } });
  expect(input).toHaveValue("My request");
});
it("does not offer invalid or invented examples", async () => {
  const withExample = { ...contract, inputSchema: { ...contract.inputSchema, examples: [{ topic: "" }] } };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ contract: withExample, endpointKey: "a".repeat(64), contractHash: "b".repeat(64) })));
  render(<QuoteRequestPanel agentId="42" />);
  await screen.findByPlaceholderText("Enter research topic");
  expect(screen.queryByRole("button", { name: "Load example" })).not.toBeInTheDocument();
});
it("lets an unverified seller check compatibility and then request its first quote in place", async () => {
  const fetcher = vi.fn(async () => Response.json({ contract, endpointKey: "a".repeat(64), contractHash: "b".repeat(64) }));
  vi.stubGlobal("fetch", fetcher);
  render(<QuoteRequestPanel agentId="42" checkCompatibilityFirst />);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Check compatibility" }));
  await screen.findByLabelText("Research topic *");
  expect(screen.getByRole("button", { name: "Request quote" })).toBeEnabled();
});
it("blocks quotes when parameters are not published", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "NEGOTIATION_PARAMETERS_UNAVAILABLE" }, { status: 409 })));
  render(<QuoteRequestPanel agentId="42" />);
  expect(screen.queryByRole("button", { name: "Request quote" })).not.toBeInTheDocument();
  await screen.findByText(/does not publish a supported quote form/);
  expect(screen.queryByText("Review enabled")).not.toBeInTheDocument();
});
it("uses seller fields, preserves one request through fallback, and clears the quote on edit", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url).endsWith("/input")) return Response.json({ contract, endpointKey: "e".repeat(64), contractHash: "f".repeat(64) });
    if (String(url).startsWith("https://seller")) throw new TypeError("Failed to fetch");
    if (String(url).endsWith("/fallback")) return Response.json({ requestId: 4, quote: { envelope: { request_hash: "hash" } } });
    return Response.json({ attemptId: "attempt-1", target: "https://seller.example.com/a2a", transport: "a2a", request: { task_description: 'SERVICE_V1:{"topic":"Research"}', terms: contract.terms } });
  }));
  render(<QuoteRequestPanel agentId="42" />);
  const input = await screen.findByLabelText("Research topic *");
  expect(screen.getByLabelText("Hiring locked until quote verified")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Request quote" }));
  expect(calls.filter(call => call.url.endsWith("/quotes"))).toHaveLength(0);
  fireEvent.change(input, { target: { value: "Research" } });
  fireEvent.click(screen.getByRole("button", { name: "Request quote" }));
  await screen.findByText("Review enabled");
  expect(screen.queryByText("Verified by the marketplace Worker")).not.toBeInTheDocument();
  expect(screen.queryByText("Status")).not.toBeInTheDocument();
  expect(screen.getByText("Quote details").closest("details")).not.toHaveAttribute("open");
  expect(screen.queryByLabelText("Hiring locked until quote verified")).not.toBeInTheDocument();
  expect(calls.find(call => call.url.endsWith("/quotes"))?.body).toMatchObject({ schemaVersion: 2, parameters: { topic: "Research" } });
  expect(calls.find(call => call.url.endsWith("/fallback"))?.url).toContain("attempt-1");
  fireEvent.change(input, { target: { value: "Changed" } });
  await waitFor(() => expect(screen.queryByText("Review enabled")).not.toBeInTheDocument());
  expect(screen.getByLabelText("Hiring locked until quote verified")).toBeInTheDocument();
});
it.each(["2025-06-18", "unsupported"])("initializes MCP before tools and rejects unsupported versions: %s", async (version) => {
  const methods: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith("/input")) return Response.json({ contract, endpointKey: "e".repeat(64), contractHash: "f".repeat(64) });
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (String(url).startsWith("https://seller")) {
      methods.push(body.method);
      if (body.method === "initialize") return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: version } }, { headers: { "mcp-session-id": "session-1" } });
      expect(new Headers(init?.headers).get("mcp-session-id")).toBe("session-1");
      expect(new Headers(init?.headers).get("mcp-protocol-version")).toBe("2025-06-18");
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "request_quote", inputSchema: { type: "object", required: ["task_description", "terms"], properties: { task_description: { type: "string" }, terms: { type: "object" } } } }] } });
      return Response.json({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { request_hash: "hash" } } });
    }
    if (String(url).endsWith("/result")) return Response.json({ requestId: 4, quote: { envelope: { request_hash: "hash" } } });
    return Response.json({ attemptId: "mcp-attempt", target: "https://seller.example.com/mcp", transport: "mcp", request: { task_description: "Research", terms: contract.terms } });
  }));
  render(<QuoteRequestPanel agentId="42" />);
  fireEvent.change(await screen.findByLabelText("Research topic *"), { target: { value: "Research" } });
  fireEvent.click(screen.getByRole("button", { name: "Request quote" }));
  if (version === "unsupported") {
    await screen.findByText("Could not verify a quote. Please try again.");
    expect(methods).toEqual(["initialize"]);
    expect(screen.queryByText("Review enabled")).not.toBeInTheDocument();
    return;
  }
  await screen.findByText("Review enabled");
  expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
});
