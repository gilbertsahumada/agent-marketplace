import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core';
import { classifyPublicCurrent, publicCurrentClassificationQuery } from '../../src/catalog/public-current-classification';
import { PUBLIC_CURRENT_TABLE, publicCurrentColumns, publicCurrentSchemaStatements, publicCurrentSourceSql } from '../../src/catalog/public-current-projection-sql';
import { constructEndpointOnlyPrototype, classifyEndpointOnlyPrototype } from '../prototypes/endpoint-only-public-prototype';
import { prototypeCombinedResponse } from '../prototypes/public-combined-prototype';
import { catalogAgentsResponse as oldList, catalogFacetsResponse as oldFacets, catalogSummaryResponse as oldSummary } from '../fixtures/public-read-reference/catalog-agents';
import { seedPublicEnriched, completeProjectionFixture, NOW } from './public-enriched-fixture';
import { metered, type ReadRecord } from './d1-meter';

async function setup() {
  await seedPublicEnriched(30);
  await env.DB.prepare("UPDATE catalog_agents SET name=?,categoriesJson=? WHERE agentId='100010'").bind("O'Reilly\\100%_",JSON.stringify({service:'grid_trading'})).run();
  await completeProjectionFixture();
  await constructEndpointOnlyPrototype(env.DB);
  await env.DB.batch!(publicCurrentSchemaStatements.map(statement => env.DB.prepare(statement)));
  await env.DB.prepare(`DELETE FROM ${PUBLIC_CURRENT_TABLE}`).run();
  await env.DB.prepare(`INSERT INTO ${PUBLIC_CURRENT_TABLE} (${publicCurrentColumns.join(',')}) ${publicCurrentSourceSql}`).run();
}
const request = (query: string) => new Request(`https://worker.test/catalog-agents?status=declared&limit=3&${query}`);

it('matches endpoint-only flags across clocks, networks, enablement and literal search without public writes', async () => {
  await setup(); const log: ReadRecord[]=[];
  for (const chain of [56,97] as const) for (const enabled of [true,false]) for (const now of [NOW-1,NOW,NOW+1000,NOW+3_600_000]) {
    for (const search of ['',"O'Reilly",'\\','%','_','100010']) {
      expect(await classifyPublicCurrent(metered(env.DB,log),now,chain,enabled,search))
        .toEqual(await classifyEndpointOnlyPrototype(env.DB,now,chain,enabled,search,'operational'));
    }
  }
  expect(log.reduce((sum,row) => sum+row.rowsWritten,0)).toBe(0);
  const query = new SQLiteAsyncDialect().sqlToQuery(publicCurrentClassificationQuery(NOW,97,true));
  const plans = await env.DB.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).bind(...query.params).all<{detail:string}>();
  expect(plans.results?.some(row => row.detail.includes('SEARCH d USING PRIMARY KEY (agent_chainId=?)'))).toBe(true);
},120_000);

it('preserves public filters, cards and summary against frozen sources; blocks shared endpoint policy live', async () => {
  await setup();
  for (const now of [NOW,NOW+3_600_000]) for (const query of ['scope=hiring','scope=evaluation','chain=97&scope=hiring',
    'protocol=mcp&category=grid_trading','reachability=historical','status=completed_jobs','quote=verified','quote=missing',
    'commerce=suspended','status=requestable&status=pending','latestFailure=true','page=999',"q=O%27Reilly",'q=%5C']) {
    const req=request(query);
    const actual = await (await prototypeCombinedResponse(req,env.DB,now,2,true,classifyPublicCurrent,false)).json() as {list:unknown;facets:unknown;summary:unknown};
    expect(actual.list,query).toEqual(await (await oldList(req,env.DB,now,2,true)).json());
    const facetUrl = new URL(req.url); facetUrl.pathname='/catalog-facets'; facetUrl.searchParams.delete('page'); facetUrl.searchParams.delete('limit');
    expect(actual.facets,query).toEqual(await (await oldFacets(new Request(facetUrl),env.DB,now,true)).json());
    expect(actual.summary,query).toEqual(await (await oldSummary(new Request(`https://worker.test/catalog-summary?chain=${query.includes('chain=97') ? 97 : 56}`),env.DB,now,true)).json());
  }
  const before = await env.DB.prepare(`SELECT * FROM ${PUBLIC_CURRENT_TABLE}`).raw!();
  await env.DB.prepare("UPDATE catalog_endpoints SET eligibility='unsafe',safety='unsafe'").run();
  expect(await env.DB.prepare(`SELECT * FROM ${PUBLIC_CURRENT_TABLE}`).raw!()).toEqual(before);
  expect(await classifyPublicCurrent(env.DB,NOW,56,true)).toEqual([]);
},120_000);
