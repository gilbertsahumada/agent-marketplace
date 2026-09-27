-- Public read projections, version 1. No source history or runtime policy changes.
-- IDs retain authoritative observation payloads; freshness/admission are joined at read time.
-- Empty endpointScope represents NULL (published endpoint keys are non-empty hashes).
-- No projection-row backfill during migration: use the bounded transactional helper.
-- The additive source indexes do scan existing history; include that cost in release admission.
CREATE TABLE catalog_public_endpoint_evidence (
  agentKey TEXT NOT NULL,
  endpointScope TEXT NOT NULL,
  latestPlatformId INTEGER,
  latestPlatformProtocol TEXT,
  latestPlatformOutcome TEXT,
  latestPlatformObservedAt INTEGER,
  latestPlatformExpiresAt INTEGER,
  latestPlatformSuccessId INTEGER,
  latestPlatformSuccessAt INTEGER,
  platformAttemptCount INTEGER NOT NULL DEFAULT 0 CHECK (platformAttemptCount >= 0),
  browserReachabilityId INTEGER,
  browserProtocolId INTEGER,
  browserQuoteId INTEGER,
  browserChainId INTEGER,
  hasBrowserProtocolSuccessEver INTEGER NOT NULL DEFAULT 0 CHECK (hasBrowserProtocolSuccessEver IN (0,1)),
  latestQuoteId INTEGER,
  latestQuoteOutcome TEXT,
  latestQuoteObservedAt INTEGER,
  latestQuoteExpiresAt INTEGER,
  latestQuoteIsBuyer INTEGER NOT NULL DEFAULT 0 CHECK (latestQuoteIsBuyer IN (0,1)),
  hasBuyerVerifiedQuoteEver INTEGER NOT NULL DEFAULT 0 CHECK (hasBuyerVerifiedQuoteEver IN (0,1)),
  latestChainId INTEGER,
  projectionVersion INTEGER NOT NULL DEFAULT 1 CHECK (projectionVersion = 1),
  lastObservationMutationId INTEGER,
  PRIMARY KEY (agentKey,endpointScope)
) WITHOUT ROWID;
CREATE TABLE catalog_public_agent_metrics (
  agentKey TEXT PRIMARY KEY NOT NULL,
  buyerQuoteRequestCount INTEGER NOT NULL DEFAULT 0 CHECK (buyerQuoteRequestCount>=0),
  buyerQuoteSuccessCount INTEGER NOT NULL DEFAULT 0 CHECK (buyerQuoteSuccessCount>=0),
  buyerQuoteLastAttemptAt INTEGER,
  jobCount INTEGER NOT NULL DEFAULT 0 CHECK (jobCount>=0),
  jobCompleted INTEGER NOT NULL DEFAULT 0 CHECK (jobCompleted>=0),
  jobFunded INTEGER NOT NULL DEFAULT 0 CHECK (jobFunded>=0),
  jobSubmitted INTEGER NOT NULL DEFAULT 0 CHECK (jobSubmitted>=0),
  projectionVersion INTEGER NOT NULL DEFAULT 1 CHECK (projectionVersion=1)
) WITHOUT ROWID;
CREATE INDEX idx_catalog_observations_public_tuple ON catalog_observations(agentKey,COALESCE(endpointKey,''),observedAt DESC,id DESC);
INSERT INTO runtime_state(key,textValue,updatedAt) VALUES ('catalog_public_projection_backfill_v1','{"version":1,"phase":"evidence","agentKey":"","endpointScope":""}',0);

-- On first use, include old history not yet backfilled. Later INSERTs update in
-- constant history-independent work; ignored INSERTs never execute this trigger.
CREATE TRIGGER catalog_public_observation_insert AFTER INSERT ON catalog_observations BEGIN
INSERT INTO catalog_public_endpoint_evidence (agentKey,endpointScope,latestPlatformId,latestPlatformProtocol,latestPlatformOutcome,latestPlatformObservedAt,latestPlatformExpiresAt,latestPlatformSuccessId,latestPlatformSuccessAt,platformAttemptCount,browserReachabilityId,browserProtocolId,browserQuoteId,browserChainId,hasBrowserProtocolSuccessEver,latestQuoteId,latestQuoteOutcome,latestQuoteObservedAt,latestQuoteExpiresAt,latestQuoteIsBuyer,hasBuyerVerifiedQuoteEver,latestChainId,projectionVersion,lastObservationMutationId)
SELECT k.agentKey,k.endpointScope,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformId,
  (SELECT o.protocol FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformProtocol,
  (SELECT o.outcome FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformOutcome,
  (SELECT o.observedAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformObservedAt,
  (SELECT o.expiresAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformExpiresAt,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' AND o.outcome='protocol_valid' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformSuccessId,
  (SELECT o.observedAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' AND o.outcome='protocol_valid' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformSuccessAt,
  (SELECT COUNT(*) FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed') AS platformAttemptCount,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.validationKind='reachability' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS browserReachabilityId,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.validationKind='protocol' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS browserProtocolId,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.validationKind='quote' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS browserQuoteId,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.validationKind='chain' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS browserChainId,
  EXISTS (SELECT 1 FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.outcome='protocol_valid') AS hasBrowserProtocolSuccessEver,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestQuoteId,
  (SELECT o.outcome FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestQuoteOutcome,
  (SELECT o.observedAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestQuoteObservedAt,
  (SELECT o.expiresAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestQuoteExpiresAt,
  COALESCE((SELECT COALESCE(json_extract( CASE WHEN json_valid(o.detailsJson) THEN o.detailsJson ELSE '{}' END , '$.quoteKind'),'') <> 'capability_probe' FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1),0) AS latestQuoteIsBuyer,
  EXISTS (SELECT 1 FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' AND o.outcome='quote_verified' AND COALESCE(json_extract( CASE WHEN json_valid(o.detailsJson) THEN o.detailsJson ELSE '{}' END , '$.quoteKind'),'') <> 'capability_probe') AS hasBuyerVerifiedQuoteEver,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='chain' AND o.verificationLevel='onchain' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestChainId,
  1 AS projectionVersion,
  NEW.id
FROM (SELECT NEW.agentKey AS agentKey,COALESCE(NEW.endpointKey,'') AS endpointScope) k
WHERE EXISTS (SELECT 1 FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope) AND NOT EXISTS (SELECT 1 FROM catalog_public_endpoint_evidence WHERE agentKey=NEW.agentKey AND endpointScope=COALESCE(NEW.endpointKey,''))
ON CONFLICT(agentKey,endpointScope) DO UPDATE SET
  latestPlatformId=excluded.latestPlatformId,
  latestPlatformProtocol=excluded.latestPlatformProtocol,
  latestPlatformOutcome=excluded.latestPlatformOutcome,
  latestPlatformObservedAt=excluded.latestPlatformObservedAt,
  latestPlatformExpiresAt=excluded.latestPlatformExpiresAt,
  latestPlatformSuccessId=excluded.latestPlatformSuccessId,
  latestPlatformSuccessAt=excluded.latestPlatformSuccessAt,
  platformAttemptCount=excluded.platformAttemptCount,
  browserReachabilityId=excluded.browserReachabilityId,
  browserProtocolId=excluded.browserProtocolId,
  browserQuoteId=excluded.browserQuoteId,
  browserChainId=excluded.browserChainId,
  hasBrowserProtocolSuccessEver=excluded.hasBrowserProtocolSuccessEver,
  latestQuoteId=excluded.latestQuoteId,
  latestQuoteOutcome=excluded.latestQuoteOutcome,
  latestQuoteObservedAt=excluded.latestQuoteObservedAt,
  latestQuoteExpiresAt=excluded.latestQuoteExpiresAt,
  latestQuoteIsBuyer=excluded.latestQuoteIsBuyer,
  hasBuyerVerifiedQuoteEver=excluded.hasBuyerVerifiedQuoteEver,
  latestChainId=excluded.latestChainId,
  projectionVersion=excluded.projectionVersion,
  lastObservationMutationId=excluded.lastObservationMutationId;
UPDATE catalog_public_endpoint_evidence SET
  latestPlatformId= CASE WHEN NEW.source IN ('worker_probe','buyer_refresh','migration') AND NEW.validationKind IN ('reachability','protocol') AND NEW.verificationLevel='platform_observed' AND (latestPlatformId IS NULL OR NEW.observedAt>latestPlatformObservedAt OR (NEW.observedAt=latestPlatformObservedAt AND NEW.id>latestPlatformId)) THEN NEW.id ELSE latestPlatformId END ,
  latestPlatformProtocol= CASE WHEN NEW.source IN ('worker_probe','buyer_refresh','migration') AND NEW.validationKind IN ('reachability','protocol') AND NEW.verificationLevel='platform_observed' AND (latestPlatformId IS NULL OR NEW.observedAt>latestPlatformObservedAt OR (NEW.observedAt=latestPlatformObservedAt AND NEW.id>latestPlatformId)) THEN NEW.protocol ELSE latestPlatformProtocol END ,
  latestPlatformOutcome= CASE WHEN NEW.source IN ('worker_probe','buyer_refresh','migration') AND NEW.validationKind IN ('reachability','protocol') AND NEW.verificationLevel='platform_observed' AND (latestPlatformId IS NULL OR NEW.observedAt>latestPlatformObservedAt OR (NEW.observedAt=latestPlatformObservedAt AND NEW.id>latestPlatformId)) THEN NEW.outcome ELSE latestPlatformOutcome END ,
  latestPlatformObservedAt= CASE WHEN NEW.source IN ('worker_probe','buyer_refresh','migration') AND NEW.validationKind IN ('reachability','protocol') AND NEW.verificationLevel='platform_observed' AND (latestPlatformId IS NULL OR NEW.observedAt>latestPlatformObservedAt OR (NEW.observedAt=latestPlatformObservedAt AND NEW.id>latestPlatformId)) THEN NEW.observedAt ELSE latestPlatformObservedAt END ,
  latestPlatformExpiresAt= CASE WHEN NEW.source IN ('worker_probe','buyer_refresh','migration') AND NEW.validationKind IN ('reachability','protocol') AND NEW.verificationLevel='platform_observed' AND (latestPlatformId IS NULL OR NEW.observedAt>latestPlatformObservedAt OR (NEW.observedAt=latestPlatformObservedAt AND NEW.id>latestPlatformId)) THEN NEW.expiresAt ELSE latestPlatformExpiresAt END ,
  latestPlatformSuccessId= CASE WHEN NEW.source IN ('worker_probe','buyer_refresh','migration') AND NEW.validationKind IN ('reachability','protocol') AND NEW.verificationLevel='platform_observed' AND NEW.outcome='protocol_valid' AND (latestPlatformSuccessId IS NULL OR NEW.observedAt>latestPlatformSuccessAt OR (NEW.observedAt=latestPlatformSuccessAt AND NEW.id>latestPlatformSuccessId)) THEN NEW.id ELSE latestPlatformSuccessId END ,
  latestPlatformSuccessAt= CASE WHEN NEW.source IN ('worker_probe','buyer_refresh','migration') AND NEW.validationKind IN ('reachability','protocol') AND NEW.verificationLevel='platform_observed' AND NEW.outcome='protocol_valid' AND (latestPlatformSuccessId IS NULL OR NEW.observedAt>latestPlatformSuccessAt OR (NEW.observedAt=latestPlatformSuccessAt AND NEW.id>latestPlatformSuccessId)) THEN NEW.observedAt ELSE latestPlatformSuccessAt END ,
  platformAttemptCount=platformAttemptCount + CASE WHEN NEW.source IN ('worker_probe','buyer_refresh','migration') AND NEW.validationKind IN ('reachability','protocol') AND NEW.verificationLevel='platform_observed' THEN 1 ELSE 0 END ,
  browserReachabilityId= CASE WHEN NEW.source='browser_reported' AND NEW.validationKind='reachability' AND (browserReachabilityId IS NULL OR NEW.observedAt>(SELECT observedAt FROM catalog_observations WHERE id=browserReachabilityId) OR (NEW.observedAt=(SELECT observedAt FROM catalog_observations WHERE id=browserReachabilityId) AND NEW.id>browserReachabilityId)) THEN NEW.id ELSE browserReachabilityId END ,
  browserProtocolId= CASE WHEN NEW.source='browser_reported' AND NEW.validationKind='protocol' AND (browserProtocolId IS NULL OR NEW.observedAt>(SELECT observedAt FROM catalog_observations WHERE id=browserProtocolId) OR (NEW.observedAt=(SELECT observedAt FROM catalog_observations WHERE id=browserProtocolId) AND NEW.id>browserProtocolId)) THEN NEW.id ELSE browserProtocolId END ,
  browserQuoteId= CASE WHEN NEW.source='browser_reported' AND NEW.validationKind='quote' AND (browserQuoteId IS NULL OR NEW.observedAt>(SELECT observedAt FROM catalog_observations WHERE id=browserQuoteId) OR (NEW.observedAt=(SELECT observedAt FROM catalog_observations WHERE id=browserQuoteId) AND NEW.id>browserQuoteId)) THEN NEW.id ELSE browserQuoteId END ,
  browserChainId= CASE WHEN NEW.source='browser_reported' AND NEW.validationKind='chain' AND (browserChainId IS NULL OR NEW.observedAt>(SELECT observedAt FROM catalog_observations WHERE id=browserChainId) OR (NEW.observedAt=(SELECT observedAt FROM catalog_observations WHERE id=browserChainId) AND NEW.id>browserChainId)) THEN NEW.id ELSE browserChainId END ,
  hasBrowserProtocolSuccessEver=MAX(hasBrowserProtocolSuccessEver, CASE WHEN NEW.source='browser_reported' AND NEW.outcome='protocol_valid' THEN 1 ELSE 0 END ),
  latestQuoteId= CASE WHEN NEW.validationKind='quote' AND NEW.verificationLevel='cryptographic' AND (latestQuoteId IS NULL OR NEW.observedAt>latestQuoteObservedAt OR (NEW.observedAt=latestQuoteObservedAt AND NEW.id>latestQuoteId)) THEN NEW.id ELSE latestQuoteId END ,
  latestQuoteOutcome= CASE WHEN NEW.validationKind='quote' AND NEW.verificationLevel='cryptographic' AND (latestQuoteId IS NULL OR NEW.observedAt>latestQuoteObservedAt OR (NEW.observedAt=latestQuoteObservedAt AND NEW.id>latestQuoteId)) THEN NEW.outcome ELSE latestQuoteOutcome END ,
  latestQuoteObservedAt= CASE WHEN NEW.validationKind='quote' AND NEW.verificationLevel='cryptographic' AND (latestQuoteId IS NULL OR NEW.observedAt>latestQuoteObservedAt OR (NEW.observedAt=latestQuoteObservedAt AND NEW.id>latestQuoteId)) THEN NEW.observedAt ELSE latestQuoteObservedAt END ,
  latestQuoteExpiresAt= CASE WHEN NEW.validationKind='quote' AND NEW.verificationLevel='cryptographic' AND (latestQuoteId IS NULL OR NEW.observedAt>latestQuoteObservedAt OR (NEW.observedAt=latestQuoteObservedAt AND NEW.id>latestQuoteId)) THEN NEW.expiresAt ELSE latestQuoteExpiresAt END ,
  latestQuoteIsBuyer= CASE WHEN NEW.validationKind='quote' AND NEW.verificationLevel='cryptographic' AND (latestQuoteId IS NULL OR NEW.observedAt>latestQuoteObservedAt OR (NEW.observedAt=latestQuoteObservedAt AND NEW.id>latestQuoteId)) THEN COALESCE(json_extract( CASE WHEN json_valid(NEW.detailsJson) THEN NEW.detailsJson ELSE '{}' END , '$.quoteKind'),'') <> 'capability_probe' ELSE latestQuoteIsBuyer END ,
  hasBuyerVerifiedQuoteEver=MAX(hasBuyerVerifiedQuoteEver, CASE WHEN NEW.validationKind='quote' AND NEW.verificationLevel='cryptographic' AND NEW.outcome='quote_verified' AND COALESCE(json_extract( CASE WHEN json_valid(NEW.detailsJson) THEN NEW.detailsJson ELSE '{}' END , '$.quoteKind'),'') <> 'capability_probe' THEN 1 ELSE 0 END ),
  latestChainId= CASE WHEN NEW.validationKind='chain' AND NEW.verificationLevel='onchain' AND (latestChainId IS NULL OR NEW.observedAt>(SELECT observedAt FROM catalog_observations WHERE id=latestChainId) OR (NEW.observedAt=(SELECT observedAt FROM catalog_observations WHERE id=latestChainId) AND NEW.id>latestChainId)) THEN NEW.id ELSE latestChainId END ,
  lastObservationMutationId=NEW.id
WHERE agentKey=NEW.agentKey AND endpointScope=COALESCE(NEW.endpointKey,'') AND lastObservationMutationId IS NOT NEW.id;
END;
CREATE TRIGGER catalog_public_observation_update AFTER UPDATE ON catalog_observations BEGIN
INSERT INTO catalog_public_endpoint_evidence (agentKey,endpointScope,latestPlatformId,latestPlatformProtocol,latestPlatformOutcome,latestPlatformObservedAt,latestPlatformExpiresAt,latestPlatformSuccessId,latestPlatformSuccessAt,platformAttemptCount,browserReachabilityId,browserProtocolId,browserQuoteId,browserChainId,hasBrowserProtocolSuccessEver,latestQuoteId,latestQuoteOutcome,latestQuoteObservedAt,latestQuoteExpiresAt,latestQuoteIsBuyer,hasBuyerVerifiedQuoteEver,latestChainId,projectionVersion,lastObservationMutationId)
SELECT k.agentKey,k.endpointScope,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformId,
  (SELECT o.protocol FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformProtocol,
  (SELECT o.outcome FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformOutcome,
  (SELECT o.observedAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformObservedAt,
  (SELECT o.expiresAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformExpiresAt,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' AND o.outcome='protocol_valid' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformSuccessId,
  (SELECT o.observedAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' AND o.outcome='protocol_valid' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformSuccessAt,
  (SELECT COUNT(*) FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed') AS platformAttemptCount,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.validationKind='reachability' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS browserReachabilityId,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.validationKind='protocol' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS browserProtocolId,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.validationKind='quote' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS browserQuoteId,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.validationKind='chain' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS browserChainId,
  EXISTS (SELECT 1 FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.outcome='protocol_valid') AS hasBrowserProtocolSuccessEver,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestQuoteId,
  (SELECT o.outcome FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestQuoteOutcome,
  (SELECT o.observedAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestQuoteObservedAt,
  (SELECT o.expiresAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestQuoteExpiresAt,
  COALESCE((SELECT COALESCE(json_extract( CASE WHEN json_valid(o.detailsJson) THEN o.detailsJson ELSE '{}' END , '$.quoteKind'),'') <> 'capability_probe' FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1),0) AS latestQuoteIsBuyer,
  EXISTS (SELECT 1 FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' AND o.outcome='quote_verified' AND COALESCE(json_extract( CASE WHEN json_valid(o.detailsJson) THEN o.detailsJson ELSE '{}' END , '$.quoteKind'),'') <> 'capability_probe') AS hasBuyerVerifiedQuoteEver,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='chain' AND o.verificationLevel='onchain' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestChainId,
  1 AS projectionVersion,
  NULL
FROM (SELECT OLD.agentKey AS agentKey,COALESCE(OLD.endpointKey,'') AS endpointScope) k
WHERE EXISTS (SELECT 1 FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope) AND (OLD.agentKey IS NOT NEW.agentKey OR COALESCE(OLD.endpointKey,'') IS NOT COALESCE(NEW.endpointKey,''))
ON CONFLICT(agentKey,endpointScope) DO UPDATE SET
  latestPlatformId=excluded.latestPlatformId,
  latestPlatformProtocol=excluded.latestPlatformProtocol,
  latestPlatformOutcome=excluded.latestPlatformOutcome,
  latestPlatformObservedAt=excluded.latestPlatformObservedAt,
  latestPlatformExpiresAt=excluded.latestPlatformExpiresAt,
  latestPlatformSuccessId=excluded.latestPlatformSuccessId,
  latestPlatformSuccessAt=excluded.latestPlatformSuccessAt,
  platformAttemptCount=excluded.platformAttemptCount,
  browserReachabilityId=excluded.browserReachabilityId,
  browserProtocolId=excluded.browserProtocolId,
  browserQuoteId=excluded.browserQuoteId,
  browserChainId=excluded.browserChainId,
  hasBrowserProtocolSuccessEver=excluded.hasBrowserProtocolSuccessEver,
  latestQuoteId=excluded.latestQuoteId,
  latestQuoteOutcome=excluded.latestQuoteOutcome,
  latestQuoteObservedAt=excluded.latestQuoteObservedAt,
  latestQuoteExpiresAt=excluded.latestQuoteExpiresAt,
  latestQuoteIsBuyer=excluded.latestQuoteIsBuyer,
  hasBuyerVerifiedQuoteEver=excluded.hasBuyerVerifiedQuoteEver,
  latestChainId=excluded.latestChainId,
  projectionVersion=excluded.projectionVersion,
  lastObservationMutationId=excluded.lastObservationMutationId;
DELETE FROM catalog_public_endpoint_evidence WHERE agentKey=OLD.agentKey AND endpointScope=COALESCE(OLD.endpointKey,'') AND NOT EXISTS (SELECT 1 FROM catalog_observations o WHERE o.agentKey=OLD.agentKey AND COALESCE(o.endpointKey,'')=COALESCE(OLD.endpointKey,''));
INSERT INTO catalog_public_endpoint_evidence (agentKey,endpointScope,latestPlatformId,latestPlatformProtocol,latestPlatformOutcome,latestPlatformObservedAt,latestPlatformExpiresAt,latestPlatformSuccessId,latestPlatformSuccessAt,platformAttemptCount,browserReachabilityId,browserProtocolId,browserQuoteId,browserChainId,hasBrowserProtocolSuccessEver,latestQuoteId,latestQuoteOutcome,latestQuoteObservedAt,latestQuoteExpiresAt,latestQuoteIsBuyer,hasBuyerVerifiedQuoteEver,latestChainId,projectionVersion,lastObservationMutationId)
SELECT k.agentKey,k.endpointScope,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformId,
  (SELECT o.protocol FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformProtocol,
  (SELECT o.outcome FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformOutcome,
  (SELECT o.observedAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformObservedAt,
  (SELECT o.expiresAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformExpiresAt,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' AND o.outcome='protocol_valid' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformSuccessId,
  (SELECT o.observedAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' AND o.outcome='protocol_valid' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformSuccessAt,
  (SELECT COUNT(*) FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed') AS platformAttemptCount,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.validationKind='reachability' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS browserReachabilityId,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.validationKind='protocol' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS browserProtocolId,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.validationKind='quote' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS browserQuoteId,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.validationKind='chain' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS browserChainId,
  EXISTS (SELECT 1 FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.outcome='protocol_valid') AS hasBrowserProtocolSuccessEver,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestQuoteId,
  (SELECT o.outcome FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestQuoteOutcome,
  (SELECT o.observedAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestQuoteObservedAt,
  (SELECT o.expiresAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestQuoteExpiresAt,
  COALESCE((SELECT COALESCE(json_extract( CASE WHEN json_valid(o.detailsJson) THEN o.detailsJson ELSE '{}' END , '$.quoteKind'),'') <> 'capability_probe' FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1),0) AS latestQuoteIsBuyer,
  EXISTS (SELECT 1 FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' AND o.outcome='quote_verified' AND COALESCE(json_extract( CASE WHEN json_valid(o.detailsJson) THEN o.detailsJson ELSE '{}' END , '$.quoteKind'),'') <> 'capability_probe') AS hasBuyerVerifiedQuoteEver,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='chain' AND o.verificationLevel='onchain' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestChainId,
  1 AS projectionVersion,
  NULL
FROM (SELECT NEW.agentKey AS agentKey,COALESCE(NEW.endpointKey,'') AS endpointScope) k
WHERE EXISTS (SELECT 1 FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope) AND 1
ON CONFLICT(agentKey,endpointScope) DO UPDATE SET
  latestPlatformId=excluded.latestPlatformId,
  latestPlatformProtocol=excluded.latestPlatformProtocol,
  latestPlatformOutcome=excluded.latestPlatformOutcome,
  latestPlatformObservedAt=excluded.latestPlatformObservedAt,
  latestPlatformExpiresAt=excluded.latestPlatformExpiresAt,
  latestPlatformSuccessId=excluded.latestPlatformSuccessId,
  latestPlatformSuccessAt=excluded.latestPlatformSuccessAt,
  platformAttemptCount=excluded.platformAttemptCount,
  browserReachabilityId=excluded.browserReachabilityId,
  browserProtocolId=excluded.browserProtocolId,
  browserQuoteId=excluded.browserQuoteId,
  browserChainId=excluded.browserChainId,
  hasBrowserProtocolSuccessEver=excluded.hasBrowserProtocolSuccessEver,
  latestQuoteId=excluded.latestQuoteId,
  latestQuoteOutcome=excluded.latestQuoteOutcome,
  latestQuoteObservedAt=excluded.latestQuoteObservedAt,
  latestQuoteExpiresAt=excluded.latestQuoteExpiresAt,
  latestQuoteIsBuyer=excluded.latestQuoteIsBuyer,
  hasBuyerVerifiedQuoteEver=excluded.hasBuyerVerifiedQuoteEver,
  latestChainId=excluded.latestChainId,
  projectionVersion=excluded.projectionVersion,
  lastObservationMutationId=excluded.lastObservationMutationId;
DELETE FROM catalog_public_endpoint_evidence WHERE agentKey=NEW.agentKey AND endpointScope=COALESCE(NEW.endpointKey,'') AND NOT EXISTS (SELECT 1 FROM catalog_observations o WHERE o.agentKey=NEW.agentKey AND COALESCE(o.endpointKey,'')=COALESCE(NEW.endpointKey,''));
END;
CREATE TRIGGER catalog_public_observation_delete AFTER DELETE ON catalog_observations BEGIN
INSERT INTO catalog_public_endpoint_evidence (agentKey,endpointScope,latestPlatformId,latestPlatformProtocol,latestPlatformOutcome,latestPlatformObservedAt,latestPlatformExpiresAt,latestPlatformSuccessId,latestPlatformSuccessAt,platformAttemptCount,browserReachabilityId,browserProtocolId,browserQuoteId,browserChainId,hasBrowserProtocolSuccessEver,latestQuoteId,latestQuoteOutcome,latestQuoteObservedAt,latestQuoteExpiresAt,latestQuoteIsBuyer,hasBuyerVerifiedQuoteEver,latestChainId,projectionVersion,lastObservationMutationId)
SELECT k.agentKey,k.endpointScope,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformId,
  (SELECT o.protocol FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformProtocol,
  (SELECT o.outcome FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformOutcome,
  (SELECT o.observedAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformObservedAt,
  (SELECT o.expiresAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformExpiresAt,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' AND o.outcome='protocol_valid' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformSuccessId,
  (SELECT o.observedAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed' AND o.outcome='protocol_valid' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestPlatformSuccessAt,
  (SELECT COUNT(*) FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source IN ('worker_probe','buyer_refresh','migration') AND o.validationKind IN ('reachability','protocol') AND o.verificationLevel='platform_observed') AS platformAttemptCount,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.validationKind='reachability' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS browserReachabilityId,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.validationKind='protocol' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS browserProtocolId,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.validationKind='quote' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS browserQuoteId,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.validationKind='chain' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS browserChainId,
  EXISTS (SELECT 1 FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.source='browser_reported' AND o.outcome='protocol_valid') AS hasBrowserProtocolSuccessEver,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestQuoteId,
  (SELECT o.outcome FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestQuoteOutcome,
  (SELECT o.observedAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestQuoteObservedAt,
  (SELECT o.expiresAt FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestQuoteExpiresAt,
  COALESCE((SELECT COALESCE(json_extract( CASE WHEN json_valid(o.detailsJson) THEN o.detailsJson ELSE '{}' END , '$.quoteKind'),'') <> 'capability_probe' FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1),0) AS latestQuoteIsBuyer,
  EXISTS (SELECT 1 FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='quote' AND o.verificationLevel='cryptographic' AND o.outcome='quote_verified' AND COALESCE(json_extract( CASE WHEN json_valid(o.detailsJson) THEN o.detailsJson ELSE '{}' END , '$.quoteKind'),'') <> 'capability_probe') AS hasBuyerVerifiedQuoteEver,
  (SELECT o.id FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope AND o.validationKind='chain' AND o.verificationLevel='onchain' ORDER BY o.observedAt DESC,o.id DESC LIMIT 1) AS latestChainId,
  1 AS projectionVersion,
  NULL
FROM (SELECT OLD.agentKey AS agentKey,COALESCE(OLD.endpointKey,'') AS endpointScope) k
WHERE EXISTS (SELECT 1 FROM catalog_observations o WHERE o.agentKey=k.agentKey AND COALESCE(o.endpointKey,'')=k.endpointScope) AND 1
ON CONFLICT(agentKey,endpointScope) DO UPDATE SET
  latestPlatformId=excluded.latestPlatformId,
  latestPlatformProtocol=excluded.latestPlatformProtocol,
  latestPlatformOutcome=excluded.latestPlatformOutcome,
  latestPlatformObservedAt=excluded.latestPlatformObservedAt,
  latestPlatformExpiresAt=excluded.latestPlatformExpiresAt,
  latestPlatformSuccessId=excluded.latestPlatformSuccessId,
  latestPlatformSuccessAt=excluded.latestPlatformSuccessAt,
  platformAttemptCount=excluded.platformAttemptCount,
  browserReachabilityId=excluded.browserReachabilityId,
  browserProtocolId=excluded.browserProtocolId,
  browserQuoteId=excluded.browserQuoteId,
  browserChainId=excluded.browserChainId,
  hasBrowserProtocolSuccessEver=excluded.hasBrowserProtocolSuccessEver,
  latestQuoteId=excluded.latestQuoteId,
  latestQuoteOutcome=excluded.latestQuoteOutcome,
  latestQuoteObservedAt=excluded.latestQuoteObservedAt,
  latestQuoteExpiresAt=excluded.latestQuoteExpiresAt,
  latestQuoteIsBuyer=excluded.latestQuoteIsBuyer,
  hasBuyerVerifiedQuoteEver=excluded.hasBuyerVerifiedQuoteEver,
  latestChainId=excluded.latestChainId,
  projectionVersion=excluded.projectionVersion,
  lastObservationMutationId=excluded.lastObservationMutationId;
DELETE FROM catalog_public_endpoint_evidence WHERE agentKey=OLD.agentKey AND endpointScope=COALESCE(OLD.endpointKey,'') AND NOT EXISTS (SELECT 1 FROM catalog_observations o WHERE o.agentKey=OLD.agentKey AND COALESCE(o.endpointKey,'')=COALESCE(OLD.endpointKey,''));
END;

CREATE TRIGGER catalog_public_request_insert AFTER INSERT ON catalog_quote_requests BEGIN
INSERT INTO catalog_public_agent_metrics (agentKey,buyerQuoteRequestCount,buyerQuoteSuccessCount,buyerQuoteLastAttemptAt,jobCount,jobCompleted,jobFunded,jobSubmitted,projectionVersion)
SELECT k.agentKey,
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration' AND r.status='succeeded'),
  (SELECT MAX(a.startedAt) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent JOIN catalog_quote_attempts a ON a.requestId=r.id WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=3),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=1),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=2),
  1
FROM (SELECT NEW.agentKey AS agentKey WHERE NEW.kind='buyer_quote' AND NEW.callerKey<>'migration') k WHERE 1
ON CONFLICT(agentKey) DO UPDATE SET
  buyerQuoteRequestCount=excluded.buyerQuoteRequestCount,
  buyerQuoteSuccessCount=excluded.buyerQuoteSuccessCount,
  buyerQuoteLastAttemptAt=excluded.buyerQuoteLastAttemptAt,
  jobCount=excluded.jobCount,
  jobCompleted=excluded.jobCompleted,
  jobFunded=excluded.jobFunded,
  jobSubmitted=excluded.jobSubmitted,
  projectionVersion=excluded.projectionVersion
WHERE catalog_public_agent_metrics.buyerQuoteRequestCount IS NOT excluded.buyerQuoteRequestCount OR catalog_public_agent_metrics.buyerQuoteSuccessCount IS NOT excluded.buyerQuoteSuccessCount OR catalog_public_agent_metrics.buyerQuoteLastAttemptAt IS NOT excluded.buyerQuoteLastAttemptAt OR catalog_public_agent_metrics.jobCount IS NOT excluded.jobCount OR catalog_public_agent_metrics.jobCompleted IS NOT excluded.jobCompleted OR catalog_public_agent_metrics.jobFunded IS NOT excluded.jobFunded OR catalog_public_agent_metrics.jobSubmitted IS NOT excluded.jobSubmitted OR catalog_public_agent_metrics.projectionVersion IS NOT excluded.projectionVersion;
END;

CREATE TRIGGER catalog_public_attempt_insert AFTER INSERT ON catalog_quote_attempts BEGIN
INSERT INTO catalog_public_agent_metrics (agentKey,buyerQuoteRequestCount,buyerQuoteSuccessCount,buyerQuoteLastAttemptAt,jobCount,jobCompleted,jobFunded,jobSubmitted,projectionVersion)
SELECT k.agentKey,
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration' AND r.status='succeeded'),
  (SELECT MAX(a.startedAt) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent JOIN catalog_quote_attempts a ON a.requestId=r.id WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=3),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=1),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=2),
  1
FROM (SELECT agentKey FROM catalog_quote_requests WHERE id=NEW.requestId AND kind='buyer_quote' AND callerKey<>'migration') k WHERE 1
ON CONFLICT(agentKey) DO UPDATE SET
  buyerQuoteRequestCount=excluded.buyerQuoteRequestCount,
  buyerQuoteSuccessCount=excluded.buyerQuoteSuccessCount,
  buyerQuoteLastAttemptAt=excluded.buyerQuoteLastAttemptAt,
  jobCount=excluded.jobCount,
  jobCompleted=excluded.jobCompleted,
  jobFunded=excluded.jobFunded,
  jobSubmitted=excluded.jobSubmitted,
  projectionVersion=excluded.projectionVersion
WHERE catalog_public_agent_metrics.buyerQuoteRequestCount IS NOT excluded.buyerQuoteRequestCount OR catalog_public_agent_metrics.buyerQuoteSuccessCount IS NOT excluded.buyerQuoteSuccessCount OR catalog_public_agent_metrics.buyerQuoteLastAttemptAt IS NOT excluded.buyerQuoteLastAttemptAt OR catalog_public_agent_metrics.jobCount IS NOT excluded.jobCount OR catalog_public_agent_metrics.jobCompleted IS NOT excluded.jobCompleted OR catalog_public_agent_metrics.jobFunded IS NOT excluded.jobFunded OR catalog_public_agent_metrics.jobSubmitted IS NOT excluded.jobSubmitted OR catalog_public_agent_metrics.projectionVersion IS NOT excluded.projectionVersion;
END;

CREATE TRIGGER catalog_public_hire_insert AFTER INSERT ON hire_events BEGIN
INSERT INTO catalog_public_agent_metrics (agentKey,buyerQuoteRequestCount,buyerQuoteSuccessCount,buyerQuoteLastAttemptAt,jobCount,jobCompleted,jobFunded,jobSubmitted,projectionVersion)
SELECT k.agentKey,
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration' AND r.status='succeeded'),
  (SELECT MAX(a.startedAt) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent JOIN catalog_quote_attempts a ON a.requestId=r.id WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=3),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=1),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=2),
  1
FROM (SELECT 'eip155:'||NEW.chainId||':'||NEW.agentId AS agentKey) k WHERE 1
ON CONFLICT(agentKey) DO UPDATE SET
  buyerQuoteRequestCount=excluded.buyerQuoteRequestCount,
  buyerQuoteSuccessCount=excluded.buyerQuoteSuccessCount,
  buyerQuoteLastAttemptAt=excluded.buyerQuoteLastAttemptAt,
  jobCount=excluded.jobCount,
  jobCompleted=excluded.jobCompleted,
  jobFunded=excluded.jobFunded,
  jobSubmitted=excluded.jobSubmitted,
  projectionVersion=excluded.projectionVersion
WHERE catalog_public_agent_metrics.buyerQuoteRequestCount IS NOT excluded.buyerQuoteRequestCount OR catalog_public_agent_metrics.buyerQuoteSuccessCount IS NOT excluded.buyerQuoteSuccessCount OR catalog_public_agent_metrics.buyerQuoteLastAttemptAt IS NOT excluded.buyerQuoteLastAttemptAt OR catalog_public_agent_metrics.jobCount IS NOT excluded.jobCount OR catalog_public_agent_metrics.jobCompleted IS NOT excluded.jobCompleted OR catalog_public_agent_metrics.jobFunded IS NOT excluded.jobFunded OR catalog_public_agent_metrics.jobSubmitted IS NOT excluded.jobSubmitted OR catalog_public_agent_metrics.projectionVersion IS NOT excluded.projectionVersion;
END;

CREATE TRIGGER catalog_public_job_insert AFTER INSERT ON commerce_jobs BEGIN
INSERT INTO catalog_public_agent_metrics (agentKey,buyerQuoteRequestCount,buyerQuoteSuccessCount,buyerQuoteLastAttemptAt,jobCount,jobCompleted,jobFunded,jobSubmitted,projectionVersion)
SELECT k.agentKey,
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration' AND r.status='succeeded'),
  (SELECT MAX(a.startedAt) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent JOIN catalog_quote_attempts a ON a.requestId=r.id WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=3),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=1),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=2),
  1
FROM (SELECT DISTINCT 'eip155:'||h.chainId||':'||h.agentId AS agentKey FROM hire_events h WHERE h.chainId=NEW.chainId AND h.jobId=CAST(NEW.jobId AS TEXT) AND h.provenance='chain_verified') k WHERE 1
ON CONFLICT(agentKey) DO UPDATE SET
  buyerQuoteRequestCount=excluded.buyerQuoteRequestCount,
  buyerQuoteSuccessCount=excluded.buyerQuoteSuccessCount,
  buyerQuoteLastAttemptAt=excluded.buyerQuoteLastAttemptAt,
  jobCount=excluded.jobCount,
  jobCompleted=excluded.jobCompleted,
  jobFunded=excluded.jobFunded,
  jobSubmitted=excluded.jobSubmitted,
  projectionVersion=excluded.projectionVersion
WHERE catalog_public_agent_metrics.buyerQuoteRequestCount IS NOT excluded.buyerQuoteRequestCount OR catalog_public_agent_metrics.buyerQuoteSuccessCount IS NOT excluded.buyerQuoteSuccessCount OR catalog_public_agent_metrics.buyerQuoteLastAttemptAt IS NOT excluded.buyerQuoteLastAttemptAt OR catalog_public_agent_metrics.jobCount IS NOT excluded.jobCount OR catalog_public_agent_metrics.jobCompleted IS NOT excluded.jobCompleted OR catalog_public_agent_metrics.jobFunded IS NOT excluded.jobFunded OR catalog_public_agent_metrics.jobSubmitted IS NOT excluded.jobSubmitted OR catalog_public_agent_metrics.projectionVersion IS NOT excluded.projectionVersion;
END;

CREATE TRIGGER catalog_public_request_update AFTER UPDATE ON catalog_quote_requests BEGIN
INSERT INTO catalog_public_agent_metrics (agentKey,buyerQuoteRequestCount,buyerQuoteSuccessCount,buyerQuoteLastAttemptAt,jobCount,jobCompleted,jobFunded,jobSubmitted,projectionVersion)
SELECT k.agentKey,
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration' AND r.status='succeeded'),
  (SELECT MAX(a.startedAt) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent JOIN catalog_quote_attempts a ON a.requestId=r.id WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=3),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=1),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=2),
  1
FROM (SELECT OLD.agentKey AS agentKey WHERE OLD.kind='buyer_quote' AND OLD.callerKey<>'migration' UNION SELECT NEW.agentKey AS agentKey WHERE NEW.kind='buyer_quote' AND NEW.callerKey<>'migration') k WHERE 1
ON CONFLICT(agentKey) DO UPDATE SET
  buyerQuoteRequestCount=excluded.buyerQuoteRequestCount,
  buyerQuoteSuccessCount=excluded.buyerQuoteSuccessCount,
  buyerQuoteLastAttemptAt=excluded.buyerQuoteLastAttemptAt,
  jobCount=excluded.jobCount,
  jobCompleted=excluded.jobCompleted,
  jobFunded=excluded.jobFunded,
  jobSubmitted=excluded.jobSubmitted,
  projectionVersion=excluded.projectionVersion
WHERE catalog_public_agent_metrics.buyerQuoteRequestCount IS NOT excluded.buyerQuoteRequestCount OR catalog_public_agent_metrics.buyerQuoteSuccessCount IS NOT excluded.buyerQuoteSuccessCount OR catalog_public_agent_metrics.buyerQuoteLastAttemptAt IS NOT excluded.buyerQuoteLastAttemptAt OR catalog_public_agent_metrics.jobCount IS NOT excluded.jobCount OR catalog_public_agent_metrics.jobCompleted IS NOT excluded.jobCompleted OR catalog_public_agent_metrics.jobFunded IS NOT excluded.jobFunded OR catalog_public_agent_metrics.jobSubmitted IS NOT excluded.jobSubmitted OR catalog_public_agent_metrics.projectionVersion IS NOT excluded.projectionVersion;
END;

CREATE TRIGGER catalog_public_attempt_update AFTER UPDATE ON catalog_quote_attempts BEGIN
INSERT INTO catalog_public_agent_metrics (agentKey,buyerQuoteRequestCount,buyerQuoteSuccessCount,buyerQuoteLastAttemptAt,jobCount,jobCompleted,jobFunded,jobSubmitted,projectionVersion)
SELECT k.agentKey,
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration' AND r.status='succeeded'),
  (SELECT MAX(a.startedAt) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent JOIN catalog_quote_attempts a ON a.requestId=r.id WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=3),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=1),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=2),
  1
FROM (SELECT agentKey FROM catalog_quote_requests WHERE id=OLD.requestId AND kind='buyer_quote' AND callerKey<>'migration' UNION SELECT agentKey FROM catalog_quote_requests WHERE id=NEW.requestId AND kind='buyer_quote' AND callerKey<>'migration') k WHERE 1
ON CONFLICT(agentKey) DO UPDATE SET
  buyerQuoteRequestCount=excluded.buyerQuoteRequestCount,
  buyerQuoteSuccessCount=excluded.buyerQuoteSuccessCount,
  buyerQuoteLastAttemptAt=excluded.buyerQuoteLastAttemptAt,
  jobCount=excluded.jobCount,
  jobCompleted=excluded.jobCompleted,
  jobFunded=excluded.jobFunded,
  jobSubmitted=excluded.jobSubmitted,
  projectionVersion=excluded.projectionVersion
WHERE catalog_public_agent_metrics.buyerQuoteRequestCount IS NOT excluded.buyerQuoteRequestCount OR catalog_public_agent_metrics.buyerQuoteSuccessCount IS NOT excluded.buyerQuoteSuccessCount OR catalog_public_agent_metrics.buyerQuoteLastAttemptAt IS NOT excluded.buyerQuoteLastAttemptAt OR catalog_public_agent_metrics.jobCount IS NOT excluded.jobCount OR catalog_public_agent_metrics.jobCompleted IS NOT excluded.jobCompleted OR catalog_public_agent_metrics.jobFunded IS NOT excluded.jobFunded OR catalog_public_agent_metrics.jobSubmitted IS NOT excluded.jobSubmitted OR catalog_public_agent_metrics.projectionVersion IS NOT excluded.projectionVersion;
END;

CREATE TRIGGER catalog_public_hire_update AFTER UPDATE ON hire_events BEGIN
INSERT INTO catalog_public_agent_metrics (agentKey,buyerQuoteRequestCount,buyerQuoteSuccessCount,buyerQuoteLastAttemptAt,jobCount,jobCompleted,jobFunded,jobSubmitted,projectionVersion)
SELECT k.agentKey,
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration' AND r.status='succeeded'),
  (SELECT MAX(a.startedAt) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent JOIN catalog_quote_attempts a ON a.requestId=r.id WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=3),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=1),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=2),
  1
FROM (SELECT 'eip155:'||OLD.chainId||':'||OLD.agentId AS agentKey UNION SELECT 'eip155:'||NEW.chainId||':'||NEW.agentId AS agentKey) k WHERE 1
ON CONFLICT(agentKey) DO UPDATE SET
  buyerQuoteRequestCount=excluded.buyerQuoteRequestCount,
  buyerQuoteSuccessCount=excluded.buyerQuoteSuccessCount,
  buyerQuoteLastAttemptAt=excluded.buyerQuoteLastAttemptAt,
  jobCount=excluded.jobCount,
  jobCompleted=excluded.jobCompleted,
  jobFunded=excluded.jobFunded,
  jobSubmitted=excluded.jobSubmitted,
  projectionVersion=excluded.projectionVersion
WHERE catalog_public_agent_metrics.buyerQuoteRequestCount IS NOT excluded.buyerQuoteRequestCount OR catalog_public_agent_metrics.buyerQuoteSuccessCount IS NOT excluded.buyerQuoteSuccessCount OR catalog_public_agent_metrics.buyerQuoteLastAttemptAt IS NOT excluded.buyerQuoteLastAttemptAt OR catalog_public_agent_metrics.jobCount IS NOT excluded.jobCount OR catalog_public_agent_metrics.jobCompleted IS NOT excluded.jobCompleted OR catalog_public_agent_metrics.jobFunded IS NOT excluded.jobFunded OR catalog_public_agent_metrics.jobSubmitted IS NOT excluded.jobSubmitted OR catalog_public_agent_metrics.projectionVersion IS NOT excluded.projectionVersion;
END;

CREATE TRIGGER catalog_public_job_update AFTER UPDATE OF status,chainId,jobId ON commerce_jobs BEGIN
INSERT INTO catalog_public_agent_metrics (agentKey,buyerQuoteRequestCount,buyerQuoteSuccessCount,buyerQuoteLastAttemptAt,jobCount,jobCompleted,jobFunded,jobSubmitted,projectionVersion)
SELECT k.agentKey,
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration' AND r.status='succeeded'),
  (SELECT MAX(a.startedAt) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent JOIN catalog_quote_attempts a ON a.requestId=r.id WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=3),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=1),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=2),
  1
FROM (SELECT DISTINCT 'eip155:'||h.chainId||':'||h.agentId AS agentKey FROM hire_events h WHERE h.chainId=OLD.chainId AND h.jobId=CAST(OLD.jobId AS TEXT) AND h.provenance='chain_verified' UNION SELECT DISTINCT 'eip155:'||h.chainId||':'||h.agentId AS agentKey FROM hire_events h WHERE h.chainId=NEW.chainId AND h.jobId=CAST(NEW.jobId AS TEXT) AND h.provenance='chain_verified') k WHERE 1
ON CONFLICT(agentKey) DO UPDATE SET
  buyerQuoteRequestCount=excluded.buyerQuoteRequestCount,
  buyerQuoteSuccessCount=excluded.buyerQuoteSuccessCount,
  buyerQuoteLastAttemptAt=excluded.buyerQuoteLastAttemptAt,
  jobCount=excluded.jobCount,
  jobCompleted=excluded.jobCompleted,
  jobFunded=excluded.jobFunded,
  jobSubmitted=excluded.jobSubmitted,
  projectionVersion=excluded.projectionVersion
WHERE catalog_public_agent_metrics.buyerQuoteRequestCount IS NOT excluded.buyerQuoteRequestCount OR catalog_public_agent_metrics.buyerQuoteSuccessCount IS NOT excluded.buyerQuoteSuccessCount OR catalog_public_agent_metrics.buyerQuoteLastAttemptAt IS NOT excluded.buyerQuoteLastAttemptAt OR catalog_public_agent_metrics.jobCount IS NOT excluded.jobCount OR catalog_public_agent_metrics.jobCompleted IS NOT excluded.jobCompleted OR catalog_public_agent_metrics.jobFunded IS NOT excluded.jobFunded OR catalog_public_agent_metrics.jobSubmitted IS NOT excluded.jobSubmitted OR catalog_public_agent_metrics.projectionVersion IS NOT excluded.projectionVersion;
END;

CREATE TRIGGER catalog_public_request_delete AFTER DELETE ON catalog_quote_requests BEGIN
INSERT INTO catalog_public_agent_metrics (agentKey,buyerQuoteRequestCount,buyerQuoteSuccessCount,buyerQuoteLastAttemptAt,jobCount,jobCompleted,jobFunded,jobSubmitted,projectionVersion)
SELECT k.agentKey,
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration' AND r.status='succeeded'),
  (SELECT MAX(a.startedAt) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent JOIN catalog_quote_attempts a ON a.requestId=r.id WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=3),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=1),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=2),
  1
FROM (SELECT OLD.agentKey AS agentKey WHERE OLD.kind='buyer_quote' AND OLD.callerKey<>'migration') k WHERE 1
ON CONFLICT(agentKey) DO UPDATE SET
  buyerQuoteRequestCount=excluded.buyerQuoteRequestCount,
  buyerQuoteSuccessCount=excluded.buyerQuoteSuccessCount,
  buyerQuoteLastAttemptAt=excluded.buyerQuoteLastAttemptAt,
  jobCount=excluded.jobCount,
  jobCompleted=excluded.jobCompleted,
  jobFunded=excluded.jobFunded,
  jobSubmitted=excluded.jobSubmitted,
  projectionVersion=excluded.projectionVersion
WHERE catalog_public_agent_metrics.buyerQuoteRequestCount IS NOT excluded.buyerQuoteRequestCount OR catalog_public_agent_metrics.buyerQuoteSuccessCount IS NOT excluded.buyerQuoteSuccessCount OR catalog_public_agent_metrics.buyerQuoteLastAttemptAt IS NOT excluded.buyerQuoteLastAttemptAt OR catalog_public_agent_metrics.jobCount IS NOT excluded.jobCount OR catalog_public_agent_metrics.jobCompleted IS NOT excluded.jobCompleted OR catalog_public_agent_metrics.jobFunded IS NOT excluded.jobFunded OR catalog_public_agent_metrics.jobSubmitted IS NOT excluded.jobSubmitted OR catalog_public_agent_metrics.projectionVersion IS NOT excluded.projectionVersion;
END;

CREATE TRIGGER catalog_public_attempt_delete AFTER DELETE ON catalog_quote_attempts BEGIN
INSERT INTO catalog_public_agent_metrics (agentKey,buyerQuoteRequestCount,buyerQuoteSuccessCount,buyerQuoteLastAttemptAt,jobCount,jobCompleted,jobFunded,jobSubmitted,projectionVersion)
SELECT k.agentKey,
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration' AND r.status='succeeded'),
  (SELECT MAX(a.startedAt) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent JOIN catalog_quote_attempts a ON a.requestId=r.id WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=3),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=1),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=2),
  1
FROM (SELECT agentKey FROM catalog_quote_requests WHERE id=OLD.requestId AND kind='buyer_quote' AND callerKey<>'migration') k WHERE 1
ON CONFLICT(agentKey) DO UPDATE SET
  buyerQuoteRequestCount=excluded.buyerQuoteRequestCount,
  buyerQuoteSuccessCount=excluded.buyerQuoteSuccessCount,
  buyerQuoteLastAttemptAt=excluded.buyerQuoteLastAttemptAt,
  jobCount=excluded.jobCount,
  jobCompleted=excluded.jobCompleted,
  jobFunded=excluded.jobFunded,
  jobSubmitted=excluded.jobSubmitted,
  projectionVersion=excluded.projectionVersion
WHERE catalog_public_agent_metrics.buyerQuoteRequestCount IS NOT excluded.buyerQuoteRequestCount OR catalog_public_agent_metrics.buyerQuoteSuccessCount IS NOT excluded.buyerQuoteSuccessCount OR catalog_public_agent_metrics.buyerQuoteLastAttemptAt IS NOT excluded.buyerQuoteLastAttemptAt OR catalog_public_agent_metrics.jobCount IS NOT excluded.jobCount OR catalog_public_agent_metrics.jobCompleted IS NOT excluded.jobCompleted OR catalog_public_agent_metrics.jobFunded IS NOT excluded.jobFunded OR catalog_public_agent_metrics.jobSubmitted IS NOT excluded.jobSubmitted OR catalog_public_agent_metrics.projectionVersion IS NOT excluded.projectionVersion;
END;

CREATE TRIGGER catalog_public_hire_delete AFTER DELETE ON hire_events BEGIN
INSERT INTO catalog_public_agent_metrics (agentKey,buyerQuoteRequestCount,buyerQuoteSuccessCount,buyerQuoteLastAttemptAt,jobCount,jobCompleted,jobFunded,jobSubmitted,projectionVersion)
SELECT k.agentKey,
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration' AND r.status='succeeded'),
  (SELECT MAX(a.startedAt) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent JOIN catalog_quote_attempts a ON a.requestId=r.id WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=3),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=1),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=2),
  1
FROM (SELECT 'eip155:'||OLD.chainId||':'||OLD.agentId AS agentKey) k WHERE 1
ON CONFLICT(agentKey) DO UPDATE SET
  buyerQuoteRequestCount=excluded.buyerQuoteRequestCount,
  buyerQuoteSuccessCount=excluded.buyerQuoteSuccessCount,
  buyerQuoteLastAttemptAt=excluded.buyerQuoteLastAttemptAt,
  jobCount=excluded.jobCount,
  jobCompleted=excluded.jobCompleted,
  jobFunded=excluded.jobFunded,
  jobSubmitted=excluded.jobSubmitted,
  projectionVersion=excluded.projectionVersion
WHERE catalog_public_agent_metrics.buyerQuoteRequestCount IS NOT excluded.buyerQuoteRequestCount OR catalog_public_agent_metrics.buyerQuoteSuccessCount IS NOT excluded.buyerQuoteSuccessCount OR catalog_public_agent_metrics.buyerQuoteLastAttemptAt IS NOT excluded.buyerQuoteLastAttemptAt OR catalog_public_agent_metrics.jobCount IS NOT excluded.jobCount OR catalog_public_agent_metrics.jobCompleted IS NOT excluded.jobCompleted OR catalog_public_agent_metrics.jobFunded IS NOT excluded.jobFunded OR catalog_public_agent_metrics.jobSubmitted IS NOT excluded.jobSubmitted OR catalog_public_agent_metrics.projectionVersion IS NOT excluded.projectionVersion;
END;

CREATE TRIGGER catalog_public_job_delete AFTER DELETE ON commerce_jobs BEGIN
INSERT INTO catalog_public_agent_metrics (agentKey,buyerQuoteRequestCount,buyerQuoteSuccessCount,buyerQuoteLastAttemptAt,jobCount,jobCompleted,jobFunded,jobSubmitted,projectionVersion)
SELECT k.agentKey,
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(*) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration' AND r.status='succeeded'),
  (SELECT MAX(a.startedAt) FROM catalog_quote_requests r INDEXED BY idx_catalog_quote_requests_agent JOIN catalog_quote_attempts a ON a.requestId=r.id WHERE r.agentKey=k.agentKey AND r.kind='buyer_quote' AND r.callerKey<>'migration'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified'),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=3),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=1),
  (SELECT COUNT(DISTINCT j.jobId) FROM hire_events h JOIN commerce_jobs j ON j.chainId=h.chainId AND j.jobId=CAST(h.jobId AS INTEGER) AND h.jobId=CAST(j.jobId AS TEXT) WHERE h.chainId= CASE WHEN k.agentKey LIKE 'eip155:56:%' THEN 56 WHEN k.agentKey LIKE 'eip155:97:%' THEN 97 ELSE 0 END AND h.agentId=substr(k.agentKey,11) AND h.provenance='chain_verified' AND j.status=2),
  1
FROM (SELECT DISTINCT 'eip155:'||h.chainId||':'||h.agentId AS agentKey FROM hire_events h WHERE h.chainId=OLD.chainId AND h.jobId=CAST(OLD.jobId AS TEXT) AND h.provenance='chain_verified') k WHERE 1
ON CONFLICT(agentKey) DO UPDATE SET
  buyerQuoteRequestCount=excluded.buyerQuoteRequestCount,
  buyerQuoteSuccessCount=excluded.buyerQuoteSuccessCount,
  buyerQuoteLastAttemptAt=excluded.buyerQuoteLastAttemptAt,
  jobCount=excluded.jobCount,
  jobCompleted=excluded.jobCompleted,
  jobFunded=excluded.jobFunded,
  jobSubmitted=excluded.jobSubmitted,
  projectionVersion=excluded.projectionVersion
WHERE catalog_public_agent_metrics.buyerQuoteRequestCount IS NOT excluded.buyerQuoteRequestCount OR catalog_public_agent_metrics.buyerQuoteSuccessCount IS NOT excluded.buyerQuoteSuccessCount OR catalog_public_agent_metrics.buyerQuoteLastAttemptAt IS NOT excluded.buyerQuoteLastAttemptAt OR catalog_public_agent_metrics.jobCount IS NOT excluded.jobCount OR catalog_public_agent_metrics.jobCompleted IS NOT excluded.jobCompleted OR catalog_public_agent_metrics.jobFunded IS NOT excluded.jobFunded OR catalog_public_agent_metrics.jobSubmitted IS NOT excluded.jobSubmitted OR catalog_public_agent_metrics.projectionVersion IS NOT excluded.projectionVersion;
END;
