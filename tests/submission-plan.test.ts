import { getAddress, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { inspect } from "node:util";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildGridPlan, gridTaskDescription, parseGridTaskDescription } from "../src/business/policies/grid-plan-policy.ts";
import { assertBrowserSpikeChain, parseBrowserJournal, type Erc8183BrowserDeployment } from "../src/data/erc8183/browser-wallet-adapter.ts";
import { assertPublicVerificationSnapshotFresh, parsePublicVerificationSnapshot, PUBLIC_VERIFICATION_SNAPSHOT } from "../src/data/verification/public-verification-snapshot.ts";
import { loadMainnetBrowserDemoConfig } from "../src/mainnet/browser-demo-config.ts";
import { marketplaceInventoryEntries } from "../src/data/inventory/marketplace-inventory.ts";
import { ERC1967_IMPLEMENTATION_SLOT, ERC8183_MAINNET } from "../src/mainnet/contracts.ts";
import { evaluateMainnetGoNoGo } from "../src/mainnet/go-no-go.ts";
import { loadMainnetGridSellerConfig } from "../src/mainnet/grid-seller-config.ts";
import { loadHostedSellerConfig } from "../src/data/erc8183/hosted-seller-config.ts";
import { erc8183SpikeErrorResponse } from "../src/presentation/http/erc8183-spike-http.ts";

const SELLER = getAddress("0x1111111111111111111111111111111111111111");
const BUYER = getAddress("0x2222222222222222222222222222222222222222");

function deployment(): Erc8183BrowserDeployment {
  return {
    chainId: 56,
    networkName: "BNB Smart Chain",
    nativeCurrencyName: "BNB",
    nativeCurrencySymbol: "BNB",
    rpcUrl: ERC8183_MAINNET.rpcUrl,
    explorerUrl: ERC8183_MAINNET.explorerUrl,
    agentId: 9001,
    commerce: ERC8183_MAINNET.commerce,
    router: ERC8183_MAINNET.router,
    policy: ERC8183_MAINNET.policy,
    token: ERC8183_MAINNET.token,
    seller: SELLER,
    maximumBudgetRaw: ERC8183_MAINNET.maximumDemoBudgetRaw,
  };
}

describe("authentic deterministic Grid planning", () => {
  it("reproduces the same plan and preserves exact capital", () => {
    const input = { pair: "bnb/usdt", lowerPrice: "700", upperPrice: "900", capital: "1000", gridCount: 9 };
    const first = buildGridPlan(input);
    const second = buildGridPlan(parseGridTaskDescription(gridTaskDescription(input)));
    expect(second).toEqual(first);
    expect(first.levels[0]?.price).toBe("700");
    expect(first.levels.at(-1)?.price).toBe("900");
    expect(first.levels.map(({ capital }) => Number(capital)).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1000, 7);
    expect(first.execution).toBe("none");
  });

  it("rejects malformed or financially nonsensical inputs", () => {
    expect(() => buildGridPlan({ pair: "BNB", lowerPrice: "1", upperPrice: "2", capital: "1", gridCount: 3 })).toThrow(/BASE\/QUOTE/);
    expect(() => buildGridPlan({ pair: "BNB/USDT", lowerPrice: "2", upperPrice: "1", capital: "1", gridCount: 3 })).toThrow(/exceed/);
    expect(() => buildGridPlan({ pair: "BNB/USDT", lowerPrice: "1", upperPrice: "2", capital: "1", gridCount: 101 })).toThrow(/2 to 100/);
  });
});

describe("Mainnet browser allowlist", () => {
  it("adds only the explicitly configured operated seller to Grid", () => {
    const entries = marketplaceInventoryEntries({ ERC8183_MAINNET_SELLER_AGENT_ID: "9001" });
    const operated = entries.filter(({ operator }) => operator === "marketplace");
    expect(operated).toHaveLength(1);
    expect(operated[0]).toMatchObject({ agentId: "9001", categories: [{ category: "grid_trading" }] });
    expect(entries.filter(({ operator }) => operator === "third_party")).toHaveLength(4);
  });

  it("accepts chain 56 only when the server supplied an explicit Mainnet deployment", () => {
    expect(() => assertBrowserSpikeChain(56)).toThrow(/chain 97/);
    expect(() => assertBrowserSpikeChain(56, deployment())).not.toThrow();
    expect(() => assertBrowserSpikeChain(97, deployment())).toThrow(/chain 56/);
  });

  it("keeps Mainnet journals isolated by chain, agent and seller", () => {
    const parsed = parseBrowserJournal({
      schemaVersion: 1,
      chainId: 56,
      buyer: BUYER,
      seller: SELLER,
      jobId: "9",
      transactions: {},
      lastConfirmedStep: "funded",
      privateKey: "ignored",
    }, deployment());
    expect(parsed).toMatchObject({ chainId: 56, buyer: BUYER, seller: SELLER, jobId: "9" });
    expect(parsed).not.toHaveProperty("privateKey");
  });

  it("is disabled by default and accepts no arbitrary origin or contracts", () => {
    expect(() => loadMainnetBrowserDemoConfig({})).toThrow(/disabled/);
    expect(() => loadMainnetBrowserDemoConfig({
      ERC8183_MAINNET_DEMO_ENABLED: "true",
      ERC8183_MAINNET_SELLER_ORIGIN: "https://attacker.example",
      ERC8183_MAINNET_SELLER_AGENT_ID: "9",
      ERC8183_MAINNET_SELLER_ADDRESS: SELLER,
    })).toThrow(/origin/);
    const config = loadMainnetBrowserDemoConfig({
      ERC8183_MAINNET_DEMO_ENABLED: "true",
      ERC8183_MAINNET_SELLER_ORIGIN: "https://bnb-agent-marketplace-ruby.vercel.app",
      ERC8183_MAINNET_SELLER_AGENT_ID: "9",
      ERC8183_MAINNET_SELLER_ADDRESS: SELLER,
    });
    expect(config.deployment).toMatchObject({ chainId: 56, commerce: ERC8183_MAINNET.commerce, token: ERC8183_MAINNET.token });
  });
});

describe("published verification evidence", () => {
  it("contains provenance and no endpoint or probe payload fields", () => {
    const reparsed = parsePublicVerificationSnapshot(PUBLIC_VERIFICATION_SNAPSHOT);
    expect(reparsed.agents).toHaveLength(5);
    expect(reparsed.agents.filter(({ operator }) => operator === "third_party")).toHaveLength(4);
    expect(reparsed.agents.filter(({ operator }) => operator === "marketplace")).toEqual([
      expect.objectContaining({
        agentId: "303779",
        categories: ["grid_trading"],
        qualification: expect.objectContaining({ status: "qualified" }),
      }),
    ]);
    expect(reparsed.agents.find(({ agentId }) => agentId === "43129")?.categories)
      .toEqual(["yield_optimisation", "health_factor_monitoring"]);
    expect(JSON.stringify(reparsed)).not.toMatch(/https?:|authorization|bearer|payload|private.?key/i);
    expect(reparsed.agents.every(({ identity }) => identity.provenance.join(",") === "declared,onchain")).toBe(true);
  });

  it("fails closed when the published snapshot crosses its freshness threshold", () => {
    expect(() => assertPublicVerificationSnapshotFresh(
      PUBLIC_VERIFICATION_SNAPSHOT,
      Date.parse(PUBLIC_VERIFICATION_SNAPSHOT.staleAfter) + 1,
    )).toThrow(/expired/);
  });

  it("rebuilds more often than the snapshot freshness window", () => {
    // Hireability requires verification.freshness === "current", so an expired
    // snapshot removes every Hire action from the live site with no code change.
    // Vercel regenerates the snapshot on each build, so the invariant is that a
    // scheduled rebuild runs strictly inside the publish window.
    const publishCli = readFileSync("src/verification/publish-cli.ts", "utf8");
    const declaredWindow = publishCli.match(/--max-age-hours"\)\s*\?\?\s*"(\d+)"/);
    expect(declaredWindow).not.toBeNull();
    const windowHours = Number(declaredWindow![1]);

    const workflow = readFileSync(".github/workflows/refresh-release-snapshot.yml", "utf8");
    const schedule = workflow.match(/cron:\s*"0 \*\/(\d+) \* \* \*"/);
    expect(schedule).not.toBeNull();
    const rebuildEveryHours = Number(schedule![1]);

    // A missed run must still leave room to recover before the snapshot expires.
    expect(rebuildEveryHours * 2).toBeLessThan(windowHours);
  });

  it("regenerates sanitized verification evidence before every Vercel build", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { buildCommand: string };
    expect(vercel.buildCommand).toBe("npm run build:deployment");
    expect(packageJson.scripts["build:deployment"]).toBe("npm run readiness:bsc && npm run publish:verification && npm run build");
  });

  it("loads local readiness configuration without requiring an env file in deployment", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts["readiness:bsc"]).toBe(
      "if [ -f .env.local ]; then node --env-file=.env.local --import tsx src/readiness/cli.ts; else tsx src/readiness/cli.ts; fi",
    );
  });
});

describe("Mainnet security decision", () => {
  it("loads the local Mainnet configuration for the documented go/no-go command", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts["mainnet:go-no-go"]).toBe(
      "node --env-file=.env.local --import tsx src/mainnet/go-no-go-cli.ts",
    );
  });

  it("keeps seller key material out of object logs, JSON and error responses", async () => {
    const secret = `0x${"11".repeat(32)}` as Hex;
    const config = loadMainnetGridSellerConfig({
      ERC8183_MAINNET_SELLER_ENABLED: "true",
      ERC8183_MAINNET_SELLER_ORIGIN: "https://bnb-agent-marketplace-ruby.vercel.app",
      ERC8183_MAINNET_SELLER_ADDRESS: privateKeyToAccount(secret).address,
      ERC8183_MAINNET_SELLER_AGENT_ID: "9001",
      MAINNET_SELLER_PRIVATE_KEY: secret,
    });
    const error = Object.assign(new Error("seller failed"), { config });
    const hostedConfig = loadHostedSellerConfig({
      ERC8183_BROWSER_SPIKE_SELLER_ORIGIN: "https://bnb-agent-marketplace-ruby.vercel.app",
      SELLER_PRIVATE_KEY: secret,
    });
    const serialized = JSON.stringify({ config, hostedConfig, error });
    const inspected = inspect({ config, hostedConfig, error });
    const directResponse = await Response.json({ config, hostedConfig }).text();
    const errorResponse = await erc8183SpikeErrorResponse(error, "Mainnet").text();

    expect(config.privateKey).toBe(secret);
    expect(hostedConfig.privateKey).toBe(secret);
    expect(Object.keys(config)).not.toContain("privateKey");
    expect(Object.keys(hostedConfig)).not.toContain("privateKey");
    for (const output of [serialized, inspected, directResponse, errorResponse]) {
      expect(output).not.toContain(secret);
      expect(output).not.toMatch(/privateKey|MAINNET_SELLER_PRIVATE_KEY/);
    }
  });

  it("remains NO_GO until the dedicated seller public configuration is present", async () => {
    const implementationStorage = (address: string) => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}` as `0x${string}`;
    const client = {
      getBlockNumber: async () => 123n,
      getChainId: async () => 56,
      getCode: async () => "0x01",
      getBalance: async () => 2_000_000_000_000_000n,
      getStorageAt: async ({ address, slot }: { address: string; slot: string }) => {
        expect(slot).toBe(ERC1967_IMPLEMENTATION_SLOT);
        return implementationStorage(address.toLowerCase() === ERC8183_MAINNET.commerce.toLowerCase()
          ? ERC8183_MAINNET.commerceImplementation
          : ERC8183_MAINNET.routerImplementation);
      },
      readContract: async ({ functionName }: { functionName: string }) => ({
        paymentToken: ERC8183_MAINNET.token,
        policyWhitelist: true,
        commerce: ERC8183_MAINNET.commerce,
        router: ERC8183_MAINNET.router,
        disputeWindow: 604800n,
        voteQuorum: 3,
        activeVoterCount: 5,
        admin: SELLER,
        symbol: "U",
        decimals: 18,
      })[functionName],
    } as unknown as PublicClient;
    const sellerEndpointProbe = vi.fn(async () => true);
    const report = await evaluateMainnetGoNoGo({ client, env: {}, now: () => new Date("2026-08-24T00:00:00Z"), sellerEndpointProbe });
    expect(report.status).toBe("no_go");
    expect(report.reasons).toEqual(expect.arrayContaining(["dedicatedSellerAddress", "productionSellerOrigin", "productionSellerEndpoint"]));
    expect(report.checks.policyAllowlisted?.passed).toBe(true);
    expect(sellerEndpointProbe).not.toHaveBeenCalled();

    const configured = await evaluateMainnetGoNoGo({
      client,
      env: {
        ERC8183_MAINNET_SELLER_ADDRESS: SELLER,
        ERC8183_MAINNET_SELLER_ORIGIN: "https://bnb-agent-marketplace-ruby.vercel.app",
      },
      now: () => new Date("2026-08-24T00:01:00Z"),
      sellerEndpointProbe,
    });
    expect(configured.status).toBe("go");
    expect(configured.checks.productionSellerEndpoint).toMatchObject({
      passed: true,
      provenance: "observed:https-dns-pinned",
    });
    expect(sellerEndpointProbe).toHaveBeenCalledWith("https://bnb-agent-marketplace-ruby.vercel.app");
  });
});
