import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { captureWp2WindowStart } from "../scripts/capture-wp2-window-start";

describe("WP2 window-start evidence capture", () => {
  it("writes the literal successful D1 response without persisting the API token", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wp2-window-start-"));
    const outputPath = join(directory, "window-start.json");
    const response = {
      success: true,
      errors: [],
      result: [{ results: [{ key: "next_scheduler_phase", value: "sweep" }] }],
    };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await captureWp2WindowStart({
      accountId: "bc8d4adf4860284fda426b24e7377bc2",
      apiToken: "never-persist-this-token",
      capturedAt: () => "2026-08-28T23:59:30.000Z",
      databaseId: "6fbeea3e-4516-4c4e-a5c4-392cb067198a",
      fetch,
      outputPath,
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://api.cloudflare.com/client/v4/accounts/bc8d4adf4860284fda426b24e7377bc2/d1/database/6fbeea3e-4516-4c4e-a5c4-392cb067198a/query",
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer never-persist-this-token" },
    });
    expect(JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      sql: "SELECT key, textValue AS value FROM runtime_state WHERE key = ? LIMIT 1",
      params: ["next_scheduler_phase"],
    });
    const contents = await readFile(outputPath, "utf8");
    expect(contents).not.toContain("never-persist-this-token");
    expect(JSON.parse(contents)).toEqual({
      request: {
        accountId: "bc8d4adf4860284fda426b24e7377bc2",
        capturedAt: "2026-08-28T23:59:30.000Z",
        databaseId: "6fbeea3e-4516-4c4e-a5c4-392cb067198a",
        params: ["next_scheduler_phase"],
        sql: "SELECT key, textValue AS value FROM runtime_state WHERE key = ? LIMIT 1",
      },
      response,
    });
  });

  it("does not write evidence when Cloudflare returns an API or phase error", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wp2-window-start-"));
    for (const response of [
      { success: false, errors: [{ message: "denied" }], result: [] },
      { success: true, errors: [{ message: "contradictory" }],
        result: [{ results: [{ key: "next_scheduler_phase", value: "sweep" }] }] },
      { success: true, errors: [], result: [{ results: [] }] },
      { success: true, errors: [], result: [{ results: [{ key: "next_scheduler_phase", value: "other" }] }] },
    ]) {
      const outputPath = join(directory, `${Math.random()}.json`);
      await expect(captureWp2WindowStart({
        accountId: "bc8d4adf4860284fda426b24e7377bc2",
        apiToken: "token",
        capturedAt: () => "2026-08-28T23:59:30.000Z",
        databaseId: "6fbeea3e-4516-4c4e-a5c4-392cb067198a",
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(response))),
        outputPath,
      })).rejects.toThrow();
      await expect(readFile(outputPath, "utf8")).rejects.toThrow();
    }
  });

  it("preserves an existing evidence file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wp2-window-start-"));
    const outputPath = join(directory, "window-start.json");
    await writeFile(outputPath, "original\n", "utf8");
    const response = { success: true, errors: [],
      result: [{ results: [{ key: "next_scheduler_phase", value: "sweep" }] }] };
    await expect(captureWp2WindowStart({
      accountId: "bc8d4adf4860284fda426b24e7377bc2",
      apiToken: "token",
      capturedAt: () => "2026-08-28T23:59:30.000Z",
      databaseId: "6fbeea3e-4516-4c4e-a5c4-392cb067198a",
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(response))),
      outputPath,
    })).rejects.toThrow();
    await expect(readFile(outputPath, "utf8")).resolves.toBe("original\n");
  });

  it("fails closed on HTTP, malformed JSON and network errors", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wp2-window-start-"));
    const fetches = [
      vi.fn().mockResolvedValue(new Response("{}", { status: 403 })),
      vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })),
      vi.fn().mockRejectedValue(new Error("network unavailable")),
    ];
    for (const [index, fetch] of fetches.entries()) {
      await expect(captureWp2WindowStart({
        accountId: "bc8d4adf4860284fda426b24e7377bc2",
        apiToken: "token",
        databaseId: "6fbeea3e-4516-4c4e-a5c4-392cb067198a",
        fetch,
        outputPath: join(directory, `${index}.json`),
      })).rejects.toThrow();
    }
  });
});
