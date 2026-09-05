// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobHistory } from "../components/marketplace/job-history";
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); push.mockReset(); });
const historyProps = { agentId: "113284", provider: "0x1111111111111111111111111111111111111111", chainId: 56 as const, scope: "wallet" as const, jobs: [], more: false, hireActivity: { status: "missing" as const, provenance: "onchain" as const, observedAt: null, detail: "No activity" } };
const job = { chainId: 56 as const, jobId: "100", buyer: "0x1111111111111111111111111111111111111111" as const, provider: "0x2222222222222222222222222222222222222222" as const, status: "OPEN" as const, updatedAt: "2026-09-05T12:00:00Z", expiresAt: "2026-09-06T12:00:00Z", submittedAt: null, budgetRaw: "100", marketplace: false };

it("replaces the activity window with the selected network and keeps jobs if activity fails", async () => {
  const activity = { chainId: 56 as const, days: 30, from: "", to: "", byDay: [], totals: { created: 7, funded: 0, submitted: 0, settled: 2, refunded: 0 } };
  const fetcher = vi.fn((url: string) => Promise.resolve(url.includes("/activity?")
    ? new Response(null, { status: 503 })
    : Response.json({ jobs: [{ ...job, chainId: 97, jobId: "90" }], nextBefore: null })));
  vi.stubGlobal("fetch", fetcher);
  render(<JobHistory {...historyProps} activity={activity} hireJobs={[job]} />);
  expect(screen.getByText("Last 30 days: 7 created · 2 settled")).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("tab", { name: "Testnet" }));
  expect(await screen.findByText("Job #90")).toBeInTheDocument();
  expect(screen.queryByText("Last 30 days: 7 created · 2 settled")).not.toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/activity?chainId=97&provider="), expect.any(Object));
});

it("uses new server cursor pages and resets the local five-row page", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<JobHistory {...historyProps} hireJobs={Array.from({ length: 6 }, (_, i) => ({ ...job, jobId: String(100 - i) }))} olderHref="/hire/113284?jobsBefore=95" />);
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Job #95")).toBeInTheDocument();
  rerender(<JobHistory {...historyProps} hireJobs={[{ ...job, jobId: "94" }]} newestHref="/hire/113284" />);
  expect(screen.getByText("Job #94")).toBeInTheDocument();
  expect(screen.queryByText("Job #95")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Newest jobs" })).toHaveAttribute("href", "/hire/113284");
  expect(screen.queryByRole("link", { name: "Older jobs" })).not.toBeInTheDocument();
});

it("reflects refreshed server job states without remounting", () => {
  const { rerender } = render(<JobHistory {...historyProps} hireJobs={[job]} />);
  rerender(<JobHistory {...historyProps} hireJobs={[{ ...job, status: "COMPLETED" }]} totals={{ total: 1, completed: 1, funded: 0, submitted: 0 }} />);
  expect(screen.getByText("Completed")).toBeInTheDocument();
  expect(screen.getByText("1 completed")).toBeInTheDocument();
  expect(screen.queryByText("Open")).not.toBeInTheDocument();
});

it("does not let an old network response overwrite a newer server page", async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("/activity?") ? Promise.resolve(Response.json(null)) : new Promise<Response>(resolve => { finish = resolve; })));
  const user = userEvent.setup();
  const { rerender, container } = render(<JobHistory {...historyProps} hireJobs={[job]} />);
  await user.click(screen.getByRole("tab", { name: "Testnet" }));
  rerender(<JobHistory {...historyProps} hireJobs={[{ ...job, jobId: "94" }]} newestHref="/hire/113284" />);
  await act(async () => { finish(Response.json({ jobs: [], nextBefore: null })); });
  expect(screen.getByText("Job #94")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Mainnet", selected: true })).toBeInTheDocument();
  expect(container.querySelectorAll(".lucide-loader-circle")).toHaveLength(0);
});

it("keeps headers above the empty state and switches only job data with one loader", async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn((url: string) => url.includes("/activity?") ? Promise.resolve(Response.json(null)) : new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  const { container } = render(<JobHistory agentId="113284" provider="0x1111111111111111111111111111111111111111" chainId={56} scope="wallet" jobs={[]} hireJobs={[]} more={false} totals={{ total: 0, funded: 0, completed: 0, submitted: 0 }} hireActivity={{ status: "missing", provenance: "onchain", observedAt: null, detail: "No activity" }} />);
  const table = screen.getByRole("table");
  expect(within(table).getByRole("columnheader", { name: "Job" })).toBeInTheDocument();
  expect(within(table).getByText("No indexed jobs on this network.").closest("tbody")).not.toBeNull();
  await user.click(screen.getByRole("tab", { name: "Testnet" }));
  expect(container.querySelectorAll(".lucide-loader-circle")).toHaveLength(1);
  expect(push).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledWith("/api/marketplace/jobs?chainId=97&provider=0x1111111111111111111111111111111111111111", { cache: "no-store", signal: expect.any(AbortSignal) });
  finish(Response.json({ jobs: [], nextBefore: null, totals: { total: 0, funded: 0, completed: 0, submitted: 0 } }));
  await screen.findByRole("tab", { name: "Testnet", selected: true });
  expect(container.querySelectorAll(".lucide-loader-circle")).toHaveLength(0);
  expect(push).not.toHaveBeenCalled();
});
