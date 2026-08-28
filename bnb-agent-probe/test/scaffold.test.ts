import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");
const wrangler = JSON.parse(readFileSync(resolve(projectRoot, "wrangler.jsonc"), "utf8")) as {
  main?: string;
  compatibility_date?: string;
  triggers?: unknown;
  vars?: Record<string, string>;
  d1_databases?: Array<Record<string, string>>;
  env?: Record<string, {
    name?: string;
    triggers?: unknown;
    vars?: Record<string, string>;
    d1_databases?: Array<Record<string, string>>;
  }>;
};

describe("WP1 Wrangler scaffold", () => {
  it("binds the Worker and D1 without activating a cron", () => {
    expect(wrangler.main).toBe("src/index.ts");
    expect(wrangler.compatibility_date).toBe("2026-08-28");
    expect(wrangler.triggers).toBeUndefined();
    expect(wrangler.d1_databases).toEqual([
      expect.objectContaining({
        binding: "DB",
        database_name: "bnb-agent-probe",
        migrations_dir: "migrations",
      }),
    ]);
  });

  it("deploys disabled on the Free profile", () => {
    expect(wrangler.vars).toMatchObject({
      CLOUDFLARE_WORKERS_PLAN: "free",
      KILL_SWITCH: "1",
      CRON_INTERVAL_MINUTES: "5",
      HEADER_LIMIT: "25",
      SWEEP_LIMIT: "25",
      SWEEP_PAGES_PER_RUN: "1",
      PROBE_BATCH_SIZE: "1",
      D1_QUERIES_PER_RUN: "40",
      MAX_CATALOG_RESPONSE_BYTES: "16777216",
    });
  });

  it("keeps staging isolated, disabled and without a cron", () => {
    const staging = wrangler.env?.staging;

    expect(staging).toMatchObject({
      name: "bnb-agent-probe-staging",
      vars: {
        CLOUDFLARE_WORKERS_PLAN: "free",
        KILL_SWITCH: "1",
        D1_QUERIES_PER_RUN: "40",
        MAX_CATALOG_RESPONSE_BYTES: "16777216",
      },
      d1_databases: [
        expect.objectContaining({
          binding: "DB",
          database_name: "bnb-agent-probe-staging",
          migrations_dir: "migrations",
        }),
      ],
    });
    expect(staging?.triggers).toBeUndefined();
  });
});
