import { env } from "cloudflare:workers";
import { beforeEach, expect, it, vi } from "vitest";
import { persistDeferred, replayDeferred } from "../../src/db/deferred-background";
import type { D1DatabaseLike } from "../../src/db/client";
const db = env.DB as unknown as D1DatabaseLike;
const NOW = 1_800_000_000_000;
const body = {schemaVersion:1,kind:"index_identities",chainId:56,enqueuedAt:NOW};
beforeEach(async () => { await db.prepare("DELETE FROM runtime_state WHERE key LIKE 'deferred_background:%'").run(); });
it("acks only durable work, deduplicates delivery, preserves original body, and separates lanes", async () => {
  const ack=vi.fn();
  await persistDeferred(db,{id:"message",body,ack},"jobs",NOW);
  await persistDeferred(db,{id:"message",body,ack},"jobs",NOW+1);
  await persistDeferred(db,{id:"message",body,ack},"maintenance",NOW);
  expect(ack).toHaveBeenCalledTimes(3);
  expect(await db.prepare("SELECT COUNT(*) n FROM runtime_state WHERE key LIKE 'deferred_background:%'").first()).toEqual({n:2});
  const send=vi.fn().mockResolvedValue(undefined);
  await replayDeferred(db,"jobs",{send},NOW+900_000);
  expect(send).toHaveBeenCalledExactlyOnceWith(body);
  expect(await db.prepare("SELECT COUNT(*) n FROM runtime_state WHERE key LIKE 'deferred_background:%'").first()).toEqual({n:1});
});
it("does not ack oversized payload or a failed persistence", async () => {
  const ack=vi.fn();
  await expect(persistDeferred(db,{id:"big",body:"x".repeat(65_537),ack},"jobs",NOW)).rejects.toThrow();
  const broken: D1DatabaseLike={prepare(){throw new Error("offline");},batch:async()=>[]};
  await expect(persistDeferred(broken,{id:"failed",body,ack},"jobs",NOW)).rejects.toThrow("offline");
  expect(ack).not.toHaveBeenCalled();
});
it("leases concurrent replay and releases failed sends for a later attempt", async () => {
  await persistDeferred(db,{id:"retry",body,ack:vi.fn()},"jobs",NOW);
  let release!:()=>void;
  let entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const held=new Promise<void>(resolve=>{release=resolve;});
  const send=vi.fn(async()=>{entered();await held;throw new Error("queue unavailable");});
  const running=replayDeferred(db,"jobs",{send},NOW+900_000);
  await started;
  await replayDeferred(db,"jobs",{send},NOW+900_000);
  expect(send).toHaveBeenCalledTimes(1);
  release(); await running;
  const retry=vi.fn().mockResolvedValue(undefined);
  await replayDeferred(db,"jobs",{send:retry},NOW+900_001);
  expect(retry).not.toHaveBeenCalled();
  await replayDeferred(db,"jobs",{send:retry},NOW+1_800_000);
  expect(retry).toHaveBeenCalledExactlyOnceWith(body);
});
it("replays at most five messages per invocation", async () => {
  for(let i=0;i<7;i++) await persistDeferred(db,{id:String(i),body,ack:vi.fn()},"jobs",NOW);
  const send=vi.fn().mockResolvedValue(undefined);
  await replayDeferred(db,"jobs",{send},NOW+900_000);
  expect(send).toHaveBeenCalledTimes(5);
});

it("never lets an expired lease owner delete a newer failed attempt", async () => {
  await persistDeferred(db,{id:"expired",body,ack:vi.fn()},"jobs",NOW);
  let release!:()=>void;
  let entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const held=new Promise<void>(resolve=>{release=resolve;});
  const first=replayDeferred(db,"jobs",{send:async()=>{entered();await held;}},NOW+900_000);
  await started;
  expect(await replayDeferred(db,"jobs",{send:async()=>{throw new Error("failed newer send");}},NOW+1_800_000)).toEqual({sent:0,failed:1});
  release();await first;
  expect(await db.prepare("SELECT COUNT(*) n FROM runtime_state WHERE key LIKE 'deferred_background:%'").first()).toEqual({n:1});
  const send=vi.fn().mockResolvedValue(undefined);
  await replayDeferred(db,"jobs",{send},NOW+2_700_000);
  expect(send).toHaveBeenCalledExactlyOnceWith(body);
});

it("does not ack when the confirmation read fails or an existing ID has a different payload", async () => {
  const ack=vi.fn();
  const broken: D1DatabaseLike={prepare(sql){
    if(sql.startsWith("SELECT")) throw new Error("confirmation unavailable");
    return db.prepare(sql);
  },batch:statements=>db.batch(statements)};
  await expect(persistDeferred(broken,{id:"confirmation",body,ack},"jobs",NOW)).rejects.toThrow("confirmation unavailable");
  expect(ack).not.toHaveBeenCalled();
  await persistDeferred(db,{id:"confirmation",body,ack},"jobs",NOW+1);
  expect(ack).toHaveBeenCalledTimes(1);
  await expect(persistDeferred(db,{id:"confirmation",body:{...body,chainId:97},ack},"jobs",NOW+2)).rejects.toThrow("MESSAGE_CONFLICT");
  expect(ack).toHaveBeenCalledTimes(1);
});

it("honors the next UTC budget deadline and never shortens an existing deferral", async () => {
  const midnight = Date.parse(new Date(NOW).toISOString().slice(0,10) + "T00:00:00Z") + 86_400_000;
  const msg={id:"budget-deadline",body,ack:vi.fn()};
  await persistDeferred(db,msg,"jobs",NOW,midnight);
  await persistDeferred(db,msg,"jobs",NOW+1);
  const send=vi.fn().mockResolvedValue(undefined);
  await replayDeferred(db,"jobs",{send},midnight-1);
  expect(send).not.toHaveBeenCalled();
  await replayDeferred(db,"jobs",{send},midnight);
  expect(send).toHaveBeenCalledExactlyOnceWith(body);
});
