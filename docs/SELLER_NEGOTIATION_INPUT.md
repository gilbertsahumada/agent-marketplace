# Seller negotiation inputs

Public developer guide: `/docs/sellers` (linked from `/docs`, accessible through
Docs in the site footer). It includes A2A, HTTP and MCP publication examples and form guidance.

## Listing is not hiring

- Catalogue listing requires an indexed ERC-8004 identity with valid metadata.
  Operational service declarations qualify an identity for the candidate view;
  a negotiation schema is not required merely to retain its catalogue identity.
- Availability requires a recent successful operational protocol check. Social
  links and websites are not negotiation transports.
- A quote form requires a supported published input schema. Funding additionally
  requires a fresh, verified buyer quote and the marketplace's security checks.

Use short `title` labels, essential `description` help, `required` only for
mandatory properties, `enum` for choices, and explicit numeric/string bounds.
The form uses declared constants but never invents defaults. Publish schemas
that match the actual parser, and return client errors for invalid input.

## Scope

An ERC-8004 identity or reachable endpoint does not imply a compatible hiring
contract. The marketplace discovers an explicit input schema before showing a
seller-specific quote form. It does not infer inputs from descriptions or fill
invented defaults. Unsupported or missing schemas disable quote submission.

This discovery contract is a marketplace convention, not an ERC-8183 or A2A
requirement. ERC-8183 remains the on-chain settlement layer.

## Publication

- A2A: declare `negotiate-erc8183-job` or `negotiate` and publish a capabilities
  extension with URI
  `https://marketplace.trust8004.xyz/extensions/negotiation-input/v1`.
  Its `params` contain `inputSchema`, `taskDescriptionPrefix`, and exact `terms`.
- HTTP: publish the same object under `negotiationInput` in `/status`.
- MCP: publish `inputSchema` on `negotiate_erc8183_job` or `request_quote`.
  The root must require `task_description` (string) and `terms` (object).
  A generic MCP tool does not qualify.

For prefixed contracts, the request task is the declared prefix followed by
deterministic JSON with sorted keys. Grid publishes its real `GRID_PLAN_V1:`
fields: pair, lowerPrice, upperPrice, capital, gridCount. Grid-specific input
errors are client errors, not internal-server errors.

## Supported schema subset

Objects, strings, numbers, integers, booleans, required properties, enum, const,
numeric bounds and string lengths are supported. Titles and descriptions provide
field labels/help. Only a narrowly bounded character-class regex grammar is
accepted. Arbitrary regexes, references, arrays, unions and unknown constraints
are rejected rather than silently interpreted. Schemas are limited to 32 nodes
and depth 3. This is intentionally not a universal JSON Schema renderer.

## Request lifecycle

1. `GET /api/marketplace/agents/:agentId/quotes/input` discovers a contract from
   at most four current indexed compatible endpoints. Discovery is read-only.
2. The response includes the selected endpoint key and normalized contract hash.
3. The browser submits schemaVersion 2, endpointKey, contractHash and parameters
   to the existing quote POST route.
4. The Worker resolves the current endpoint and rediscovers its schema. Changed
   schemas return `NEGOTIATION_SCHEMA_CHANGED`; invalid parameters cannot proceed.
5. The canonical request is registered before browser negotiation. Network-policy
   fallback reuses the request; signed responses undergo existing verification.
6. Only a verified buyer quote unlocks Review/Fund. Editing fields or reloading
   the contract clears that session quote and its request link.

Only the request hash is persisted, not the parameter text. Existing legacy
schemaVersion 1 callers remain supported for compatibility; the new UI uses v2.
Existing quote signature, provider, chain, token, contract, price and expiration
checks are not relaxed.

## Limits and errors

Discovery uses bounded responses, five-second endpoint timeouts, public HTTPS
targets and no redirects. Per-minute limits are 120 globally, 10 per caller and
25 per origin; atomic counters use the existing D1 access layer. Quote creation
also retains its own rate limits. Identical-request deduplication includes the
caller and endpoint to prevent sharing another buyer's pending request.

Seller HTTP 5xx is classified as `SELLER_SERVER_ERROR`, distinct from network
unreachability. An Agent Card response alone is not successful negotiation.

## Rollout and verification

Deploy Worker and frontend together: the new frontend needs the private Worker
input endpoint, and Grid must publish the extension before discovery succeeds.
This change introduces no new D1 migration. Automated coverage includes schema
validation, all three discovery transports, generic MCP rejection, unsafe
targets, changed contract hashes, canonical request creation, private-input
non-persistence, required UI fields, fallback request reuse and clearing an old
quote after editing.

Local automated tests do not establish availability of third-party sellers.
After deployment, repeat live discovery/quote checks and a complete authorized
Testnet hire. No Mainnet transaction is needed to verify discovery or quotes.
