import { expect, it } from "vitest";
import { assembleRecovery, recoveryDraft } from "./knowledgeCardRecovery";
const text="# 同名作品\n这份正文只属于当前备份。";
function image(id:string,page:number,changes:Record<string,unknown>={}) { return {id,userId:"1",status:"succeeded",createdAt:new Date("2026-10-05T01:00:00Z"),input:{action:"platform_composite_sheet_progress",params:{kind:"single_page_knowledge_card",scriptContext:text,notePageIndex:page,notePageTotal:3,distillModel:"glm-5.3-flash",subjectPosition:"left",...changes}},output:{compositeImageUrl:`https://storage.googleapis.com/test/${id}.png`}}; }
it("仅恢复本人同正文同版式成品，保留缺页并按真实页码排序",()=>{
 const one=image("one",1), three=image("three",3), otherUser={...image("other-user",2),userId:"2"};
 const r=assembleRecovery("1",one,[three,one,otherUser,image("other-layout",2,{subjectPosition:"center"}),image("other-text",2,{scriptContext:text+"不同情节"}),{...image("failed",2),status:"failed"}]);
 expect(r.total).toBe(3);expect(r.images.map(i=>[i.page,i.jobId])).toEqual([[1,"one"],[3,"three"]]);
 expect(()=>assembleRecovery("2",one,[one])).toThrow("无法读取");
});
it("重出仅替换同一页最新成功记录，精华正文恢复不猜选图片组合",()=>{
 const old=image("old",1), recent={...image("recent",1),createdAt:new Date("2026-10-05T02:00:00Z")};
 const draft={...old,id:"draft",input:{action:"knowledge_card_derive_level",params:{fullMarkdown:"原完整稿"}},output:{distilledMarkdown:text,detailLevel:"concise"}};
 const r=assembleRecovery("1",old,[old,recent,draft]);expect(r.images[0].jobId).toBe("recent");expect(r.fullMarkdown).toBe("原完整稿");
 expect(assembleRecovery("1",draft,[draft,old]).images).toEqual([]);
 expect(recoveryDraft({...draft,status:"running"})).toBeNull();expect(recoveryDraft({...draft,input:{action:"unrelated"}})).toBeNull();
});
