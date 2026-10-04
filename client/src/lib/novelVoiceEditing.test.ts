import { it, expect } from "vitest";
import { emptyNovelWorkspace } from "./novelWorkspace";
import { readNovelVoiceChapter, prepareNovelVoiceCandidate, applyNovelVoiceCandidate } from "./novelVoiceEditing";
import { normalizeVoiceMessage, voiceSetup } from "../../../server/services/creativeVoiceTransport";
const workspace = () => ({...emptyNovelWorkspace(), chapters:["第一集\n门外下着雨。\n裴昭递来药碗。", "第二集\n沈昀入宫。"], novelApproved:"approved"});
it("准确替换指定段落，保留其他文字和集数，保存旧稿并使下游审阅失效",async()=>{
 const w=workspace(), r=await readNovelVoiceChapter(w,1);
 const c=await prepareNovelVoiceCandidate(w,{action:"preview",episode:1,revision:r.revision,edits:[{before:"裴昭递来药碗。",after:"裴昭把药碗收回身侧：先告诉我，你替谁办事？"}],summary:"让裴昭主动试探"});
 const n=await applyNovelVoiceCandidate(w,c);
 expect(n.chapters).toEqual(["第一集\n门外下着雨。\n裴昭把药碗收回身侧：先告诉我，你替谁办事？","第二集\n沈昀入宫。"]);
 expect(w.chapters[0]).toContain("递来药碗");expect(n.chapterVersions?.[0].text).toBe(w.chapters[0]);expect(n.novelApproved).toBe("");expect(n.chapterWarnings?.['1']).toContain('核对');
});
it("旧版本、跨作品、重复或重叠原文片段均拒绝，不模糊匹配覆盖",async()=>{
 const w=workspace(), r=await readNovelVoiceChapter(w,1);const request={action:"preview" as const,episode:1,revision:r.revision,edits:[{before:"门外下着雨。",after:"门外雨停了。"}],summary:"天气调整"};const c=await prepareNovelVoiceCandidate(w,request);
 await expect(applyNovelVoiceCandidate({...w,chapters:['用户刚写的新正文',w.chapters[1]]},c)).rejects.toThrow('变化');
 await expect(applyNovelVoiceCandidate({...w,roundId:crypto.randomUUID()},c)).rejects.toThrow('作品');
 await expect(prepareNovelVoiceCandidate(w,{...request,edits:[{before:'不存在',after:'新文'}]})).rejects.toThrow('不存在');
 await expect(prepareNovelVoiceCandidate(w,{...request,edits:[...request.edits,{before:'下着雨',after:'有阳光'}]})).rejects.toThrow('重叠');
 await expect(applyNovelVoiceCandidate({...w,direction:'新方向'},c)).rejects.toThrow('变化');
});
it("普通与Extended共享正文工具；参数错误返回失败回执，不接受模型伪造确认",()=>{
 const raw:any={toolCall:{functionCalls:[{id:'a',name:'novelText',args:{action:'read',episode:2}}]}};
 expect(normalizeVoiceMessage(false,raw)).toMatchObject([{type:'novelEdit',id:'a',action:{action:'read',episode:2}}]);expect(normalizeVoiceMessage(true,raw)[0].type).toBe('novelEdit');
 raw.toolCall.functionCalls[0].args={action:'apply',candidateId:crypto.randomUUID(),approved:true};expect(normalizeVoiceMessage(true,raw)[0].type).toBe('toolRejected');
 const setup=voiceSetup({route:'gemini_api',model:'gemini-3.8-live-extended-thinking',generationConfig:{}} as any,'作品');
 expect(setup.setup.tools[0].functionDeclarations.some(f=>f.name==='novelText')).toBe(true);
 expect(setup.setup.systemInstruction.parts[0].text).toContain('保存成功');
});
