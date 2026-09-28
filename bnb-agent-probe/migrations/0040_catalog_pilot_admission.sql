-- Durable, bounded Mainnet admission. Rebuild only the small work table to
-- replace its fixed CHECK with membership enforcement; preserve all work.
CREATE TABLE catalog_pilot_admissions (
 slot INTEGER PRIMARY KEY CHECK(slot BETWEEN 1 AND 29),
 agentKey TEXT NOT NULL UNIQUE CHECK(agentKey GLOB 'eip155:56:[1-9]*' AND substr(agentKey,11) NOT GLOB '*[^0-9]*' AND length(agentKey) BETWEEN 11 AND 88),
 batchId TEXT NOT NULL,
 admittedAt INTEGER NOT NULL
);
INSERT INTO catalog_pilot_admissions(slot,agentKey,batchId,admittedAt) VALUES
(1,'eip155:56:341565','legacy-19',0),
(2,'eip155:56:341564','legacy-19',0),
(3,'eip155:56:341563','legacy-19',0),
(4,'eip155:56:303779','legacy-19',0),
(5,'eip155:56:213378','legacy-19',0),
(6,'eip155:56:213332','legacy-19',0),
(7,'eip155:56:213053','legacy-19',0),
(8,'eip155:56:212989','legacy-19',0),
(9,'eip155:56:212840','legacy-19',0),
(10,'eip155:56:208760','legacy-19',0),
(11,'eip155:56:265375','legacy-19',0),
(12,'eip155:56:269233','legacy-19',0),
(13,'eip155:56:270213','legacy-19',0),
(14,'eip155:56:204789','legacy-19',0),
(15,'eip155:56:212769','legacy-19',0),
(16,'eip155:56:212943','legacy-19',0),
(17,'eip155:56:213036','legacy-19',0),
(18,'eip155:56:213084','legacy-19',0),
(19,'eip155:56:213432','legacy-19',0);
CREATE TABLE catalog_pilot_discovery_work_admitted (
  workKey TEXT PRIMARY KEY,
  agentKey TEXT NOT NULL REFERENCES catalog_pilot_admissions(agentKey),
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
INSERT INTO catalog_pilot_discovery_work_admitted
 (workKey,agentKey,endpointKey,originKey,chainId,transport,contextVersion,generation,cohort,priorityClass,state,nextAttemptAt,runId,executionFence,executionToken,deliveryAt,failures,lastErrorCode,updatedAt)
 SELECT workKey,agentKey,endpointKey,originKey,chainId,transport,contextVersion,generation,cohort,priorityClass,state,nextAttemptAt,runId,executionFence,executionToken,deliveryAt,failures,lastErrorCode,updatedAt
 FROM catalog_pilot_discovery_work;
DROP TABLE catalog_pilot_discovery_work;
ALTER TABLE catalog_pilot_discovery_work_admitted RENAME TO catalog_pilot_discovery_work;
CREATE UNIQUE INDEX catalog_pilot_discovery_work_agent_endpoint ON catalog_pilot_discovery_work(agentKey,endpointKey);
CREATE INDEX idx_pilot_discovery_origin_head ON catalog_pilot_discovery_work
  (originKey,state,cohort,chainId,priorityClass,nextAttemptAt,workKey);
CREATE INDEX idx_pilot_discovery_delivery ON catalog_pilot_discovery_work(state,deliveryAt,workKey);
