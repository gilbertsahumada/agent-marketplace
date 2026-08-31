-- On-demand validation results are committed under the declaring agent.  The
-- pre-normalization key was endpoint+kind only, which could incorrectly reuse
-- one identity's request when two agents declared the same endpoint.
UPDATE catalog_validation_requests
SET dedupeKey = agentKey || ':' || endpointKey || ':' || validationKind
WHERE validationKind IN ('protocol', 'reachability')
  AND dedupeKey = endpointKey || ':' || validationKind;
