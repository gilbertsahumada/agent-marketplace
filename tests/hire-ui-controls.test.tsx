// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { JobNetworkTabs } from "../components/marketplace/job-network-tabs";
import { AgentValidationActions } from "../components/marketplace/agent-validation-actions";
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("uses network tabs and preserves the agent route when switching", () => {
  render(<JobNetworkTabs agentId="303779" chainId={56} walletScope><p>Jobs</p></JobNetworkTabs>);
  expect(screen.getByRole("tab", { name: "Mainnet" })).toHaveAttribute("aria-selected", "true");
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Testnet" }), { button: 0, ctrlKey: false });
  expect(push).toHaveBeenCalledWith("/hire/303779?jobsNetwork=testnet#erc8183-history", { scroll: false });
});
it("embeds diagnostics as endpoint rows without another card or repeated title", () => {
  const { container } = render(<AgentValidationActions embedded agentId="303779" targets={[{ protocol: "a2a", endpoint: "https://seller.example/card", browserValidatable: true }]} />);
  expect(screen.queryByText("Connection check")).not.toBeInTheDocument();
  expect(container.querySelector('[data-slot="card"]')).toBeNull();
  expect(screen.getByRole("button", { name: "Validate from browser" })).toBeInTheDocument();
});
