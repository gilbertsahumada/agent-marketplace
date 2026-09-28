import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {expect,it} from 'vitest';

it('requires durable membership and caps admission at 29 without changing existing tasks',()=>{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 const dir=new URL('../migrations/',import.meta.url);
 for(const name of readdirSync(dir).filter(n=>n.endsWith('.sql')&&n<'0040').sort())db.exec(readFileSync(new URL(name,dir),'utf8'));
 db.exec("INSERT INTO catalog_pilot_discovery_work(workKey,agentKey,endpointKey,originKey,chainId,transport,contextVersion,state,nextAttemptAt,updatedAt) VALUES('old','eip155:56:341563','ep','origin',56,'a2a','v1','running',123,456)");
 const before=db.prepare('SELECT * FROM catalog_pilot_discovery_work').all();
 db.exec(readFileSync(new URL('0040_catalog_pilot_admission.sql',dir),'utf8'));
 expect(db.prepare('SELECT * FROM catalog_pilot_discovery_work').all()).toEqual(before);
 expect(db.prepare('SELECT COUNT(*) n FROM catalog_pilot_admissions').get()).toEqual({n:19});
 const insert=db.prepare("INSERT INTO catalog_pilot_discovery_work(workKey,agentKey,endpointKey,originKey,chainId,transport,contextVersion,nextAttemptAt,updatedAt) VALUES(?,?,'ep','origin',56,'a2a','v1',0,0)");
 expect(()=>insert.run('unknown','eip155:56:100000')).toThrow();
 const admit=db.prepare('INSERT INTO catalog_pilot_admissions(slot,agentKey,batchId,admittedAt) VALUES(?,?,?,?)');
 for(let slot=20;slot<=29;slot++){admit.run(slot,`eip155:56:${100000+slot}`,'batch-1',100);insert.run(`new-${slot}`,`eip155:56:${100000+slot}`);}
 expect(()=>admit.run(30,'eip155:56:100030','batch-2',100)).toThrow();
 expect(()=>db.prepare("UPDATE catalog_pilot_admissions SET agentKey='eip155:97:100020' WHERE slot=20").run()).toThrow();
 expect(()=>db.prepare('DELETE FROM catalog_pilot_admissions WHERE slot=20').run()).toThrow();
 db.close();
});
