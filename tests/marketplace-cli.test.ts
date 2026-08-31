import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  executeMarketplaceCli,
  parseMarketplaceCliArguments,
} from "../src/marketplace-cli.ts";

const ORIGIN = "https://marketplace.example";

describe("public marketplace CLI", () => {
  it("is packaged as a thin HTTP client without data-layer imports", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { bin?: Record<string, string> };
    const source = readFileSync("src/marketplace-cli.ts", "utf8");
    expect(packageJson.bin?.marketplace).toBe("dist/src/marketplace-cli-bin.js");
    expect(source).not.toMatch(/src\/(?:data|trust8004|readiness|verification)|@bnbagent\/sdk|\bviem\b/);
  });

  it("executes through the symlink shape used by npm bins", () => {
    const directory = mkdtempSync(join(tmpdir(), "marketplace-cli-"));
    try {
      const link = join(directory, "marketplace.ts");
      symlinkSync(resolve("src/marketplace-cli-bin.ts"), link);
      const result = spawnSync(process.execPath, ["--import", "tsx", link], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Usage:");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    [["agent", "inspect", "56:45650"], { resource: "agent", action: "inspect", id: "45650" }],
    [["agent", "validate", "56:303779"], { resource: "agent", action: "validate", id: "303779" }],
    [["seller", "qualify", "56:303779"], { resource: "seller", action: "qualify", id: "303779" }],
    [["job", "proof", "56:700"], { resource: "job", action: "proof", id: "700" }],
  ])("parses %j", (argv, expected) => {
    expect(parseMarketplaceCliArguments([...argv, "--origin", ORIGIN])).toEqual({
      ...expected,
      chainId: 56,
      origin: ORIGIN,
    });
  });

  it.each([
    ["wrong chain", ["agent", "inspect", "97:45650"]],
    ["non-numeric id", ["agent", "inspect", "56:not-an-id"]],
    ["unknown command", ["agent", "delete", "56:45650"]],
    ["unsafe origin", ["agent", "inspect", "56:45650", "--origin", "http://marketplace.example"]],
  ])("rejects %s", (_label, argv) => {
    expect(() => parseMarketplaceCliArguments(argv)).toThrow();
  });

  it("uses the marketplace APIs and never implements a second validation engine", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/api/marketplace/validate")) {
        return Response.json({ schemaVersion: 1, chainId: 56, agent: { agentId: "303779" }, passport: { agentId: "303779", state: "evaluated" } });
      }
      if (url.endsWith("/passport")) {
        return Response.json({ schemaVersion: 1, chainId: 56, agentId: "303779", state: "evaluated", checks: {}, nextRequirements: [] });
      }
      if (url.includes("/proofs/jobs/mainnet/")) {
        return Response.json({ schemaVersion: 1, chainId: 56, agentId: "303779", jobId: "700", resultHashVerified: true });
      }
      return Response.json({ chainId: 56, agentId: "45650", name: "V3 Pools" });
    });

    await executeMarketplaceCli(parseMarketplaceCliArguments(["agent", "inspect", "56:45650", "--origin", ORIGIN]), { fetch });
    await executeMarketplaceCli(parseMarketplaceCliArguments(["agent", "validate", "56:303779", "--origin", ORIGIN]), { fetch });
    await executeMarketplaceCli(parseMarketplaceCliArguments(["seller", "qualify", "56:303779", "--origin", ORIGIN]), { fetch });
    await executeMarketplaceCli(parseMarketplaceCliArguments(["job", "proof", "56:700", "--origin", ORIGIN]), { fetch });

    expect(requests).toEqual([
      { url: `${ORIGIN}/api/marketplace/agents/45650`, init: expect.objectContaining({ method: "GET" }) },
      { url: `${ORIGIN}/api/marketplace/validate`, init: expect.objectContaining({ method: "POST", body: JSON.stringify({ agentId: "303779" }) }) },
      { url: `${ORIGIN}/api/marketplace/agents/303779/passport`, init: expect.objectContaining({ method: "GET" }) },
      { url: `${ORIGIN}/api/marketplace/proofs/jobs/mainnet/700`, init: expect.objectContaining({ method: "GET" }) },
    ]);
  });

  it("fails visibly when the API schema does not match the requested resource", async () => {
    const fetch = vi.fn(async () => Response.json({ chainId: 97, agentId: "45650" }));
    const args = parseMarketplaceCliArguments(["agent", "inspect", "56:45650", "--origin", ORIGIN]);
    await expect(executeMarketplaceCli(args, { fetch })).rejects.toThrow("schema");
  });
});
