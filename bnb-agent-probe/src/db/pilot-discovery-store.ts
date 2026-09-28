import { sql, type SQL } from 'drizzle-orm';
import { SQLiteD1Session } from 'drizzle-orm/d1';
import { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core';
import { createDatabase } from './orm';
import type { D1DatabaseLike, D1ResultLike } from './client';

export interface DiscoveryStatement {
  readonly query:SQL;
  first<Row=Record<string,unknown>>():Promise<Row|null>;
  all<Row=Record<string,unknown>>():Promise<D1ResultLike<unknown,Row>>;
  run():Promise<D1ResultLike>;
}
async function execute<T>(operation:()=>PromiseLike<T>):Promise<T>{
  try{return await operation();}
  catch(error){
    // Drizzle wraps binding errors; preserve budget error identity so the
    // queue's durable-deferral path still recognizes a closed admission.
    if(error instanceof Error&&error.cause instanceof Error)throw error.cause;
    throw error;
  }
}

/** Internal static-SQL builder. Every question-mark parameter becomes a
 * Drizzle bound value, never interpolated text. Callers may compose only
 * source-code SQL fragments (fixed classes and predicates), not user input. */
export function discoveryStatement(binding:D1DatabaseLike,source:string,values:unknown[]=[]):DiscoveryStatement{
  const parts=source.split('?');
  if(parts.length!==values.length+1)throw new Error('DISCOVERY_PARAMETER_COUNT');
  const fragments:SQL[]=[];
  for(const [index,part]of parts.entries()){
    fragments.push(sql.raw(part));
    if(index<values.length)fragments.push(sql`${values[index]}`);
  }
  const query=sql.join(fragments,sql.raw('')),db=createDatabase(binding);
  return{query,first:async<Row>()=>(await execute(()=>db.get<Row>(query)))??null,
    all:async<Row>()=>({success:true,meta:{},results:await execute(()=>db.all<Row>(query))}),
    run:async()=>await execute(()=>db.run(query))};
}

/** Drizzle batch retains the D1 atomic transaction and direct change counts. */
export async function discoveryBatch(binding:D1DatabaseLike,statements:DiscoveryStatement[]):Promise<readonly D1ResultLike[]>{
  if(!statements.length)return[];
  const db=createDatabase(binding),queries=statements.map(statement=>discoveryBatchQuery(binding,statement));
  return await db.batch(queries as [typeof queries[number],...typeof queries[number][]]);
}

/** Compose agenda writes into the ingester's existing atomic ORM batch. */
export function discoveryBatchQuery(binding:D1DatabaseLike,statement:DiscoveryStatement){
  const db=createDatabase(binding),dialect=new SQLiteAsyncDialect();
  // Drizzle 0.45's SQLiteRaw._prepare() lacks the D1 statement expected by
  // its batch implementation. Prepare through Drizzle's D1 session instead;
  // all SQL compilation, binding and batch execution remain ORM-owned.
  const session=new SQLiteD1Session(binding as ConstructorParameters<typeof SQLiteD1Session>[0],dialect,undefined);
  const query=db.run(statement.query);
  query._prepare=()=>session.prepareQuery(dialect.sqlToQuery(statement.query),undefined,'run',false);
  return query;
}
