import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {expect,it} from 'vitest';
import {getTableColumns,getTableName} from 'drizzle-orm';
import {catalogPilotDiscoveryWork,catalogPilotOriginSchedule} from '../src/db/schema';

it('upgrades the published schema additively and preserves existing data',()=>{
  const db=new DatabaseSync(':memory:'),dir=new URL('../migrations/',import.meta.url);
  for(const name of readdirSync(dir).filter(n=>n.endsWith('.sql')&&n<'0038').sort())db.exec(readFileSync(new URL(name,dir),'utf8'));
  db.exec("INSERT INTO runtime_state(key,integerValue,updatedAt) VALUES('migration-sentinel',42,123)");
  const before=db.prepare("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
  db.exec(readFileSync(new URL('0038_catalog_pilot_discovery.sql',dir),'utf8'));
  const after=db.prepare("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '%pilot%' ORDER BY name").all();
  expect(after).toEqual(before);
  expect(db.prepare("SELECT integerValue,updatedAt FROM runtime_state WHERE key='migration-sentinel'").get()).toEqual({integerValue:42,updatedAt:123});
  for(const table of [catalogPilotDiscoveryWork,catalogPilotOriginSchedule]){
    const columns=db.prepare(`PRAGMA table_info(${getTableName(table)})`).all().map(row=>row.name);
    expect(columns).toEqual(Object.values(getTableColumns(table)).map(column=>column.name));
  }
  db.close();
});
