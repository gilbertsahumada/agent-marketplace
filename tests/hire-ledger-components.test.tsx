// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import type { AnchorHTMLAttributes } from "react";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { AddressLink } from "../components/marketplace/address-link";
import type { HireActivity, HireJob, HireJobDetail, HireJobEvent, HireLedgerSummary } from "../src/business/entities/hire-job.ts";

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
const { HireJobLedgerPage } = await import("../components/marketplace/hire-job-ledger-page.tsx");
const { HireLedgerPage } = await import("../components/marketplace/hire-ledger-page.tsx");

const BUYER = "0x5ee75a1B1648C023e885E58bD3735Ae273f2cc52" as const;
const SELLER = "0xA2a2012e52Fd075c0F3146e37E833E7294ee52B5" as const;
const NOW = "2026-09-03T12:00:00.000Z";
const TX = `0x${"ab".repeat(32)}` as const;

function job(jobId: string, overrides: Partial<HireJob> = {}): HireJob {
  return {
    chainId: 56, jobId, buyer: BUYER, provider: SELLER, budgetRaw: "10000000000000000", status: "FUNDED",
    expiresAt: NOW, submittedAt: null, marketplace: false, updatedAt: NOW, ...overrides,
  };
}

function event(phase: HireJobEvent["phase"], eventName: string, overrides: Partial<HireJobEvent> = {}): HireJobEvent {
  return { phase, eventName, txHash: TX, logIndex: 0, blockNumber: "119000000", occurredAt: NOW, actor: SELLER, amount: null, deliverable: null, reason: null, ...overrides };
}

function summary(overrides: Partial<HireLedgerSummary> = {}): HireLedgerSummary {
  const zero = { OPEN: 0, FUNDED: 0, SUBMITTED: 0, COMPLETED: 0, REJECTED: 0, EXPIRED: 0 };
  return {
    chainId: 56,
    indexedThrough: { blockNumber: "119000000", at: NOW },
    protocol: { jobs: 56_697, byStatus: { ...zero, SUBMITTED: 56_000, COMPLETED: 697 } },
    marketplace: { jobs: 2, byStatus: { ...zero, SUBMITTED: 1, FUNDED: 1 } },
    lastIndexRun: { status: "ok", at: NOW },
    ...overrides,
  };
}

function activity(overrides: Partial<HireActivity> = {}): HireActivity {
  const zero = { created: 0, funded: 0, submitted: 0, settled: 0, refunded: 0 };
  return {
    chainId: 56,
    days: 30,
    from: "2026-08-04T12:00:00.000Z",
    to: NOW,
    byDay: [
      { day: "2026-09-01", ...zero, created: 1_234, funded: 2 },
      { day: "2026-09-02", ...zero, settled: 1, refunded: 1 },
    ],
    totals: { ...zero, created: 1_234, funded: 2, settled: 1, refunded: 1 },
    ...overrides,
  };
}

function detail(overrides: Partial<HireJobDetail> = {}): HireJobDetail {
  return {
    ...job("56662", { status: "COMPLETED", marketplace: true }),
    evaluator: SELLER, hook: SELLER, deliverable: null, firstSeenAt: NOW,
    events: [event("funded", "JobFunded"), event("settled", "JobCompleted")],
    hireEvents: [],
    ...overrides,
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
    expect(screen.getAllByText("Hired here")).toHaveLength(1);
    expect(screen.queryByText("marketplace")).not.toBeInTheDocument();
    expect(screen.getAllByTitle(`${BUYER} → ${SELLER}`)).toHaveLength(2);
    expect((await axe.run(document.body)).violations).toEqual([]);
  });

  it("names the address roles and the update time for assistive tech, not only on hover", () => {
    render(createElement("main", {}, createElement(HireJobRows, { chainId: 56, emptyText: "none", jobs: [job("56696", { marketplace: true })] })));

    const link = screen.getByRole("link", { name: /Job #56696/ });
    expect(link).toHaveAccessibleName(/Buyer 0x5ee7…cc52 provider 0xA2a2…52B5/);
    expect(link).toHaveAccessibleName(/Updated Sep 3, 2026 UTC/);
    expect(link).toHaveAccessibleName(/Hired here/);
    const time = link.querySelector("time");
    expect(time).toHaveAttribute("dateTime", NOW);
    expect(time).toHaveTextContent("Sep 3, 2026 UTC");
    for (const hidden of ["Buyer", "provider", "Updated"]) {
      expect(screen.getByText(hidden, { exact: false, selector: ".sr-only" })).toBeInTheDocument();
    }
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
    expect(screen.getByText("1 shown")).toBeInTheDocument();
    expect(screen.queryByText(/created by this wallet/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Older jobs" })).not.toBeInTheDocument();
    expect((await axe.run(document.body)).violations).toEqual([]);
  });

  it("reports an unavailable ledger without inventing rows", async () => {
    walletState.address = BUYER;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    render(createElement(MyHireJobs, { chainId: 56 }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Ledger temporarily unavailable."));
  });

  it.each([
    ["an object without jobs", {}],
    ["a jobs field that is not an array", { chainId: 56, jobs: "56696", nextBefore: null }],
    ["a malformed job inside the jobs array", { chainId: 56, jobs: [{}], nextBefore: null }],
    ["a response for another network", { chainId: 97, jobs: [], nextBefore: null }],
    ["a cursor that is neither string nor null", { chainId: 56, jobs: [], nextBefore: 5 }],
    ["a non-object body", "ok"],
  ])("treats a 200 with %s as unavailable instead of crashing the page", async (_label, body) => {
    walletState.address = BUYER;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
    render(createElement(MyHireJobs, { chainId: 56 }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Ledger temporarily unavailable."));
  });

  it("pages older jobs through the same route and never claims a total", async () => {
    walletState.address = BUYER;
    const fetchMock = vi.fn<typeof fetch>(async (input) => String(input).includes("before=")
      ? Response.json({ chainId: 56, jobs: [job("56600")], nextBefore: null })
      : Response.json({ chainId: 56, jobs: [job("56696"), job("56690")], nextBefore: "56690" }));
    vi.stubGlobal("fetch", fetchMock);
    render(createElement("main", {}, createElement(MyHireJobs, { chainId: 56 })));

    await waitFor(() => expect(screen.getByRole("link", { name: /Job #56690/ })).toBeInTheDocument());
    expect(screen.getByText("showing the newest 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Older jobs" }));

    await waitFor(() => expect(screen.getByRole("link", { name: /Job #56600/ })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(`/api/marketplace/jobs?chainId=56&buyer=${BUYER}&before=56690`);
    expect(screen.getByRole("link", { name: /Job #56696/ })).toBeInTheDocument();
    expect(screen.getByText("3 shown")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Older jobs" })).not.toBeInTheDocument();
    expect((await axe.run(document.body)).violations).toEqual([]);
  });

  it("aborts the in-flight request on unmount", async () => {
    walletState.address = BUYER;
    const fetchMock = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(createElement(MyHireJobs, { chainId: 56 }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    unmount();

    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
  });

  it("refetches on a network switch and abandons the previous request", async () => {
    walletState.address = BUYER;
    const fetchMock = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(createElement(MyHireJobs, { chainId: 56 }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender(createElement(MyHireJobs, { chainId: 97 }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).signal?.aborted).toBe(false);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(`/api/marketplace/jobs?chainId=97&buyer=${BUYER}`);
    expect(screen.getByRole("status")).toHaveTextContent("Loading your jobs");
  });
});

describe("AddressLink", () => {
  it.each([56, 97] as const)("links addresses to the correct explorer on chain %s", (chainId) => {
    const address = "0x1111111111111111111111111111111111111111";
    render(createElement(AddressLink, { address, chainId }));
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", `https://${chainId === 97 ? "testnet." : ""}bscscan.com/address/${address}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

describe("HireLedgerPage", () => {
  const page = { chainId: 56 as const, jobs: [job("56696", { marketplace: true }), job("56695")], nextBefore: "56695" };

  it("sorts job IDs numerically and toggles every data header accessibly", () => {
    const records = { ...page, jobs: [job("100"), job("9")] };
    render(createElement(HireLedgerPage, { chainId: 56, summary: summary(), page: records }));
    const ids = () => screen.getAllByRole("link", { name: /^Job #/ }).map(link => link.textContent);
    expect(ids()).toEqual(["Job #100", "Job #9"]);
    fireEvent.click(screen.getByRole("button", { name: "Job" }));
    expect(ids()).toEqual(["Job #9", "Job #100"]);
    expect(screen.getByRole("columnheader", { name: "Job" })).toHaveAttribute("aria-sort", "ascending");
    for (const label of ["Agent", "Current state", "Buyer", "Provider", "Origin", "Last observed"]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(screen.getByRole("columnheader", { name: label })).toHaveAttribute("aria-sort", "ascending");
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(screen.getByRole("columnheader", { name: label })).toHaveAttribute("aria-sort", "descending");
    }
    expect(records.jobs.map(record => record.jobId)).toEqual(["100", "9"]);
  });

  it("returns to the preceding cursor rather than jumping to the first page", () => {
    render(createElement(HireLedgerPage, { chainId: 56, summary: summary(), page, before: "56670", cursorTrail: ["56695"] }));
    expect(screen.getByText("Page 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/jobs?chainId=56&before=56695");
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/jobs?chainId=56&before=56695&trail=56695,56670");
  });

  it("names the two counts as activity and reports a succeeded index run", async () => {
    render(createElement(HireLedgerPage, { chainId: 56, summary: summary(), page }));

    expect(screen.getByText("Protocol jobs indexed")).toBeInTheDocument();
    expect(screen.getByText("Attributed to marketplace")).toBeInTheDocument();
    expect(screen.getByText(/Marketplace attribution confirms a recorded hire event/)).toBeInTheDocument();
    expect(screen.queryByText("My jobs")).not.toBeInTheDocument();
    expect(screen.getByText(/Last run succeeded/)).toBeInTheDocument();
    expect(screen.queryByText(/last run ok/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/jobs?chainId=56&before=56695");
    expect(screen.queryByRole("link", { name: "Previous" })).not.toBeInTheDocument();
    expect((await axe.run(document.body)).violations).toEqual([]);
  });

  it("maps a failed index run and offers the way back to the newest page", () => {
    render(createElement(HireLedgerPage, { chainId: 56, summary: summary({ lastIndexRun: { status: "error", at: NOW } }), page: { ...page, nextBefore: null }, before: "56695" }));

    expect(screen.getByText(/Last run failed/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Indexed jobs before/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/jobs?chainId=56");
  });

  it("searches loaded jobs and clears the filter without changing index totals", () => {
    render(createElement(HireLedgerPage, { chainId: 56, summary: summary(), page }));
    const search = screen.getByRole("textbox", { name: "Search this page" });
    fireEvent.change(search, { target: { value: "#56696" } });
    expect(screen.getByRole("link", { name: "Job #56696" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Job #56695" })).not.toBeInTheDocument();
    expect(screen.getByText("56,697")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/jobs?chainId=56&before=56695");
    fireEvent.change(search, { target: { value: "no-match" } });
    expect(screen.getByText(/No matching records on this page/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("link", { name: "Job #56695" })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "MARKETPLACE" } });
    expect(screen.getByRole("link", { name: "Job #56696" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Job #56695" })).not.toBeInTheDocument();
  });

  it("searches resolved agent names and IDs and links to their profile", () => {
    render(createElement(HireLedgerPage, { chainId: 56, summary: summary(), page, agentResolutions: {
      "56:56696": { status: "wallet_match", coverage: "partial", evidence: [], agents: [{
        chainId: 56, registryAddress: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
        agentId: "303779", name: "Grid Agent", profileAvailable: true,
      }] },
    } }));
    const search = screen.getByRole("textbox", { name: "Search this page" });
    for (const value of ["grid agent", "#303779"]) {
      fireEvent.change(search, { target: { value } });
      expect(screen.getByRole("link", { name: "Grid Agent · #303779" })).toHaveAttribute("href", "/agents/303779");
      expect(screen.queryByRole("link", { name: "Job #56695" })).not.toBeInTheDocument();
      expect(screen.getByText("56,697")).toBeInTheDocument();
    }
  });

  it.each([
    ["idle", "Waiting for new blocks"],
    ["initialized", "Index initialized"],
  ])("does not label an %s index run as failed", (status, label) => {
    render(createElement(HireLedgerPage, { chainId: 56, summary: summary({ lastIndexRun: { status, at: NOW } }), page }));
    expect(screen.getByText(new RegExp(label))).toBeInTheDocument();
    expect(screen.queryByText(/Last run failed/)).not.toBeInTheDocument();
  });

  it("keeps the recent jobs when only the counts are unavailable", () => {
    render(createElement(HireLedgerPage, { chainId: 56, summary: null, page }));

    expect(screen.getByText("Counts temporarily unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Job #56696/ })).toBeInTheDocument();
    expect(screen.queryByText("Indexed ledger temporarily unavailable.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Recent jobs temporarily unavailable/)).not.toBeInTheDocument();
  });

  it("keeps the counts when only the recent jobs are unavailable", () => {
    render(createElement(HireLedgerPage, { chainId: 56, summary: summary(), page: null }));

    expect(screen.getByText("Indexed ledger temporarily unavailable.")).toBeInTheDocument();
    expect(screen.getByText("56,697")).toBeInTheDocument();
    expect(screen.queryByText(/Counts temporarily unavailable/)).not.toBeInTheDocument();
  });

  it("collapses to one notice when nothing could be read", () => {
    render(createElement(HireLedgerPage, { chainId: 56, summary: null, page: null, activity: null }));

    expect(screen.getByText("Indexed ledger temporarily unavailable.")).toBeInTheDocument();
    expect(screen.getByText(/Counts temporarily unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/Recent jobs temporarily unavailable/)).not.toBeInTheDocument();
    // The ledger-level notice already covers the activity window: one status
    // region, not two.
    expect(screen.queryByText("Recent activity temporarily unavailable.")).not.toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("shows the last 30 days as phase totals plus a per-day table with the indexing note", async () => {
    render(createElement(HireLedgerPage, { chainId: 56, summary: summary(), page, activity: activity() }));

    const trigger = screen.getByText("Activity summary · Last 30 days");
    expect(trigger.closest("details")).not.toHaveAttribute("open");
    expect(screen.getByRole("region", { name: "Indexed jobs" }).compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(trigger.closest("summary")!);
    const totals = screen.getByRole("list", { name: "Phase totals, last 30 days" });
    expect(totals).toHaveTextContent("Created1,234");
    expect(totals).toHaveTextContent("Settled1");
    expect(totals).toHaveTextContent("Refunded1");
    const table = screen.getByRole("table", { name: "Phase events per UTC day" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Day", "Created", "Funded", "Submitted", "Settled", "Refunded"]);
    expect(within(table).getByRole("rowheader", { name: "2026-09-01" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "2026-09-02" })).toBeInTheDocument();
    expect(screen.getByText("Counts phase events indexed since the ledger started; earlier jobs are present by state only.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/proven/i);
    expect((await axe.run(document.body)).violations).toEqual([]);
  });

  it("omits the per-day table when no phase events fell in the window", () => {
    render(createElement(HireLedgerPage, { chainId: 56, summary: summary(), page, activity: activity({ byDay: [], totals: { created: 0, funded: 0, submitted: 0, settled: 0, refunded: 0 } }) }));

    fireEvent.click(screen.getByText("Activity summary · Last 30 days").closest("summary")!);
    expect(screen.queryByRole("table", { name: "Phase events per UTC day" })).not.toBeInTheDocument();
    expect(screen.getByText("No phase events indexed in this window.")).toBeInTheDocument();
    expect(screen.getByText(/Counts phase events indexed since the ledger started/)).toBeInTheDocument();
  });

  it("reports an unavailable activity window on its own without touching the counts or the jobs", () => {
    render(createElement(HireLedgerPage, { chainId: 56, summary: summary(), page, activity: null }));

    expect(screen.getByRole("status")).toHaveTextContent("Recent activity temporarily unavailable.");
    expect(screen.queryByText("Activity summary · Last 30 days")).not.toBeInTheDocument();
    expect(screen.getByText("56,697")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Job #56696/ })).toBeInTheDocument();
    expect(screen.queryByText("Indexed ledger temporarily unavailable.")).not.toBeInTheDocument();
  });
});

describe("HireJobLedgerPage", () => {
  it.each([56, 97] as const)("places chain %s in job facts instead of the header", (chainId) => {
    render(createElement(HireJobLedgerPage, { job: detail({ chainId }) }));
    expect(screen.getByText(`Chain ID: ${chainId}`)).toBeInTheDocument();
    expect(screen.getByText(chainId === 56 ? "BNB Smart Chain Mainnet" : "BNB Smart Chain Testnet")).toBeInTheDocument();
    expect(screen.queryByText(/BSC Mainnet · chain|BSC Testnet · chain/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Indexed chain activity\. Delivery integrity/)).not.toBeInTheDocument();
  });

  it("shows one precise budget with the token symbol linked to explorer", () => {
    render(createElement(HireJobLedgerPage, { job: detail({ budgetRaw: "100000000000001" }) }));
    expect(screen.getByText("0.000100000000000001")).toBeInTheDocument();
    expect(screen.queryByText("100000000000001")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /U token on explorer/ })).toHaveAttribute("href", "https://bscscan.com/address/0xcE24439F2D9C6a2289F741120FE202248B666666");
  });

  it("links transactions on the selected network without repeating blocks", () => {
    const hash = `0x${"ab".repeat(32)}`;
    render(createElement(HireJobLedgerPage, { job: detail({ chainId: 97, deliverable: hash, events: [event("submitted", "JobSubmitted", { deliverable: hash })] }) }));
    expect(screen.queryByText(/Block 119000000/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View submission transaction/ })).toHaveAttribute("href", `https://testnet.bscscan.com/tx/${TX}`);
    expect(screen.getByRole("link", { name: /Submitted transaction on explorer/ })).toHaveClass("text-signal");
    expect(screen.queryByText("0.01 U")).not.toBeInTheDocument();
  });

  it("does not invent a transaction link for a deliverable without a matching event", () => {
    render(createElement(HireJobLedgerPage, { job: detail({ deliverable: `0x${"ab".repeat(32)}` }) }));
    expect(screen.queryByRole("link", { name: /View submission transaction/ })).not.toBeInTheDocument();
    expect(screen.getByText("Submission transaction not yet indexed.")).toBeInTheDocument();
  });

  it("names every explorer link by phase and destination and warns about the new tab", async () => {
    render(createElement(HireJobLedgerPage, { job: detail() }));

    const funded = screen.getByRole("link", { name: "Funded transaction on explorer, opens in a new tab" });
    const settled = screen.getByRole("link", { name: "Settled transaction on explorer, opens in a new tab" });
    expect(funded).toHaveAttribute("href", `https://bscscan.com/tx/${TX}`);
    expect(funded).toHaveAttribute("rel", "noopener noreferrer");
    expect(funded).toHaveAttribute("target", "_blank");
    expect(settled).toHaveTextContent("Transaction on explorer");
    expect(screen.queryByRole("link", { name: "Transaction" })).not.toBeInTheDocument();
    expect((await axe.run(document.body)).violations).toEqual([]);
  });

  it("exposes the card titles as level-2 headings", () => {
    render(createElement(HireJobLedgerPage, { job: detail({ hireEvents: [{ phase: "funded", txHash: TX, blockNumber: "119000000", occurredAt: NOW, agentId: "303779", jobId: "56662", chainId: 56 } as never] }) }));

    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent))
      .toEqual(["Delivery & closure", "Indexed job state", "Phase ledger", "Marketplace hire events"]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("ERC-8183 Job #56662");
    expect(screen.getByRole("link", { name: "Funded marketplace transaction on explorer, opens in a new tab" })).toHaveAttribute("href", `https://bscscan.com/tx/${TX}`);
    expect(screen.queryByText(/Block 119000000/)).not.toBeInTheDocument();
  });

  it("labels raw budget units and keeps the proof page bound to hash-verified deliverables", () => {
    render(createElement(HireJobLedgerPage, { job: detail() }));

    expect(screen.queryByText("Budget (raw token units)")).not.toBeInTheDocument();
    expect(screen.queryByText("Budget raw")).not.toBeInTheDocument();
    expect(screen.getByText(/Integrity confirms the content matches its on-chain hash, not that it meets your requirements/)).toBeInTheDocument();
    expect(screen.getByText("Hired via this marketplace")).toBeInTheDocument();
    expect(screen.queryByText(/Processed through this marketplace/)).not.toBeInTheDocument();
  });

  it("keeps two same-name events in one transaction apart", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const twin = event("settled", "JobCompleted");
    render(createElement(HireJobLedgerPage, { job: detail({ events: [twin, { ...twin }] }) }));

    expect(screen.getAllByRole("link", { name: "Settled transaction on explorer, opens in a new tab" })).toHaveLength(2);
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    consoleError.mockRestore();
  });
});
