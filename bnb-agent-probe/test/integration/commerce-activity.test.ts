import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { createWorker } from "../../src/index";
import { commerceActivityResponse } from "../../src/routes/commerce-jobs";
import type { D1Database, Env } from "../../src/types";

const NOW = 1_788_000_000_000; // 2026-08-29T10:40:00.000Z
const DAY = 86_400_000;
const BUYER = "0x5ee75a1B1648C023e885E58bD3735Ae273f2cc52";
const SELLER = "0xA2a2012e52Fd075c0F3146e37E833E7294ee52B5";
const OTHER = "0x1111111111111111111111111111111111111111";

type Phase = "created" | "funded" | "submitted" | "settled" | "refunded";
type Counts = Record<Phase, number>;
type Body = {
  schemaVersion: number;
  chainId: number;
  days: number;
  from: number;
  to: number;
  byDay: Array<{ day: string } & Counts>;
  totals: Counts;
};

const ZERO: Counts = { created: 0, funded: 0, submitted: 0, settled: 0, refunded: 0 };
const day = (date: string, counts: Partial<Counts>) => ({ day: date, ...ZERO, ...counts });

let sequence = 0;

async function seedJob(chainId: 56 | 97, jobId: number, provider: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO commerce_jobs
    (chainId, jobId, client, provider, evaluator, budget, expiredAt, status, hook, submittedAt, deliverable, firstSeenAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, '10000000000000000', ?, 1, ?, NULL, NULL, ?, ?)`)
    .bind(chainId, jobId, BUYER, provider, OTHER, NOW + 600_000, OTHER, NOW, NOW).run();
}

async function seedEvent(chainId: 56 | 97, jobId: number, phase: Phase, blockTimestamp: number): Promise<void> {
  sequence += 1;
  const txHash = `0x${sequence.toString(16).padStart(64, "0")}`;
  await env.DB.prepare(`INSERT INTO commerce_job_events
    (chainId, jobId, phase, eventName, txHash, logIndex, blockNumber, blockTimestamp, actor, amount, deliverable, reason, indexedAt)
    VALUES (?, ?, ?, 'JobEvent', ?, 0, ?, ?, NULL, NULL, NULL, NULL, ?)`)
    .bind(chainId, jobId, phase, txHash, 1_000 + sequence, blockTimestamp, NOW).run();
}

async function seedHire(agentId: string, jobId: number, provenance: "chain_verified" | "marketplace_observed"): Promise<void> {
  sequence += 1;
  await env.DB.prepare(`INSERT INTO hire_events
    (eventKey, agentId, chainId, phase, provenance, jobId, txHash, blockNumber, occurredAt, verifiedAt, callerKey)
    VALUES (?, ?, 56, 'funded', ?, ?, ?, '1001', ?, ?, 'anonymous')`)
    .bind(`56:${sequence}:funded`, agentId, provenance, String(jobId), `0x${sequence.toString(16).padStart(64, "0")}`, NOW, NOW).run();
}

// Chain 56: job 901 belongs to SELLER, jobs 902 and 904 to OTHER. Timestamps
// straddle a UTC midnight, the `from` boundary of the default window and `to`.
async function seedLedger(): Promise<void> {
  await seedJob(56, 901, SELLER);
  await seedJob(56, 902, OTHER);
  await seedJob(56, 904, OTHER);
  await seedJob(97, 903, SELLER);
  await seedEvent(56, 901, "created", Date.UTC(2026, 7, 28, 23, 59, 59));
  await seedEvent(56, 901, "funded", Date.UTC(2026, 7, 29, 0, 0, 1));
  await seedEvent(56, 901, "submitted", NOW - 1_000);
  await seedEvent(56, 901, "settled", NOW - 1);
  await seedEvent(56, 902, "created", NOW - 5 * DAY);
  await seedEvent(56, 904, "created", NOW - 5 * DAY + 1);
  await seedEvent(56, 904, "funded", NOW - 30 * DAY); // exactly `from` of the default window: included
  await seedEvent(56, 904, "funded", NOW - 30 * DAY - 1); // one millisecond older: excluded
  await seedEvent(56, 902, "refunded", NOW - 40 * DAY); // outside 30 days, inside 90
  await seedEvent(56, 902, "settled", NOW); // `to` is exclusive
  await seedEvent(97, 903, "created", NOW - 1_000);
  await seedHire("303779", 901, "chain_verified");
  await seedHire("303779", 902, "marketplace_observed"); // a marketplace claim never counts
  await seedHire("999", 904, "chain_verified");
}

function activity(query: string, db: D1Database = env.DB): Promise<Response> {
  return commerceActivityResponse(new Request(`https://worker.test/commerce-activity?${query}`), db, NOW);
}

beforeEach(async () => {
  sequence = 0;
  await env.DB.prepare("DELETE FROM hire_events").run();
  await env.DB.prepare("DELETE FROM commerce_jobs").run();
  // The ledger is append-only; drop its triggers for the reset, then restore them.
  await env.DB.prepare("DROP TRIGGER IF EXISTS commerce_job_events_no_delete").run();
  await env.DB.prepare("DELETE FROM commerce_job_events").run();
  await env.DB.prepare(`CREATE TRIGGER commerce_job_events_no_delete
    BEFORE DELETE ON commerce_job_events
    BEGIN SELECT RAISE(ABORT, 'commerce_job_events is append-only'); END`).run();
});

describe("commerceActivityResponse", () => {
  it("groups phase events per UTC day inside the default 30-day window, ascending, only days with events", async () => {
    await seedLedger();
    const response = await activity("chainId=56");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, stale-while-revalidate=300");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await response.json() as Body;
    expect(body).toEqual({
      schemaVersion: 1,
      chainId: 56,
      days: 30,
      from: NOW - 30 * DAY,
      to: NOW,
      byDay: [
        day("2026-07-30", { funded: 1 }),
        day("2026-08-24", { created: 2 }),
        day("2026-08-28", { created: 1 }),
        day("2026-08-29", { funded: 1, submitted: 1, settled: 1 }),
      ],
      totals: { created: 3, funded: 2, submitted: 1, settled: 1, refunded: 0 },
    });
  });

  it("honours an explicit window: days=90 reaches the older refund, days=1 keeps only the last day", async () => {
    await seedLedger();
    const wide = await (await activity("chainId=56&days=90")).json() as Body;
    expect(wide.days).toBe(90);
    expect(wide.from).toBe(NOW - 90 * DAY);
    expect(wide.byDay[0]).toEqual(day("2026-07-20", { refunded: 1 }));
    // The funded event one millisecond before the default `from` now falls inside the window.
    expect(wide.byDay[1]).toEqual(day("2026-07-30", { funded: 2 }));
    expect(wide.byDay).toHaveLength(5);
    expect(wide.totals).toEqual({ created: 3, funded: 3, submitted: 1, settled: 1, refunded: 1 });

    const narrow = await (await activity("chainId=56&days=1")).json() as Body;
    expect(narrow.days).toBe(1);
    expect(narrow.from).toBe(NOW - DAY);
    expect(narrow.byDay).toEqual([
      day("2026-08-28", { created: 1 }),
      day("2026-08-29", { funded: 1, submitted: 1, settled: 1 }),
    ]);
    expect(narrow.totals).toEqual({ created: 1, funded: 1, submitted: 1, settled: 1, refunded: 0 });
  });

  it("scopes to one chain and reports an empty window as no days and zero totals", async () => {
    await seedLedger();
    const testnet = await (await activity("chainId=97")).json() as Body;
    expect(testnet.chainId).toBe(97);
    expect(testnet.byDay).toEqual([day("2026-08-29", { created: 1 })]);

    const empty = await (await activity(`chainId=97&provider=${OTHER}`)).json() as Body;
    expect(empty.byDay).toEqual([]);
    expect(empty.totals).toEqual(ZERO);
  });

  it("filters by provider wallet, comparing the checksummed address", async () => {
    await seedLedger();
    const body = await (await activity(`chainId=56&provider=${SELLER.toLowerCase()}`)).json() as Body;
    expect(body.byDay).toEqual([
      day("2026-08-28", { created: 1 }),
      day("2026-08-29", { funded: 1, submitted: 1, settled: 1 }),
    ]);
    expect(body.totals).toEqual({ created: 1, funded: 1, submitted: 1, settled: 1, refunded: 0 });
  });

  it("filters by agent through chain-verified hire events only", async () => {
    await seedLedger();
    const body = await (await activity("chainId=56&agentId=303779")).json() as Body;
    expect(body.byDay).toEqual([
      day("2026-08-28", { created: 1 }),
      day("2026-08-29", { funded: 1, submitted: 1, settled: 1 }),
    ]);
    expect(body.totals).toEqual({ created: 1, funded: 1, submitted: 1, settled: 1, refunded: 0 });

    const unknown = await (await activity("chainId=56&agentId=424242")).json() as Body;
    expect(unknown.byDay).toEqual([]);
  });

  it.each([
    ["missing chainId", "days=7"],
    ["unsupported chainId", "chainId=1"],
    ["days=0", "chainId=56&days=0"],
    ["days=91", "chainId=56&days=91"],
    ["days with a leading zero", "chainId=56&days=07"],
    ["days not a number", "chainId=56&days=week"],
    ["provider and agentId together", `chainId=56&provider=${SELLER}&agentId=303779`],
    ["a malformed provider address", "chainId=56&provider=0x1234"],
    ["a malformed agentId", "chainId=56&agentId=0"],
    ["an unknown key", "chainId=56&buyer=" + BUYER],
    ["a duplicated key", "chainId=56&days=7&days=7"],
  ])("rejects %s with 400 and no caching", async (_label, query) => {
    const response = await activity(query);
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });
});

describe("GET /commerce-activity through the worker", () => {
  it("serves the route with the injected clock and the route's own cache headers when caching is off", async () => {
    await seedLedger();
    const app = createWorker({ now: () => NOW });
    const response = await app.fetch(
      new Request(`https://worker.test/commerce-activity?chainId=56&provider=${SELLER}`),
      env as unknown as Env,
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, stale-while-revalidate=300");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await response.json() as Body;
    expect(body.to).toBe(NOW);
    expect(body.totals).toEqual({ created: 1, funded: 1, submitted: 1, settled: 1, refunded: 0 });
  }, 30_000); // first fetch in this file pays the route bundle's cold import under a full parallel run

  it("rejects a duplicated query key at the worker boundary", async () => {
    const app = createWorker({ now: () => NOW });
    const response = await app.fetch(
      new Request("https://worker.test/commerce-activity?chainId=56&chainId=56"),
      { ...env, CATALOG_RESPONSE_CACHE_SECONDS: "300" } as unknown as Env,
      createExecutionContext(),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("serves repeat reads from one cache entry keyed on the canonical query", async () => {
    await seedLedger();
    const cachedEnv = { ...env, CATALOG_RESPONSE_CACHE_SECONDS: "300" } as unknown as Env;
    const app = createWorker({ now: () => NOW });
    const warm = await app.fetch(
      new Request("https://worker.test/commerce-activity?days=90&chainId=%35%36"),
      cachedEnv,
      createExecutionContext(),
    );
    expect(warm.status).toBe(200);
    expect(warm.headers.get("cache-control")).toBe("public, max-age=60, stale-while-revalidate=60");
    const warmBody = await warm.json() as Body;
    expect(warmBody.totals.refunded).toBe(1);

    const reads = { prepares: 0 };
    const counted: D1Database = {
      prepare(sql: string) {
        reads.prepares += 1;
        return env.DB.prepare(sql);
      },
    };
    const hit = await app.fetch(
      new Request("https://worker.test/commerce-activity?chainId=56&days=90"),
      { ...cachedEnv, DB: counted },
      createExecutionContext(),
    );
    expect(hit.status).toBe(200);
    expect(reads.prepares).toBe(0);
    expect(await hit.json()).toEqual(warmBody);
  });
});
