import { describe, expect, it } from "vitest";
import { classifyCatalogResource } from "../src/trust8004/resource-classification";
import type { CatalogEndpointProtocol } from "../src/trust8004/types";

describe("catalog resource classification", () => {
  it.each([
    ["a2a", "https://agent.example.org/a2a", "operational", "a2a", null, "eligible"],
    ["mcp", "https://agent.example.org/mcp", "operational", "mcp", null, "eligible"],
    ["erc8183_http", "https://agent.example.org/jobs", "operational", "erc8183_http", null, "eligible"],
    ["web", "https://agent.example.org", "external", null, "website", "unsupported"],
    ["web", "https://x.com/agent", "external", null, "social", "unsupported"],
    ["web", "https://t.me/agent", "external", null, "social", "unsupported"],
    ["web", "https://github.com/example/agent", "external", null, "repository", "unsupported"],
    ["web", "https://docs.agent.org/guide", "external", null, "documentation", "unsupported"],
    ["unknown", "https://agent.example.org/custom", "external", null, "other", "unsupported"],
    ["x402", "https://agent.example.org/pay", "external", null, "other", "unsupported"],
    ["mcp", "https://twitter.com/agent", "operational", "mcp", "social", "invalid_declaration"],
    ["a2a", "https://telegram.me/agent", "operational", "a2a", "social", "invalid_declaration"],
    ["erc8183_http", "https://x.com/agent/jobs", "operational", "erc8183_http", "social", "invalid_declaration"],
  ] satisfies ReadonlyArray<readonly [
    CatalogEndpointProtocol,
    string,
    string,
    string | null,
    string | null,
    string,
  ]>)("classifies %s at %s", (protocol, endpoint, role, validation, external, eligibility) => {
    expect(classifyCatalogResource(protocol, endpoint)).toMatchObject({
      declaredProtocol: protocol,
      role,
      validationProtocol: validation,
      externalKind: external,
      eligibility,
      safety: "safe",
    });
  });

  it.each([
    ["mcp", "http://127.0.0.1/mcp", "operational", "mcp"],
    ["web", "https://localhost/profile", "external", null],
    ["a2a", "not-a-url", "operational", "a2a"],
  ] satisfies ReadonlyArray<readonly [CatalogEndpointProtocol, string, string, string | null]>)
  ("rejects unsafe %s resources before work selection", (protocol, endpoint, role, validationProtocol) => {
    expect(classifyCatalogResource(protocol, endpoint)).toEqual({
      declaredProtocol: protocol,
      role,
      validationProtocol,
      externalKind: null,
      eligibility: "unsafe",
      safety: "unsafe",
      safetyReason: "invalid_url",
    });
  });
});
