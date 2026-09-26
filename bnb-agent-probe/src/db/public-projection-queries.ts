import {sql} from 'drizzle-orm';
import {SQLiteD1Session} from 'drizzle-orm/d1';
import {SQLiteAsyncDialect} from 'drizzle-orm/sqlite-core';
import type {D1Database} from '../types';
import type {D1DatabaseLike} from './client';
import {createDatabase} from './orm';

/** Internal SQL templates only; every value remains a Drizzle parameter. */
export function publicProjectionDatabase(d1:D1Database){
 const db=createDatabase(d1 as unknown as D1DatabaseLike);
 const dialect=new SQLiteAsyncDialect();
 const session=new SQLiteD1Session(d1 as ConstructorParameters<typeof SQLiteD1Session>[0],dialect,undefined);
 const query=(template:string,values:readonly unknown[]=[])=>{
  const parts=template.split('?');if(parts.length!==values.length+1)throw Error('Public projection SQL binding mismatch');
  return sql.join(parts.flatMap((part,i)=>i<values.length?[sql.raw(part),sql`${values[i]}`]:[sql.raw(part)]),sql``);
 };
 return{
  all:<T>(template:string,values:readonly unknown[]=[])=>db.all<T>(query(template,values)),
  first:async<T>(template:string,values:readonly unknown[]=[]) =>(await db.all<T>(query(template,values)))[0]??null,
  statement:(template:string,values:readonly unknown[]=[])=>{
   const statement=query(template,values),runnable=db.run(statement);
   // Drizzle SQLiteRaw needs the exported session compiler for bound D1 batches.
   runnable._prepare=()=>session.prepareQuery(dialect.sqlToQuery(statement),undefined,'run',false);
   return runnable;
  },
  batch:(statements:ReturnType<typeof db.run>[])=>{
   if(!statements.length)throw Error('Public projection transaction cannot be empty');
   return db.batch(statements as [ReturnType<typeof db.run>,...ReturnType<typeof db.run>[]]);
  },
 };
}
