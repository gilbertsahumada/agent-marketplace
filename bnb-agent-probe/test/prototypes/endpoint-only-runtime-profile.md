# Endpoint-only operational runtime profile — local, not production approval

Run `node test/prototypes/endpoint-only-runtime-profile.mjs` from the Worker
project. It owns and disposes an exclusive Miniflare instance, D1 database and
inspector socket. `cf:false` and an outbound-denying service prevent optional
metadata refresh and seller traffic. Existing runtime limits are not changed.

## Fixture and validity

The synthetic fixture matches sanitized sizing counts: 183,506 raw agents,
40,767 current declarations, and 35,230 Mainnet operational agents. Only declared
endpoint rows are physically projected. This is **not a production payload
replica**: names/categories are synthetic, historical payloads are absent, and
12 synthetic compatible capabilities plus 12 protocol observations are added so
both hiring and evaluation return actual cards. No artificial or real quote is
requested.

Empty-source projection coverage is verified first. Subsequent fixture writes
use the real sparse-projection triggers; no completion marker is fabricated.
The endpoint-only classifier is injected into the same combined-response helper.
Registry is not materialized into application memory; its separate paged design
is outside this operational profile.

Every response asserts:

- Availability: 12 hiring / 35,218 evaluation.
- Hiring returns 12 cards; evaluation returns its full 24-card page.
- Exactly 35,230 classification rows, not all 183,506 registry rows.
- All public sections of concurrent responses equal their serial reference.

A bounded five-second start barrier ensures four requests are active inside the
same Worker before processing. The runtime counter confirmed four for every
concurrent response. The exclusive instance and socket were disposed on success.

## Final measured run

| Metric | Sequential reference | Four concurrent requests |
|---|---:|---:|
| Request elapsed ms | 236.22 / 283.29 / 204.15 | 971.92 / 972.19 / 972.41 / 279.60 |
| Maximum sampled used heap, bytes | 23,290,800 | 44,168,492 |
| Allocated heap after group, bytes | 63,635,456 | 119,242,752 |
| Heap samples | 4 | 4 |

Each classification transfers 4,909,989 serialized bytes. V8 inspector sampling
is application-Worker evidence, not Node CPU or production billed CPU. D1 runs
as a separate local service, inspector polling adds overhead, and the host is
not an exclusive performance laboratory.

## Capacity remains unresolved

The final allocated heap is approximately **113.72 MiB**, close to 128 MiB.
An earlier valid exploratory run allocated 87,736,320 bytes after the same
concurrent workload, illustrating garbage-collection variability. Four delayed
heap samples cannot prove the true peak, and neither `usedSize` nor `totalSize`
alone proves the complete platform memory accounting. Therefore this run proves
correct bounded concurrent responses but **does not certify safe production
operation below 128 MiB**.

The result remains blocked for production capacity approval: real metadata sizes,
larger operational sets, longer bursts and adequate headroom must be addressed.
Do not extrapolate the earlier 4× JSON heuristic into a memory guarantee or
increase runtime limits to disguise this risk. No remote migration, deployment,
background activation or registry-wide runtime profile was performed.

Exact sanitized records: `endpoint-only-runtime-profile.json`.
