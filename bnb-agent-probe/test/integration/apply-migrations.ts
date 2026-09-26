import { env } from "cloudflare:workers";
import { backfillPublicProjections, publicProjectionsReady } from "../../src/catalog/public-projections";
import { applyD1Migrations } from "cloudflare:test";
import {beginPublicCurrentBackfill,publicCurrentProjectionReady,stepPublicCurrentBackfill} from '../../src/catalog/public-current-backfill';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Exercise the real, bounded source/projection verification on the empty
// migrated database. Fixtures added afterwards are maintained by the triggers;
// coverage tests explicitly replace this checkpoint to test fail-closed reads.
for (let step = 0; step < 8 && !await publicProjectionsReady(env.DB); step++) {
  await backfillPublicProjections(env.DB, { batchSize: 40, nowMs: 0 });
}
if (!await publicProjectionsReady(env.DB)) throw new Error("Empty database projection verification did not complete");
await beginPublicCurrentBackfill(env.DB);
for(let step=0;step<3&&!await publicCurrentProjectionReady(env.DB);step++) {
  await stepPublicCurrentBackfill(env.DB,10_000_000);
}
if(!await publicCurrentProjectionReady(env.DB))throw new Error('Empty current projection verification did not complete');
