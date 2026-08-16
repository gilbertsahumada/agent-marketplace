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

## New work in this repository

- Independent BSC marketplace product and brand.
- Four-category marketplace taxonomy with evidence.
- Proof-of-hireability model.
- Category-specific profiles and comparison.
- Marketplace data adapter layer.
- Web-based ERC-8183 buyer journey.
- Quotes, funding guidance, job tracking, results, and receipts.
- Operational curation separating `Hireable now` from `Listed only`.

## Not copied from trust8004

- Existing landing and multichain navigation.
- Owner registration and dashboard flows.
- Social engagement features.
- Generic taxonomy.
- Agent activation metadata toggle.
- Direct Turso schema access.
- Existing Git history presented as hackathon work.

## Submission disclosure

> This marketplace is a new standalone product built during Build the Era. It extends the public ERC-8004 indexing and reputation infrastructure developed for trust8004.xyz, while introducing a BSC-specific marketplace data model, four-category discovery, proof of hireability and an ERC-8183 buyer journey.
