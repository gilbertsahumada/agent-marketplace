import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JobStateCard } from "../components/marketplace/job-state-card";
import { directJobState } from "../components/marketplace/direct-job-state";
import { GridDeliverySummary } from "../components/marketplace/grid-delivery-summary";
import type { Erc8183JobFacts } from "../src/business/entities/erc8183-browser-spike";

describe("shared job presentation", () => {
  it.each([56, 97] as const)("formats direct chain %s with the indexed layout", chainId => {
    const facts = directJobState({ chainId, buyer: "0x123", provider: "0x456", evaluator: "0x789", budgetRaw: "100000000000000000", deadline: "1789425658", submittedAt: "0", deliverableHash: `0x${"0".repeat(64)}` } as unknown as Erc8183JobFacts);
    const html = renderToStaticMarkup(createElement(JobStateCard, { job: facts, source: "direct" }));
    expect(html).toContain("Verified job state");
    expect(html).toContain("Read directly from the Commerce contract");
    expect(html).toContain("0.1");
    expect(html).toContain("UTC");
    expect(html).not.toContain("1789425658");
    expect(html).not.toContain("Budget raw");
    expect(html).not.toContain("1970");
    expect(facts.events).toEqual([]);
    expect(facts.deliverable).toBeNull();
    const withPolicy = renderToStaticMarkup(createElement(JobStateCard, { job: { ...facts, policy: "0x999" }, source: "direct" }));
    expect(withPolicy).toContain(">Policy</span>");
    expect(withPolicy).toContain("/address/0x999");
    expect(withPolicy).not.toContain("<details");
    expect(withPolicy.indexOf(">Policy</span>")).toBeLessThan(withPolicy.indexOf(">Expires</span>"));
  });
  it("renders the supported simulation as a table, not an execution claim", () => {
    const content = JSON.stringify({ schemaVersion: 1, execution: "none", pair: "BNB/USDT", lowerPrice: "700", upperPrice: "900", capital: "1000", gridCount: 1, levels: [{ index: 1, price: "700", side: "buy", capital: "1000" }] });
    const html = renderToStaticMarkup(createElement(GridDeliverySummary, { content }));
    expect(html).toContain("<table");
    expect(html).toContain("Simulation only");
    expect(html).toContain("BNB/USDT");
  });
  it.each(['not json', '{}', '{"schemaVersion":1,"execution":"traded"}'])("does not interpret unsupported data %s", content => {
    expect(renderToStaticMarkup(createElement(GridDeliverySummary, { content }))).toBe("");
  });
});
