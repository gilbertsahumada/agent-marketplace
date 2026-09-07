import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { hireNotificationsResponse } from "../../src/routes/hire-notifications";
const now = 1800000000000;
const binding = { chainId: 97, jobId: "1066", agentId: "2197", quoteRequestId: 1, buyer: `0x${"ab".repeat(20)}` };
async function call(action: string, extra = {}, time = now) {
  return hireNotificationsResponse(new Request("https://worker.test/hire-notifications", { method: "POST", body: JSON.stringify({ ...binding, action, ...extra }) }), env.DB as never, time);
}
beforeEach(async () => { await env.DB.prepare("DELETE FROM hire_notifications").run(); });
it("deduplicates enqueue and rejects a conflicting binding", async () => {
  await call("enqueue"); await call("enqueue");
  expect((await env.DB.prepare("SELECT count(*) AS n FROM hire_notifications").first<{n:number}>())?.n).toBe(1);
  expect((await call("enqueue", { quoteRequestId: 2 })).status).toBe(409);
});
it("has only one owner and fences a stale owner after a crash", async () => {
  await call("enqueue");
  const first = await (await call("claim")).json() as {leaseToken:string};
  expect(await (await call("claim")).json()).toBeNull();
  const next = await (await call("claim", {}, now+120001)).json() as {leaseToken:string};
  expect(next.leaseToken).not.toBe(first.leaseToken);
  expect((await call("sending", {token:first.leaseToken}, now+120002)).status).toBe(409);
});
it("preserves uncertainty across worker restarts and prevents a second dispatch", async () => {
  await call("enqueue");
  const first = await (await call("claim")).json() as {leaseToken:string};
  await call("sending", {token:first.leaseToken});
  const resumed = await (await call("claim", {}, now+120001)).json() as {leaseToken:string; state:string};
  expect(resumed.state).toBe("uncertain");
  expect((await call("sending", {token:resumed.leaseToken},now+120002)).status).toBe(409);
  await call("finish", {token:resumed.leaseToken,state:"pending"}, now+120002);
  expect((await (await call("read")).json() as {state:string}).state).toBe("uncertain");
});
it("isolates chains and removes acknowledged jobs from due work", async () => {
  await call("enqueue");
  expect(await (await call("read", {chainId:56})).json()).toBeNull();
  const first = await (await call("claim")).json() as {leaseToken:string};
  await call("finish", {token:first.leaseToken,state:"notified"});
  expect(await (await call("due", {}, now+999999)).json()).toEqual([]);
});
