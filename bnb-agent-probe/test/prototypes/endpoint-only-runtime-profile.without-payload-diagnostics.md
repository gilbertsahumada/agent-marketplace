# Endpoint-only runtime: diagnostic serialization disabled

Date: 2026-09-26. Local-only prototype; no production traffic, remote D1, seller requests, or deployment.

## Change measured

The combined response receives `capturePayloadDiagnostics=false`. This avoids serializing and encoding the entire classified dataset solely to estimate its size. `materializedBytes` and `memoryEstimateBytes` are explicitly `null` (unknown), not zero. Public payload semantics are unchanged.

The exclusive Miniflare Worker uses 183,506 raw agents, 40,767 current declarations and 35,230 visible Mainnet agents. Twelve synthetic capabilities and protocol observations populate the hiring cohort. This reproduces observed cardinalities, not production metadata or history. There are no physical rows for missing-endpoint agents. Registry enumeration is outside this experiment; the existing paged directory reader remains the intended registry path.

## Bounded results

Each run first verifies three serial responses, then starts four overlapping requests with a profile-only barrier. All four report four active requests. Full cards, facets and summary payloads match the serial counterpart. Hiring has 12 results/cards; evaluation has 35,218 results and 24 cards. Each concurrent scenario delivers only four inspector heap samples, despite a shorter requested interval.

| Scenario | Maximum sampled used heap (bytes) | Allocated heap after requests (bytes) | Four response times (ms) |
| --- | ---: | ---: | --- |
| Historical, payload diagnostics enabled | 44,168,492 | 119,242,752 | 971.92 / 972.19 / 972.41 / 279.60 |
| Diagnostics disabled, run 1 | 27,234,980 | 88,539,136 | 901.35 / 901.58 / 901.78 / 275.79 |
| Diagnostics disabled, run 2 | 44,175,016 | 80,838,656 | 904.82 / 905.05 / 905.24 / 270.89 |

Observed allocated heap with diagnostics disabled was 77.1–84.4 MiB. Sampled used heap was 26.0–42.1 MiB. Allocated headroom improved in these bounded runs, but used-heap variation demonstrates garbage-collection sensitivity; no causal percentage reduction or maximum-memory guarantee is inferred. An earlier diagnostic-enabled exploratory run also allocated less heap than the historical table row, reinforcing that limitation.

`Runtime.getHeapUsage` samples are not the Worker memory limit accounting and do not establish a true peak. Inspector work can be delayed by Worker execution, external/native memory is incompletely represented, no forced GC is used, and longer bursts or larger real metadata are unmeasured. These successful local responses do not establish that every production request can safely execute below 128 MiB. V8 CPU sample counts are diagnostic samples, not billed Worker CPU time. Request durations include local scheduling and the profiling barrier and are not production latency predictions.

## Reproduction and artifacts

Run from `bnb-agent-probe`: `node test/prototypes/endpoint-only-runtime-profile.mjs`.

- `endpoint-only-runtime-profile.without-payload-diagnostics.json`: first run.
- `endpoint-only-runtime-profile.without-payload-diagnostics-repeat.json`: independent repeat.
- `endpoint-only-runtime-profile.json`: preserved historical diagnostic-enabled run.

Both independent instances exited successfully and disposed their Worker, inspector and D1 resources. Outbound networking is blocked by the harness. Fixture construction occurs outside measured Worker request execution. No budgets, caching, concurrency controls or production behavior were changed by this experiment.
