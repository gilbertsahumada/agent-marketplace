# Documentation maintenance and historical rollout notes

These are maintainer notes, not current production status or public integration prerequisites.

## Historical prerequisites moved out of the seller guide

- The original hiring-first rollout required 0024_negotiation_compatibility.sql.
- Network-isolated catalogue reads required migration 0025 and an updated Worker before the frontend.
- SDK-profile discovery required migration 0026 and its corresponding Worker code. Older structural failures were reconsidered through bounded bootstrap batches, without fabricating successful quotes or extending their lifetime.
- The September 6, 2026 guide said Testnet discovery and dynamic quoting were not configured. That statement is historical, not a reliable assertion about today's deployment.
- Safe capabilityProbeParameters support optional automatic quote checks in the implementation. Absence of a sample does not block valid buyer inputs. Documentation must not imply that publishing a sample activates paused infrastructure.
- Shared structural endpoint failures, when enabled by the operator, retain their original observation time. This does not share buyer quotes, buyer inputs or identity verification.

Before a release, inspect active configuration, migration ledger, coverage and network gates. Local tests do not prove deployment. Preserve pauses and concurrent work. No documentation change authorizes deployment or process reactivation.

## One content source

The typed app/docs/content.ts registry renders HTML, Markdown, navigation, search and /llms.txt. Do not add parallel prose to page components or markdown.ts. Keep sample JSON parseable, clearly label partial responses and never include a fake signed quote.

Runtime MCP metadata lives in src/marketplace-mcp-metadata.ts. Its names and input schemas are consumed unchanged by the handlers and reference. Description edits do not add functionality. In particular request_quote remains a fixed demo tool.

Preserve existing section IDs with aliases when reorganizing pages. Validate internal links and Markdown coverage for every guide. Historical fork receipts, addresses and expired example quotes must not be presented as current availability evidence.

The former HIRE-SPEC.md link pointed to an absent file in this checkout. Public documentation now links to the maintained buyer guide rather than designating a missing document as normative.
