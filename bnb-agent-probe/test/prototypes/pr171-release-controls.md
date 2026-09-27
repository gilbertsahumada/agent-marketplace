# Release control admission — 2026-09-27

The prior 7M control lane could not complete the frozen 40,767-tuple
backfill: 1,022 calls each require a separate confirmation. RED:
11,846,144 reserved units including prior capture and 64 contingency calls
exceeded 7M. This was detected before remote migration.

Lane ceilings now permit up to 12M controls, but are **not additive grants**.
Every control admission atomically checks the unchanged 250M shared cap.
Work admission checks that cap with confirmation headroom, then uses the
existing compare-and-swap. The 150M C reserve is unchanged. Only confirmed
measured work releases unused reservations; unknown work remains charged.

Local complete rehearsal through the authenticated release entrypoint:
1,022 current steps plus confirmations; current work 44,602,039 units;
controls 11,223,145 units using the original 986,144 prior-capture charge;
base reservation 7,871,859; C protected 150M. No remaining lock or halt.
The final prior-capture allowance is rounded to 1,050,000 to include the
48,793 reads / zero writes of the September 27 read-only sizing check and
150 earlier ledger/schema reads. Total cap is unchanged.

Reproduce: `npx vitest run --config vitest.worker.config.ts test/integration/public-projection-release-worker.test.ts --disableConsoleIntercept`.
The fixture matches counts, not private production payloads. Remote work
must still stop on underestimated pages, missing metadata or parity failure.
Do not activate readers until both exact coverage gates are complete.

Integrated validation: Worker 670 unit + 629 integration tests; frontend
1,569 tests, types and production build; updated release tests 16 passing.
Worker CI timeout increases from 10 to 25 minutes without removing scenarios:
the local integration suite alone took 454.51 seconds; CI had timed out twice.

Remote preflight: version 9deb4de2-d382-4c5c-b982-586c34dcfb3a; only ERC-8183
indexing active; 7,877 observations and 40,767 current declarations. Migrations
0036 and 0037 are pending. This report does not claim production activation.

## Remote bounded admission correction

After the two additive migrations succeeded, sparse verification was safely
refused at base charge 8,885,999 plus a 130,000 next-page reservation against
the original 9M lane ceiling. No work ran for that refused page. The public
Worker remained unchanged. This demonstrated a payload/distribution gap in
the synthetic sparse fixture; it was not an exhausted shared budget.

The base ceiling is now 12M, still subject to the same atomic 250M total and
protected 150M C reserve. Regression coverage reproduces this admission and
keeps the shared-cap refusal tests. All 17 release tests and types pass.
Resume only after reviewing the durable ledger; never replay ambiguous work.
