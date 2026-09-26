# Exclusive local Worker runtime profile

Run `node test/prototypes/dense-public-runtime-profile.mjs` from the Worker project.
The script owns one Miniflare instance, one local D1 database, and its returned
inspector socket. It disposes that instance/socket on exit. It does not inspect
other workers or processes. Outbound Worker requests are blocked; `cf:false`
also prevents Miniflare's optional metadata refresh on subsequent runs.

The same frozen 20k fixture and verified sparse projections are prepared through
the local D1 binding from Node. Fixture construction is not part of measured
application execution. Three complete combined responses (hiring, evaluation,
hiring) then run inside the application Worker, without response caching.

## Recorded observation

- Request elapsed time: 275.94 / 232.03 / 211.50 ms.
- Worker JS classification elapsed time: 22 / 28 / 22 ms.
- V8 used heap before requests: 1,729,712 bytes.
- V8 used heap after three requests: 20,691,132 bytes (~19.73 MiB).
- Maximum **sampled** used heap: 20,691,132 bytes; total heap after: 39,944,192 bytes.
- Five heap samples were delivered. CPU-bound work delays inspector commands;
  therefore this is not proof of the true peak or a concurrency memory bound.
- V8 CPU profiler window: 729,187 microseconds; samples: 112 application/other,
  13 GC, 8 program, 1 idle. Requested sampling interval: 1,000 microseconds.

These are local workerd inspector observations, not Node CPU measurements and not
Cloudflare billed CPU. Sample counts must not simply be multiplied by the requested
interval to assert actual CPU milliseconds. The D1 engine is a separate local
service; these observations concern the public application Worker. Inspector
polling introduces overhead, and no forced garbage collection was performed.

The observed used heap exceeds the previous 4× serialized-payload heuristic of
13,280,584 bytes: retain that heuristic only as the historical prototype estimate,
not as a capacity guarantee. Multiple concurrent requests and substantially larger
catalogues remain unmeasured. This successful bounded run establishes feasibility,
not production safety approval or delivery B completion.

Raw sanitized output is in `dense-public-runtime-profile.json`. The process exited
successfully and its exclusive instance was disposed. No application production
database, seller, deployment, migration or background activation was involved.

## Four overlapping requests at 20k

The subsequent script version profiles three sequential reference responses and
then four requests with a bounded five-second, local-only start barrier. Plain
`Promise.all` did not demonstrate four overlapping requests in the local runtime;
that failed attempt is not reported as a concurrency pass. The barrier run
observed four active requests inside the same Worker, with all four payloads
exactly equal to their corresponding sequential reference.

- Concurrent request elapsed times: 932.97 / 931.94 / 932.52 / 245.15 ms.
- Maximum sampled used heap: 24,828,704 bytes (~23.68 MiB), from four samples.
- Used heap after the group: 8,808,748 bytes; allocated heap: 69,206,016 bytes
  (~66 MiB). Garbage collection explains why final used heap is smaller.
- No forced GC, production network calls, response cache, or application limit
  changes. The exclusive instance/socket were disposed successfully.

This bounded run did not demonstrate a 128 MiB violation, but four delayed
inspector samples cannot establish a guaranteed peak. It is **not a production
capacity pass**: the integrator subsequently identified roughly 189k projected
rows under the physical-sentinel design, materially above this fixture. The 40k
run was not executed; production sizing remains blocked pending a representation
that does not materialize missing-endpoint registry rows for operational reads.

Exact output: `dense-public-runtime-profile.concurrency20k.json`.
