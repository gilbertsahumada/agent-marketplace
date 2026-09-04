import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};
const wrangler = JSON.parse(readFileSync(resolve(projectRoot, "wrangler.jsonc"), "utf8")) as {
  main?: string;
  compatibility_date?: string;
  triggers?: unknown;
  vars?: Record<string, string>;
  d1_databases?: Array<Record<string, string>>;
  queues?: {
    producers?: Array<Record<string, string>>;
    consumers?: Array<Record<string, string | number>>;
  };
  env?: Record<string, {
    name?: string;
    triggers?: unknown;
    vars?: Record<string, string>;
    d1_databases?: Array<Record<string, string>>;
    queues?: {
      producers?: Array<Record<string, string>>;
      consumers?: Array<Record<string, string | number>>;
    };
  }>;
};

describe("WP1 Wrangler scaffold", () => {
  it("compiles the isolated validation environment in the standard check", () => {
    expect(packageJson.scripts?.["dry-run:validation"]).toBe(
      "wrangler deploy --dry-run --env validation --outdir dist/worker-validation",
    );
    expect(packageJson.scripts?.check).toContain("npm run dry-run:validation");
  });

  it("binds the Worker and D1 without activating a cron", () => {
    expect(wrangler.main).toBe("src/index.ts");
    expect(wrangler.compatibility_date).toBe("2026-08-28");
    expect(wrangler.triggers).toEqual({ crons: [] });
    expect(wrangler.d1_databases).toEqual([
      expect.objectContaining({
        binding: "DB",
        database_name: "bnb-agent-probe",
        migrations_dir: "migrations",
      }),
    ]);
    expect(wrangler.queues).toEqual({
      producers: [{ binding: "WP2_QUEUE", queue: "bnb-agent-probe" }],
      consumers: [{
        queue: "bnb-agent-probe",
        max_batch_size: 1,
        max_batch_timeout: 1,
        max_retries: 3,
        max_concurrency: 1,
        retry_delay: 60,
      }],
    });
  });

  it("deploys disabled on the Free profile", () => {
    expect(wrangler.vars).toMatchObject({
      DEPLOYMENT_ENV: "production",
      STAGING_MANUAL_RUN: "0",
      CLOUDFLARE_WORKERS_PLAN: "free",
      KILL_SWITCH: "1",
      CRON_INTERVAL_MINUTES: "5",
      HEADER_LIMIT: "25",
      SWEEP_LIMIT: "4",
      SWEEP_PAGES_PER_RUN: "1",
      PROBE_BATCH_SIZE: "1",
      D1_QUERIES_PER_RUN: "40",
      D1_ROWS_READ_PER_RUN: "3000",
      D1_ROWS_WRITTEN_PER_RUN: "60",
      MAX_CATALOG_RESPONSE_BYTES: "16777216",
      // Production serves the commerce summary (two full-table scans per
      // uncached call) from the Workers Cache like staging does.
      CATALOG_RESPONSE_CACHE_SECONDS: "60",
    });
  });

  it("declares the Commerce indexer flag off wherever the catalogue flags are declared", () => {
    for (const vars of [wrangler.vars, wrangler.env?.staging?.vars, wrangler.env?.validation?.vars]) {
      expect(vars?.CATALOG_PROBE_ENABLED).toBeDefined();
      expect(vars?.COMMERCE_INDEX_ENABLED).toBe("0");
    }
  });

  it("keeps product monitoring active only in the isolated staging environment", () => {
    const staging = wrangler.env?.staging;

    expect(staging).toMatchObject({
      name: "bnb-agent-probe-staging",
      vars: {
        DEPLOYMENT_ENV: "staging",
        STAGING_MANUAL_RUN: "0",
        CLOUDFLARE_WORKERS_PLAN: "paid",
        CRON_INTERVAL_MINUTES: "1",
        CATALOG_PROBE_BATCH_SIZE: "4",
        CATALOG_PROBE_CONCURRENCY: "2",
        CATALOG_DISCOVERY_PAGE_SIZE: "15",
        EXTERNAL_SUBREQUESTS_PER_RUN: "15",
        CATALOG_V2_READS_ENABLED: "1",
        CATALOG_V2_WRITES_ENABLED: "1",
        D1_QUERIES_PER_RUN: "40",
        D1_ROWS_READ_PER_RUN: "3000",
        D1_ROWS_WRITTEN_PER_RUN: "200",
        PROBE_TIMEOUT_MS: "10000",
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
    expect(staging?.vars?.KILL_SWITCH).toBe("0");
    expect(staging?.vars?.PRODUCER_KILL_SWITCH).toBe("0");
    expect(staging?.triggers).toEqual({ crons: ["* * * * *"] });
    expect(staging?.queues).toEqual({
      producers: [{ binding: "WP2_QUEUE", queue: "bnb-agent-probe-staging" }],
      consumers: [{
        queue: "bnb-agent-probe-staging",
        max_batch_size: 1,
        max_batch_timeout: 1,
        max_retries: 3,
        max_concurrency: 1,
        retry_delay: 60,
      }],
    });
  });

  it("provides a fully isolated Free validation environment", () => {
    const staging = wrangler.env?.staging;
    const validation = wrangler.env?.validation;

    expect(validation).toMatchObject({
      name: "bnb-agent-probe-validation",
      triggers: { crons: [] },
      vars: {
        DEPLOYMENT_ENV: "validation",
        STAGING_MANUAL_RUN: "0",
        CLOUDFLARE_WORKERS_PLAN: "free",
        KILL_SWITCH: "1",
        HEADER_LIMIT: "25",
        SWEEP_LIMIT: "4",
        D1_QUERIES_PER_RUN: "40",
        D1_ROWS_READ_PER_RUN: "3000",
        D1_ROWS_WRITTEN_PER_RUN: "60",
      },
      d1_databases: [{
        binding: "DB",
        database_name: "bnb-agent-probe-validation-20260828",
        database_id: "11253c18-cc4d-489a-8d1d-972d3a31e49f",
        migrations_dir: "migrations",
      }],
      queues: {
        producers: [{
          binding: "WP2_QUEUE",
          queue: "bnb-agent-probe-validation-20260828",
        }],
        consumers: [{
          queue: "bnb-agent-probe-validation-20260828",
          max_batch_size: 1,
          max_batch_timeout: 1,
          max_retries: 3,
          max_concurrency: 1,
          retry_delay: 60,
        }],
      },
    });
    expect(validation?.d1_databases?.[0]?.database_id)
      .not.toBe(staging?.d1_databases?.[0]?.database_id);
    expect(validation?.queues?.producers?.[0]?.queue)
      .not.toBe(staging?.queues?.producers?.[0]?.queue);
  });
});
