// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HistoryPages } from "../components/marketplace/history-pages";
import { QuoteHistory } from "../components/marketplace/quote-history";
import { markCatalogForRefresh } from "../components/marketplace/catalog-return-refresh";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
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
