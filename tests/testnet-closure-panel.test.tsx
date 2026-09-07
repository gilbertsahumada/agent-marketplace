// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TestnetClosurePanel } from "../components/marketplace/testnet-closure-panel";
vi.mock("../components/marketplace/job-closure-actions", () => ({ JobClosureActions: () => <div>Wallet actions</div> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const report = { jobId: "1066", chainId: 97, closure: "not_submitted", status: "FUNDED", refundAvailable: true, buyer: "0x" + "ab".repeat(20), budgetRaw: "100000000000000000", settlementOutcome: null };
it("automatically explains the expired job and the deposit", async () => {
  vi.stubEnv("NEXT_PUBLIC_TESTNET_JOB_CLOSURE_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(report)));
  render(<TestnetClosurePanel jobId="1066" />);
  expect(await screen.findByText("Deadline passed · deposit available")).toBeInTheDocument();
  expect(screen.getByText("0.1 U")).toBeInTheDocument();
  expect(screen.getByText("Wallet actions")).toBeInTheDocument();
});
it("hides actions during refresh and after failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(report)).mockRejectedValueOnce(new Error("offline")));
  render(<TestnetClosurePanel jobId="1066" />);
  await screen.findByText("Wallet actions");
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  expect(screen.queryByText("Wallet actions")).not.toBeInTheDocument();
  await screen.findByRole("alert");
});
it.each([{ ...report, chainId: 56 }, { ...report, jobId: "99" }, { ...report, budgetRaw: "invalid" }])("rejects invalid evidence %#", async data => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(data)));
  render(<TestnetClosurePanel jobId="1066" />);
  await screen.findByRole("alert");
  expect(screen.queryByText("Wallet actions")).not.toBeInTheDocument();
});
it("does not show wallet controls once the deposit was withdrawn", async () => {
  vi.stubEnv("NEXT_PUBLIC_TESTNET_JOB_CLOSURE_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...report, status: "EXPIRED", closure: "expired", refundAvailable: false })));
  render(<TestnetClosurePanel jobId="1066" />);
  expect(await screen.findByText("Deposit withdrawn")).toBeInTheDocument();
  expect(screen.queryByText("Wallet actions")).not.toBeInTheDocument();
});
