import { desc, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const probeTargets = sqliteTable(
  "probe_targets",
  {
    agentId: text().notNull(),
    chainId: integer().notNull(),
    transport: text().notNull(),
    endpoint: text().notNull(),
    name: text(),
    categoriesJson: text().notNull().default("[]"),
    categoryProvenance: text(),
    declarationState: text().notNull(),
    currentMetadataUpdatedAt: integer(),
    lastMetadataCheckedAt: integer().notNull(),
    firstSeenAt: integer().notNull(),
    lastChangedAt: integer().notNull(),
    lastSeenAt: integer().notNull(),
    priority: integer().notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [table.chainId, table.agentId, table.transport, table.endpoint],
    }),
    index("idx_targets_probe").on(
      table.declarationState,
      desc(table.priority),
      table.chainId,
      table.agentId,
    ),
    check("probe_targets_chain_bsc", sql`${table.chainId} = 56`),
    check(
      "probe_targets_transport",
      sql`${table.transport} IN ('a2a', 'erc8183_http')`,
    ),
    check(
      "probe_targets_category_provenance",
      sql`${table.categoryProvenance} IS NULL OR ${table.categoryProvenance} = 'derived:marketplace-inventory'`,
    ),
    check(
      "probe_targets_declaration_state",
      sql`${table.declarationState} IN ('current', 'removed', 'metadata_unavailable')`,
    ),
  ],
);

export const probeObservations = sqliteTable(
  "probe_observations",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    agentId: text().notNull(),
    chainId: integer().notNull(),
    transport: text().notNull(),
    endpoint: text().notNull(),
    probedAt: integer().notNull(),
    probeCategory: text(),
    outcome: text().notNull(),
    observedMetadataUpdatedAt: integer(),
    observedWallet: text(),
    observedWalletSource: text(),
    observedBlockNumber: text(),
    onchainObservedAt: integer(),
    commerce: text(),
    router: text(),
    policy: text(),
    priceRaw: text(),
    currency: text(),
    decimals: integer(),
    signatureMethod: text(),
    signer: text(),
    requestHash: text(),
    negotiationHash: text(),
    source: text(),
    quoteNegotiatedAt: integer(),
    quoteExpiresAt: integer(),
    httpStatus: integer(),
    errorCode: text(),
    durationMs: integer().notNull(),
  },
  (table) => [
    index("idx_obs_agent").on(table.chainId, table.agentId, desc(table.probedAt)),
    index("idx_obs_target").on(
      table.chainId,
      table.agentId,
      table.transport,
      table.endpoint,
      desc(table.probedAt),
    ),
    index("idx_obs_target_category").on(
      table.chainId,
      table.agentId,
      table.transport,
      table.endpoint,
      table.probeCategory,
      desc(table.probedAt),
    ),
    uniqueIndex("idx_obs_buyer_refresh_negotiation")
      .on(table.chainId, table.agentId, table.negotiationHash)
      .where(sql`${table.source} = 'buyer_refresh' AND ${table.negotiationHash} IS NOT NULL`),
    check("probe_observations_chain_bsc", sql`${table.chainId} = 56`),
    check(
      "probe_observations_transport",
      sql`${table.transport} IN ('a2a', 'erc8183_http')`,
    ),
    check(
      "probe_observations_category",
      sql`${table.probeCategory} IS NULL OR ${table.probeCategory} IN (
        'rebalancing', 'grid_trading', 'yield_optimisation', 'health_factor_monitoring'
      )`,
    ),
    check(
      "probe_observations_outcome",
      sql`${table.outcome} IN (
        'quote_verified', 'protocol_valid', 'quote_rejected', 'quote_invalid',
        'reachable', 'unreachable', 'unsafe_url', 'error'
      )`,
    ),
    check(
      "probe_observations_wallet_source",
      sql`${table.observedWalletSource} IS NULL OR ${table.observedWalletSource} IN ('agentWallet', 'ownerOf')`,
    ),
    check(
      "probe_observations_signature_method",
      sql`${table.signatureMethod} IS NULL OR ${table.signatureMethod} IN ('eip191', 'erc1271')`,
    ),
    check(
      "probe_observations_source",
      sql`${table.source} IS NULL OR ${table.source} = 'buyer_refresh'`,
    ),
  ],
);

export const funnelSnapshots = sqliteTable("funnel_snapshots", {
  id: integer().primaryKey({ autoIncrement: true }),
  measuredAt: integer().notNull(),
  blockNumber: text().notNull(),
  sourcePath: text().notNull(),
  sourceSha256: text().notNull(),
  registeredTotal: integer().notNull(),
  metadataOk: integer().notNull(),
  metadataHttpUnreachable: integer().notNull(),
  metadataOther: integer().notNull(),
  a2aOnly: integer().notNull(),
  erc8183Only: integer().notNull(),
  both: integer().notNull(),
  mcpOnly: integer().notNull(),
  otherOrNone: integer().notNull(),
  protocolUnknown: integer().notNull(),
  declaredCandidateEndpoints: integer().notNull(),
  publicCandidateEndpoints: integer().notNull(),
});

export const hireEvents = sqliteTable(
  "hire_events",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    eventKey: text().notNull().unique(),
    agentId: text().notNull(),
    chainId: integer().notNull(),
    phase: text().notNull(),
    provenance: text().notNull(),
    jobId: text(),
    txHash: text(),
    blockNumber: text(),
    occurredAt: integer().notNull(),
    verifiedAt: integer(),
  },
  (table) => [
    index("idx_hire_agent").on(table.chainId, table.agentId, desc(table.occurredAt)),
    check("hire_events_chain_bsc", sql`${table.chainId} = 56`),
    check(
      "hire_events_phase",
      sql`${table.phase} IN (
        'clicked', 'quoted', 'quote_rejected',
        'created', 'funded', 'submitted', 'settled', 'refunded'
      )`,
    ),
    check(
      "hire_events_provenance",
      sql`${table.provenance} IN ('marketplace_observed', 'chain_verified')`,
    ),
  ],
);

export const runtimeState = sqliteTable("runtime_state", {
  key: text().primaryKey(),
  textValue: text(),
  integerValue: integer(),
  updatedAt: integer().notNull(),
});

export const schedulerAttempts = sqliteTable(
  "scheduler_attempts",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    messageId: text().notNull(),
    scheduledTime: integer().notNull(),
    attempt: integer().notNull(),
    phase: text(),
    outcome: text().notNull(),
    startedAt: integer().notNull(),
    finishedAt: integer().notNull(),
    upstreamRequests: integer().notNull(),
    d1Queries: integer().notNull(),
    rowsReadObservedBeforeLedger: integer().notNull(),
    rowsWrittenObservedBeforeLedger: integer().notNull(),
    errorCode: text(),
  },
  (table) => [
    index("idx_scheduler_attempts_window").on(table.scheduledTime, table.messageId, table.attempt),
    uniqueIndex("scheduler_attempts_message_attempt").on(table.messageId, table.attempt),
    check("scheduler_attempts_attempt", sql`${table.attempt} BETWEEN 1 AND 4`),
    check(
      "scheduler_attempts_phase",
      sql`${table.phase} IS NULL OR ${table.phase} IN ('header', 'sweep', 'probe')`,
    ),
    check(
      "scheduler_attempts_outcome",
      sql`${table.outcome} IN ('completed', 'failed', 'duplicate', 'locked')`,
    ),
    check("scheduler_attempts_time", sql`${table.finishedAt} >= ${table.startedAt}`),
    check("scheduler_attempts_requests", sql`${table.upstreamRequests} >= 0`),
    check("scheduler_attempts_queries", sql`${table.d1Queries} BETWEEN 1 AND 40`),
    check("scheduler_attempts_rows_read", sql`${table.rowsReadObservedBeforeLedger} >= 0`),
    check("scheduler_attempts_rows_written", sql`${table.rowsWrittenObservedBeforeLedger} >= 0`),
  ],
);

export const catalogAgents = sqliteTable(
  "catalog_agents",
  {
    agentKey: text().primaryKey(),
    agentId: text().notNull().unique(),
    chainId: integer().notNull(),
    name: text(),
    description: text(),
    imageUrl: text(),
    categoriesJson: text().notNull().default("[]"),
    marketplaceConfigured: integer().notNull().default(0),
    metadataState: text().notNull(),
    indexState: text().notNull().default("current"),
    registeredAt: integer(),
    blockNumber: text(),
    firstSeenAt: integer().notNull(),
    lastSeenAt: integer().notNull(),
    priority: integer().notNull().default(0),
  },
  (table) => [
    index("idx_catalog_agents_priority").on(
      table.indexState,
      desc(table.priority),
      desc(table.registeredAt),
      table.agentId,
    ),
    check("catalog_agents_chain_bsc", sql`${table.chainId} = 56`),
    check(
      "catalog_agents_metadata_state",
      sql`${table.metadataState} IN ('ok', 'http_unreachable', 'other')`,
    ),
    check("catalog_agents_index_state", sql`${table.indexState} IN ('current', 'removed')`),
    check("catalog_agents_marketplace_configured", sql`${table.marketplaceConfigured} IN (0, 1)`),
  ],
);

export const catalogEndpoints = sqliteTable(
  "catalog_endpoints",
  {
    endpointKey: text().primaryKey(),
    protocol: text().notNull(),
    endpoint: text(),
    originKey: text(),
    safety: text().notNull(),
    safetyReason: text(),
    representativeAgentKey: text(),
    lastProbedAt: integer(),
    nextProbeAt: integer().notNull().default(0),
    consecutiveFailures: integer().notNull().default(0),
  },
  (table) => [
    index("idx_catalog_endpoints_queue").on(
      table.safety,
      table.representativeAgentKey,
      table.nextProbeAt,
      table.lastProbedAt,
      table.endpointKey,
    ),
    index("idx_catalog_endpoints_origin").on(table.originKey, table.protocol),
    check(
      "catalog_endpoints_protocol",
      sql`${table.protocol} IN ('a2a', 'mcp', 'web', 'erc8183_http')`,
    ),
    check("catalog_endpoints_safety", sql`${table.safety} IN ('safe', 'unsafe')`),
    check("catalog_endpoints_failures", sql`${table.consecutiveFailures} >= 0`),
    check(
      "catalog_endpoints_safety_reason",
      sql`${table.safetyReason} IS NULL OR ${table.safetyReason} IN (
        'invalid_url', 'https_required', 'credentials_not_allowed',
        'query_not_allowed', 'fragment_not_allowed', 'non_public_host'
      )`,
    ),
  ],
);

export const catalogAgentEndpoints = sqliteTable(
  "catalog_agent_endpoints",
  {
    agentKey: text().notNull(),
    endpointKey: text().notNull(),
    declarationState: text().notNull(),
    firstSeenAt: integer().notNull(),
    lastSeenAt: integer().notNull(),
    priority: integer().notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.agentKey, table.endpointKey] }),
    index("idx_catalog_agent_endpoints_agent").on(
      table.agentKey,
      table.declarationState,
      desc(table.priority),
      table.endpointKey,
    ),
    index("idx_catalog_agent_endpoints_endpoint").on(
      table.endpointKey,
      table.declarationState,
      desc(table.priority),
      table.agentKey,
    ),
    check(
      "catalog_agent_endpoints_declaration_state",
      sql`${table.declarationState} IN ('current', 'removed')`,
    ),
  ],
);

export const catalogObservations = sqliteTable(
  "catalog_observations",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    agentKey: text().notNull(),
    endpointKey: text(),
    protocol: text().notNull(),
    source: text().notNull(),
    outcome: text().notNull(),
    observedAt: integer().notNull(),
    expiresAt: integer(),
    httpStatus: integer(),
    errorCode: text(),
    durationMs: integer().notNull(),
    detailsJson: text().notNull().default("{}"),
  },
  (table) => [
    index("idx_catalog_observations_agent").on(table.agentKey, desc(table.observedAt), desc(table.id)),
    index("idx_catalog_observations_endpoint").on(table.endpointKey, desc(table.observedAt), desc(table.id)),
    index("idx_catalog_observations_outcome").on(table.outcome, desc(table.observedAt), desc(table.id)),
    check(
      "catalog_observations_protocol",
      sql`${table.protocol} IN ('a2a', 'mcp', 'web', 'erc8183_http', 'erc8183')`,
    ),
    check(
      "catalog_observations_source",
      sql`${table.source} IN ('browser_reported', 'marketplace_probe', 'worker_probe', 'chain_index')`,
    ),
    check(
      "catalog_observations_outcome",
      sql`${table.outcome} IN (
        'protocol_valid', 'cors_blocked', 'http_error', 'timeout',
        'network_error', 'invalid_response', 'unsafe_url', 'erc8183_detected',
        'quote_verified', 'quote_rejected', 'unreachable', 'error'
      )`,
    ),
    check("catalog_observations_duration", sql`${table.durationMs} >= 0`),
  ],
);

export const schema = {
  probeTargets,
  probeObservations,
  funnelSnapshots,
  hireEvents,
  runtimeState,
  schedulerAttempts,
  catalogAgents,
  catalogEndpoints,
  catalogAgentEndpoints,
  catalogObservations,
} as const;
