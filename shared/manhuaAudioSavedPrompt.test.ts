import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createManhuaAudioFromSavedPrompt, savedPromptAudioDiffers, syncUnproducedAudioToSavedPrompt } from "./manhuaAudioSavedPrompt";
import { createCanvasAudioCue, emptyCanvasAudioStudio } from "./canvasAudioStudio";
const fixture = (segment: number) => readFileSync(new URL(`../client/src/lib/__testutils__/fixtures/manhua-closure-1001/segment-${segment}.txt`, import.meta.url), "utf8");
const characters = [{id:"cust_mtn5ko0y_01qwd",nameZh:"墨屠"},{id:"cust_mu3cnj74_qpe4b",nameZh:"阿菁"},{id:"cust_mu3cqjqb_nbgh1",nameZh:"曹三"},{id:"cust_mu3cyr8i_6y12m",nameZh:"娘"},{id:"cust_mu3cdav2_xshp2",nameZh:"坐堂先生",aliasZh:"先生"}];
it("第四段保存全文读取五句新原词，第二句是娘，第三句仍绑定先生", () => {
 const studio = createManhuaAudioFromSavedPrompt(fixture(4),24,characters);
 expect(studio.cues.map(c=>c.speakerZh)).toEqual(["坐堂先生","娘","坐堂先生","阿菁","墨屠"]);
 expect(studio.cues[1]).toMatchObject({speakerId:"cust_mu3cyr8i_6y12m",textZh:"要取多少墨屠的血？",startSec:6.3,endSec:9.4});
 expect(studio.cues[4]).toMatchObject({textZh:"草藥只能撐三天，太短了，取點血沒事的，我撐得住。",startSec:17.3,endSec:24});
 expect(studio.cues.every(c=>!c.approved && !c.selectedTakeId && !c.takes.length)).toBe(true);
});
it.each([[1,29,5],[3,23,4]])("第%s段明确秒窗和角色标签读出%s秒的%s句原词",(segment,duration,count)=>{
 const studio=createManhuaAudioFromSavedPrompt(fixture(segment!),duration!,characters);
 expect(studio.cues).toHaveLength(count!);
 expect(studio.cues.every(c=>characters.some(character=>character.id===c.speakerId))).toBe(true);
});
it("明确更新未生成草稿时保留音乐、音效、原曲任务，不自动采用",()=>{
 const bgm=createCanvasAudioCue("bgm","original-bgm");
 const studio={...emptyCanvasAudioStudio(),musicJobIds:["old-music-job"],cues:[{...createCanvasAudioCue("dialogue","old"),speakerZh:"阿菁",textZh:"要多少？"},bgm]};
 const saved=createManhuaAudioFromSavedPrompt(fixture(4),24,characters);
 expect(savedPromptAudioDiffers(studio,saved)).toBe(true);
 const updated=syncUnproducedAudioToSavedPrompt(studio,saved);
 expect(updated.cues.at(-1)).toEqual(bgm);expect(updated.musicJobIds).toEqual(studio.musicJobIds);
 expect(savedPromptAudioDiffers(updated,saved)).toBe(false);
 expect(studio.cues[0]!.textZh).toBe("要多少？");
});
it("已有原声或候选时拒绝覆盖，输入逐字保留",()=>{
 const cue={...createCanvasAudioCue("dialogue","old"),speakerZh:"阿菁",textZh:"要多少？",takes:[{id:"original-take",gcsUri:"gs://test/audio.wav",previewUrl:"",durationSec:3,createdAt:"test",inputKey:"old"}]};
 const studio={...emptyCanvasAudioStudio(),cues:[cue]};const before=JSON.stringify(studio);
 expect(()=>syncUnproducedAudioToSavedPrompt(studio,createManhuaAudioFromSavedPrompt(fixture(4),24,characters))).toThrow("不能覆盖");
 expect(JSON.stringify(studio)).toBe(before);
});
it("旧23秒容量、含糊说话人、缺秒窗和多句未分窗均明确失败，不回填旧对白",()=>{
 expect(()=>createManhuaAudioFromSavedPrompt(fixture(4),23,characters)).toThrow("超出本段");
 expect(()=>createManhuaAudioFromSavedPrompt(fixture(1),29,[])).toThrow("未唯一绑定");
 expect(()=>createManhuaAudioFromSavedPrompt("{对白/娘：0.0秒开口，“原句”。}",24,characters)).toThrow("无法完整读取");
 expect(()=>createManhuaAudioFromSavedPrompt('0–5s：@角色1说「一。」；@角色1说「二。」',5,characters)).toThrow("多句对白");
});

it("角色cust图片通过明确seedLibrary桥绑定wa人物身份，不按标签或位置猜人",()=>{
 const canonical=characters.map(c=>({...c,id:`wa_${c.nameZh}`,referenceAssetIds:[c.id]}));
 const result=createManhuaAudioFromSavedPrompt(fixture(1),29,canonical);
 expect(result.cues.map(c=>c.speakerId)).toEqual(["wa_娘","wa_阿菁","wa_曹三","wa_阿菁","wa_曹三"]);
 expect(()=>createManhuaAudioFromSavedPrompt(fixture(1),29,canonical.map(c=>({...c,referenceAssetIds:[]})))).toThrow("未唯一绑定");
});
