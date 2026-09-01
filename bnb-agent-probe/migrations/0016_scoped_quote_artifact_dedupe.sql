-- A signed quote artifact is reusable only for the declaring agent and exact
-- endpoint that were independently verified.  Hash-only uniqueness could
-- incorrectly turn an identical artifact for another declaration into a
-- cross-agent duplicate.
DROP INDEX IF EXISTS idx_catalog_observations_quote_artifact;

CREATE UNIQUE INDEX idx_catalog_observations_quote_artifact
  ON catalog_observations (agentKey, endpointKey, artifactHash)
  WHERE validationKind = 'quote' AND artifactHash IS NOT NULL;
