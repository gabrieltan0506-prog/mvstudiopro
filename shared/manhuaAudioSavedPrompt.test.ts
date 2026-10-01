import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createManhuaAudioFromSavedPrompt, resolveSavedPromptAudioCharacters, savedPromptAudioDiffers, syncUnproducedAudioToSavedPrompt } from "./manhuaAudioSavedPrompt";
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


it.each([{ speakerId: "other-role" }, { startSec: 6.4 }, { endSec: 9.3 }])("同句同名仍识别人物ID或秒窗变化：%j", patch => {
 const saved=createManhuaAudioFromSavedPrompt(fixture(4),24,characters);
 const current={...saved,cues:saved.cues.map((cue,index)=>index===1?{...cue,...patch}:cue)};
 expect(savedPromptAudioDiffers(current,saved)).toBe(true);
 expect(savedPromptAudioDiffers(saved,saved)).toBe(false);
});

it("音轨桥只取明确seed或人工人物ID认领，拒绝名称推导及已清除认领", async()=>{
 const {buildManhuaAssetLockRegistry}=await import("./manhuaAssetLockRegistry");
 const anchor={id:"wa_ajing",role:"character" as const,nameZh:"阿菁",lookZh:"",promptZh:""};
 const ref={id:"cust_same_label",role:"character" as const,url:"https://test.invalid/ajing.png",labelZh:"阿菁"};
 const canon={characters:[anchor],locations:[],props:[],episodeMainSceneId:{}};
 // 真实图片锁可以按名称找到图；这种推导不等于明确音轨身份认领。
 expect(buildManhuaAssetLockRegistry({assetCanon:canon,customRefs:[ref]}).byRole.character[0]?.seedLibraryId).toBe(anchor.id);
 const prompt='【第1段·5s】\n0–5s：@角色1说「原句。」\n【资产·Image对照】\n@角色1|id=cust_same_label|label=阿菁|kind=角色';
 expect(()=>createManhuaAudioFromSavedPrompt(prompt,5,resolveSavedPromptAudioCharacters([anchor],[ref]))).toThrow("未唯一绑定");
 const seeded={...ref,seedLibraryId:anchor.id};
 expect(createManhuaAudioFromSavedPrompt(prompt,5,resolveSavedPromptAudioCharacters([anchor],[seeded])).cues[0]?.speakerId).toBe(anchor.id);
 const claimed={...ref,claimSource:"manual" as const,claimedAnchorIds:[anchor.id]};
 expect(createManhuaAudioFromSavedPrompt(prompt,5,resolveSavedPromptAudioCharacters([anchor],[claimed])).cues[0]?.speakerId).toBe(anchor.id);
 expect(()=>createManhuaAudioFromSavedPrompt(prompt,5,resolveSavedPromptAudioCharacters([anchor],[{...seeded,claimSource:"manual",claimedAnchorIds:[]}]))).toThrow("未唯一绑定");
});


it.each([
 '【第1段·5s】\n0–5s：娘说「原句」，其他人无对白。',
 '【第1段·10s】\n0–5s：{对白/娘：0秒开口，“第一句”。}\n5–10s：娘说「第二句」。',
 '【第1段·5s】\n0–5s：对白：原句。其他人无对白。',
])("未支持格式不得静默漏句或借无对白声明清空：%s",prompt=>{
 expect(()=>createManhuaAudioFromSavedPrompt(prompt,10,characters)).toThrow("无法完整读取的对白格式");
});

it("明确无对白稿仍可保留零句，不制造旧分镜对白",()=>{
 expect(createManhuaAudioFromSavedPrompt('【第1段·5s】\n0–5s：人物走过，禁止对白。',5,characters).cues).toEqual([]);
});
