import {env} from 'cloudflare:workers';
import {expect,it} from 'vitest';
import {PILOT_AGENT_IDS} from '../../src/catalog/pilot-policy';
import {measureD1Invocation} from '../../src/db/invocation-metrics';
it('migrates nineteen tasks atomically and preserves every execution field',async()=>{
 await env.DB.prepare('DROP TABLE catalog_pilot_discovery_work').run();
 await env.DB.prepare('DROP TABLE catalog_pilot_admissions').run();
 const old=env.TEST_MIGRATIONS.find(m=>m.name==='0039_catalog_pilot_expansion.sql')!;
 await env.DB.prepare(old.queries[0]!.replaceAll('catalog_pilot_discovery_work_expanded','catalog_pilot_discovery_work')).run();
 for(const query of old.queries.slice(-3))await env.DB.prepare(query).run();
 for(const [i,id]of PILOT_AGENT_IDS.entries())await env.DB.prepare(`INSERT INTO catalog_pilot_discovery_work
 (workKey,agentKey,endpointKey,originKey,chainId,transport,contextVersion,generation,state,nextAttemptAt,runId,executionFence,executionToken,deliveryAt,failures,lastErrorCode,updatedAt)
 VALUES(?,?,?,'shared',56,'a2a','v1',7,?,9999999999999,'run',4,'token',9999999999999,3,'TIMEOUT',123)`)
 .bind(`work-${id}`,`eip155:56:${id}`,`ep-${id}`,['scheduled','dispatch','running','suspended'][i%4]).run();
 const before=(await env.DB.prepare('SELECT * FROM catalog_pilot_discovery_work ORDER BY workKey').all()).results;
 const migration=env.TEST_MIGRATIONS.find(m=>m.name==='0040_catalog_pilot_admission.sql')!;
 await expect(env.DB.batch!([...migration.queries.map(query=>env.DB.prepare(query)),env.DB.prepare("INSERT INTO catalog_pilot_admissions(slot,agentKey,batchId,admittedAt) VALUES(30,'eip155:56:999999','invalid',0)")])).rejects.toThrow();
 expect((await env.DB.prepare('SELECT * FROM catalog_pilot_discovery_work ORDER BY workKey').all()).results).toEqual(before);
 const meter=measureD1Invocation(env.DB);
 await meter.db.batch!(migration.queries.map(query=>meter.db.prepare(query)));
 expect((await env.DB.prepare('SELECT * FROM catalog_pilot_discovery_work ORDER BY workKey').all()).results).toEqual(before);
 expect(meter.snapshot().complete).toBe(true);
 expect(meter.snapshot().rowsRead!+1000*meter.snapshot().rowsWritten!).toBeLessThan(350000);
 expect(meter.snapshot()).toMatchSnapshot();
});
