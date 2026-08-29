import { describe, expect, it } from "vitest";
import {
  buildRollbackPlan,
  killSwitchesOn,
  runRollback,
  schedulesEmpty,
  type RollbackStep,
} from "../scripts/rollback-wp2-activation";

const CONTEXT = {
  accountId: "bc8d4adf4860284fda426b24e7377bc2",
  scriptName: "bnb-agent-probe-staging",
  fullSha: "0123456789abcdef0123456789abcdef01234567",
  shortSha: "0123456",
} as const;

describe("WP2 activation rollback plan", () => {
  it("builds the exact abort deploy, cron removal and verifications in order", () => {
    const plan = buildRollbackPlan(CONTEXT);
    expect(plan.map(({ kind }) => kind)).toEqual(["wrangler", "http", "verify", "verify"]);
    expect(plan[0]).toEqual({
      kind: "wrangler",
      args: [
        "wrangler", "deploy", "--env", "staging", "--keep-vars",
        "--var", "PRODUCER_KILL_SWITCH:1", "--var", "KILL_SWITCH:1",
        "--message", "git_commit=0123456789abcdef0123456789abcdef01234567",
        "--tag", "git-0123456-activation-abort",
      ],
    });
    expect(plan[1]).toEqual({
      kind: "http",
      method: "DELETE",
      url: "https://api.cloudflare.com/client/v4/accounts/bc8d4adf4860284fda426b24e7377bc2/workers/scripts/bnb-agent-probe-staging/schedules/%2A%2F5%20%2A%20%2A%20%2A%20%2A",
    });
    expect(plan[2]).toMatchObject({ check: "schedules_empty" });
    expect(plan[3]).toMatchObject({ check: "kill_switches_on" });
  });

  it.each([
    ["short FULL_SHA", { ...CONTEXT, fullSha: "abc" }, "FULL_SHA"],
    ["mismatched SHORT_SHA", { ...CONTEXT, shortSha: "fedcba9" }, "SHORT_SHA"],
    ["invalid account", { ...CONTEXT, accountId: "not-hex" }, "CLOUDFLARE_ACCOUNT_ID"],
    ["invalid script name", { ...CONTEXT, scriptName: "Bad Name" }, "WP2_SCRIPT_NAME"],
  ])("rejects %s", (_label, context, message) => {
    expect(() => buildRollbackPlan(context)).toThrow(message);
  });

  it("refuses a non-staging Worker unless explicitly allowed", () => {
    expect(() => buildRollbackPlan({ ...CONTEXT, scriptName: "bnb-agent-probe" }))
      .toThrow("-staging");
    expect(buildRollbackPlan({ ...CONTEXT, scriptName: "bnb-agent-probe", allowNonStaging: true }))
      .toHaveLength(4);
  });

  it("verifies schedules-empty strictly", () => {
    expect(schedulesEmpty({ success: true, errors: [], result: { schedules: [] } })).toBe(true);
    expect(schedulesEmpty({ success: true, errors: [], result: { schedules: [{ cron: "*/5 * * * *" }] } })).toBe(false);
    expect(schedulesEmpty({ success: false, errors: [], result: { schedules: [] } })).toBe(false);
    expect(schedulesEmpty({ success: true, errors: [{}], result: { schedules: [] } })).toBe(false);
    expect(schedulesEmpty(null)).toBe(false);
  });

  it("verifies both kill switches strictly", () => {
    const bindings = (producer: string, consumer: string) => ({ result: { bindings: [
      { name: "PRODUCER_KILL_SWITCH", text: producer, type: "plain_text" },
      { name: "KILL_SWITCH", text: consumer, type: "plain_text" },
    ] } });
    expect(killSwitchesOn(bindings("1", "1"))).toBe(true);
    expect(killSwitchesOn(bindings("1", "0"))).toBe(false);
    expect(killSwitchesOn(bindings("0", "1"))).toBe(false);
    expect(killSwitchesOn({ result: { bindings: [] } })).toBe(false);
    expect(killSwitchesOn(undefined)).toBe(false);
  });

  it("stops execution when a verification fails and reports which one", async () => {
    const plan = buildRollbackPlan(CONTEXT);
    const calls: string[] = [];
    await expect(runRollback(plan, {
      runWrangler: async (args) => { calls.push(`wrangler:${args[1]}`); },
      fetchJson: async (method, url) => {
        calls.push(`${method}:${url.split("/").at(-1)}`);
        if (url.endsWith("/schedules")) return { success: true, errors: [], result: { schedules: [{ cron: "*/5 * * * *" }] } };
        return {};
      },
    })).rejects.toThrow("schedules_empty");
    expect(calls).toEqual([
      "wrangler:deploy",
      "DELETE:%2A%2F5%20%2A%20%2A%20%2A%20%2A",
      "GET:schedules",
    ]);
  });

  it("runs the full plan in order when every verification passes", async () => {
    const plan = buildRollbackPlan(CONTEXT);
    const order: RollbackStep["kind"][] = [];
    await runRollback(plan, {
      runWrangler: async () => { order.push("wrangler"); },
      fetchJson: async (method, url) => {
        order.push(method === "DELETE" ? "http" : "verify");
        if (url.endsWith("/settings")) {
          return { result: { bindings: [
            { name: "PRODUCER_KILL_SWITCH", text: "1" },
            { name: "KILL_SWITCH", text: "1" },
          ] } };
        }
        return { success: true, errors: [], result: { schedules: [] } };
      },
    });
    expect(order).toEqual(["wrangler", "http", "verify", "verify"]);
  });
});
