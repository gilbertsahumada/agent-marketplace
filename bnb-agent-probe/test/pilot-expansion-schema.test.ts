import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {expect,it} from 'vitest';
import {isPilotAgent} from '../src/catalog/pilot-policy';

const added=['204789','212769','212943','213036','213084','213432'];
it('admits only the six explicit Mainnet additions in code',()=>{
 for(const id of added){expect(isPilotAgent(`eip155:56:${id}`)).toBe(true);expect(isPilotAgent(`eip155:97:${id}`)).toBe(false);}
 expect(isPilotAgent('eip155:56:999999')).toBe(false);
});
it('preserves running tasks and origins when upgrading the published allowlist',()=>{
 const db=new DatabaseSync(':memory:'),dir=new URL('../migrations/',import.meta.url);
 for(const name of readdirSync(dir).filter(n=>n.endsWith('.sql')&&n<'0039').sort())db.exec(readFileSync(new URL(name,dir),'utf8'));
 db.exec(`INSERT INTO catalog_pilot_discovery_work(workKey,agentKey,endpointKey,originKey,chainId,transport,contextVersion,generation,state,nextAttemptAt,runId,executionFence,executionToken,deliveryAt,failures,lastErrorCode,updatedAt)
 VALUES('original','eip155:56:341563','ep','origin',56,'a2a','v1',7,'running',123,'run',4,'token',456,3,'TIMEOUT',789);
 INSERT INTO catalog_pilot_origin_schedule(originKey,wakeAt,turn,leaseToken,leaseUntil,executionToken,executionLeaseUntil,used) VALUES('origin',123,987,'lease',456,'exec',654,1);`);
 const before=db.prepare('SELECT * FROM catalog_pilot_discovery_work').all();
 const origins=db.prepare('SELECT * FROM catalog_pilot_origin_schedule').all();
 db.exec('BEGIN');
 db.exec(readFileSync(new URL('0039_catalog_pilot_expansion.sql',dir),'utf8'));
 db.exec('COMMIT');
 expect(db.prepare('SELECT * FROM catalog_pilot_discovery_work').all()).toEqual(before);
 expect(db.prepare('SELECT * FROM catalog_pilot_origin_schedule').all()).toEqual(origins);
 const insert=db.prepare("INSERT INTO catalog_pilot_discovery_work(workKey,agentKey,endpointKey,originKey,chainId,transport,contextVersion,nextAttemptAt,updatedAt) VALUES(?,?,'ep','origin',?,'a2a','v1',0,0)");
 for(const id of added){insert.run(id,`eip155:56:${id}`,56);expect(()=>insert.run('testnet-'+id,`eip155:97:${id}`,97)).toThrow();}
 expect(()=>insert.run('unknown','eip155:56:999999',56)).toThrow();
 expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='catalog_pilot_discovery_work' ORDER BY name").all().map(r=>r.name)).toEqual(['catalog_pilot_discovery_work_agent_endpoint','idx_pilot_discovery_delivery','idx_pilot_discovery_origin_head']);
 db.close();
});
