# Combined dense public-read prototype — local evidence

This prototype passes the fixed public-read gates without cache warming, policy
booleans, historical-reference changes, or public writes. It is **not production
approval for delivery B**. No remote request, migration, deployment or activation
was performed.

## Same source outputs, fewer reads

| Agents | Operation | Source reads | Prototype reads | Prototype writes |
|---|---|---:|---:|---:|
| 2,000 | Hiring cold | 128,190 | 13,754 | 0 |
| 2,000 | Evaluation cold | 169,012 | 13,613 | 0 |
| 2,000 | Filtered evaluation cold | 195,045 | 13,663 | 0 |
| 20,000 | Hiring cold | 1,221,818 | 117,185 | 0 |
| 20,000 | Evaluation cold | 1,631,632 | 116,958 | 0 |
| 20,000 | Filtered evaluation cold | 1,869,721 | 117,057 | 0 |

At 20k these are 90.41%, 92.83% and 93.74% fewer reads respectively. The fixed
limits remain 122,181 / 163,163 / 186,972, and the test additionally requires the
original measured baseline to remain exactly unchanged. One combined public
operation executes 11 SQL calls including coverage and page enrichment; it does
not mean one SQL statement.

Standalone global facets use 11,527 reads at 2k and 114,891 at 20k, both zero
writes. Complete and partial SQLite statistics use 116,183 hiring reads at 20k;
absent statistics use 117,185. At 2k the corresponding counts are 12,752 and
13,754. Outputs remain equal to the original source responses captured before
changing statistics. Source measurements after ANALYZE are not used to inflate
the claimed saving.

## Mechanism and costs retained

The local dense table copies raw current agent/declaration/capability fields and
compact historical evidence. Shared endpoint policy remains an authoritative live
join. One SQL classification result is reused in JavaScript for cards, facets
with own-group exclusion, and both availability totals. Only selected page rows
are enriched. Categories are parsed once in that JavaScript pass; removing the
otherwise duplicated per-agent SQL `json_each` aggregate changed the initial
hiring result from 136,698 (RED) to 117,185 (GREEN).

Initial prototype construction costs 14,015 reads / 4,042 writes at 2k and
138,215 reads / 40,042 writes at 20k. This is an isolated table construction, not
a production migration/backfill estimate and not steady-state trigger cost.

At 20k, classification materializes 19,513 rows / 3,320,146 serialized bytes.
Measured local classification elapsed time is 188–215 ms for the three cold
requests; the JavaScript portion is 14–24 ms. Summed D1 duration is 155–160 ms.
These are elapsed timings, **not production CPU billing**. Peak heap and CPU
usage are unknown. The reported 13,280,584-byte memory estimate is only a 4× JSON
heuristic. Linear transfer/processing of the network catalogue remains and needs
explicit capacity validation before production.

## Validation

- Four matrix tests pass, plus the subsequently added adversarial test passes in
  isolation; TypeScript passes.
- 81 filter/time combinations include both networks, expiry at the boundary,
  quote/commerce/failure filters, duplicate categories, null registration dates,
  out-of-range pagination, literal wildcard search, and cursor continuation.
- A shared endpoint block changes the next result without refreshing dense rows.
- Additional parity covers enabled Testnet, response v1/v2, object/scalar category
  JSON, and quotes/backslashes in search.
- Three SQLite statistics variants pass fixed cost gates with zero public writes.

Run the command in the adjacent JSON artifact for exact records, plans and
timings. JSON records are extracted from the successful local benchmark log;
the extra adversarial test was run with `-t 'enabled Testnet'`.

## Still required before accepting delivery B

Atomic maintenance of dense raw fields, concurrent/backfill coverage checks,
agent-local write amplification, the frozen 24-hour weighted workload, integration
of the combined frontend operation with loading/retry semantics, real CPU/peak
memory bounds, independent review, and migration admission remain unvalidated.
Neither these measurements nor the empty cron imply production savings yet.
