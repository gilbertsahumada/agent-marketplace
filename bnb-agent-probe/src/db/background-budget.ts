import type { D1DatabaseLike, D1PreparedStatementLike, D1ResultLike } from "./client";

export type BackgroundLane = "jobs" | "maintenance";
export const BACKGROUND_DAILY_NANO_USD = 25_000_000;
export const BACKGROUND_LANE_NANO_USD = { jobs: 10_000_000, maintenance: 15_000_000 } as const;
// Reserved for the atomic admission, settlement and emergency close queries.
// Local D1 profile: fresh admission 1 read/2 writes (2001 nanoUSD),
// existing admission 2 reads/1 write (1002), settlement 1 read/1 write (1001).
// 5000 covers the largest normal pair plus an emergency point update and margin.
// This deliberately remains charged: the last accounting write cannot account
// for its own observed cost before it has executed. Reject anomalous metadata.
export const BACKGROUND_CONTROL_NANO_USD = 5_000;
// A denied existing-row admission measured 2 reads/1 write = 1002 nanoUSD.
// It performs no settlement; leave headroom, and close on anomalous metadata.
export const BACKGROUND_DENIED_CONTROL_NANO_USD = 2_000;
export interface BackgroundBudgetOptions { readonly estimateNanoUsd?: number }
export type BackgroundBudgetResult<T> =
  | { readonly status: "denied"; readonly lane: BackgroundLane; readonly unitKey: string; readonly notBeforeMs: number }
  | { readonly status: "completed"; readonly value: T; readonly observedNanoUsd: number; readonly chargedNanoUsd: number };

export class BackgroundBudgetError extends Error {
  constructor(readonly code: "metadata" | "overrun" | "closed" | "database") {
    super(`BACKGROUND_BUDGET_${code.toUpperCase()}`);
    this.name = "BackgroundBudgetError";
  }
}

function cost(result: D1ResultLike): number {
  const meta = result.meta as { rows_read?: unknown; rows_written?: unknown } | null;
  if (!result.success || !meta || typeof meta !== "object"
    || typeof meta.rows_read !== "number" || !Number.isSafeInteger(meta.rows_read) || meta.rows_read < 0
    || typeof meta.rows_written !== "number" || !Number.isSafeInteger(meta.rows_written) || meta.rows_written < 0) {
    throw new BackgroundBudgetError("metadata");
  }
  const amount = meta.rows_read + meta.rows_written * 1_000;
  if (!Number.isSafeInteger(amount)) throw new BackgroundBudgetError("metadata");
  return amount;
}

/**
 * Atomically reserve the daily lane before executing a unit. The caller must
 * use only the supplied database for that unit and durably defer denied work.
 * Reservations survive crashes. Successful work refunds unused work estimate;
 * failure retains it. Accounting overhead is conservatively reserved, including
 * denied attempts. This bounds admission, not the cost of a single SQL statement:
 * D1 reports rows only after execution, so one statement/batch can overshoot.
 * unitKey labels a type of work; it is not an idempotency/deduplication key.
 */
export async function runWithBackgroundBudget<T>(
  database: D1DatabaseLike,
  lane: BackgroundLane,
  unitKey: string,
  nowMs: number,
  callback: (database: D1DatabaseLike) => Promise<T>,
  options: BackgroundBudgetOptions = {},
): Promise<BackgroundBudgetResult<T>> {
  return executeBackgroundUnit(database,lane,unitKey,nowMs,callback,options,false);
}

/** For mandatory deferred-work persistence only, never processing jobs. Its
 * cost remains charged even when normal admission has exhausted the lane. */
export async function runBackgroundControl<T>(
  database: D1DatabaseLike,
  lane: BackgroundLane,
  unitKey: string,
  nowMs: number,
  callback: (database: D1DatabaseLike) => Promise<T>,
  options: BackgroundBudgetOptions = {},
): Promise<Extract<BackgroundBudgetResult<T>,{status:"completed"}>> {
  const result=await executeBackgroundUnit(database,lane,unitKey,nowMs,callback,options,true);
  if(result.status!=="completed") throw new Error("BACKGROUND_CONTROL_ADMISSION");
  return result;
}

async function executeBackgroundUnit<T>(
  database:D1DatabaseLike,lane:BackgroundLane,unitKey:string,nowMs:number,
  callback:(database:D1DatabaseLike)=>Promise<T>,options:BackgroundBudgetOptions,controlOnly:boolean,
):Promise<BackgroundBudgetResult<T>> {
  const limit = BACKGROUND_LANE_NANO_USD[lane];
  const estimate = options.estimateNanoUsd ?? (lane === "jobs" ? 50_000 : 150_000);
  if (!limit || !unitKey.trim() || unitKey.length > 200 || !Number.isSafeInteger(nowMs) || nowMs < 0
    || !Number.isSafeInteger(estimate) || estimate < 1 || estimate > limit - BACKGROUND_CONTROL_NANO_USD) {
    throw new Error("BACKGROUND_BUDGET_INVALID_INPUT");
  }
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const key = `background_budget:${day}:${lane}`;
  const notBeforeMs = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
  const reserved = estimate + BACKGROUND_CONTROL_NANO_USD;
  let controls = 0;
  const closeLane = async () => {
    // Never retry this operation or a settlement automatically. A lost response
    // can mean a write committed. The latch survives concurrent settlements
    // refunding earlier reservations and lowering the numeric counter again.
    await database.prepare(`INSERT INTO runtime_state(key,textValue,integerValue,updatedAt)
      VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET
      integerValue=MAX(COALESCE(runtime_state.integerValue,0),?)+?,
      textValue=excluded.textValue,updatedAt=excluded.updatedAt`)
      .bind(key, `closed:${notBeforeMs}`, limit + BACKGROUND_CONTROL_NANO_USD, nowMs,
        limit, BACKGROUND_CONTROL_NANO_USD).run();
  };
  let admission: D1ResultLike<unknown, { textValue: string }>;
  try {
    admission = await database.prepare(`INSERT INTO runtime_state(key,textValue,integerValue,updatedAt)
      VALUES (?,'granted',?,?) ON CONFLICT(key) DO UPDATE SET
      textValue=CASE WHEN ?=1 OR runtime_state.textValue LIKE 'closed:%'
        OR runtime_state.textValue LIKE 'denied:%' THEN runtime_state.textValue
        WHEN COALESCE(runtime_state.integerValue,0)+?<=? THEN 'granted' ELSE ? END,
      integerValue=COALESCE(runtime_state.integerValue,0)+CASE WHEN ?=1 OR
        (COALESCE(runtime_state.textValue,'') NOT LIKE 'closed:%'
          AND COALESCE(runtime_state.textValue,'') NOT LIKE 'denied:%'
          AND COALESCE(runtime_state.integerValue,0)+?<=?) THEN ? ELSE ? END,
      updatedAt=excluded.updatedAt RETURNING CASE WHEN ?=1 THEN 'granted' ELSE textValue END AS textValue`)
      .bind(key,reserved,nowMs,Number(controlOnly),reserved,limit,`denied:${notBeforeMs}`,Number(controlOnly),reserved,limit,reserved,BACKGROUND_DENIED_CONTROL_NANO_USD,Number(controlOnly))
      .all<{ textValue: string }>();
    controls += cost(admission);
    if (controls > BACKGROUND_CONTROL_NANO_USD || admission.results?.length !== 1
      || !["granted",`denied:${notBeforeMs}`,`closed:${notBeforeMs}`].includes(admission.results[0]!.textValue)) throw new BackgroundBudgetError("metadata");
    if (admission.results[0]!.textValue !== "granted" && controls > BACKGROUND_DENIED_CONTROL_NANO_USD) {
      throw new BackgroundBudgetError("metadata");
    }
  } catch (error) {
    await closeLane();
    throw error;
  }
  // Persisted with the admission decision. Callers must retain this deadline
  // with deferred work rather than poll admission every minute after denial.
  if (admission.results![0]!.textValue !== "granted") return {status:"denied",lane,unitKey,notBeforeMs};

  let observed = 0;
  let terminal: BackgroundBudgetError | undefined;
  let active = true;
  let queue: Promise<unknown> = Promise.resolve();
  const originals = new WeakMap<D1PreparedStatementLike,D1PreparedStatementLike>();
  // Serialize accesses so parallel callers cannot bypass a known overrun.
  const execute = <R>(operation: () => Promise<R>, results: (result: R) => readonly D1ResultLike[]): Promise<R> => {
    const next = queue.then(async () => {
      if (!active) throw new BackgroundBudgetError("closed");
      if (terminal) throw terminal;
      let result: R;
      try { result = await operation(); }
      catch { terminal = new BackgroundBudgetError("database"); throw terminal; }
      try { for (const item of results(result)) observed += cost(item); }
      catch { terminal = new BackgroundBudgetError("metadata"); throw terminal; }
      if (!Number.isSafeInteger(observed)) terminal = new BackgroundBudgetError("metadata");
      else if (!controlOnly && observed > estimate) terminal = new BackgroundBudgetError("overrun");
      if (terminal) throw terminal;
      return result;
    });
    queue = next.catch(() => undefined);
    return next;
  };
  const wrap = (raw: D1PreparedStatementLike): D1PreparedStatementLike => {
    const statement: D1PreparedStatementLike = {
      bind: (...values) => wrap(raw.bind(...values)),
      all: <Row>() => execute(() => raw.all<Row>(), result => [result]),
      run: <Meta>() => execute(() => raw.run<Meta>(), result => [result]),
      async first<Row>() { return (await statement.all<Row>()).results?.[0] ?? null; },
      async raw<Row extends unknown[]>(options?: {columnNames?:boolean}) {
        const result = await statement.all<Record<string,unknown>>();
        const rows = result.results ?? [];
        const output = rows.map(row => Object.values(row)) as Row[];
        if(options?.columnNames && rows[0]) output.unshift(Object.keys(rows[0]) as Row);
        return output;
      },
    };
    originals.set(statement,raw);
    return statement;
  };
  const measured: D1DatabaseLike = {
    prepare: query => wrap(database.prepare(query)),
    async batch<Meta>(statements: readonly D1PreparedStatementLike[]) {
      const raw = statements.map(statement => {
        const original = originals.get(statement);
        if (!original) throw new Error("BACKGROUND_BUDGET_FOREIGN_STATEMENT");
        return original;
      });
      if (!raw.length) return [];
      return execute(() => database.batch<Meta>(raw), result => {
        if (result.length !== raw.length) throw new BackgroundBudgetError("metadata");
        return result;
      });
    },
  };
  let value: T;
  let failed = false;
  let failure: unknown;
  try { value = await callback(measured); }
  catch (error) { failed = true; failure = error; }
  await queue;
  active = false;
  if (terminal?.code === "metadata" || terminal?.code === "database") {
    await closeLane();
    throw terminal;
  }
  // A single settlement; never retry an ambiguous result, because the refund
  // may already have committed. The original reservation covered this write.
  const workCharge = failed || terminal ? Math.max(estimate,observed) : observed;
  try {
    const settlement = await database.prepare(`UPDATE runtime_state SET integerValue=integerValue+?,updatedAt=? WHERE key=?`)
      .bind(workCharge-estimate,nowMs,key).run();
    controls += cost(settlement);
    if (controls > BACKGROUND_CONTROL_NANO_USD) throw new BackgroundBudgetError("metadata");
  } catch (error) {
    await closeLane();
    throw error;
  }
  if (terminal) throw terminal;
  if (failed) throw failure;
  return {status:"completed",value:value!,observedNanoUsd:observed+controls,chargedNanoUsd:workCharge+BACKGROUND_CONTROL_NANO_USD};
}
