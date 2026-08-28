import { describe, expect, it } from "vitest";

import { selectLiveTargets } from "../src/trust8004/candidates.ts";
import { isSyntacticallyPublicHttpsUrl } from "../src/trust8004/safe-url.ts";
import type { CatalogAgent } from "../src/trust8004/types.ts";

function agent(overrides: Partial<CatalogAgent> = {}): CatalogAgent {
  return {
    chainId: 56,
    agentId: "42",
    name: null,
    registeredAt: null,
    metadataUpdatedAt: null,
    metadataAvailable: true,
    declarations: { a2a: false, erc8183: true },
    declaredEndpoints: [],
    ...overrides,
  };
}

describe("WP2 live target filter", () => {
  it("normalizes labels and keeps at most two safe endpoints in source order", () => {
    const targets = selectLiveTargets(agent({
      declaredEndpoints: [
        { transport: "erc8183_http", endpoint: "https://one.example.com/jobs", source: "services", sourceIndex: 0 },
        { transport: "a2a", endpoint: "https://two.example.com/a2a", source: "services", sourceIndex: 1 },
        { transport: "a2a", endpoint: "https://three.example.com/a2a", source: "endpoints", sourceIndex: 0 },
      ],
    }), { curatedAgentIds: new Set() });

    expect(targets).toEqual([
      { chainId: 56, agentId: "42", transport: "erc8183_http", endpoint: "https://one.example.com/jobs" },
      { chainId: 56, agentId: "42", transport: "a2a", endpoint: "https://two.example.com/a2a" },
    ]);
  });

  it("allows a curated A2A agent but excludes global A2A-only agents", () => {
    const a2aOnly = agent({
      declarations: { a2a: true, erc8183: false },
      declaredEndpoints: [
        { transport: "a2a", endpoint: "https://seller.example.com/a2a", source: "endpoints", sourceIndex: 0 },
      ],
    });

    expect(selectLiveTargets(a2aOnly, { curatedAgentIds: new Set() })).toEqual([]);
    expect(selectLiveTargets(a2aOnly, { curatedAgentIds: new Set(["42"]) })).toHaveLength(1);
  });

  it("requires parsed metadata and drops unsafe or duplicate endpoints", () => {
    const endpoints: CatalogAgent["declaredEndpoints"] = [
      { transport: "erc8183_http", endpoint: "http://seller.example.com", source: "services", sourceIndex: 0 },
      { transport: "erc8183_http", endpoint: "https://user:pass@seller.example.com", source: "services", sourceIndex: 1 },
      { transport: "erc8183_http", endpoint: "https://127.0.0.1/jobs", source: "endpoints", sourceIndex: 0 },
      { transport: "erc8183_http", endpoint: "https://seller.example.com/jobs", source: "endpoints", sourceIndex: 1 },
      { transport: "erc8183_http", endpoint: "https://seller.example.com/jobs", source: "endpoints", sourceIndex: 2 },
    ];

    expect(selectLiveTargets(agent({ metadataAvailable: false, declaredEndpoints: endpoints }), {
      curatedAgentIds: new Set(["42"]),
    })).toEqual([]);
    expect(selectLiveTargets(agent({ declaredEndpoints: endpoints }), {
      curatedAgentIds: new Set(),
    })).toEqual([
      { chainId: 56, agentId: "42", transport: "erc8183_http", endpoint: "https://seller.example.com/jobs" },
    ]);
  });
});

describe("syntactically public HTTPS policy", () => {
  it.each([
    "https://seller.example.com/path",
    "https://api.example.com/path",
    "https://8.8.8.8/path",
    "https://[2606:4700:4700::1111]/path",
  ])("accepts %s", (url) => {
    expect(isSyntacticallyPublicHttpsUrl(url)).toBe(true);
  });

  it.each([
    "http://seller.example/path",
    "https://user:secret@seller.example/path",
    "https://localhost/path",
    "https://service.local/path",
    "https://seller.example/path",
    "https://10.0.0.1/path",
    "https://169.254.1.2/path",
    "https://192.168.1.2/path",
    "https://[::1]/path",
    "https://[fc00::1]/path",
    "not a url",
  ])("rejects %s", (url) => {
    expect(isSyntacticallyPublicHttpsUrl(url)).toBe(false);
  });
});
