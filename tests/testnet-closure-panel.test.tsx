// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TestnetClosurePanel } from "../components/marketplace/testnet-closure-panel";
vi.mock("../components/marketplace/job-closure-actions", () => ({ JobClosureActions: ({ network }: { network: string }) => <div>Actions for {network}</div> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
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
