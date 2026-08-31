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

## Scope Guard

Complete the current task with the minimum sufficient change.

### Before editing

- Read the relevant code, tests, and configuration directly. Do not work from search snippets or guesses.
- If the requirement is ambiguous or the premise is unverified, resolve that before building on it.
- State a minimal plan:
  - **Outcome** — the exact behavior requested
  - **Non-goals** — what this task will not do
  - **Files** — the smallest set expected to change
  - **Proof** — the check that will prove the change works
- Start with one implementation path. Split work only when the task has genuinely independent parts.

### While editing

- Reuse existing code, helpers, patterns, and test setup before adding anything new.
- Fix bugs at the root cause. Do not stack patches around a wrong premise.
- Add an abstraction, adapter, or config layer only for a second real caller
  in this task or a stated requirement.
- Preserve behavior outside the requested change.
- Do not design for rare or future cases nobody asked about.
- Remove code you replace. Keep an old path only when compatibility is an explicit requirement.

### Pause and confirm

Read-only discovery is always allowed. If the task has not already authorized it, get approval before:

- Materially expanding the scope or touching unrelated files
- Adding a dependency, framework, service, or new test infrastructure
- Changing a public API, schema, storage format, or wire format
- Deleting or overwriting user data, discarding uncommitted work, rewriting history, or dropping data
- Keeping two implementations of the same behavior alive

### Testing

- Run the narrowest existing tests that exercise the changed behavior.
- Extend the most relevant existing test before creating a new test file.
- Add a test only when changed user-observable behavior is not covered, or when the user asks for one.
- Each new test must protect a clear acceptance criterion or regression risk.
- Do not backfill unrelated coverage or introduce test infrastructure for this task alone.
- Do not use passing tests as justification for extra abstractions or scope.

### If the plan grows

Stop when the work starts adding future-use layers, workaround stacks,
unrelated cleanup, or tests for unstated behavior. Rewrite a smaller plan
and confirm the new scope.

### Done means

- The requested behavior works and the acceptance criteria are met
- Relevant checks pass, with the exact commands and results reported
- Every touched file is necessary and the diff contains nothing unrelated
- No debug code, backup copies, dead paths, or scratch files remain
- Assumptions, limitations, and unverified runtime behavior are stated plainly

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
- Agent-to-agent hiring is in scope as a hackathon differentiator: an agent may be the ERC-8183 buyer, and the signed-quote gate applies to agent buyers exactly as to humans.
- The machine-readable marketplace surface is one HTTP API in this repository; CLI and MCP are thin wrappers over it, never parallel implementations.
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
