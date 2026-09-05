import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JobAgentCell } from "../components/marketplace/job-agent-cell.tsx";
import { IDENTITY_REGISTRIES, type AgentReference } from "../shared/agent-identity.ts";

const agent: AgentReference = { chainId: 56, registryAddress: IDENTITY_REGISTRIES[56], agentId: "7", name: "Grid Agent", profileAvailable: true };
describe("JobAgentCell", () => {
  it("links names to profiles and labels the association", () => {
    const html = renderToStaticMarkup(<JobAgentCell resolution={{ status: "wallet_match", agents: [agent], evidence: [], coverage: "partial" }} />);
    expect(html).toContain('href="/agents/7"'); expect(html).toContain("Grid Agent · #7");
    expect(html).toContain("not historical proof");
  });
  it("never sends testnet identities to a mainnet profile", () => {
    const html = renderToStaticMarkup(<JobAgentCell resolution={{ status: "registered", agents: [{ ...agent, chainId: 97, registryAddress: IDENTITY_REGISTRIES[97] }], evidence: [], coverage: "partial" }} />);
    expect(html).not.toContain('href="/agents/'); expect(html).toContain("Testnet");
  });
  it("renders failures differently from an empty partial index", () => {
    expect(renderToStaticMarkup(<JobAgentCell />)).toContain("unavailable");
    expect(renderToStaticMarkup(<JobAgentCell resolution={{ status: "unmatched", agents: [], evidence: [], coverage: "partial" }} />)).toContain("No match in partial index");
  });
});
