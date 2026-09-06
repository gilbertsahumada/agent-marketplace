# SDK negotiation pilot — 2026-09-06

## Outcome

The final detector resolved SDK-style forms for 15 external Mainnet identities in
the 39-agent priority cohort (46 unique endpoints). The previous saved audit of
that cohort resolved no additional forms. These are time-separated network checks,
not proof that all differences are solely caused by code. Discovery is not hiring
approval, and these results were not written into production D1.

| Cohort | Endpoints checked | Supported forms | Quotes requested | Signatures verified against registry wallet |
| --- | ---: | ---: | ---: | ---: |
| Mainnet priority cohort, final detector | 46 | 15 | 2 | 2 |
| Testnet HTTP sample | 30 | 0 | 0 | 0 |
| Testnet A2A sample | 30 | 0 | 0 | 0 |

Testnet samples are not the entire 2,182-identity inventory. They selected the first
30 endpoints in each transport cohort, not a random representative sample.
No claim of zero compatible Testnet sellers follows from this result.

Resolved Mainnet identities: 213432, 213378, 213332, 213053, 213084, 213036,
212943, 212989, 212840, 208760, 212769, 198999, 265375, 269233, 270213.

An initial pass counted 16. Manual inspection found that ChainHelix #269223
publishes another task-input-schema extension with structured portfolio inputs.
The final detector deliberately excludes this case from the generic fallback;
it needs a specialized adapter, not an invented free-text replacement.

## Real quotes, no payments

| Agent | Request time UTC | Result | Price | Current marketplace cap | Outcome |
| --- | --- | --- | --- | --- | --- |
| Explainer #270213 | 2026-09-06 10:31:05 | Accepted; EIP-191 signature valid | 0.1 U | 0.01 U | Above cap; not enabled for funding |
| BNB Grid #269233 | 2026-09-06 10:31:08 | Accepted; EIP-191 signature valid | 0.1 U | 0.01 U | Above cap; not enabled for funding |

Registry wallet and signature checks used BSC block 120287243:
- #270213: 0x08Cef8B3ec5D33529dFe6700ccbFfc97158Cb5dd
- #269233: 0xFAf0ffd121947B9EE3920Fa0CfbF9EEEB0AcBF7f

Both replies bind chain 56 and Commerce 0xEa4DAa3100A767e86FDed867729ae7446476EBA6,
use token 0xcE24439F2D9C6a2289F741120FE202248B666666, and match their request hashes.
Neither includes optional provider_address. The verifier now authenticates the
original envelope against the chain-resolved provider instead of requiring that
convenience metadata. Explicit mismatching provider metadata still rejects.

Signature verification is not a full funding/preflight approval. No jobs were
created, funded, notified, submitted or settled by the pilot. Quotes are now
historical and must never be replayed as buyer authorization. No cap or contract
pin was changed. Full policy/settlement admission remains independently required.

## Reproduction and evidence

Discovery uses src/trust8004/discovery-audit-cli.ts, safe DNS-pinned HTTPS,
bounded responses/timeouts, at most three active origins and one request per origin.
Input cohort comes from the earlier saved public catalogue audits, excluding our
Grid #303779. Raw snapshots and pilot envelopes remain local, not committed.

SDK reference: bnb-chain/bnbagent-sdk commit
bab27109237d509c780a36cf831dcfce70aabafe, python/bnbagent/erc8183/negotiation.py
and python/examples/a2a-agent/src/server.py. No SDK/Studio code was executed.

## Remaining decisions

- Approve a deliberate marketplace price-limit policy; do not silently raise the
  existing 0.01 U limit just to increase the compatible count.
- Apply migrations 0025 and 0026 in order before deploying the respective Workers.
- Revalidate live providers through the marketplace ledger after deployment.
- Add tested adapters for explicit specialized input extensions such as ChainHelix.
- Complete network-specific Testnet quote verification/pins before enabling payments.
