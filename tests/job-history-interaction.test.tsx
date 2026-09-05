// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobHistory } from "../components/marketplace/job-history";
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); push.mockReset(); });
it("keeps headers above the empty state and switches only job data with one loader", async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  const { container } = render(<JobHistory agentId="113284" provider="0x1111111111111111111111111111111111111111" chainId={56} scope="wallet" jobs={[]} hireJobs={[]} more={false} totals={{ total: 0, funded: 0, completed: 0, submitted: 0 }} hireActivity={{ status: "missing", provenance: "onchain", observedAt: null, detail: "No activity" }} />);
  const table = screen.getByRole("table");
  expect(within(table).getByRole("columnheader", { name: "Job" })).toBeInTheDocument();
  expect(within(table).getByText("No indexed jobs on this network.").closest("tbody")).not.toBeNull();
  await user.click(screen.getByRole("tab", { name: "Testnet" }));
  expect(container.querySelectorAll(".lucide-loader-circle")).toHaveLength(1);
  expect(push).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledWith("/api/marketplace/jobs?chainId=97&provider=0x1111111111111111111111111111111111111111", { cache: "no-store" });
  finish(Response.json({ jobs: [], nextBefore: null, totals: { total: 0, funded: 0, completed: 0, submitted: 0 } }));
  await screen.findByRole("tab", { name: "Testnet", selected: true });
  expect(container.querySelectorAll(".lucide-loader-circle")).toHaveLength(0);
  expect(push).not.toHaveBeenCalled();
});
