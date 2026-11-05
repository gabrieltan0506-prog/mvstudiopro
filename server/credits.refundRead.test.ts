import {describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({available:true,results:[] as any[],queries:[] as any[]}));
vi.mock('./db',()=>({getDb:async()=>state.available?{select:()=>({from:()=>({where:(q:any)=>{state.queries.push(q);return {limit:async()=>state.results.shift()};}})})}:null,isBillingChargeKeyIndexReady:()=>true,reverifyBillingChargeKeyIndex:async()=>true}));
import {readChargeRefundState} from './credits';
import {PgDialect} from 'drizzle-orm/pg-core';
describe('重试前只读扣退核对',()=>{
 it('扣款无退款认领时不放行，有退款认领才通过',async()=>{
  state.queries=[];state.results=[[{creditsCost:3,metadata:null}],[]];
  expect(await readChargeRefundState(7,'original-charge','canonical-refund')).toEqual({charged:3,settled:false});
  const dialect=new PgDialect();expect(state.queries.map(q=>dialect.sqlToQuery(q).params)).toEqual([[7,'original-charge'],[7,'canonical-refund']]);
  state.results=[[{creditsCost:3,metadata:null}],[{id:9}]];
  expect(await readChargeRefundState(7,'original-charge','canonical-refund')).toEqual({charged:3,settled:true});
 });
 it('无扣款可放行，数据库不可读必须失败',async()=>{
  state.results=[[]];expect(await readChargeRefundState(7,'c','r')).toEqual({charged:0,settled:true});
  state.available=false;await expect(readChargeRefundState(7,'c','r')).rejects.toThrow('积分账暂不可读取');state.available=true;
 });
});
