# Decision Log

| Date | Decision | Status | Rationale | Trade-off |
|---|---|---|---|---|
| 2026-08-12 | Create a standalone public repository | Approved | Independent, attributable, and adoptable product | Requires a stable API boundary |
| 2026-08-12 | Reuse trust8004 through APIs | Approved | Preserves existing infrastructure advantage | Initial external dependency |
| 2026-08-12 | Limit MVP to BSC | Approved | Direct main-track alignment | Multichain deferred |
| 2026-08-12 | Use ERC-8183 for buyer activation | Approved | Official hiring lifecycle | Wallet and `$U` complexity |
| 2026-08-12 | Build four proprietary agents | Rejected | Marketplace is the evaluated product | Existing sellers must be verified |
| 2026-08-12 | Build a minimal Grid seller | Conditional | Only if the category remains blocked | Adds seller maintenance |
| 2026-08-12 | Enter partner tracks | Out of scope | Protect main-track execution | Additional prizes deferred |
| 2026-08-12 | Build complete UI before buyer spike | Rejected | Does not reduce critical technical risk | Visual build starts later |
| 2026-08-12 | Duplicate the full indexer | Rejected for MVP | High effort without judging value | Provider dependency remains |
| 2026-08-14 | Use trust8004 as the sole catalogue source | Approved | One read-only API boundary preserves provenance and keeps the BSC inventory simple | Coverage is explicitly partial; critical facts still require direct BSC verification |
| 2026-08-16 | Keep verification evidence separate from the trust8004 snapshot | Approved | Prevents observed MCP tools and direct BSC reads from overwriting declared catalogue data | Consumers must interpret mismatches and temporal drift explicitly |
| 2026-08-17 | Gate frontend work on reproducible evidence, not third-party seller access | Approved | Gate 1 already proves the buyer lifecycle onchain; the UI can honestly represent MCP-only and unavailable states | Replaces waiting for an external seller; no existing MVP item or gate is delayed |
| 2026-08-17 | Probe only explicitly declared seller protocols | Approved | Prevents MCP/A2A discovery from being misrepresented as ERC-8183 hireability | Undeclared compatible routes are intentionally not guessed |

## Scope change rule

Any new MVP feature must identify either:

- the existing feature it replaces; or
- the gate and delivery date it delays.

Unapproved suggestions remain outside the active backlog.
