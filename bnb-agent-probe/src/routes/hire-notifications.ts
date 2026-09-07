import type { D1DatabaseLike } from "../db/client";
import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { createDatabase } from "../db/orm";
import { hireNotifications as table } from "../db/schema";

/** Private service API. All enqueue bindings must be verified by the marketplace first. */
export async function hireNotificationsResponse(request: Request, db: D1DatabaseLike, now = Date.now()): Promise<Response> {
  const raw = await request.text();
  if (raw.length > 4096) return Response.json({ error: "invalid_request" }, { status: 400 });
  let b: Record<string, unknown>;
  try { b = JSON.parse(raw); } catch { return Response.json({ error: "invalid_request" }, { status: 400 }); }
  if (!b || typeof b !== "object") return Response.json({ error: "invalid_request" }, { status: 400 });
  const reply = (value: unknown) => Response.json(value, { headers: { "cache-control": "no-store" } });
  const orm = createDatabase(db);
  const eligible = and(inArray(table.state, ["pending", "processing", "sending", "uncertain"]), lte(table.nextAttemptAt, now), lte(table.leaseUntil, now));
  if (b.action === "due") {
    const chains = b.chainIds === undefined ? [56, 97] : b.chainIds;
    if (!Array.isArray(chains) || chains.length > 2 || chains.some(chain => chain !== 56 && chain !== 97) || new Set(chains).size !== chains.length) return Response.json({ error: "invalid_request" }, { status: 400 });
    if (chains.length === 0) return reply([]);
    return reply(await orm.select({ chainId: table.chainId, jobId: table.jobId }).from(table).where(and(eligible, inArray(table.chainId, chains))).orderBy(asc(table.nextAttemptAt)).limit(3).all());
  }
  if (![56, 97].includes(Number(b.chainId)) || typeof b.jobId !== "string" || !/^[1-9]\d{0,19}$/.test(b.jobId)) return Response.json({ error: "invalid_request" }, { status: 400 });
  const chain = Number(b.chainId) as 56 | 97, id = b.jobId;
  const key = and(eq(table.chainId, chain), eq(table.jobId, id));
  const read = async () => (await orm.select().from(table).where(key).get()) ?? null;
  if (b.action === "enqueue") {
    if (typeof b.agentId !== "string" || !/^[1-9]\d{0,19}$/.test(b.agentId) || typeof b.quoteRequestId !== "number" || !Number.isSafeInteger(b.quoteRequestId) || b.quoteRequestId < 1 || typeof b.buyer !== "string" || !/^0x[\da-f]{40}$/i.test(b.buyer)) return Response.json({ error: "invalid_request" }, { status: 400 });
    await orm.insert(table).values({ chainId: chain, jobId: id, agentId: b.agentId, quoteRequestId: b.quoteRequestId, buyer: b.buyer.toLowerCase(), nextAttemptAt: now, createdAt: now, updatedAt: now }).onConflictDoNothing().run();
    const row = await read();
    if (!row || row.agentId !== b.agentId || row.quoteRequestId !== b.quoteRequestId || row.buyer !== b.buyer.toLowerCase()) return Response.json({ error: "binding_conflict" }, { status: 409 });
    return reply(row);
  }
  if (b.action === "read") return reply(await read());
  if (b.action === "claim") {
    const token = crypto.randomUUID();
    const row = await orm.update(table).set({ leaseToken: token, leaseUntil: now + 120000, state: sql`CASE WHEN ${table.state} IN ('sending','uncertain') THEN 'uncertain' ELSE 'processing' END`, attempts: sql`${table.attempts} + 1`, updatedAt: now }).where(and(key, eligible)).returning().get();
    return reply(row ?? null);
  }
  if (typeof b.token !== "string") return Response.json({ error: "invalid_request" }, { status: 400 });
  const owner = and(key, eq(table.leaseToken, b.token), gt(table.leaseUntil, now));
  if (b.action === "sending") {
    const row = await orm.update(table).set({ state: "sending", updatedAt: now }).where(and(owner, eq(table.state, "processing"))).returning().get();
    return row ? reply(row) : Response.json({ error: "lease_lost" }, { status: 409 });
  }
  if (b.action === "finish" && ["pending","uncertain","notified","watching","delivered","stopped","attention"].includes(String(b.state))) {
    // Once dispatch was fenced, even a buggy caller cannot schedule a second send.
    const row = await orm.update(table).set({ state: sql`CASE WHEN ${table.state} IN ('sending','uncertain') AND ${b.state}='pending' THEN 'uncertain' ELSE ${b.state} END`, nextAttemptAt: now + Math.min(3600000, 30000 * 2 ** Math.min(7, (await read())?.attempts ?? 1)), leaseToken: null, leaseUntil: 0, updatedAt: now }).where(owner).returning().get();
    return row ? reply(row) : Response.json({ error: "lease_lost" }, { status: 409 });
  }
  return Response.json({ error: "invalid_request" }, { status: 400 });
}
