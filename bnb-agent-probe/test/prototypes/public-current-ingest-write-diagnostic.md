# Restoring the unchanged ingest write budget

The existing four-declaration changed-generation test failed at **102 writes**, over its unchanged **94-write** ceiling. The failure is in the new current-tuple trigger maintenance, not additional useful ingest work.

| Local fixture | Reads | Writes | Reads + 1,000 × writes |
|---|---:|---:|---:|
| Source ingest, 0036 retained, 0037 disabled | 49 | 82 | 82,049 |
| Previous 0037 delete + insert | 107 | 102 | 102,107 |
| Guarded upsert + deletion of orphan tuples | 139 | 94 | 94,139 |

Identity changes rewrote four existing projected tuples twice: source statement 11→7 writes after using updates. Adding four capabilities to already declared tuples similarly changes 28→24 writes. New declarations remain 28 writes. Shared endpoint writes, admission and ingest checkpoints are unchanged. This saves eight writes at the cost of 32 extra point reads, a measured 7,968 weighted-unit reduction; no budget was increased.

The source-only control leaves 0036 installed. This workload does not modify observation/quote/job history, so its sparse projection triggers do not add the 20 writes being diagnosed.

Production generator and additive, unpublished migration0037 now delete only tuples absent from current declarations at their exact old network/key, then upsert absolute source fields. A null-safe conflict predicate skips identical payloads. Network/key changes still delete orphaned OLD tuples; capability/evidence removal clears copied fields without deleting a valid declaration. Shared endpoint policy remains joined live.

EXPLAIN uses the current table network-first primary key, source declaration composite index and agent primary key; no catalogue scan. Regression checks cover network move, capability deletion, declaration removal/reinstatement, agent deletion, source/projection rollback and generator/migration parity. 44 ingest/migration/backfill/diagnostic checks plus seven production SQL checks passed locally. The frozen pre-upsert trigger reference is test-only.

Exact per-source counters and query plan are in the adjacent JSON. Existing daily receipts are historical measurements, not silently updated predictions: whole-day economics must be rerun for the new trigger behavior. No remote queries, deployment or reactivation occurred.
