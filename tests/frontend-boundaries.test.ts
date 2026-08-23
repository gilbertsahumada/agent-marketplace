import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";

function contents(pattern: string): string {
  return globSync(pattern).map((file) => `${file}\n${readFileSync(file, "utf8")}`).join("\n");
}

describe("three-layer dependency boundaries", () => {
  it("keeps Next.js and React out of Business", () => {
    expect(contents("src/business/**/*.ts")).not.toMatch(/from ["'](?:next|react)(?:\/|["'])/);
  });

  it("keeps provider access out of API controllers", () => {
    expect(contents("app/api/**/*.ts")).not.toMatch(/src\/(?:data|trust8004|verification)|\bviem\b|@bnbagent\/sdk/);
  });

  it("keeps trust8004 and RPC access out of client presentation", () => {
    expect(contents("components/**/*.tsx")).not.toMatch(/src\/(?:trust8004|data)|\bviem\b|@bnbagent\/sdk/);
  });

  it("keeps page presentation dependent on Business instead of Data", () => {
    expect(contents("app/**/*.tsx")).not.toMatch(/src\/data/);
  });

  it("does not prefetch every profile linked from a catalog page", () => {
    const agentCard = readFileSync("components/marketplace/agent-card.tsx", "utf8");
    expect(agentCard).toMatch(/<Link[^>]+prefetch=\{false\}/);
  });

  it("publishes no secret material in the versioned proof manifest", () => {
    const proof = readFileSync("src/data/proofs/gate1-job-514.ts", "utf8");
    expect(proof).not.toMatch(/private.?key|mnemonic|password|keystore|authorization|\.env|\/Users\//i);
  });
});
