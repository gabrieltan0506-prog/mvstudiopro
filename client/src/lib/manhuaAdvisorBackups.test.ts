import { describe, expect, it } from "vitest";
import { advisorReconfirmationEpisodeIndexes, advisorReconfirmationFromEpisode, listAdvisorBackups } from "./manhuaAdvisorBackups";
function storage(rows: Record<string,string>) { const keys=Object.keys(rows); return {length:keys.length,key:(i:number)=>keys[i]||null,getItem:(k:string)=>rows[k]||null}; }
const backup=(version:string|null,body="原稿")=>JSON.stringify({createdAt:"2026-09-20T05:22:00.000Z",episodeIndex:1,changes:["变化"],writerPack:{seriesTitle:"船战",episodes:[{index:1,body}]},projectBible:version?{confirmedAt:version}:null});
describe("顾问旧稿备份读取",()=>{
 it("隔离用户和已确认项目版本，损坏记录保留原文且可报告",()=>{
  const rows={"manhua-advisor-rewrite-backup:1:a":backup("v1"),"manhua-advisor-rewrite-backup:2:b":backup("v1"),"manhua-advisor-rewrite-backup:1:c":backup("v2"),"manhua-advisor-rewrite-backup:1:d":"broken"};
  const result=listAdvisorBackups(storage(rows),{userId:"1",confirmedProjectVersion:"v1",seriesTitle:"船战",episodeIndex:1,body:"新稿"});
  expect(result.entries).toHaveLength(1);expect(result.entries[0].json).toBe(rows["manhua-advisor-rewrite-backup:1:a"]);expect(result.errors).toBe(1);expect(rows["manhua-advisor-rewrite-backup:1:d"]).toBe("broken");
 });
 it("未确认项目必须同时匹配剧名、集数和当前/候选原稿，不按同名串项目",()=>{
  const store=storage({"manhua-advisor-rewrite-backup:1:a":backup(null)});
  const scope={userId:"1",seriesTitle:"船战",episodeIndex:1,body:"另一个故事"};
  expect(listAdvisorBackups(store,scope).entries).toHaveLength(0);
  expect(listAdvisorBackups(store,{...scope,originalBody:"原稿"}).entries).toHaveLength(1);
  expect(listAdvisorBackups(store,{...scope,seriesTitle:"别剧",originalBody:"原稿"}).entries).toHaveLength(0);
 });
});

it("重新确认产生新Bible时间后，凭实际采用正文找回旧稿；同名不同正文不能匹配",()=>{
 const row={...JSON.parse(backup("v1")),adoptedWriterPack:{seriesTitle:"船战",episodes:[{index:1,body:"已采用新正文"}]}};
 const store=storage({"manhua-advisor-rewrite-backup:1:a":JSON.stringify(row)});
 const scope={userId:"1",confirmedProjectVersion:"v2",seriesTitle:"船战",episodeIndex:1,body:"已采用新正文"};
 expect(listAdvisorBackups(store,scope).entries).toHaveLength(1);
 expect(listAdvisorBackups(store,{...scope,body:"另剧"}).entries).toHaveLength(0);
 expect(listAdvisorBackups(store,{...scope,userId:"2"}).entries).toHaveLength(0);
});

it("重新确认读取备份受阻时显式拒绝，不当作没有改写证据",()=>{
 expect(()=>advisorReconfirmationFromEpisode({length:1,key:()=>"manhua-advisor-rewrite-backup:1:a",getItem:()=>{throw Error("storage denied")}},"1",{})).toThrow("storage denied");
});

it("重新确认按真实批次集号恢复，旧记录仅失效单集，不扩大后续剧集",()=>{
 const writerPack={seriesTitle:"船战",episodes:[{index:1,body:"新稿1"},{index:2,body:"保留2"},{index:3,body:"新稿3"}]};
 const row={...JSON.parse(backup("v1")),adoptedWriterPack:writerPack,changedEpisodeIndexes:[3,1]};
 const store=storage({"manhua-advisor-rewrite-backup:1:a":JSON.stringify(row)});
 expect(advisorReconfirmationEpisodeIndexes(store,"1",writerPack,"v1")).toEqual([1,3]);
 expect(advisorReconfirmationEpisodeIndexes(store,"2",writerPack,"v1")).toBeUndefined();
 expect(advisorReconfirmationEpisodeIndexes(store,"1",writerPack,"v2")).toBeUndefined();
 expect(advisorReconfirmationEpisodeIndexes(store,"1",{...writerPack,seriesTitle:"别剧"},"v1")).toBeUndefined();
 const old={...row,changedEpisodeIndexes:undefined};
 expect(advisorReconfirmationEpisodeIndexes(storage({"manhua-advisor-rewrite-backup:1:a":JSON.stringify(old)}),"1",writerPack,"v1")).toEqual([1]);
 expect(listAdvisorBackups(store,{userId:"1",confirmedProjectVersion:"v2",seriesTitle:"船战",episodeIndex:3,body:"新稿3"}).entries).toHaveLength(1);
});
