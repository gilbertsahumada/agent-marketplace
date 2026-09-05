import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AgentProfile } from "../components/marketplace/agent-profile";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

it("labels wallet activity, uses all-page totals and keeps Testnet navigation scoped", () => {
  const markup = renderToStaticMarkup(createElement(AgentProfile, {
    agent: { agentId: "304169", name: "Search provider", services: [], endpoints: [] } as never,
    passport: { checks: { quote: { status: "missing" }, hireActivity: { status: "missing" } }, trackRecord: { provenJobs: 0 } } as never,
    hireJobsScope: "wallet", jobsChainId: 97,
    hireJobsTotals: { total: 18, completed: 9, funded: 2, submitted: 1 },
    hireJobs: [{ chainId: 97, jobId: "7", buyer: `0x${"1".repeat(40)}`, provider: `0x${"2".repeat(40)}`, status: "COMPLETED", budgetRaw: "1", expiresAt: "2026-09-05T00:00:00Z", submittedAt: null, marketplace: false, updatedAt: "2026-09-05T00:00:00Z" }],
    jobsOlderHref: "/hire/304169?jobsNetwork=testnet&jobsBefore=7#erc8183-history",
  }));
  expect(markup).toContain("Provider wallet jobs");
  expect(markup).toContain('role="tablist"');
  expect(markup).toContain('scope="col"');
  expect(markup).toContain("Buyer</th>");
  expect(markup).toContain("Provider</th>");
  expect(markup).not.toContain("Wallet activity below");
  expect(markup).toContain("not exclusive to this agent");
  expect(markup).toContain("18 jobs");
  expect(markup).toContain("9 completed");
  expect(markup).not.toContain("9 completed jobs");
  expect(markup).toContain('href="/jobs/testnet/7"');
  expect(markup).toContain("jobsNetwork=testnet&amp;jobsBefore=7");
  expect(markup.indexOf("Provider wallet jobs")).toBeLessThan(markup.indexOf("Quote history"));
});
