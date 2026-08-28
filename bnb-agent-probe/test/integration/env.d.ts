interface TestMigration {
  name: string;
  queries: string[];
}

declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: TestMigration[];
  }
}

declare module "cloudflare:workers" {
  export interface ProvidedEnv {
    DB: import("../../src/types").D1Database;
    TEST_MIGRATIONS: TestMigration[];
    CLOUDFLARE_WORKERS_PLAN: string;
    KILL_SWITCH: string;
    CRON_INTERVAL_MINUTES: string;
    HEADER_LIMIT: string;
    SWEEP_LIMIT: string;
    SWEEP_PAGES_PER_RUN: string;
    PROBE_BATCH_SIZE: string;
    PROBE_AGENT_ALLOWLIST: string;
    PROBE_ENDPOINT_ALLOWLIST: string;
    TRUST8004_REQUESTS_PER_RUN: string;
    EXTERNAL_SUBREQUESTS_PER_RUN: string;
    D1_QUERIES_PER_RUN: string;
    D1_ROWS_READ_PER_RUN: string;
    D1_ROWS_WRITTEN_PER_RUN: string;
    PROBE_TIMEOUT_MS: string;
    MAX_CATALOG_RESPONSE_BYTES: string;
    MAX_SELLER_RESPONSE_BYTES: string;
  }

  export const env: ProvidedEnv;
}

declare module "cloudflare:test" {
  export function applyD1Migrations(
    db: import("../../src/types").D1Database,
    migrations: TestMigration[],
  ): Promise<void>;
  export function createExecutionContext(): import("../../src/types").ExecutionContext;
}
