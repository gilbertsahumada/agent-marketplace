import { expect, it } from 'vitest';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { decodeTableRow } from '../src/db/measured-table-read';

const table=sqliteTable('example',{
  name:text('stored_name'), enabled:integer('enabled',{mode:'boolean'}), optional:text(),
});
it('preserves schema names, driver decoders and nulls',()=>{
  expect(decodeTableRow(table,{stored_name:'example',enabled:1,optional:null}))
    .toEqual({name:'example',enabled:true,optional:null});
});
it('rejects partial projections instead of fabricating missing values',()=>{
  expect(()=>decodeTableRow(table,{stored_name:'example'})).toThrow('D1_INCOMPLETE_TABLE_PROJECTION');
});
