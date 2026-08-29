import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { captureWp2Control } from "../scripts/capture-wp2-control";

const directories: string[] = [];

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
        return new Response(JSON.stringify({ success: true, errors: [], result: { bindings: [
          { name: "KILL_SWITCH", text: "1", type: "plain_text" },
          { name: "PRODUCER_KILL_SWITCH", text: "1", type: "plain_text" },
          { name: "STAGING_MANUAL_RUN", text: "0", type: "plain_text" },
        ] } }));
      }
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ status: "ok", killSwitch: true,
          producerKillSwitch: true, stagingManualRun: false }));
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const timestamps = ["2026-08-30T00:16:00.000Z", "2026-08-30T00:16:00.400Z"];

    await captureWp2Control({
      accountId: "bc8d4adf4860284fda426b24e7377bc2",
      apiToken: "token",
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
    expect(raw.response.settings.result.bindings).toHaveLength(3);
    expect(raw.response.secrets).toEqual([{ name: "BSC_RPC_URL", type: "secret_text" }]);
  });

  it("does not publish a control snapshot that exceeded its ten-second bound", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wp2-control-timeout-"));
    directories.push(directory);
    const outputPath = join(directory, "cleanup.json");
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/schedules")) return Response.json({ success: true, errors: [], result: { schedules: [] } });
      if (url.endsWith("/settings")) return Response.json({ success: true, errors: [], result: { bindings: [
        { name: "KILL_SWITCH", text: "1", type: "plain_text" },
        { name: "PRODUCER_KILL_SWITCH", text: "1", type: "plain_text" },
        { name: "STAGING_MANUAL_RUN", text: "0", type: "plain_text" },
      ] } });
      if (url.endsWith("/metrics")) return Response.json({ success: true, errors: [], result: {
        backlog_count: 0, backlog_bytes: 0,
      } });
      return Response.json({ status: "ok", killSwitch: true, producerKillSwitch: true });
    });
    const timestamps = ["2026-08-30T00:16:00.000Z", "2026-08-30T00:16:10.001Z"];

    await expect(captureWp2Control({
      accountId: "bc8d4adf4860284fda426b24e7377bc2",
      apiToken: "token",
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
      if (url.endsWith("/settings")) return Response.json({ success: true, errors: [], result: { bindings: [
        { name: "KILL_SWITCH", text: "0", type: "plain_text" },
        { name: "PRODUCER_KILL_SWITCH", text: "1", type: "plain_text" },
        { name: "STAGING_MANUAL_RUN", text: "0", type: "plain_text" },
      ] } });
      if (url.endsWith("/metrics")) return Response.json({ success: true, errors: [], result: {
        backlog_count: 0, backlog_bytes: 0,
      } });
      return Response.json({ status: "ok", killSwitch: false, producerKillSwitch: true });
    });
    const timestamps = ["2026-08-29T23:56:20.000Z", "2026-08-29T23:56:20.400Z"];

    await captureWp2Control({
      accountId: "bc8d4adf4860284fda426b24e7377bc2", apiToken: "token", fetch,
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
});
