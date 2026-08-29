import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { captureWp2Control } from "../scripts/capture-wp2-control";

const directories: string[] = [];
const plain = (name: string, text: string) => ({ name, text, type: "plain_text" });
function settingsBindings(killSwitch: string, producerKillSwitch: string): unknown[] {
  return [
    plain("DEPLOYMENT_ENV", "staging"), plain("CLOUDFLARE_WORKERS_PLAN", "free"),
    plain("CRON_INTERVAL_MINUTES", "5"), plain("HEADER_LIMIT", "25"), plain("SWEEP_LIMIT", "4"),
    plain("SWEEP_PAGES_PER_RUN", "1"), plain("PROBE_BATCH_SIZE", "1"),
    plain("TRUST8004_REQUESTS_PER_RUN", "4"), plain("EXTERNAL_SUBREQUESTS_PER_RUN", "12"),
    plain("D1_QUERIES_PER_RUN", "40"), plain("D1_ROWS_READ_PER_RUN", "3000"),
    plain("D1_ROWS_WRITTEN_PER_RUN", "60"), plain("PROBE_TIMEOUT_MS", "5000"),
    plain("MAX_CATALOG_RESPONSE_BYTES", "16777216"), plain("MAX_SELLER_RESPONSE_BYTES", "32768"),
    plain("KILL_SWITCH", killSwitch), plain("PRODUCER_KILL_SWITCH", producerKillSwitch),
    plain("STAGING_MANUAL_RUN", "0"),
    { name: "DB", type: "d1", id: "6fbeea3e-4516-4c4e-a5c4-392cb067198a" },
    { name: "WP2_QUEUE", type: "queue", queue_name: "bnb-agent-probe-staging" },
  ];
}
function healthState(killSwitch: boolean, producerKillSwitch: boolean): Record<string, unknown> {
  return { status: "ok", plan: "free", schedulerMode: "single_phase", killSwitch, producerKillSwitch,
    budgets: { cronIntervalMinutes: 5, headerLimit: 25, sweepLimit: 4, sweepPagesPerRun: 1,
      probeBatchSize: 1, trust8004RequestsPerRun: 4, externalSubrequestsPerRun: 12,
      d1QueriesPerRun: 40, d1RowsReadPerRun: 3000, d1RowsWrittenPerRun: 60,
      probeTimeoutMs: 5000, maxCatalogResponseBytes: 16777216, maxSellerResponseBytes: 32768 } };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("WP2 control-plane capture", () => {
  it("captures schedules, Queue backlog, health and secret names literally in one bounded snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wp2-control-"));
    directories.push(directory);
    const outputPath = join(directory, "cleanup.json");
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/schedules")) {
        return new Response(JSON.stringify({ success: true, errors: [], result: { schedules: [] } }));
      }
      if (url.endsWith("/metrics")) {
        return new Response(JSON.stringify({ success: true, errors: [], result: {
          backlog_count: 0, backlog_bytes: 0, oldest_message_timestamp_ms: 0,
        } }));
      }
      if (url.endsWith("/settings")) {
        return Response.json({ success: true, errors: [], result: { bindings: settingsBindings("1", "1") } });
      }
      if (url.endsWith("/health")) {
        return Response.json(healthState(true, true));
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const timestamps = ["2026-08-30T00:16:00.000Z", "2026-08-30T00:16:00.400Z"];

    await captureWp2Control({
      accountId: "bc8d4adf4860284fda426b24e7377bc2",
      apiToken: "token",
      databaseId: "6fbeea3e-4516-4c4e-a5c4-392cb067198a",
      fetch,
      healthUrl: "https://bnb-agent-probe-staging.gilbertsahumada.workers.dev/health",
      mode: "cleanup",
      now: () => timestamps.shift()!,
      outputPath,
      queueId: "721ba809967d425a91dbc34eb1ac3baa",
      readSecrets: async () => [{ name: "BSC_RPC_URL", type: "secret_text" }],
      scriptName: "bnb-agent-probe-staging",
    });

    const raw = JSON.parse(await readFile(outputPath, "utf8")) as any;
    expect(raw.request).toMatchObject({
      accountId: "bc8d4adf4860284fda426b24e7377bc2",
      completedAt: "2026-08-30T00:16:00.400Z",
      mode: "cleanup",
      queueId: "721ba809967d425a91dbc34eb1ac3baa",
      scriptName: "bnb-agent-probe-staging",
      startedAt: "2026-08-30T00:16:00.000Z",
    });
    expect(raw.response.schedules).toEqual({ success: true, errors: [], result: { schedules: [] } });
    expect(raw.response.backlog.result.backlog_count).toBe(0);
    expect(raw.response.health).toMatchObject({ killSwitch: true, producerKillSwitch: true });
    expect(raw.response.settings.result.bindings).toHaveLength(20);
    expect(raw.response.secrets).toEqual([{ name: "BSC_RPC_URL", type: "secret_text" }]);
  });

  it("does not publish a control snapshot that exceeded its ten-second bound", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wp2-control-timeout-"));
    directories.push(directory);
    const outputPath = join(directory, "cleanup.json");
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/schedules")) return Response.json({ success: true, errors: [], result: { schedules: [] } });
      if (url.endsWith("/settings")) return Response.json({ success: true, errors: [],
        result: { bindings: settingsBindings("1", "1") } });
      if (url.endsWith("/metrics")) return Response.json({ success: true, errors: [], result: {
        backlog_count: 0, backlog_bytes: 0,
      } });
      return Response.json(healthState(true, true));
    });
    const timestamps = ["2026-08-30T00:16:00.000Z", "2026-08-30T00:16:10.001Z"];

    await expect(captureWp2Control({
      accountId: "bc8d4adf4860284fda426b24e7377bc2",
      apiToken: "token",
      databaseId: "6fbeea3e-4516-4c4e-a5c4-392cb067198a",
      fetch,
      healthUrl: "https://bnb-agent-probe-staging.gilbertsahumada.workers.dev/health",
      mode: "cleanup",
      now: () => timestamps.shift()!,
      outputPath,
      queueId: "721ba809967d425a91dbc34eb1ac3baa",
      readSecrets: async () => [{ name: "BSC_RPC_URL", type: "secret_text" }],
      scriptName: "bnb-agent-probe-staging",
    })).rejects.toThrow("ten-second");
    await expect(access(outputPath)).rejects.toThrow();
  });

  it("captures the producer-off consumer-on drain barrier", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wp2-control-drain-"));
    directories.push(directory);
    const outputPath = join(directory, "drain.json");
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/schedules")) return Response.json({ success: true, errors: [], result: { schedules: [] } });
      if (url.endsWith("/settings")) return Response.json({ success: true, errors: [],
        result: { bindings: settingsBindings("0", "1") } });
      if (url.endsWith("/metrics")) return Response.json({ success: true, errors: [], result: {
        backlog_count: 1, backlog_bytes: 64,
      } });
      return Response.json(healthState(false, true));
    });
    const timestamps = ["2026-08-29T23:56:20.000Z", "2026-08-29T23:56:20.400Z"];

    await captureWp2Control({
      accountId: "bc8d4adf4860284fda426b24e7377bc2", apiToken: "token", fetch,
      databaseId: "6fbeea3e-4516-4c4e-a5c4-392cb067198a",
      healthUrl: "https://bnb-agent-probe-staging.gilbertsahumada.workers.dev/health",
      mode: "drain", now: () => timestamps.shift()!, outputPath,
      queueId: "721ba809967d425a91dbc34eb1ac3baa",
      readSecrets: async () => [{ name: "BSC_RPC_URL", type: "secret_text" }],
      scriptName: "bnb-agent-probe-staging",
    });
    const raw = JSON.parse(await readFile(outputPath, "utf8")) as any;
    expect(raw.request.mode).toBe("drain");
    expect(raw.response.health).toMatchObject({ killSwitch: false, producerKillSwitch: true });
  });

  it("refuses to publish a snapshot bound to another D1", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wp2-control-profile-"));
    directories.push(directory);
    const outputPath = join(directory, "activation.json");
    const bindings = settingsBindings("0", "0") as Array<Record<string, unknown>>;
    bindings.find(({ name }) => name === "DB")!.id = "00000000-0000-4000-8000-000000000002";
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/schedules")) return Response.json({ success: true, errors: [],
        result: { schedules: [{ cron: "*/5 * * * *" }] } });
      if (url.endsWith("/settings")) return Response.json({ success: true, errors: [], result: { bindings } });
      if (url.endsWith("/metrics")) return Response.json({ success: true, errors: [], result: {
        backlog_count: 0, backlog_bytes: 0,
      } });
      return Response.json(healthState(false, false));
    });

    await expect(captureWp2Control({
      accountId: "bc8d4adf4860284fda426b24e7377bc2", apiToken: "token", fetch,
      databaseId: "6fbeea3e-4516-4c4e-a5c4-392cb067198a",
      healthUrl: "https://bnb-agent-probe-staging.gilbertsahumada.workers.dev/health",
      mode: "activation", outputPath, queueId: "721ba809967d425a91dbc34eb1ac3baa",
      readSecrets: async () => [{ name: "BSC_RPC_URL", type: "secret_text" }],
      scriptName: "bnb-agent-probe-staging",
    })).rejects.toThrow("DB");
    await expect(access(outputPath)).rejects.toThrow();
  });
});
