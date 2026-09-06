# Testnet closure execution

## Safety boundaries

- No Mainnet sends, wallet signatures, flag activation or Worker redeployment during preparation.
- Never reuse Mainnet contract addresses, implementation pins or job IDs for Testnet.
- Live wallet transactions are a separate acceptance step; passing fixtures is not end-to-end proof.

## Execution checklist

- [x] Inspect existing Testnet contracts, tracker and seller integration.
- [x] Run a read-only readiness audit: chain 97, bytecode, proxy implementations, token, policy whitelist and dispute window.
- [ ] Confirm a current seller endpoint and a verifiable quote; distinguish configured agent from available agent.
- [ ] Establish reviewed Testnet implementation pins before permitting closure writes.
- [x] Parameterize closure network and journal isolation without changing Mainnet behavior.
- [x] Add Testnet-specific closure state reader and gated UI integration in the existing live Testnet tracker; delivery rendering remains the existing tracker responsibility.
- [x] Test wrong network, wrong contracts, missing pins, replacements, reverts and cross-network journal separation with fixtures. UI tests reject mismatched network/job responses and hide actions by default.
- [ ] Validate quote → funding → delivery → settlement with a user-controlled Testnet wallet.
- [ ] Validate a separate disputed job and wallet cancellation/acceleration/reload.
- [ ] Record transaction hashes, observed outcomes and remaining blockers; only then consider enabling closure controls.

## Starting evidence

The repository configures chain 97 and agent #1866. Its Testnet constants contain commerce/router/policy/token addresses but no reviewed proxy implementation pins. Existing Testnet job tracking is separate from the Mainnet delivery panel. These facts do not establish current seller availability or authorize enabling writes.

## Audit results — 2026-09-06

Read-only RPC block 129514722 confirmed all four contract bytecodes, configured payment token, allowlisted policy, matching agent #1866 seller wallet and a 900-second dispute window. Observed commerce implementation: `0x153783ddbdf5233c591965f04644b1df2d1a7815`; router: `0x40c0254610d92f1eb9c2d7d5d2114bc4c99d935e`. These are frozen observation pins, not a security audit.

The registered agent card at `https://bnb-agent-marketplace-ruby.vercel.app/.well-known/agent-card.json` returned HTTP 200 and declares deterministic quote/funding-notification services. It explicitly identifies itself as test infrastructure, not a marketplace agent. No quote or wallet transaction was requested in this preparation phase.

`scripts/testnet-closure-readiness.ts` repeats the audit without private keys. The browser adapter now accepts explicit `network: "testnet"`, pins chain 97 and uses separate journal keys. Existing callers default to Mainnet; no UI feature flags were enabled. Testnet UI/state integration is complete; live-wallet acceptance remains pending.

## UI integration

The live Testnet tracker now offers an on-demand read-only closure check backed by `/api/marketplace/jobs/testnet/:jobId/closure`. Reads bind implementation checks and job/policy facts to one block; failures return sanitized 503 responses with no-store. Wallet controls require the independent `NEXT_PUBLIC_TESTNET_JOB_CLOSURE_ENABLED=true` flag (not enabled here), chain 97, and a fresh matching report. Mainnet controls remain unchanged.

Live read check of historical job #514 was blocked: `jobPolicy(514)` returned the zero address on the configured Testnet router. Do not use this legacy job as closure acceptance evidence. Live testing requires a newly registered/funded compatible job and an explicit wallet signature. No real transactions were sent.
