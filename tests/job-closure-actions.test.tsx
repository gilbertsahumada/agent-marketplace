// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { JobClosureActions } from "../components/marketplace/job-closure-actions";

const BUYER = "0x5ee75a1B1648C023e885E58bD3735Ae273f2cc52";
vi.mock("wagmi", () => ({ useAccount: () => ({ address: BUYER, chainId: 56, connector: { getProvider: async () => ({}) } }) }));
vi.mock("@/src/business/browser/job-closure", () => ({ executeBrowserClosure: vi.fn() }));
afterEach(() => cleanup());

const base = { jobId: "56696", buyer: BUYER, settlementOutcome: null, reviewEndsAt: "2026-09-10T11:12:30.000Z" };

describe("JobClosureActions", () => {
  it("presents dispute as a secondary action and says there is nothing to do until settlement opens", () => {
    render(<JobClosureActions report={{ ...base, closure: "review_window" }} refresh={() => {}} />);
    const dispute = screen.getByRole("button", { name: "Dispute with wallet" });
    expect(dispute).toHaveAttribute("data-variant", "outline");
    expect(dispute).toBeDisabled();
    expect(screen.getByText(/Nothing to do until settlement opens on/)).toHaveTextContent("Thu, 10 Sep 2026 11:12:30 GMT");
    expect(screen.getByText(/Dispute only if the delivery does not match your request\./)).toBeInTheDocument();
  });

  it("keeps settlement as the primary action without the dispute guidance", () => {
    render(<JobClosureActions report={{ ...base, closure: "settlement_available", settlementOutcome: "completed", reviewEndsAt: "2026-09-02T22:40:26.000Z" }} refresh={() => {}} />);
    expect(screen.getByRole("button", { name: "Settle with wallet" })).toHaveAttribute("data-variant", "default");
    expect(screen.queryByText(/Nothing to do until settlement opens/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Dispute only if/)).not.toBeInTheDocument();
  });

  it("still explains the wait when the review deadline is unknown", () => {
    render(<JobClosureActions report={{ ...base, closure: "review_window", reviewEndsAt: null }} refresh={() => {}} />);
    expect(screen.getByText("Nothing to do until the review window ends. Dispute only if the delivery does not match your request.")).toBeInTheDocument();
  });
});
