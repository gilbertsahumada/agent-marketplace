import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { captureWp2Deployment } from "../scripts/capture-wp2-deployment";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const MEASURED = "00000000-0000-4000-8000-000000000001";
const DRAIN = "00000000-0000-4000-8000-000000000002";

function version(id: string, tag: string, etag = "a".repeat(64)) {
  return {
    id,
    annotations: {
      "workers/message": `git_commit=${COMMIT}`,
      "workers/tag": tag,
    },
    resources: { script: { etag } },
  };
}

describe("WP2 deployment evidence capture", () => {
  it("atomically preserves literal measured and drain version responses", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wp2-deployment-"));
    const outputPath = join(directory, "deployment.json");
    const responses = new Map([
      [MEASURED, version(MEASURED, `git-${COMMIT.slice(0, 12)}`)],
      [DRAIN, version(DRAIN, `git-${COMMIT.slice(0, 12)}-drain`)],
    ]);
    const readVersion = vi.fn(async (id: string) => responses.get(id));

    await captureWp2Deployment({
      commit: COMMIT,
      drainVersionIds: [DRAIN],
      measuredVersionId: MEASURED,
      outputPath,
      readVersion,
      scriptName: "bnb-agent-probe-staging",
    });

    expect(readVersion.mock.calls).toEqual([[MEASURED], [DRAIN]]);
    expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual({
      request: {
        scriptName: "bnb-agent-probe-staging",
        measuredVersionId: MEASURED,
        drainVersionIds: [DRAIN],
      },
      response: {
        measured: responses.get(MEASURED),
        drainVersions: [responses.get(DRAIN)],
      },
    });
  });

  it("rejects a mismatched commit, bundle or existing destination", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wp2-deployment-"));
    for (const [index, drain] of [
      version(DRAIN, "git-other-drain"),
      version(DRAIN, `git-${COMMIT.slice(0, 12)}-drain`, "b".repeat(64)),
    ].entries()) {
      const outputPath = join(directory, `${index}.json`);
      await expect(captureWp2Deployment({
        commit: COMMIT,
        drainVersionIds: [DRAIN],
        measuredVersionId: MEASURED,
        outputPath,
        readVersion: async (id) => id === MEASURED
          ? version(MEASURED, `git-${COMMIT.slice(0, 12)}`)
          : drain,
        scriptName: "bnb-agent-probe-staging",
      })).rejects.toThrow();
      await expect(readFile(outputPath, "utf8")).rejects.toThrow();
    }

    const existing = join(directory, "existing.json");
    await writeFile(existing, "original\n", "utf8");
    await expect(captureWp2Deployment({
      commit: COMMIT,
      drainVersionIds: [DRAIN],
      measuredVersionId: MEASURED,
      outputPath: existing,
      readVersion: async (id) => version(id, id === MEASURED
        ? `git-${COMMIT.slice(0, 12)}`
        : `git-${COMMIT.slice(0, 12)}-drain`),
      scriptName: "bnb-agent-probe-staging",
    })).rejects.toThrow();
    await expect(readFile(existing, "utf8")).resolves.toBe("original\n");
  });
});
