import type {D1DatabaseLike} from '../db/client';
import {sql} from 'drizzle-orm';
import {createDatabase} from '../db/orm';
export const MAINTENANCE_INTERVAL_MS=15*60*1000;
export const JOBS_INTERVAL_MS=60*1000;
// Claim the complete window before doing work. Failures retain their cooldown;
// missed windows never accumulate catch-up work.
export async function runMaintenanceWindow(db:D1DatabaseLike,nowMs:number,run:()=>Promise<void>):Promise<boolean>{
 return runBackgroundWindow(db,'maintenance',nowMs,MAINTENANCE_INTERVAL_MS,run);
}
export async function runBackgroundWindow(db:D1DatabaseLike,name:string,nowMs:number,intervalMs:number,run:()=>Promise<void>):Promise<boolean>{
 const claimed=await createDatabase(db).all<{key:string}>(sql`INSERT INTO runtime_state(key,integerValue,updatedAt)
 VALUES(${`background_${name}_window_v1`},${nowMs+intervalMs},${nowMs}) ON CONFLICT(key) DO UPDATE
 SET integerValue=excluded.integerValue,updatedAt=excluded.updatedAt
 WHERE runtime_state.integerValue<=${nowMs} RETURNING key`);
 if(!claimed.length)return false;
 await run();return true;
}
