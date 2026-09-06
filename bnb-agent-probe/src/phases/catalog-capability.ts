import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { createDatabase, type CatalogSellerCapabilityRow } from "../db/orm";
import { catalogQuoteAttempts, catalogQuoteRequests, catalogSellerCapabilities } from "../db/schema";
import type { D1DatabaseLike } from "../db/client";
import { discoverNegotiationInput, probeA2aSeller, probeErc8183HttpSeller, probeMcpSeller, SellerProbeError } from "../lib/seller-client";
import { NegotiationRequest } from "@bnbagent/sdk/erc8183";
import { buildContractRequest } from "../../../src/shared/negotiation-input";
import { recordCompatibility, COMPATIBILITY_TTL_MS } from "../catalog/compatibility";
import { needsProviderChange } from "../catalog/sweep-metrics";
import type { Env, QueueProducer } from "../types";
import type { WorkerConfig } from "../config";
import { persistQuoteResult, readContext, targetFor, sha256 } from "../routes/catalog-quotes";

const CLAIM_LEASE_MS = 5 * 60 * 1_000;
const AGENT_KEY = /^eip155:56:[1-9]\d{0,19}$/;
const ENDPOINT_KEY = /^[a-f0-9]{64}$/;

export const CATALOG_CAPABILITY_WORK_KIND = "catalog_capability_probe" as const;

export interface CatalogCapabilityWork {
  readonly schemaVersion: 2;
  readonly kind: typeof CATALOG_CAPABILITY_WORK_KIND;
  readonly agentKey: string;
  readonly endpointKey: string;
  readonly enqueuedAt: number;
}

export interface CatalogCapabilityQueueSummary {
  readonly selected?: number;
  readonly enqueued: number;
  readonly skipped: number;
  readonly pending: number;
  readonly ready: number;
  readonly stale: number;
  readonly failed: number;
}

export interface CatalogCapabilityProbeSummary {
  readonly status: "succeeded" | "rejected" | "failed" | "skipped";
  readonly agentKey: string;
  readonly endpointKey: string;
  readonly requestId: number | null;
  readonly attemptId: string | null;
  readonly errorCode: string | null;
  readonly durationMs: number;
}

function errorCode(error: unknown): string {
  if (error instanceof SellerProbeError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.message)) return error.message;
  return "SELLER_UNREACHABLE";
}

function capabilityPayload(row: Pick<CatalogSellerCapabilityRow, "agentKey" | "endpointKey">, enqueuedAt: number): CatalogCapabilityWork {
  return {
    schemaVersion: 2,
    kind: CATALOG_CAPABILITY_WORK_KIND,
    agentKey: row.agentKey,
    endpointKey: row.endpointKey,
    enqueuedAt,
  };
}

/**
 * Claim due capability rows and enqueue one physical probe per seller. The
 * claim moves nextProbeAt into a short lease before sending so two cron ticks
 * cannot fan out duplicate probes. A send failure releases that lease.
 */
export async function enqueueDueCatalogCapabilities(
  dbBinding: D1DatabaseLike,
  queue: QueueProducer,
  input: { readonly nowMs: number; readonly limit: number; readonly concurrency?: number; readonly bootstrapLimit?: number; readonly originPerMinute?: number },
): Promise<CatalogCapabilityQueueSummary> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1) throw new Error("CATALOG_QUOTE_BATCH_SIZE");
  const concurrency = input.concurrency ?? input.limit;
  const bootstrapLimit = input.bootstrapLimit ?? 0;
  const originPerMinute = input.originPerMinute ?? 1;
  if (!Number.isSafeInteger(originPerMinute) || originPerMinute < 1 || originPerMinute > 4) throw new Error("CATALOG_QUOTE_ORIGIN_PER_MINUTE");
  if (!Number.isSafeInteger(bootstrapLimit) || bootstrapLimit < 0 || bootstrapLimit > 100) throw new Error("CATALOG_COMPATIBILITY_BOOTSTRAP_BATCH_SIZE");
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error("CATALOG_QUOTE_CONCURRENCY");
  const db = createDatabase(dbBinding);
  // Repair stale scheduling markers from earlier discovery runs without
  // manufacturing new quote evidence or extending its expiry.
  await db.run(sql`UPDATE catalog_seller_capabilities SET state='ready', updatedAt=${input.nowMs}
    WHERE state='stale' AND compatibilityState='compatible'
      AND compatibilityExpiresAt > ${input.nowMs} AND capabilityExpiresAt > ${input.nowMs}
      AND lastSuccessAt IS NOT NULL AND consecutiveFailures=0 AND lastErrorCode IS NULL`);
  await db.update(catalogSellerCapabilities).set({
    state: "stale",
    nextProbeAt: input.nowMs,
    updatedAt: input.nowMs,
  }).where(and(
    eq(catalogSellerCapabilities.state, "ready"),
    lte(catalogSellerCapabilities.capabilityExpiresAt, input.nowMs),
  ));
  const selectDue = (bootstrap: boolean | null, window: number) => db.all<{
    agentKey: string; endpointKey: string; originKey: string; compatibilityState: string; nextProbeAt: number | null;
  }>(sql`
    WITH ranked AS (
      SELECT c.agentKey, c.endpointKey, COALESCE(e.originKey, e.endpointKey) AS originKey,
        c.compatibilityState,
        CASE WHEN e.lastAttemptOutcome='protocol_valid' THEN 0 ELSE 1 END AS onlineRank,
        CASE WHEN c.transport='erc8183_http' THEN 0 ELSE 1 END AS transportRank,
        c.nextProbeAt, c.updatedAt,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(e.originKey, e.endpointKey)
          ORDER BY CASE WHEN e.lastAttemptOutcome='protocol_valid' THEN 0 ELSE 1 END,
            CASE WHEN c.transport='erc8183_http' THEN 0 ELSE 1 END,
            c.nextProbeAt, c.updatedAt, c.agentKey, c.endpointKey
        ) AS originRank
      FROM catalog_seller_capabilities c
      JOIN catalog_agents a ON a.agentKey=c.agentKey AND a.indexState='current' AND a.chainId=56
      JOIN catalog_agent_endpoints ae ON ae.agentKey=c.agentKey AND ae.endpointKey=c.endpointKey AND ae.declarationState='current'
      JOIN catalog_endpoints e ON e.endpointKey=c.endpointKey AND e.role='operational' AND e.eligibility='eligible'
      WHERE c.state IN ('discovered','ready','stale','failed')
        AND (c.nextProbeAt IS NULL OR c.nextProbeAt <= ${input.nowMs})
        AND NOT (c.state='ready' AND COALESCE(c.capabilityExpiresAt,0) > ${input.nowMs}
          AND c.compatibilityState='compatible' AND COALESCE(c.compatibilityExpiresAt,0) > ${input.nowMs}
          AND c.lastSuccessAt IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM runtime_state r
          WHERE r.key='catalog_sweep_origin:' || COALESCE(e.originKey,e.endpointKey)
            AND (r.integerValue > ${Math.floor(input.nowMs / 60_000)}
              OR (r.integerValue=${Math.floor(input.nowMs / 60_000)} AND CAST(r.textValue AS INTEGER)>=${originPerMinute})))
        AND ${bootstrap === null ? sql`1=1` : bootstrap ? sql`c.compatibilityState='pending'` : sql`c.compatibilityState<>'pending'`}
    )
    SELECT agentKey, endpointKey, originKey, compatibilityState, nextProbeAt FROM ranked
    WHERE originRank <= ${originPerMinute}
    ORDER BY originRank, onlineRank, transportRank, nextProbeAt, updatedAt, agentKey, endpointKey
    LIMIT ${Math.min(1000, window * 10)}
  `);
  // Independent candidate windows: retries on reachable hosts must not crowd
  // first-time discovery out of the bounded SQL result (or vice versa).
  const cohorts = bootstrapLimit > 0
    ? await Promise.all([selectDue(true, bootstrapLimit), selectDue(false, input.limit)])
    : [await selectDue(null, input.limit)];
  // Share an origin's slot across first-time checks and maintenance instead of
  // letting a large bootstrap backlog monopolize that host indefinitely.
  // Rotation is deterministic for the one-minute scheduler and adds no writes.
  if (bootstrapLimit > 0 && Math.floor(input.nowMs / 60_000) % 2 === 1) cohorts.reverse();
  const due = cohorts.flat();
  // A single origin can host many catalogued agents. Bound capability
  // probes per origin and cap the total number of queued probes. The
  // five-minute claim lease prevents a second tick from re-queuing the same
  // endpoint while the queue consumer is still working.
  const selected: typeof due = [];
  const origins = new Map<string, number>();
  let bootstrapSelected = 0;
  let maintenanceSelected = 0;
  for (const row of due) {
    const bootstrap = bootstrapLimit > 0 && row.compatibilityState === "pending";
    if (bootstrap ? bootstrapSelected >= bootstrapLimit : maintenanceSelected >= Math.min(input.limit, concurrency)) continue;
    const origin = row.originKey ?? row.endpointKey;
    if ((origins.get(origin) ?? 0) >= originPerMinute) continue;
    origins.set(origin, (origins.get(origin) ?? 0) + 1);
    selected.push(row);
    if (bootstrap) bootstrapSelected += 1;
    else maintenanceSelected += 1;
  }
  let enqueued = 0;
  let skipped = 0;
  for (const row of selected) {
    const claimed = await db.update(catalogSellerCapabilities).set({
      nextProbeAt: input.nowMs + CLAIM_LEASE_MS,
      updatedAt: input.nowMs,
    }).where(and(
      eq(catalogSellerCapabilities.agentKey, row.agentKey),
      eq(catalogSellerCapabilities.endpointKey, row.endpointKey),
      inArray(catalogSellerCapabilities.state, ["discovered", "ready", "stale", "failed"]),
      or(isNull(catalogSellerCapabilities.nextProbeAt), lte(catalogSellerCapabilities.nextProbeAt, input.nowMs)),
    )).returning({ agentKey: catalogSellerCapabilities.agentKey });
    if (claimed.length === 0) {
      skipped += 1;
      continue;
    }
    // A durable minute reservation coordinates separate cron invocations.
    // Failed sends consume their slot conservatively; they do not create a burst.
    const minute = Math.floor(input.nowMs / 60_000);
    const reserved = await db.all<{ integerValue: number }>(sql`
      INSERT INTO runtime_state (key,textValue,integerValue,updatedAt)
      VALUES (${`catalog_sweep_origin:${row.originKey}`}, '1', ${minute}, ${input.nowMs})
      ON CONFLICT(key) DO UPDATE SET
        textValue=CASE WHEN runtime_state.integerValue=${minute}
          THEN CAST(CAST(runtime_state.textValue AS INTEGER)+1 AS TEXT) ELSE '1' END,
        integerValue=${minute}, updatedAt=${input.nowMs}
      WHERE runtime_state.integerValue < ${minute}
        OR (runtime_state.integerValue=${minute} AND CAST(runtime_state.textValue AS INTEGER)<${originPerMinute})
      RETURNING integerValue
    `);
    if (reserved.length === 0) {
      skipped += 1;
      await db.update(catalogSellerCapabilities).set({ nextProbeAt: row.nextProbeAt, updatedAt: input.nowMs })
        .where(and(eq(catalogSellerCapabilities.agentKey, row.agentKey), eq(catalogSellerCapabilities.endpointKey, row.endpointKey)));
      continue;
    }
    try {
      await queue.send(capabilityPayload(row, input.nowMs));
      enqueued += 1;
    } catch {
      skipped += 1;
      await db.update(catalogSellerCapabilities).set({ nextProbeAt: input.nowMs, updatedAt: input.nowMs })
        .where(and(eq(catalogSellerCapabilities.agentKey, row.agentKey), eq(catalogSellerCapabilities.endpointKey, row.endpointKey)));
    }
  }
  // Keep the queue summary bounded. The previous implementation loaded every
  // capability row into the Worker just to count states, which made the
  // minute tick grow linearly with the catalogue. D1 can aggregate this using
  // the state index and return at most six rows.
  const counts = await db.all<{ state: string; total: number }>(sql`
    SELECT state, COUNT(*) AS total
    FROM catalog_seller_capabilities
    GROUP BY state
  `);
  const count = (state: string) => Number(counts.find((row) => row.state === state)?.total ?? 0);
  return {
    selected: selected.length,
    enqueued,
    skipped,
    pending: count("discovered"),
    ready: count("ready"),
    stale: count("stale"),
    failed: count("failed"),
  };
}

async function markFailure(
  db: ReturnType<typeof createDatabase>,
  capability: CatalogSellerCapabilityRow,
  attemptId: string,
  code: string,
  nowMs: number,
  config: WorkerConfig,
): Promise<void> {
  const failures = Math.max(0, capability.consecutiveFailures) + 1;
  const backoffIndex = Math.min(failures - 1, config.catalogFailureBackoffMinutes.length - 1);
  const minutes = config.catalogFailureBackoffMinutes[Math.max(0, backoffIndex)] ?? 60;
  await db.update(catalogSellerCapabilities).set({
    state: "failed",
    lastAttemptAt: nowMs,
    lastAttemptId: attemptId,
    lastErrorCode: code,
    consecutiveFailures: failures,
    nextProbeAt: nowMs + minutes * 60_000,
    updatedAt: nowMs,
  }).where(and(
    eq(catalogSellerCapabilities.agentKey, capability.agentKey),
    eq(catalogSellerCapabilities.endpointKey, capability.endpointKey),
  ));
}

/** Execute one queue message through the same dynamic seller adapters used by
 * the browser fallback. No transaction is created: this is a read-only
 * capability probe and its quote is stored as public readiness evidence. */
export async function runCatalogCapabilityProbe(
  work: CatalogCapabilityWork,
  env: Env,
  config: WorkerConfig,
  dependencies: { readonly now?: () => number; readonly fetchImpl?: typeof fetch } = {},
): Promise<CatalogCapabilityProbeSummary> {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const db = createDatabase(env.DB as never);
  const capabilityRows = await db.select().from(catalogSellerCapabilities).where(and(
    eq(catalogSellerCapabilities.agentKey, work.agentKey),
    eq(catalogSellerCapabilities.endpointKey, work.endpointKey),
  )).limit(1);
  const capability = capabilityRows[0];
  if (!capability || capability.state === "unsupported" || capability.state === "suspended") {
    return { status: "skipped", agentKey: work.agentKey, endpointKey: work.endpointKey, requestId: null, attemptId: null, errorCode: null, durationMs: 0 };
  }
  // Delayed/redelivered work must not re-negotiate evidence already refreshed
  // by a buyer or another execution. Discovery and quote TTLs are independent.
  const quoteFresh = capability.state === "ready" && capability.lastSuccessAt !== null
    && (capability.capabilityExpiresAt ?? 0) > startedAt;
  if (quoteFresh && capability.compatibilityState === "compatible" && (capability.compatibilityExpiresAt ?? 0) > startedAt) {
    return { status: "skipped", agentKey: work.agentKey, endpointKey: work.endpointKey, requestId: null, attemptId: null, errorCode: null, durationMs: 0 };
  }
  const agentId = work.agentKey.split(":").at(-1)!;
  const target = await targetFor(db, agentId, work.endpointKey);
  if (!target) {
    return { status: "skipped", agentKey: work.agentKey, endpointKey: work.endpointKey, requestId: null, attemptId: null, errorCode: "NO_QUOTE_TRANSPORT", durationMs: Math.max(0, now() - startedAt) };
  }
  let contract;
  try {
    contract = await discoverNegotiationInput({ ...target, request: {}, fetch: dependencies.fetchImpl ?? fetch, timeoutMs: 5000, maxResponseBytes: 32768 });
    const schemaHash = await sha256(contract);
    await recordCompatibility(db, target, now(), { schemaHash });
    if (quoteFresh && schemaHash === capability.schemaHash) {
      await db.update(catalogSellerCapabilities).set({ nextProbeAt: Math.min(capability.capabilityExpiresAt!, now() + COMPATIBILITY_TTL_MS) })
        .where(and(eq(catalogSellerCapabilities.agentKey, work.agentKey), eq(catalogSellerCapabilities.endpointKey, work.endpointKey)));
      return { status: "skipped", agentKey: work.agentKey, endpointKey: work.endpointKey, requestId: null, attemptId: null, errorCode: null, durationMs: Math.max(0, now() - startedAt) };
    }
  } catch (error) {
    const code = errorCode(error);
    await recordCompatibility(db, target, now(), { errorCode: code });
    const failures = capability.consecutiveFailures + 1;
    const delays = config.catalogFailureBackoffMinutes;
    // Structural/access blockers need provider action, not frequent automatic retries.
    const delay = needsProviderChange(code) ? 10080 : delays[Math.min(failures - 1, delays.length - 1)] ?? 60;
    // Requirements discovery is not a quote attempt. recordCompatibility owns
    // its error; preserve the independent signed-quote state and last error.
    await db.update(catalogSellerCapabilities).set({ consecutiveFailures: failures, nextProbeAt: now() + delay * 60000 }).where(and(eq(catalogSellerCapabilities.agentKey, work.agentKey), eq(catalogSellerCapabilities.endpointKey, work.endpointKey)));
    return { status: "skipped", agentKey: work.agentKey, endpointKey: work.endpointKey, requestId: null, attemptId: null, errorCode: code, durationMs: Math.max(0, now() - startedAt) };
  }
  if (!contract.capabilityProbeParameters) {
    await db.update(catalogSellerCapabilities).set({ nextProbeAt: now() + COMPATIBILITY_TTL_MS }).where(and(eq(catalogSellerCapabilities.agentKey, work.agentKey), eq(catalogSellerCapabilities.endpointKey, work.endpointKey)));
    return { status: "skipped", agentKey: work.agentKey, endpointKey: work.endpointKey, requestId: null, attemptId: null, errorCode: "BUYER_INPUT_REQUIRED", durationMs: Math.max(0, now() - startedAt) };
  }
  const requestObject = buildContractRequest(contract, contract.capabilityProbeParameters);
  const negotiation = NegotiationRequest.fromDict(requestObject);
  const template = { requestHash: negotiation.computeHash().toLowerCase() };
  const requestRows = await db.insert(catalogQuoteRequests).values({
    requestHash: template.requestHash,
    agentKey: target.agentKey,
    endpointKey: target.endpointKey,
    transport: target.transport,
    kind: "capability_probe",
    status: "running",
    callerKey: "scheduler",
    createdAt: startedAt,
    metadataJson: JSON.stringify({ requestHash: template.requestHash, transport: target.transport, endpoint: target.endpoint, quoteKind: "capability_probe" }),
  }).returning();
  const requestRow = requestRows[0];
  if (!requestRow) throw new Error("QUOTE_REQUEST_FAILED");
  const attemptId = crypto.randomUUID();
  await db.insert(catalogQuoteAttempts).values({
    id: attemptId,
    requestId: requestRow.id,
    executor: "worker",
    status: "running",
    startedAt,
    metadataJson: JSON.stringify({ requestHash: template.requestHash, transport: target.transport, endpoint: target.endpoint, quoteKind: "capability_probe" }),
  });
  try {
    const fetchImpl = dependencies.fetchImpl ?? fetch;
    const common = {
      endpoint: target.endpoint,
      request: requestObject,
      timeoutMs: target.transport === "a2a" ? config.catalogA2aTimeoutMs
        : target.transport === "mcp" ? config.catalogMcpTimeoutMs : config.catalogErc8183TimeoutMs,
      maxResponseBytes: config.maxSellerResponseBytes,
      fetch: fetchImpl,
    } as const;
    const result = target.transport === "a2a"
      ? await probeA2aSeller({ ...common, requireNotifyFunded: false })
      : target.transport === "mcp"
        ? await probeMcpSeller({
          ...common,
          taskDescription: String(requestObject.task_description),
          terms: requestObject.terms as {
            deliverables: string;
            quality_standards: string;
            evaluation_required: true;
            evaluator_type: "uma_oov3";
          },
        })
        : await (async () => {
          const context = await readContext(env, config, agentId, startedAt);
          return probeErc8183HttpSeller({
            ...common,
            expectedHttpStatus: {
              provider: context.provider,
              commerce: context.commerce,
              router: context.router,
              policy: context.policy,
              currency: context.paymentToken,
              decimals: context.tokenDecimals,
            },
          });
        })();
    const response = await persistQuoteResult(
      db,
      env,
      config,
      requestRow,
      attemptId,
      { ...result.quote, request: result.quote.request ?? requestObject },
      "worker",
      now(),
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { code?: unknown } | null;
      const code = typeof payload?.code === "string" ? payload.code : "QUOTE_REJECTED";
      await markFailure(db, capability, attemptId, code, now(), config);
      return { status: "rejected", agentKey: work.agentKey, endpointKey: work.endpointKey, requestId: requestRow.id, attemptId, errorCode: code, durationMs: Math.max(0, now() - startedAt) };
    }
    return { status: "succeeded", agentKey: work.agentKey, endpointKey: work.endpointKey, requestId: requestRow.id, attemptId, errorCode: null, durationMs: Math.max(0, now() - startedAt) };
  } catch (error) {
    const code = errorCode(error);
    await db.update(catalogQuoteAttempts).set({
      status: "failed", finishedAt: now(), durationMs: Math.max(0, now() - startedAt), outcome: "error", errorCode: code,
    }).where(eq(catalogQuoteAttempts.id, attemptId));
    await db.update(catalogQuoteRequests).set({ status: "failed", completedAt: now(), errorCode: code })
      .where(eq(catalogQuoteRequests.id, requestRow.id));
    await markFailure(db, capability, attemptId, code, now(), config);
    return { status: "failed", agentKey: work.agentKey, endpointKey: work.endpointKey, requestId: requestRow.id, attemptId, errorCode: code, durationMs: Math.max(0, now() - startedAt) };
  }
}

export function parseCatalogCapabilityWork(value: unknown, nowMs: number): CatalogCapabilityWork {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CATALOG_QUOTE_QUEUE_MESSAGE_INVALID");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 2 || row.kind !== CATALOG_CAPABILITY_WORK_KIND
    || typeof row.agentKey !== "string" || !AGENT_KEY.test(row.agentKey)
    || typeof row.endpointKey !== "string" || !ENDPOINT_KEY.test(row.endpointKey)
    || typeof row.enqueuedAt !== "number" || !Number.isSafeInteger(row.enqueuedAt)
    || row.enqueuedAt < 0 || row.enqueuedAt > nowMs + 5 * 60_000) {
    throw new Error("CATALOG_QUOTE_QUEUE_MESSAGE_INVALID");
  }
  return {
    schemaVersion: 2,
    kind: CATALOG_CAPABILITY_WORK_KIND,
    agentKey: row.agentKey,
    endpointKey: row.endpointKey,
    enqueuedAt: row.enqueuedAt,
  };
}
