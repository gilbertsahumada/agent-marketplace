export interface D1Result<T = unknown> {
  success: boolean;
  results?: T[];
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
  raw?<T extends unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch?<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface Env {
  DB: D1Database;
  WP2_QUEUE?: QueueProducer;
  CLOUDFLARE_WORKERS_PLAN?: string;
  KILL_SWITCH?: string;
  PRODUCER_KILL_SWITCH?: string;
  CRON_INTERVAL_MINUTES?: string;
  HEADER_LIMIT?: string;
  SWEEP_LIMIT?: string;
  SWEEP_PAGES_PER_RUN?: string;
  PROBE_BATCH_SIZE?: string;
  PROBE_AGENT_ALLOWLIST?: string;
  PROBE_ENDPOINT_ALLOWLIST?: string;
  PROBE_GENERAL_EGRESS_APPROVED?: string;
  CATALOG_PROBE_ENABLED?: string;
  CATALOG_PROBE_BATCH_SIZE?: string;
  TRUST8004_REQUESTS_PER_RUN?: string;
  EXTERNAL_SUBREQUESTS_PER_RUN?: string;
  D1_QUERIES_PER_RUN?: string;
  D1_ROWS_READ_PER_RUN?: string;
  D1_ROWS_WRITTEN_PER_RUN?: string;
  PROBE_TIMEOUT_MS?: string;
  MAX_CATALOG_RESPONSE_BYTES?: string;
  MAX_SELLER_RESPONSE_BYTES?: string;
  TRUST8004_BASE_URL?: string;
  DEPLOYMENT_ENV?: string;
  STAGING_MANUAL_RUN?: string;
  SHARED_SECRET?: string;
  BUYER_OBSERVATION_SECRET?: string;
  BSC_RPC_URL?: string;
}

export interface ScheduledController {
  scheduledTime: number;
  cron: string;
  attempt?: number;
  messageId?: string;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface QueueProducer {
  send(message: unknown): Promise<unknown>;
}

export interface QueueMessage {
  readonly id: string;
  readonly timestamp: Date;
  readonly body: unknown;
  readonly attempts: number;
  ack(): void;
  retry(options: { delaySeconds: number }): void;
}

export interface QueueBatch {
  readonly messages: readonly QueueMessage[];
}

export interface WorkerEntrypoint {
  fetch(request: Request, env: Env, context?: ExecutionContext): Promise<Response>;
  scheduled(controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void>;
  queue(batch: QueueBatch, env: Env, context: ExecutionContext): Promise<void>;
}
