-- Public discovery is scoped to an agent/endpoint context. Origin admission is
-- shared across chains; this table never carries a reusable signed quote.
CREATE TABLE catalog_pilot_discovery_work (
  workKey TEXT PRIMARY KEY,
  agentKey TEXT NOT NULL CHECK(agentKey IN ('eip155:56:341565','eip155:56:341564','eip155:56:341563','eip155:56:303779','eip155:56:213378','eip155:56:213332','eip155:56:213053','eip155:56:212989','eip155:56:212840','eip155:56:208760','eip155:56:265375','eip155:56:269233','eip155:56:270213')),
  endpointKey TEXT NOT NULL,
  originKey TEXT NOT NULL,
  chainId INTEGER NOT NULL CHECK(chainId = 56),
  transport TEXT NOT NULL,
  contextVersion TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1,
  cohort TEXT NOT NULL DEFAULT 'initial' CHECK(cohort IN ('initial','refresh')),
  priorityClass INTEGER NOT NULL DEFAULT 0 CHECK(priorityClass BETWEEN 0 AND 3),
  state TEXT NOT NULL DEFAULT 'scheduled' CHECK(state IN ('scheduled','dispatch','running','suspended')),
  nextAttemptAt INTEGER NOT NULL,
  runId TEXT,
  executionFence INTEGER NOT NULL DEFAULT 0,
  executionToken TEXT,
  deliveryAt INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  lastErrorCode TEXT,
  updatedAt INTEGER NOT NULL
) WITHOUT ROWID;
CREATE UNIQUE INDEX catalog_pilot_discovery_work_agent_endpoint ON catalog_pilot_discovery_work(agentKey,endpointKey);
CREATE INDEX idx_pilot_discovery_origin_head ON catalog_pilot_discovery_work
  (originKey,state,cohort,chainId,priorityClass,nextAttemptAt,workKey);
CREATE INDEX idx_pilot_discovery_delivery ON catalog_pilot_discovery_work(state,deliveryAt,workKey);

CREATE TABLE catalog_pilot_origin_schedule (
  originKey TEXT PRIMARY KEY,
  -- wakeAt=0 is the durable ready ring; positive values are sleeping deadlines.
  status TEXT NOT NULL DEFAULT 'sleeping',
  wakeAt INTEGER NOT NULL,
  turn INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  minute INTEGER NOT NULL DEFAULT -1,
  used INTEGER NOT NULL DEFAULT 0,
  nextCohort TEXT NOT NULL DEFAULT 'initial',
  nextChain INTEGER NOT NULL DEFAULT 56,
  leaseToken TEXT,
  leaseUntil INTEGER NOT NULL DEFAULT 0,
  executionToken TEXT,
  executionLeaseUntil INTEGER NOT NULL DEFAULT 0,
  executionMinute INTEGER NOT NULL DEFAULT -1,
  executionUsed INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE INDEX idx_pilot_discovery_origin_agenda ON catalog_pilot_origin_schedule(wakeAt,turn,originKey);
