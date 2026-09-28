-- SQLite cannot ALTER a CHECK constraint. Rebuild only the small pilot work
-- table within the migration transaction, preserving every column. No source
-- data, origin schedule, evidence, budget or public projection is rewritten.
-- Release must pause/drain only the pilot and verify a recoverable backup.
CREATE TABLE catalog_pilot_discovery_work_expanded (
  workKey TEXT PRIMARY KEY,
  agentKey TEXT NOT NULL CHECK(agentKey IN ('eip155:56:341565','eip155:56:341564','eip155:56:341563','eip155:56:303779','eip155:56:213378','eip155:56:213332','eip155:56:213053','eip155:56:212989','eip155:56:212840','eip155:56:208760','eip155:56:265375','eip155:56:269233','eip155:56:270213','eip155:56:204789','eip155:56:212769','eip155:56:212943','eip155:56:213036','eip155:56:213084','eip155:56:213432')),
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
INSERT INTO catalog_pilot_discovery_work_expanded
 (workKey,agentKey,endpointKey,originKey,chainId,transport,contextVersion,generation,cohort,priorityClass,state,nextAttemptAt,runId,executionFence,executionToken,deliveryAt,failures,lastErrorCode,updatedAt)
 SELECT workKey,agentKey,endpointKey,originKey,chainId,transport,contextVersion,generation,cohort,priorityClass,state,nextAttemptAt,runId,executionFence,executionToken,deliveryAt,failures,lastErrorCode,updatedAt
 FROM catalog_pilot_discovery_work;
DROP TABLE catalog_pilot_discovery_work;
ALTER TABLE catalog_pilot_discovery_work_expanded RENAME TO catalog_pilot_discovery_work;
CREATE UNIQUE INDEX catalog_pilot_discovery_work_agent_endpoint ON catalog_pilot_discovery_work(agentKey,endpointKey);
CREATE INDEX idx_pilot_discovery_origin_head ON catalog_pilot_discovery_work
  (originKey,state,cohort,chainId,priorityClass,nextAttemptAt,workKey);
CREATE INDEX idx_pilot_discovery_delivery ON catalog_pilot_discovery_work(state,deliveryAt,workKey);
