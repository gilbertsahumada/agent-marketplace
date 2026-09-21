import {env} from 'cloudflare:workers';
import {expect,it} from 'vitest';
import {runMaintenanceWindow} from '../../src/phases/background-cadence';
import type {D1DatabaseLike} from '../../src/db/client';
const db=env.DB as unknown as D1DatabaseLike;
it('admits four maintenance cycles in sixty ticks, without replaying missed intervals',async()=>{
 await db.prepare("DELETE FROM runtime_state WHERE key='background_maintenance_window_v1'").run();
 let calls=0;const now=1800000000000;
 for(let i=0;i<60;i++)await runMaintenanceWindow(db,now+i*60000,async()=>{calls++;});
 expect(calls).toBe(4);
 await runMaintenanceWindow(db,now+86400000,async()=>{calls++;});expect(calls).toBe(5);
});
it('claims once concurrently and backs off failed windows',async()=>{
 await db.prepare("DELETE FROM runtime_state WHERE key='background_maintenance_window_v1'").run();
 let calls=0;const now=1800000000000;
 await Promise.all(Array.from({length:8},()=>runMaintenanceWindow(db,now,async()=>{calls++;})));
 expect(calls).toBe(1);
 await expect(runMaintenanceWindow(db,now+900000,async()=>{throw Error('failure');})).rejects.toThrow('failure');
 expect(await runMaintenanceWindow(db,now+960000,async()=>{calls++;})).toBe(false);
});
