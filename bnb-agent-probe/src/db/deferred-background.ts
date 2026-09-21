import { sql, type SQL } from "drizzle-orm";
import type { D1DatabaseLike, D1ResultLike } from "./client";
import { createDatabase } from "./orm";
export type DeferredLane = "jobs" | "maintenance";
export interface DeferredMessage { id: string; body: unknown; ack(): void; }
const RETRY_MS = 15 * 60 * 1000;
const MAX_BYTES = 64 * 1024;
type Payload = { messageId: string; body: unknown; deferredAt: number; lease?: string };
function prefix(lane: DeferredLane, now: number) {
  if ((lane !== "jobs" && lane !== "maintenance") || !Number.isSafeInteger(now) || now <= 0 || now > Number.MAX_SAFE_INTEGER - RETRY_MS) {
    throw new Error("DEFERRED_BACKGROUND_INVALID_INPUT");
  }
  return `deferred_background:${lane}:`;
}
function encode(payload: Payload, reserveBytes = 0) {
  const text = JSON.stringify(payload);
  if (payload.body === undefined || new TextEncoder().encode(text).byteLength + reserveBytes > MAX_BYTES) throw new Error("DEFERRED_BACKGROUND_PAYLOAD_LIMIT");
  return text;
}
function decode(text: string): Payload {
  const value = JSON.parse(text) as Payload;
  if (!value || typeof value.messageId !== "string" || value.body === undefined || !Number.isSafeInteger(value.deferredAt)) {
    throw new Error("DEFERRED_BACKGROUND_INVALID_PAYLOAD");
  }
  return value;
}

// Keep success and returning rows together through the ORM boundary. In
// particular, an unsuccessful claim must never authorize a queue send.
async function query<Row>(db: ReturnType<typeof createDatabase>, statement: SQL): Promise<readonly Row[]> {
  let result: D1ResultLike<unknown, Row>;
  try { result = await db.run(statement) as D1ResultLike<unknown, Row>; }
  catch (error) {
    // Preserve budget errors for the caller's durable-deferral handling.
    if (error instanceof Error && error.cause instanceof Error) throw error.cause;
    throw error;
  }
  if (!result.success) throw new Error("DEFERRED_BACKGROUND_DATABASE_FAILED");
  return result.results ?? [];
}

/** The caller must validate and whitelist the body using its queue-work parser,
 * preserving original timestamps and schemaVersion but removing unknown fields.
 * Never acknowledge before durable confirmation.
 * A budget-denied caller must account for this small persistence separately.
 */
export async function persistDeferred(db: D1DatabaseLike, message: DeferredMessage, lane: DeferredLane, now: number, notBeforeMs?: number): Promise<{ key: string }> {
  const start = prefix(lane, now);
  if (notBeforeMs !== undefined && (!Number.isSafeInteger(notBeforeMs) || notBeforeMs < 0)) throw new Error("DEFERRED_BACKGROUND_INVALID_NOT_BEFORE");
  const due = Math.max(now + RETRY_MS, notBeforeMs ?? 0);
  const orm = createDatabase(db);
  if (!message.id || message.id.length > 256) throw new Error("DEFERRED_BACKGROUND_INVALID_ID");
  const text = encode({ messageId: message.id, body: message.body, deferredAt: now }, 64);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message.id));
  const key = start + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  await query(orm, sql`INSERT INTO runtime_state(key,textValue,integerValue,updatedAt) VALUES (${key},${text},${due},${now})
    ON CONFLICT(key) DO UPDATE SET integerValue=MAX(runtime_state.integerValue,${notBeforeMs ?? 0}),updatedAt=MAX(runtime_state.updatedAt,excluded.updatedAt)`);
  const [saved] = await query<{textValue:string}>(orm, sql`SELECT textValue FROM runtime_state WHERE key=${key}`);
  if (!saved) throw new Error("DEFERRED_BACKGROUND_PERSIST_UNCONFIRMED");
  const existing = decode(saved.textValue);
  if (existing.messageId !== message.id || JSON.stringify(existing.body) !== JSON.stringify(message.body)) {
    throw new Error("DEFERRED_BACKGROUND_MESSAGE_CONFLICT");
  }
  message.ack();
  return { key };
}

/** At-least-once replay: a crash after send leaves a lease which can expire.
 * The PK range isolates the lane; at most five due rows are claimed. A large
 * not-due backlog can still cost reads, so callers must pass a metered binding.
 */
export async function replayDeferred(db: D1DatabaseLike, lane: DeferredLane, queue: { send(body: unknown): Promise<unknown> }, now: number): Promise<{sent:number;failed:number}> {
  const start = prefix(lane, now);
  const orm = createDatabase(db);
  const rows = await query<{key:string;textValue:string}>(orm, sql`SELECT key,textValue FROM runtime_state
    WHERE key>=${start} AND key<${start + "\uffff"} AND integerValue<=${now} ORDER BY key LIMIT 5`);
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const payload = decode(row.textValue);
    const claimedText = encode({ ...payload, lease: crypto.randomUUID() });
    const [claimed] = await query<{key:string}>(orm, sql`UPDATE runtime_state SET textValue=${claimedText},integerValue=${now + RETRY_MS},updatedAt=${now}
      WHERE key=${row.key} AND textValue=${row.textValue} AND integerValue<=${now} RETURNING key`);
    if (!claimed) continue;
    try {
      await queue.send(payload.body);
    } catch {
      // Conditional release cannot replace another invocation's newer lease.
      await query(orm, sql`UPDATE runtime_state SET textValue=${encode({ messageId: payload.messageId, body: payload.body, deferredAt: payload.deferredAt })},
        integerValue=MAX(integerValue,${now + RETRY_MS}),updatedAt=${now} WHERE key=${row.key} AND textValue=${claimedText} RETURNING key`);
      failed++;
      continue;
    }
    await query(orm, sql`DELETE FROM runtime_state WHERE key=${row.key} AND textValue=${claimedText} RETURNING key`);
    sent++;
  }
  return { sent, failed };
}
