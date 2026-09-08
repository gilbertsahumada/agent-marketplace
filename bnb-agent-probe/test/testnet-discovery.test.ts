import { describe, expect, it, vi } from "vitest";
import type { D1DatabaseLike } from "../src/db/client";
import { enqueueTestnetDiscovery } from "../src/scheduled";
import type { Env } from "../src/types";

const config = { probeTimeoutMs: 1_000, maxCatalogResponseBytes: 1_024 * 1_024 };

function discoveryInput(overrides: Partial<Parameters<typeof enqueueTestnetDiscovery>[0]> = {}) {
  const logger = { info: vi.fn(), error: vi.fn() };
  const db = {
    prepare() { throw new Error("D1 must not be touched on the failure path"); },
    batch() { throw new Error("D1 must not be touched on the failure path"); },
  } as unknown as D1DatabaseLike;
  return {
    logger,
    input: {
      env: { CATALOG_TESTNET_ENABLED: "1", BSC_TESTNET_RPC_URL: "https://rpc.example" } as Env,
      phase: "header" as const,
      db,
      nowMs: 1_000,
      remainingQueries: 100,
      reservedQueries: 0,
      config,
      logger,
      fetch: vi.fn(async () => { throw new Error("TESTNET_REGISTRY_DOWN"); }) as unknown as typeof fetch,
      ...overrides,
    },
  };
}

describe("Testnet discovery is best-effort", () => {
  it("swallows a Testnet registry failure and reports it instead of aborting the phase", async () => {
    const { input, logger } = discoveryInput();

    await expect(enqueueTestnetDiscovery(input)).resolves.toBeNull();

    expect(input.fetch).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith("catalog.testnet.discovery.failed", {
      phase: "header",
      errorCode: "TESTNET_REGISTRY_DOWN",
    });
  });

  it("reports an invalid Testnet configuration without throwing", async () => {
    const { input, logger } = discoveryInput({ env: { CATALOG_TESTNET_ENABLED: "true" } as Env });

    await expect(enqueueTestnetDiscovery(input)).resolves.toBeNull();

    expect(input.fetch).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith("catalog.testnet.discovery.failed", {
      phase: "header",
      errorCode: "CATALOG_TESTNET_ENABLED_INVALID",
    });
  });

  it("sanitizes free-form failure messages into a fixed error code", async () => {
    const { input, logger } = discoveryInput({
      fetch: vi.fn(async () => { throw new Error("connect ECONNREFUSED 10.0.0.1:443"); }) as unknown as typeof fetch,
    });

    await enqueueTestnetDiscovery(input);

    expect(logger.error).toHaveBeenCalledWith("catalog.testnet.discovery.failed", {
      phase: "header",
      errorCode: "CATALOG_PROBE_FAILED",
    });
  });

  it("does nothing when Testnet is disabled", async () => {
    const { input, logger } = discoveryInput({ env: {} as Env });

    await expect(enqueueTestnetDiscovery(input)).resolves.toBeNull();

    expect(input.fetch).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does nothing when the remaining D1 query budget is reserved for Mainnet work", async () => {
    const { input, logger } = discoveryInput({ remainingQueries: 25, reservedQueries: 10 });

    await expect(enqueueTestnetDiscovery(input)).resolves.toBeNull();

    expect(input.fetch).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does nothing in the probe phase", async () => {
    const { input, logger } = discoveryInput({ phase: "probe" });

    await expect(enqueueTestnetDiscovery(input)).resolves.toBeNull();

    expect(input.fetch).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
