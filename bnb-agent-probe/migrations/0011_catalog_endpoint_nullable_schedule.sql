ALTER TABLE catalog_endpoints RENAME TO catalog_endpoints_legacy_0011;

CREATE TABLE catalog_endpoints (
  endpointKey              TEXT PRIMARY KEY,
  protocol                 TEXT NOT NULL CHECK (protocol IN ('a2a', 'mcp', 'web', 'erc8183_http')),
  endpoint                 TEXT,
  originKey                TEXT,
  safety                   TEXT NOT NULL CHECK (safety IN ('safe', 'unsafe')),
  safetyReason             TEXT CHECK (safetyReason IS NULL OR safetyReason IN (
    'invalid_url', 'https_required', 'credentials_not_allowed',
    'query_not_allowed', 'fragment_not_allowed', 'non_public_host'
  )),
  representativeAgentKey   TEXT,
  lastProbedAt             INTEGER,
  nextProbeAt              INTEGER,
  consecutiveFailures      INTEGER NOT NULL DEFAULT 0 CHECK (consecutiveFailures >= 0),
  declaredProtocol         TEXT NOT NULL DEFAULT 'unknown' CHECK (
    declaredProtocol IN ('a2a', 'mcp', 'erc8183_http', 'x402', 'web', 'unknown')
  ),
  role                     TEXT NOT NULL DEFAULT 'external' CHECK (role IN ('operational', 'external')),
  validationProtocol       TEXT CHECK (validationProtocol IS NULL OR validationProtocol IN ('a2a', 'mcp', 'erc8183_http')),
  externalKind             TEXT CHECK (externalKind IS NULL OR externalKind IN ('website', 'social', 'repository', 'documentation', 'other')),
  eligibility              TEXT NOT NULL DEFAULT 'unsupported' CHECK (eligibility IN ('eligible', 'unsafe', 'invalid_declaration', 'unsupported')),
  lastAttemptAt            INTEGER,
  lastAttemptOutcome       TEXT,
  lastSuccessfulAt         INTEGER,
  CHECK (role != 'external' OR (validationProtocol IS NULL AND nextProbeAt IS NULL)),
  CHECK (eligibility != 'eligible' OR (role = 'operational' AND validationProtocol IS NOT NULL AND nextProbeAt IS NOT NULL))
);

INSERT INTO catalog_endpoints (
  endpointKey, protocol, endpoint, originKey, safety, safetyReason,
  representativeAgentKey, lastProbedAt, nextProbeAt, consecutiveFailures,
  declaredProtocol, role, validationProtocol, externalKind, eligibility,
  lastAttemptAt, lastAttemptOutcome, lastSuccessfulAt
)
SELECT
  endpointKey, protocol, endpoint, originKey, safety, safetyReason,
  representativeAgentKey, lastProbedAt,
  CASE WHEN role = 'operational' AND eligibility = 'eligible' THEN nextProbeAt ELSE NULL END,
  consecutiveFailures, declaredProtocol, role, validationProtocol, externalKind,
  eligibility, lastAttemptAt, lastAttemptOutcome, lastSuccessfulAt
FROM catalog_endpoints_legacy_0011;

DROP TABLE catalog_endpoints_legacy_0011;

CREATE INDEX idx_catalog_endpoints_queue
  ON catalog_endpoints (safety, representativeAgentKey, nextProbeAt, lastProbedAt, endpointKey);
CREATE INDEX idx_catalog_endpoints_origin
  ON catalog_endpoints (originKey, protocol);
CREATE INDEX idx_catalog_endpoints_validation_queue
  ON catalog_endpoints (role, eligibility, validationProtocol, nextProbeAt, lastAttemptAt, endpointKey);
