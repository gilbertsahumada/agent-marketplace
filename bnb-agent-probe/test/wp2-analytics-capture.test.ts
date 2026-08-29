import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    const outputDirectory = await mkdtemp(join(tmpdir(), "wp2-analytics-"));
    directories.push(outputDirectory);
    const calls: Array<{ query: string; variables: Record<string, string> }> = [];
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, string> };
      calls.push(body);
      return new Response(JSON.stringify({ data: { call: calls.length }, errors: null }), {
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
    for (const [index, name] of ["d1-database", "d1-account", "workers", "queue", "queue-account"].entries()) {
      const raw = JSON.parse(await readFile(join(outputDirectory, `${name}.json`), "utf8")) as any;
      expect(raw.request).toMatchObject({ capturedAt: "2026-08-30T00:16:00.000Z" });
      expect(raw.response).toEqual({ data: { call: index + 1 }, errors: null });
    }
  });

  it("is create-only and does not overwrite an existing raw", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "wp2-analytics-existing-"));
    directories.push(outputDirectory);
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
