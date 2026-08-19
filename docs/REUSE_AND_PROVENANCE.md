# Reuse and Provenance

## Purpose

This document makes the boundary between existing infrastructure and hackathon work explicit.

## Existing infrastructure reused

| Capability | Source | Integration |
|---|---|---|
| ERC-8004 indexing | trust8004 | API |
| Metadata and IPFS normalization | trust8004 | API |
| ERC-8004 reputation | trust8004 | API with visible provenance |
| Endpoint observations | trust8004 | Public API when persisted; absence remains explicit |
| BSC catalogue snapshot | trust8004 | Public API, marked as partial coverage |
| ERC-8183 contracts and client | BNB Agent SDK | Upstream TypeScript dependency |
| Identity and commerce facts | BSC | Direct RPC reads |
| Browser ERC-8183 ABI signatures | BNB Agent SDK generated ABIs | Minimal `createJob`, `setBudget`, `fund`, `registerJob`, `approve`, and lifecycle events adapted for viem |

## New work in this repository

- Independent BSC marketplace product and brand.
- Four-category marketplace taxonomy with evidence.
- Proof-of-hireability model.
- Category-specific profiles and comparison.
- Marketplace data adapter layer.
- Web-based ERC-8183 buyer journey.
- Quotes, funding guidance, job tracking, results, and receipts.
- Operational curation separating `Hireable now` from `Listed only`.

## Gate 5 visual references

The visual review used trust8004 commit
`7777b2478a5277f21aecba08b15e960a071de92c` in read-only mode. The marketplace
adapted patterns from these source areas:

| Pattern adapted | trust8004 reference | Marketplace implementation |
|---|---|---|
| Dark zinc tokens and spacing rhythm | `app/globals.css`, `app/layout.tsx`, `app/fonts.ts` | `app/globals.css`, `app/layout.tsx` |
| Profile information hierarchy | `components/agent-profile/agent-hero.tsx`, `profile-tabs.tsx`, `overview-tab.tsx`, `services-tab.tsx`, `reputation-tab.tsx`, `technical-tab.tsx` | `components/marketplace/agent-profile.tsx` |
| Compact agent cards and status badges | `components/ui/agent-cell.tsx`, `components/agent-table.tsx`, `components/agent-profile/trust-score-badge.tsx` | `components/marketplace/agent-card.tsx`, `provenance-badge.tsx` |
| Skeleton, empty, and error geometry | `app/(app)/agents/loading.tsx`, `components/error-boundary.tsx`, `app/not-found.tsx` | `app/loading.tsx`, `app/error.tsx`, `app/not-found.tsx` |
| Accessible primitive composition | `components/ui/button.tsx`, `badge.tsx`, `tabs.tsx`, `tooltip.tsx`, `dialog.tsx` | Regenerated local shadcn/Radix primitives under `components/ui/` |

No source file, font binary, logo, navigation, runtime package, database code,
or absolute-path import was copied from the trust8004 checkout. Space Grotesk
and Space Mono are loaded independently through `next/font/google`. The
Evidence Rail and all marketplace hiring semantics are new work in this
repository.

## Gate 6A protocol references

Gate 6A inspected the installed npm artifact `@bnbagent/sdk@0.5.0` and the
official TypeScript A2A buyer, wallet-provider contract, ERC-8183 facade, and
generated ABIs. The SDK remains server-side for resolution, negotiation,
signature validation, notification, and read helpers. The browser-side viem
adapter and non-custodial confirmation UI are new marketplace code. Only the
minimal official ABI signatures needed by the spike were adapted; no SDK
wallet, keystore, server, or application code was copied into the browser.

Agent `1815` remains controlled test infrastructure derived from the official
A2A example. It is not a marketplace agent and is not described as an official
reference agent.

The hosted replacement remains the same kind of controlled testing
infrastructure. Its public Agent Card/A2A controllers, server-only Vercel
composition, deterministic deliverable reconstruction, and environment-key
boundary are new marketplace code. `NegotiationHandler`, `ERC8183JobOps`,
`DeliverableManifest`, and ERC-8004 registration remain upstream BNB Agent SDK
functionality. The original Agent `1815` is retained only as historical Gate 1
evidence because its local keystore is no longer operationally recoverable.

## Not copied from trust8004

- Existing landing and multichain navigation.
- Owner registration and dashboard flows.
- Social engagement features.
- Generic taxonomy.
- Agent activation metadata toggle.
- Direct Turso schema access.
- Existing Git history presented as hackathon work.
- trust8004 font binaries, logo, animated canvas, marquee, and profile glow.

## Submission disclosure

> This marketplace is a new standalone product built during Build the Era. It extends the public ERC-8004 indexing and reputation infrastructure developed for trust8004.xyz, while introducing a BSC-specific marketplace data model, four-category discovery, proof of hireability and an ERC-8183 buyer journey.
