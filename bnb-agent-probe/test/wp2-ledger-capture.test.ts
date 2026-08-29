import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { captureWp2Ledger } from "../scripts/capture-wp2-ledger";
import { WP2_ATTEMPT_COHORT_SQL } from "../src/evidence/wp2-24h-queries";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("WP2 scheduler ledger capture", () => {
  it("preserves the exact D1 query, cohort parameters and literal response", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wp2-ledger-"));
    directories.push(directory);
    const outputPath = join(directory, "scheduler-attempts.json");
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        sql: WP2_ATTEMPT_COHORT_SQL,
        params: [1787961600000, 1788048000000, 1787961600000, 1788048000000],
      });
      return new Response(JSON.stringify({
        success: true,
        errors: [],
        result: [{ results: [{ messageId: "message-1", scheduledTime: 1787961614000 }] }],
      }));
    });

    await captureWp2Ledger({
      accountId: "bc8d4adf4860284fda426b24e7377bc2",
      apiToken: "token",
      databaseId: "6fbeea3e-4516-4c4e-a5c4-392cb067198a",
      fetch,
      now: () => "2026-08-30T00:16:00.000Z",
      outputPath,
      windowEnd: "2026-08-30T00:00:00.000Z",
      windowStart: "2026-08-29T00:00:00.000Z",
    });

    const raw = JSON.parse(await readFile(outputPath, "utf8")) as any;
    expect(raw.request).toMatchObject({
      accountId: "bc8d4adf4860284fda426b24e7377bc2",
      capturedAt: "2026-08-30T00:16:00.000Z",
      databaseId: "6fbeea3e-4516-4c4e-a5c4-392cb067198a",
      params: [1787961600000, 1788048000000, 1787961600000, 1788048000000],
      sql: WP2_ATTEMPT_COHORT_SQL,
    });
    expect(raw.response.result[0].results).toEqual([
      { messageId: "message-1", scheduledTime: 1787961614000 },
    ]);
  });

  it("does not publish the final ledger before the terminality grace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wp2-ledger-early-"));
    directories.push(directory);
    const outputPath = join(directory, "scheduler-attempts.json");
    await expect(captureWp2Ledger({
      accountId: "bc8d4adf4860284fda426b24e7377bc2",
      apiToken: "token",
      databaseId: "6fbeea3e-4516-4c4e-a5c4-392cb067198a",
      fetch: vi.fn(async () => Response.json({ success: true, errors: [], result: [{ results: [] }] })),
      now: () => "2026-08-30T00:14:59.999Z",
      outputPath,
      windowEnd: "2026-08-30T00:00:00.000Z",
      windowStart: "2026-08-29T00:00:00.000Z",
    })).rejects.toThrow("terminality grace");
    await expect(access(outputPath)).rejects.toThrow();
  });
});
