import { expect, it } from "vitest";
import { readGuaikeiBalance } from "./balance";
it("余额/支出分别读取真实字段；低于5元提示；跨页去重且不把未知当零",async()=>{
 const at="2026-11-04T22:00:00+08:00";
 const row={id:1,path:"xiaohongshu/note-search",single:0.2,balance:5.1,created_at:at};
 const result=await readGuaikeiBalance(async page=>({errcode:0,data:{balance:4.9,list:page===1?[row]:[]}}),Date.parse(at));
 expect(result).toMatchObject({balanceCents:490,todaySpentCents:20,lowBalance:true,todayComplete:true,balanceConsistent:true});
 const invalid=await readGuaikeiBalance(async()=>({errcode:0,data:{list:[]}}),Date.parse(at));
 expect(invalid.balanceCents).toBeNull();expect(invalid.lowBalance).toBeNull();expect(invalid.todayComplete).toBe(false);
});
