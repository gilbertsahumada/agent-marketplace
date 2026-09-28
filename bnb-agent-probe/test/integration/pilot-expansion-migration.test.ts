import {env} from 'cloudflare:workers';
import {expect,it} from 'vitest';
import {ORIGINAL_PILOT_AGENT_IDS} from '../../src/catalog/pilot-policy';
import {measureD1Invocation} from '../../src/db/invocation-metrics';
it('atomically upgrades thirteen tasks without resetting their state and measures installation separately',async()=>{
 await env.DB.prepare('DROP TABLE catalog_pilot_discovery_work').run();
 const original=env.TEST_MIGRATIONS.find(m=>m.name==='0038_catalog_pilot_discovery.sql')!;
 for(const query of original.queries.slice(0,4))await env.DB.prepare(query).run();
 for(const [i,id] of ORIGINAL_PILOT_AGENT_IDS.entries())await env.DB.prepare(`INSERT INTO catalog_pilot_discovery_work
  (workKey,agentKey,endpointKey,originKey,chainId,transport,contextVersion,generation,state,nextAttemptAt,runId,executionFence,executionToken,deliveryAt,failures,lastErrorCode,updatedAt)
  VALUES(?,?,?,'shared',56,'a2a','v1',7,?,9999999999999,'run',4,'token',9999999999999,3,'TIMEOUT',123)`)
  .bind(`work-${id}`,`eip155:56:${id}`,`ep-${id}`,['scheduled','dispatch','running','suspended'][i%4]).run();
 const before=await env.DB.prepare('SELECT * FROM catalog_pilot_discovery_work ORDER BY workKey').all();
 const migration=env.TEST_MIGRATIONS.find(m=>m.name==='0039_catalog_pilot_expansion.sql')!;
 // A failing atomic migration must leave the original table and task data.
 await expect(env.DB.batch!([...migration.queries.map(query=>env.DB.prepare(query)),
  env.DB.prepare("INSERT INTO catalog_pilot_discovery_work(workKey,agentKey,endpointKey,originKey,chainId,transport,contextVersion,nextAttemptAt,updatedAt) VALUES('invalid','eip155:56:999999','ep','origin',56,'a2a','v1',0,0)")])).rejects.toThrow();
 expect((await env.DB.prepare('SELECT * FROM catalog_pilot_discovery_work ORDER BY workKey').all()).results).toEqual(before.results);
 expect((await env.DB.prepare("SELECT sql FROM sqlite_master WHERE name='catalog_pilot_discovery_work'").first<{sql:string}>())!.sql).not.toContain('eip155:56:204789');
 const meter=measureD1Invocation(env.DB);
 await meter.db.batch!(migration.queries.map(query=>meter.db.prepare(query)));
 expect((await env.DB.prepare('SELECT * FROM catalog_pilot_discovery_work ORDER BY workKey').all()).results).toEqual(before.results);
 expect(meter.snapshot().complete).toBe(true);
 expect(meter.snapshot().rowsRead!+1000*meter.snapshot().rowsWritten!).toBeLessThan(150_000);
 expect(meter.snapshot()).toMatchInlineSnapshot(`
   {
     "complete": true,
     "knownRowsRead": 873,
     "knownRowsWritten": 126,
     "queries": 7,
     "rowsRead": 873,
     "rowsWritten": 126,
     "unmeasuredQueries": 0,
   }
 `);
});
