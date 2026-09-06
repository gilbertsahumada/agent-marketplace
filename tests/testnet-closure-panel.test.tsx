// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TestnetClosurePanel } from "../components/marketplace/testnet-closure-panel";
vi.mock("../components/marketplace/job-closure-actions", () => ({ JobClosureActions: ({ network }: { network: string }) => <div>Actions for {network}</div> }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const report = { jobId: "514", chainId: 97, closure: "settlement_available", settlementOutcome: "completed" };
it("checks on demand without mounting wallet actions when disabled", async () => {
  vi.stubEnv("NEXT_PUBLIC_TESTNET_JOB_CLOSURE_ENABLED", "false");
  const fetcher = vi.fn(async () => Response.json(report)); vi.stubGlobal("fetch", fetcher);
  render(<TestnetClosurePanel jobId="514" />);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button"));
  await screen.findByText("settlement available");
  expect(screen.queryByText("Actions for testnet")).not.toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledWith("/api/marketplace/jobs/testnet/514/closure", expect.objectContaining({ cache: "no-store" }));
});
it("enables only Testnet controls after a matching response and clears them on job change", async () => {
  vi.stubEnv("NEXT_PUBLIC_TESTNET_JOB_CLOSURE_ENABLED", "true");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(report)));
  const { rerender } = render(<TestnetClosurePanel jobId="514" />);
  fireEvent.click(screen.getByRole("button"));
  await screen.findByText("Actions for testnet");
  rerender(<TestnetClosurePanel jobId="515" />);
  expect(screen.queryByText("Actions for testnet")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button"));
  await screen.findByRole("alert");
  expect(screen.queryByText("Actions for testnet")).not.toBeInTheDocument();
});
it("rejects a Mainnet response and releases the loading state", async () => {
  vi.stubEnv("NEXT_PUBLIC_TESTNET_JOB_CLOSURE_ENABLED", "true");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...report, chainId: 56 })));
  render(<TestnetClosurePanel jobId="514" />);
  fireEvent.click(screen.getByRole("button"));
  await screen.findByRole("alert");
  expect(screen.getByRole("button")).not.toBeDisabled();
  expect(screen.queryByText("Actions for testnet")).not.toBeInTheDocument();
});
it("removes previously enabled actions immediately during refresh and keeps them hidden after failure", async () => {
  vi.stubEnv("NEXT_PUBLIC_TESTNET_JOB_CLOSURE_ENABLED", "true");
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(report)).mockRejectedValueOnce(new Error("Offline"));
  vi.stubGlobal("fetch", fetcher);
  render(<TestnetClosurePanel jobId="514" />);
  fireEvent.click(screen.getByRole("button"));
  await screen.findByText("Actions for testnet");
  fireEvent.click(screen.getByRole("button"));
  expect(screen.queryByText("Actions for testnet")).not.toBeInTheDocument();
  await screen.findByRole("alert");
  expect(screen.queryByText("Actions for testnet")).not.toBeInTheDocument();
  expect(screen.getByRole("button")).not.toBeDisabled();
});
it("aborts an old job request and ignores its late response", async () => {
  vi.stubEnv("NEXT_PUBLIC_TESTNET_JOB_CLOSURE_ENABLED", "true");
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn((_url: string, _options: RequestInit) => new Promise<Response>(done => { resolve = done; }));
  vi.stubGlobal("fetch", fetcher);
  const { rerender } = render(<TestnetClosurePanel jobId="514" />);
  fireEvent.click(screen.getByRole("button"));
  expect(fetcher).toHaveBeenCalledTimes(1);
  const signal = fetcher.mock.calls[0]![1].signal!;
  rerender(<TestnetClosurePanel jobId="515" />);
  expect(signal.aborted).toBe(true);
  await act(async () => { resolve(Response.json(report)); });
  expect(screen.queryByText("Actions for testnet")).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByRole("button")).not.toBeDisabled();
});
it("times out a refresh after successful verification without retaining actions", async () => {
  vi.stubEnv("NEXT_PUBLIC_TESTNET_JOB_CLOSURE_ENABLED", "true");
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(report))
    .mockImplementationOnce((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
  vi.stubGlobal("fetch", fetcher);
  render(<TestnetClosurePanel jobId="514" />);
  fireEvent.click(screen.getByRole("button"));
  await screen.findByText("Actions for testnet");
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button"));
  expect(screen.queryByText("Actions for testnet")).not.toBeInTheDocument();
  expect(screen.getByRole("button")).toBeDisabled();
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("button")).not.toBeDisabled();
  expect(screen.queryByText("Actions for testnet")).not.toBeInTheDocument();
});
