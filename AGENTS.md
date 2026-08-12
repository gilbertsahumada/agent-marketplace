# Agent Development Guidelines

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## Objective

Build the BSC marketplace journey required by the Build the Era main track:

```text
Discover → Understand → Compare → Hire → Track → Result
```

## Scope guardrails

- Keep all four required categories first-class.
- Treat ERC-8183 hiring as the critical path.
- Reuse trust8004 through APIs, never direct database access.
- Resolve financial facts and job state from chain.
- Do not build a full frontend before the buyer spike passes.
- Do not build four proprietary agents.
- Build a fallback seller only when a missing category blocks judging.
- Partner tracks, multichain support, social features, and a new reputation protocol are out of scope.

## Provenance

Always distinguish:

- pre-existing trust8004 infrastructure;
- upstream BNB Agent SDK functionality;
- third-party 8004scan data;
- code and product work created in this repository.

Never describe a candidate agent as an official reference agent without a published BNB source.

## Quality rules

- Separate onchain facts, self-declared metadata, observed capabilities, derived scores, and job performance.
- Never equate MCP/A2A availability with ERC-8183 hireability.
- Keep wallet interactions non-custodial.
- Show token, allowance, budget, deadline, and transaction intent before signatures.
- Every primary CTA must have a functional destination.
- Preserve source timestamps and transaction hashes.

## Change discipline

- Update `docs/DECISIONS.md` for material scope or architecture changes.
- A new MVP feature must state which existing item is removed or which gate is delayed.
- Run the relevant tests and production build before merging application changes.
