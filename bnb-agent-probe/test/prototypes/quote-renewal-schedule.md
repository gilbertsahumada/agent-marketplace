# Buyer quote / discovery scheduling correction

## Evidence (2026-09-30 UTC)

Read-only remote inspection of 303779 and seven explicit related IDs cost 32 reads / 0 writes. A second keyed inspection of 303779 cost 4 reads / 0 writes. No vendor request was issued.

303779's last successful browser `buyer_quote` set `nextProbeAt = capabilityExpiresAt = lastSuccessAt + 86400000`. Its negotiation compatibility was last checked on September 27 and had already expired. Both quote-success writers unconditionally replaced the discovery gate with the new quote TTL. A continued stream of buyer quotes could therefore keep expired negotiation inputs from being rediscovered.

The pilot correctly respected that future gate. No evidence supports blaming its lease implementation or clearing an arbitrary backoff.

## Correction

Both quote-success writers use one atomic SQL expression against the previous capability row. New rows have discovery due now. Existing future dates are preserved unless they are recognizable as a ready, error-free quote-expiry gate. That gate is replaced with the negotiation evidence renewal date (expiry minus two hours, bounded by now and quote TTL); absent/expired requirements are due now. The agenda still owns its deterministic 22–23-hour renewal jitter and execution leases.

Quote signatures, ownership, quote expiry, evidence freshness and hiring eligibility are unchanged. This does not make 303779 available by itself. Existing persisted dates are not bulk-repaired.

## RED / GREEN

Before: five deterministic regression cases failed because every successful browser quote assigned `now + 24h`.

After: 37 tests passed across catalog-quote-evidence, catalog-quotes and pilot-consumer. Cases cover expired/fresh requirements, vendor backoff, execution lease and unexplained future date. Seller networking and chain verification are mocked locally.

## Publication checks still required

CI/review, current version/configuration and schema inspection, bounded post-release validation. Any repair of 303779 must re-read its current values and use a compare-and-swap conditioned on the verified writer, generation and absence of an active execution. Never overwrite a concurrent success or arbitrary future gate. Automatic monitoring remains paused.
