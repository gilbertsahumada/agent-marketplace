// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HistoryPages } from "../components/marketplace/history-pages";
import { HireActivityWindow } from "../components/marketplace/hire-activity-window";
import { QuoteHistory } from "../components/marketplace/quote-history";
import { markCatalogForRefresh } from "../components/marketplace/catalog-return-refresh";
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("shows daily activity cards with a compact period selector", () => {
  render(<HireActivityWindow activity={{ chainId: 56, days: 30, from: "", to: "", totals: { created: 1, funded: 0, submitted: 0, settled: 0, refunded: 0 }, byDay: [] }} />);
  expect(screen.getByRole("region", { name: "ERC-8183 activity" })).toBeInTheDocument();
  expect(screen.getByText("Past 30 days", { selector: "summary" }).closest("details")).not.toHaveAttribute("open");
  expect(screen.getByRole("button", { name: "About the Created metric" })).toBeInTheDocument();
});
it("opens quote details below the summary row across the full table", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ requests: [{ id: 720, status: "rejected", errorCode: "QUOTE_SIGNATURE", transport: "a2a", createdAt: Date.now(), attempts: [{ id: "a", executor: "browser", durationMs: 4003, httpStatus: null, errorCode: "QUOTE_SIGNATURE" }] }] })));
  render(<QuoteHistory agentId="204789" />);
  const trigger = await screen.findByRole("button", { name: "View details for quote 720" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(trigger);
  const message = screen.getByText("The quote signature could not be verified. Hiring remains blocked.");
  expect(message.closest("td")).toHaveAttribute("colspan", "5");
  expect(message.closest("tr")).not.toBe(trigger.closest("tr"));
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(trigger);
  expect(screen.queryByText("The quote signature could not be verified. Hiring remains blocked.")).not.toBeInTheDocument();
});
it("polls processing quotes and stops after an interrupted result", async () => {
  vi.useFakeTimers();
  const request = vi.fn()
    .mockResolvedValueOnce(Response.json({ requests: [{ id: 704, status: "running", transport: "a2a", createdAt: Date.now(), attempts: [] }] }))
    .mockResolvedValue(Response.json({ requests: [{ id: 704, status: "failed", errorCode: "QUOTE_ATTEMPT_INTERRUPTED", transport: "a2a", createdAt: Date.now(), attempts: [] }] }));
  vi.stubGlobal("fetch", request);
  await act(async () => { render(<QuoteHistory agentId="42" />); });
  expect(screen.getByText("Processing")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  expect(screen.getByText("Interrupted")).toBeInTheDocument();
  expect(screen.queryByText("Processing")).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(request).toHaveBeenCalledTimes(2);
});
it("shows five job rows, then the next five, and allows returning", () => {
  render(<HistoryPages label="Jobs">{Array.from({ length: 11 }, (_, n) => <div key={n}>Job row {n}</div>)}</HistoryPages>);
  expect(screen.getAllByText(/Job row/)).toHaveLength(5);
  expect(screen.queryByText("Job row 5")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Job row 5")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(screen.getByText("Job row 0")).toBeInTheDocument();
});
it("loads quote pages from the server without changing total counts", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const page = Number(new URL(url, "https://test.example").searchParams.get("page"));
    return Response.json({ counts: { requests: 8, succeeded: 0 }, pagination: { page, total: 8, hasMore: page === 1 }, requests: Array.from({ length: page === 1 ? 5 : 3 }, (_, n) => ({ id: page * 10 + n, transport: "a2a", status: "failed", createdAt: 1800000000000, attempts: [] })) });
  }));
  render(<QuoteHistory agentId="42" />);
  await screen.findByText("Page 1 of 2");
  expect(screen.getAllByRole("row")).toHaveLength(6);
  expect(screen.getByRole("columnheader", { name: "Transport" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("Page 2 of 2");
  expect(screen.getAllByRole("row")).toHaveLength(4);
  expect(screen.getByText("8 quotes requested")).toBeInTheDocument();
});
it("reloads the matching history after a shared mutation, without inventing imported buyer requests", async () => {
  let count = 0;
  const request = vi.fn(async () => Response.json({ counts: { requests: ++count, buyerRequests: count, buyerVerified: 0, importedObservations: 24 }, requests: [] }));
  vi.stubGlobal("fetch", request);
  render(<QuoteHistory agentId="42" />);
  await screen.findByText("1 quotes requested");
  markCatalogForRefresh("99");
  expect(request).toHaveBeenCalledTimes(1);
  markCatalogForRefresh("42");
  await screen.findByText("2 quotes requested");
  expect(screen.getByText("24 imported observations")).toBeInTheDocument();
});
