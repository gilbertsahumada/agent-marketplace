# Endpoint-only public day with network-first primary key

2026-09-26. Independent local rerun after adopting typed `(agent_chainId, agent_agentKey, endpointKey)` primary key. Previous receipts remain unchanged. This is not deployment approval.

## Frozen method

The identical workload, fixtures, baseline A, source mutations, classifier semantics and acceptance thresholds from `endpoint-only-day-cost.md` were retained. Workload SHA-256: `2120b6bef1ad1957dd6061e454fcab938e08210f8432c9122d71215f4551a17e`. All 96 cycles ran in all four scenarios; no extrapolation. Baseline A excludes projection triggers/index; B includes actual trigger costs, including the new point lookups used to delete tuples by network. Historical construction, setup and parity-audit queries remain outside recurrent totals and require separate admission.

Command: `npm run test:worker -- test/integration/endpoint-only-day-cost.test.ts --disableConsoleIntercept`.

**4/4 GREEN in 314.91 seconds.** Source progress and all returned results/facets/summaries match; public reads write zero rows. Separate maintenance suite **8/8 GREEN** includes agent `chainId` moves 56→97→56, removal of old physical keys, both endpoint rows, unchanged unrelated Testnet rows and deletion after the move. Typecheck and whitespace checks passed.

## Actual recurrent counters

Units = reads + 1,000 × writes, not invoice dollars.

| Agents / scenario | A reads | B reads | A writes | B writes | A units | B units | Weighted reduction |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2k representative | 17,895,551 | 1,073,044 | 2,950 | 3,785 | 20,845,551 | 4,858,044 | 76.6951% |
| 20k representative | 173,838,270 | 9,122,127 | 2,784 | 3,534 | 176,622,270 | 12,656,127 | 92.8344% |
| 2k write-heavy | 357,592 | 226,234 | 46,122 | 58,923 | 46,479,592 | 59,149,234 | **−27.2585%** |
| 20k write-heavy | 2,910,814 | 312,161 | 46,464 | 59,434 | 49,374,814 | 59,746,161 | **−21.0053%** |

Representative cases exceed the unchanged 50% weighted-saving gate. Extra mutation point reads cause no additional writes relative to the previous endpoint-only receipt. The write-heavy scenario still costs more; nothing was omitted to manufacture savings. Each representative case performs 96 mutation groups and 96 cold traversals; each adverse case performs 1,536 groups and one cold traversal. The frozen public requests are Mainnet requests with both networks present in the fixture: these totals do not claim to measure the separate Testnet-only range-scan improvement.

Observed break-even cold traversals/day are 5 and 1 for representative 2k/20k and 49 and 5 for adverse 2k/20k. This assumes the same mutation volume and cold-read mix; zero-D1 cache hits cannot amortize new projection writes.

Measured hashes, per-operation counters and timings are in `endpoint-only-day-cost.network-pk.json`. This evidence does not close C/background processing, historical-cost admission, production runtime/headroom validation or the 48-hour production comparison. No remote request, seller request, deployment, migration or reactivation occurred.
