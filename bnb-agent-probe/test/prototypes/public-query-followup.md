# PR179 public-query follow-up — BLOCKED / RED

Reference: main bc5e5a1017f518bdd8ac87d7f52dc65c6c091388. All measurements here are local D1; no production catalogue traffic was generated for this experiment.

Frozen readers and the economic regression test are intentionally retained. **Do not merge or deploy this draft:** the mandatory 20% reduction is not achieved. Production source has been restored to the original code; none of the unsuccessful prototypes is shipped.

## Reproduced classification measurements

| Variant | 2,000 reads | 20,000 reads | Writes | Result |
|---|---:|---:|---:|---|
| PR179 reference | 11,437 | 114,329 | 0 | Baseline |
| Extra endpoint covering index, explicitly selected | 15,340 | 153,354 | 0 during reads | Rejected: more reads and an extra persistent index |
| SQL grouped flags with TypeScript-derived flags | 11,437 | 114,329 | 0 | No saving |
| Ungrouped flags / separate completed-jobs read | 11,511 | 115,095 | 0 | Rejected: regression |
| Conditional failed-quote lookup | 11,437 | 114,329 | 0 | No saving |
| Materialized live endpoint fields | 19,245 | Not run after small-fixture failure | 0 | Rejected: temporary grouping scan |

The explicit covering index was removed, including the uncommitted migration/schema change. No remote migration exists for it. Parity tests passed for the conditional lookup, but parity without the economic gate does not approve the change.

Required 20,000-agent classification threshold: <=91,463 reads. The RED assertion is not skipped or weakened. Full-route before/after results are printed by the same fixture harness, with frozen list and combined readers.

## Reproduction

`npm run test:worker -- test/integration/public-query-followup-cost.test.ts --disableConsoleIntercept`

Run inside bnb-agent-probe. The suite seeds 2,000/20,000 agents locally, compares outputs and emits plans/counts. `public-current-classification.test.ts` separately covers clocks, networks, literal searches and live endpoint blocking. Fixture construction and diagnostic queries are not included as serving cost. No invoice reduction or production saving is established.

The scheduling correction and six-agent diagnosis are independent. This draft does not complete the five-pending initiative or authorize general evaluation.
