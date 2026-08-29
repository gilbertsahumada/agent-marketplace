import { describe, expect, it } from "vitest";
import {
  createInMemorySellerObservationStore,
} from "../src/data/observations/seller-observation-store.ts";
import type { SellerObservation } from "../src/business/entities/seller-observation.ts";
import type { MainnetDemoPublicConfig } from "../src/business/entities/mainnet-browser-demo.ts";
import type { NormalizedErc8183Quote } from "../src/business/entities/erc8183-browser-spike.ts";
import { RecordSellerObservation } from "../src/business/use-cases/record-seller-observation.ts";

function observation(overrides: Partial<SellerObservation> = {}): SellerObservation {
  return {
    agentId: "303779",
    observedAt: "2026-08-27T10:00:00.000Z",
    quoteStatus: "verified",
    transport: "a2a",
    endpoint: "https://fixture.example/a2a",
    priceRaw: "10000000000000000",
    currency: "0xcE24439F2D9C6a2289F741120FE202248B666666",
    signatureMethod: "eip191",
    errorCode: null,
    ...overrides,
  };
}

describe("seller observation store", () => {
  it("returns the most recent observation per agent", async () => {
    const store = createInMemorySellerObservationStore([
      observation({ observedAt: "2026-08-27T10:00:00.000Z" }),
      observation({ observedAt: "2026-08-27T10:05:00.000Z", quoteStatus: "unavailable" }),
      observation({ agentId: "45650", observedAt: "2026-08-27T09:00:00.000Z" }),
    ]);

    const latest = await store.latest(["303779", "45650"]);

    expect(latest.get("303779")).toMatchObject({
      observedAt: "2026-08-27T10:05:00.000Z",
      quoteStatus: "unavailable",
    });
    expect(latest.get("45650")?.observedAt).toBe("2026-08-27T09:00:00.000Z");
  });

  it("omits agents that were never observed instead of inventing a state", async () => {
    const store = createInMemorySellerObservationStore([observation()]);

    const latest = await store.latest(["303779", "99999"]);

    expect(latest.has("303779")).toBe(true);
    expect(latest.has("99999")).toBe(false);
  });

  it("keeps a failed probe as evidence rather than dropping it", async () => {
    const store = createInMemorySellerObservationStore();
    await store.record(observation({
      quoteStatus: "unavailable",
      priceRaw: null,
      currency: null,
      signatureMethod: null,
      errorCode: "SELLER_UNREACHABLE",
    }));

    const latest = await store.latest(["303779"]);

    expect(latest.get("303779")).toMatchObject({ quoteStatus: "unavailable", errorCode: "SELLER_UNREACHABLE" });
  });

  it("returns nothing for an empty request without querying", async () => {
    const store = createInMemorySellerObservationStore([observation()]);
    expect(await store.latest([])).toEqual(new Map());
  });

  it("records evidence without persisting a derived hireability label", async () => {
    const store = createInMemorySellerObservationStore();
    const config: MainnetDemoPublicConfig = {
      agentId: 303779,
      seller: "0x0000000000000000000000000000000000000001",
      commerce: "0x0000000000000000000000000000000000000002",
      router: "0x0000000000000000000000000000000000000003",
      policy: "0x0000000000000000000000000000000000000004",
      token: "0x0000000000000000000000000000000000000005",
      maximumBudgetRaw: "1",
      rpcUrl: "https://rpc.example",
      explorerUrl: "https://explorer.example",
      sellerOrigin: "https://seller.example",
    };
    const quote = {
      endpoint: "https://seller.example",
      priceRaw: "1",
      token: config.token,
    } as NormalizedErc8183Quote;

    const result = await new RecordSellerObservation(
      { execute: () => config },
      { execute: async () => quote },
      () => store,
      () => "2026-08-27T11:00:00.000Z",
    ).execute();

    expect(result).toMatchObject({ observed: 1, quoteStatus: "verified" });
    expect(result).not.toHaveProperty("hireable");
    expect(store.all()[0]).toMatchObject({
      agentId: "303779",
      observedAt: "2026-08-27T11:00:00.000Z",
      quoteStatus: "verified",
    });
    expect(store.all()[0]).not.toHaveProperty("hireable");
  });
});
