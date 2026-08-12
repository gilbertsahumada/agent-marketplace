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

## Scope change rule

Any new MVP feature must identify either:

- the existing feature it replaces; or
- the gate and delivery date it delays.

Unapproved suggestions remain outside the active backlog.
