import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { captureWp2Analytics } from "../scripts/capture-wp2-analytics";
import {
  WP2_D1_ACCOUNT_ANALYTICS_QUERY,
  WP2_D1_DATABASE_ANALYTICS_QUERY,
  WP2_QUEUE_ACCOUNT_ANALYTICS_QUERY,
  WP2_QUEUE_ANALYTICS_QUERY,
  WP2_WORKERS_ANALYTICS_QUERY,
} from "../src/evidence/wp2-24h-queries";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("WP2 final Analytics capture", () => {
  it("writes all five literal GraphQL responses with exact queries and variables", async () => {
    const root = await mkdtemp(join(tmpdir(), "wp2-analytics-"));
    directories.push(root);
    const outputDirectory = join(root, "analytics");
    const calls: Array<{ query: string; variables: Record<string, string> }> = [];
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, string> };
      calls.push(body);
      const data = calls.length === 4 ? {
        call: calls.length,
        viewer: { accounts: [{
          queueTerminalOperations: [{
            count: 288,
            dimensions: { actionType: "DeleteMessage", outcome: "success" },
          }],
        }] },
      } : { call: calls.length };
      return new Response(JSON.stringify({ data, errors: null }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    });

    await captureWp2Analytics({
      accountId: "bc8d4adf4860284fda426b24e7377bc2",
      apiToken: "token",
      databaseId: "6fbeea3e-4516-4c4e-a5c4-392cb067198a",
      date: "2026-08-29",
      fetch,
      now: () => "2026-08-30T00:16:00.000Z",
      outputDirectory,
      queueId: "721ba809967d425a91dbc34eb1ac3baa",
      scriptName: "bnb-agent-probe-staging",
      terminalityEndInclusive: "2026-08-30T00:15:00.000Z",
    });

    expect(calls.map(({ query }) => query)).toEqual([
      WP2_D1_DATABASE_ANALYTICS_QUERY,
      WP2_D1_ACCOUNT_ANALYTICS_QUERY,
      WP2_WORKERS_ANALYTICS_QUERY,
      WP2_QUEUE_ANALYTICS_QUERY,
      WP2_QUEUE_ACCOUNT_ANALYTICS_QUERY,
    ]);
    expect(calls.map(({ variables }) => variables)).toEqual([
      { accountTag: "bc8d4adf4860284fda426b24e7377bc2", date: "2026-08-29",
        databaseId: "6fbeea3e-4516-4c4e-a5c4-392cb067198a" },
      { accountTag: "bc8d4adf4860284fda426b24e7377bc2", date: "2026-08-29" },
      { accountTag: "bc8d4adf4860284fda426b24e7377bc2", scriptName: "bnb-agent-probe-staging",
        start: "2026-08-29T00:00:00.000Z", terminalityEndInclusive: "2026-08-30T00:15:00.000Z" },
      { accountTag: "bc8d4adf4860284fda426b24e7377bc2", queueId: "721ba809967d425a91dbc34eb1ac3baa",
        start: "2026-08-29T00:00:00.000Z", endInclusive: "2026-08-29T23:59:59.999Z",
        terminalityEndInclusive: "2026-08-30T00:15:00.000Z" },
      { accountTag: "bc8d4adf4860284fda426b24e7377bc2", start: "2026-08-29T00:00:00.000Z",
        endInclusive: "2026-08-29T23:59:59.999Z" },
    ]);
    const names = ["d1-database", "d1-account", "workers", "queue", "queue-account"];
    const raws: Record<string, any> = {};
    for (const [index, name] of names.entries()) {
      const raw = JSON.parse(await readFile(join(outputDirectory, `${name}.json`), "utf8")) as any;
      raws[name] = raw;
      expect(raw.request).toMatchObject({ capturedAt: "2026-08-30T00:16:00.000Z" });
      expect(raw.response.data.call).toBe(index + 1);
    }
    const manifest = JSON.parse(await readFile(join(outputDirectory, "analytics-manifest.json"), "utf8")) as any;
    expect(manifest).toMatchObject({ schemaVersion: 1, captureId: raws.queue.request.captureId });
    for (const name of names) {
      expect(raws[name].request.captureId).toBe(manifest.captureId);
      expect(manifest.files[`${name}.json`]).toBe(createHash("sha256")
        .update(await readFile(join(outputDirectory, `${name}.json`)))
        .digest("hex"));
    }
  });

  it("does not publish canonical raws before 288 successful deletes are visible", async () => {
    const root = await mkdtemp(join(tmpdir(), "wp2-analytics-incomplete-"));
    directories.push(root);
    const outputDirectory = join(root, "analytics");
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      data: { viewer: { accounts: [{ queueTerminalOperations: [] }] } },
      errors: null,
    })));

    await expect(captureWp2Analytics({
      accountId: "bc8d4adf4860284fda426b24e7377bc2",
      apiToken: "token",
      databaseId: "6fbeea3e-4516-4c4e-a5c4-392cb067198a",
      date: "2026-08-29",
      fetch,
      outputDirectory,
      queueId: "721ba809967d425a91dbc34eb1ac3baa",
      scriptName: "bnb-agent-probe-staging",
      terminalityEndInclusive: "2026-08-30T00:15:00.000Z",
    })).rejects.toThrow(/288 successful deletes/);
    expect(await readdir(root)).toEqual([]);
  });

  it("is create-only and does not overwrite an existing raw", async () => {
    const root = await mkdtemp(join(tmpdir(), "wp2-analytics-existing-"));
    directories.push(root);
    const outputDirectory = join(root, "analytics");
    await mkdir(outputDirectory);
    await writeFile(join(outputDirectory, "workers.json"), "preserve\n");
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: {}, errors: null })));

    await expect(captureWp2Analytics({
      accountId: "bc8d4adf4860284fda426b24e7377bc2",
      apiToken: "token",
      databaseId: "6fbeea3e-4516-4c4e-a5c4-392cb067198a",
      date: "2026-08-29",
      fetch,
      outputDirectory,
      queueId: "721ba809967d425a91dbc34eb1ac3baa",
      scriptName: "bnb-agent-probe-staging",
      terminalityEndInclusive: "2026-08-30T00:15:00.000Z",
    })).rejects.toThrow();
    expect(await readFile(join(outputDirectory, "workers.json"), "utf8")).toBe("preserve\n");
  });
});
