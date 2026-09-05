// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QuoteRequestPanel } from "../components/marketplace/quote-request-panel";
vi.mock("../components/spikes/erc8183-browser-spike", () => ({ Erc8183MarketplaceHire: () => <div>Review enabled</div> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const contract = { encoding: "prefixed-json", taskDescriptionPrefix: "SERVICE_V1:", inputSchema: { type: "object", required: ["topic"], properties: { topic: { type: "string", title: "Research topic", minLength: 1 } } }, terms: { deliverables: "Report", quality_standards: "Cited", evaluation_required: true, evaluator_type: "uma_oov3" } };
it("blocks quotes when parameters are not published", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "NEGOTIATION_PARAMETERS_UNAVAILABLE" }, { status: 409 })));
  render(<QuoteRequestPanel agentId="42" />);
  expect(screen.getByRole("button", { name: "Request quote" })).toBeDisabled();
  await screen.findByText(/parameters are not published/);
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
  fireEvent.click(screen.getByRole("button", { name: "Request quote" }));
  expect(calls.filter(call => call.url.endsWith("/quotes"))).toHaveLength(0);
  fireEvent.change(input, { target: { value: "Research" } });
  fireEvent.click(screen.getByRole("button", { name: "Request quote" }));
  await screen.findByText("Review enabled");
  expect(calls.find(call => call.url.endsWith("/quotes"))?.body).toMatchObject({ schemaVersion: 2, parameters: { topic: "Research" } });
  expect(calls.find(call => call.url.endsWith("/fallback"))?.url).toContain("attempt-1");
  fireEvent.change(input, { target: { value: "Changed" } });
  await waitFor(() => expect(screen.queryByText("Review enabled")).not.toBeInTheDocument());
});
