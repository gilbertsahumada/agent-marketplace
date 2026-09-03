// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import type { AnchorHTMLAttributes } from "react";
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import type { HireJob } from "../src/business/entities/hire-job.ts";

const walletState = vi.hoisted(() => ({ address: null as `0x${string}` | null }));

vi.mock("wagmi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wagmi")>();
  return {
    ...actual,
    useAccount: () => ({ address: walletState.address, isConnected: walletState.address !== null, connector: null }),
    useChainId: () => 56,
    useConnect: () => ({ connect: vi.fn(), connectors: [], error: null }),
    useDisconnect: () => ({ disconnect: vi.fn() }),
    useSwitchChain: () => ({ switchChain: vi.fn(), switchChainAsync: vi.fn() }),
  };
});

vi.mock("next/link", async () => {
  const { createElement: createMockElement } = await import("react");
  return {
    default: ({ prefetch, ...anchorProps }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) =>
      createMockElement("a", { ...anchorProps, "data-prefetch": String(prefetch) }),
  };
});

const { HireJobRows } = await import("../components/marketplace/hire-job-rows.tsx");
const { MyHireJobs } = await import("../components/marketplace/my-hire-jobs.tsx");

const BUYER = "0x5ee75a1B1648C023e885E58bD3735Ae273f2cc52" as const;
const SELLER = "0xA2a2012e52Fd075c0F3146e37E833E7294ee52B5" as const;
const NOW = "2026-09-03T12:00:00.000Z";

function job(jobId: string, overrides: Partial<HireJob> = {}): HireJob {
  return {
    chainId: 56, jobId, buyer: BUYER, provider: SELLER, budgetRaw: "10000000000000000", status: "FUNDED",
    expiresAt: NOW, submittedAt: null, marketplace: false, updatedAt: NOW, ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  walletState.address = null;
});

describe("hire ledger components", () => {
  it("links every indexed job to its network page and marks marketplace jobs", async () => {
    render(createElement("main", {}, createElement(HireJobRows, { chainId: 97, emptyText: "none", jobs: [job("551", { chainId: 97, marketplace: true, status: "COMPLETED" }), job("552", { chainId: 97 })] })));

    expect(screen.getByRole("link", { name: /Job #551/ })).toHaveAttribute("href", "/jobs/testnet/551");
    expect(screen.getByRole("link", { name: /Job #552/ })).toHaveAttribute("href", "/jobs/testnet/552");
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getAllByText("marketplace")).toHaveLength(1);
    expect(screen.getAllByText("0x5ee7…cc52 → 0xA2a2…52B5")).toHaveLength(2);
    expect((await axe.run(document.body)).violations).toEqual([]);
  });

  it("asks for a wallet and never fetches while disconnected", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(MyHireJobs, { chainId: 56 }));

    expect(screen.getByText("Connect a wallet to see the jobs it created on this network.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the connected wallet's jobs from the same-origin ledger route once", async () => {
    walletState.address = BUYER;
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ chainId: 56, jobs: [job("56696", { marketplace: true })], nextBefore: null }));
    vi.stubGlobal("fetch", fetchMock);
    render(createElement("main", {}, createElement(MyHireJobs, { chainId: 56 })));

    await waitFor(() => expect(screen.getByRole("link", { name: /Job #56696/ })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`/api/marketplace/jobs?chainId=56&buyer=${BUYER}`);
    expect(screen.getByText("1 created by this wallet")).toBeInTheDocument();
    expect((await axe.run(document.body)).violations).toEqual([]);
  });

  it("reports an unavailable ledger without inventing rows", async () => {
    walletState.address = BUYER;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    render(createElement(MyHireJobs, { chainId: 56 }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Ledger temporarily unavailable."));
  });
});
