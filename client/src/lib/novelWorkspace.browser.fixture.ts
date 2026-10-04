export const novelMockTransport = `
import { parseNovelModelJson } from "@shared/novelJson";
import { novelChapterSchema } from "@shared/novelWorkspace";
const cards=Array.from({length:6},(_,i)=>({publicId:'mt_000'+i,nameZh:'模板'+(i+1),featureZh:'人物冲突与对白',introZh:'有代价的抉择',methodBrief:{title:'封闭空间里的声音变化',highlights:['局部火光与门外脚步制造逼近感。','低声回应后留白，使交换条件的分量被听见。'],useWhen:'适合受限空间中的对峙。'},classificationTagsZh:[],craft:{version:1,features:[i%2?{id:'verbal-tactics',dimension:'dialogue',label:'对白试探与攻防'}:{id:'music-turn',dimension:'sound',label:'音乐推动剧情转折'}]}}));
globalThis.calls=[];globalThis.receipts={};globalThis.backups=[];globalThis.recoveryFixtures=[];
globalThis.readDraft=async()=>new Promise((resolve,reject)=>{const r=indexedDB.open('mv-novel-workspaces',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('drafts','readonly'),q=tx.objectStore('drafts').get('mv-novel-lab-v2:1');tx.oncomplete=()=>{resolve(JSON.parse(q.result));db.close()};tx.onerror=()=>reject(tx.error)}});
globalThis.writeDraft=async state=>new Promise((resolve,reject)=>{const r=indexedDB.open('mv-novel-workspaces',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(JSON.stringify(state),'mv-novel-lab-v2:1');tx.oncomplete=()=>{resolve();db.close()};tx.onerror=()=>reject(tx.error)}});
globalThis.archives=async()=>new Promise(resolve=>{const r=indexedDB.open('mv-novel-workspaces',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('drafts','readonly'),q=tx.objectStore('drafts').getAllKeys();tx.oncomplete=()=>{resolve(q.result.some(k=>k.includes(':archive:')));db.close()}}});
const generate=async input=>{
 globalThis.calls.push(input);if(input.stage==='chapter'&&input.chapterIndex===2&&globalThis.deferChapter)await new Promise(resolve=>{globalThis.releaseChapter=resolve});let value;
 if(input.stage==='advice')value={assessment:'先确定主角代价，前三集逐次兑现冲突。',recommendations:cards.filter(c=>!input.selectedTemplateIds.includes(c.publicId)).slice(0,3).map(c=>({publicId:c.publicId,reason:'强化角色抉择',tradeoff:'减少支线'}))};
 if(input.advisorIntent==='story_variants')value={assessment:'三个不同因果走向',recommendations:[],variants:['A','B','C'].map(id=>({id,title:'故事'+id,changeSummary:'选择不同的救城方式'+id,tradeoff:'承担不同代价',templates:input.templates,outline:{premise:'补天需要代价'+id,characters:'女娲与守火人',episodes:Array.from({length:input.episodeCount},(_,i)=>({index:(input.episodeStart||1)+i,title:'第'+(i+1)+'集',events:'主角作出选择'+id,hook:'新的代价',payoff:'救下一城'}))}}))};
 if(input.stage==='outline')value={premise:'补天需要代价',characters:'女娲与守火人',episodes:Array.from({length:input.episodeCount},(_,i)=>({index:(input.episodeStart||1)+i,title:'第'+(i+1)+'集',events:'主角作出选择',hook:'新的代价',payoff:'救下一城'}))};
 if(input.stage==='chapter')value={title:'第'+input.chapterIndex+'章',text:'女娲望着破裂的天空，决定留下来。'.repeat(40),notes:'测试生成，非真实模型结果',continuity:'女娲与守火人共同守城，身份与伏笔保持；已写到第'+input.chapterIndex+'集'};
 if(input.stage==='script')value={title:'补天',applications:input.templates.map(t=>({publicId:t.publicId,method:'选择带来代价',adaptation:'让守火人通过留下来承担救城的代价。',sceneKeys:['E'+(input.episodeStart||1)+'-S1']})),episodes:Array.from({length:input.episodeCount},(_,i)=>({index:(input.episodeStart||1)+i,title:'补天',opening:'天裂',payoff:'救人',hook:'余烬',scenes:[{key:'E'+((input.episodeStart||1)+i)+'-S1',场景:'共同场景。'+(input.templates[0].publicId==='mt_0000'?'雪落城头。':'雨落城头。'),人物:'女娲与守火人。',妆容:'灰衣。',灯光:'火光。',氛围:'紧张。',对白:'女娲说：“把孩子先带出去，我来守住这里。”'}]}))};
 const result={model:input.modelPreference==='deepseek'?'deepseek/deepseek-v4.1-flash':'z-ai/glm-5.3-flashx',requestId:input.requestId,stage:input.stage,text:JSON.stringify(value),templateIds:input.templates.map(t=>t.publicId),inputSha256:'a'.repeat(64),resultSha256:'b'.repeat(64)};if(input.stage==='chapter'&&input.chapterIndex===globalThis.failChapter){globalThis.failChapter=undefined;globalThis.recoveryFixtures.push({input,result,raw:result.text.replace(/}$/,",}")});globalThis.receipts[input.requestId]={status:'failed'};throw new Error('模拟格式错误，原稿保留');}globalThis.receipts[input.requestId]=result;return result;
};
export const trpc={manhuaViralTemplate:{listApprovedPublic:{useQuery:()=>({data:{groups:[{items:cards}]},isLoading:false,isError:false,refetch:async()=>{globalThis.templateRefreshes=(globalThis.templateRefreshes||0)+1;return{};}})}},novelWorkspace:{backup:{useMutation:()=>({mutateAsync:async({workspaceJson})=>{const d=JSON.parse(workspaceJson);const row={backupId:crypto.randomUUID(),roundId:d.roundId,title:d.topic,season:d.season||1,createdAt:new Date().toISOString(),bytes:workspaceJson.length,sha256:'mock',workspaceJson};globalThis.backups.push(row);return row}})},listBackups:{useQuery:()=>({data:globalThis.backups,refetch:async()=>({data:globalThis.backups})})},generate:{useMutation:()=>({mutateAsync:generate})},recoverSavedChapter:{useMutation:()=>({mutateAsync:async({requestId})=>{const row=globalThis.recoveryFixtures.find(r=>r.input.requestId===requestId);if(!row)throw new Error('missing');const result=row.raw?{...row.result,text:JSON.stringify(novelChapterSchema.parse(parseNovelModelJson(row.raw).value))}:row.result;globalThis.receipts[requestId]=result;return result}})},recoverableChapters:{useQuery:()=>({data:globalThis.recoveryFixtures.map(r=>r.input)})}},useUtils:()=>({manhuaCloudDraft:{get:{fetch:async()=>({draft:null,serverUpdatedAt:null})}},novelWorkspace:{savedRaw:{fetch:async({requestId})=>{const r=globalThis.recoveryFixtures.find(r=>r.input.requestId===requestId);return {requestId,text:r.raw||r.result.text,sha256:'mock'}}},readBackup:{fetch:async({backupId})=>{const row=globalThis.backups.find(r=>r.backupId===backupId);return {metadata:row,workspaceJson:row.workspaceJson}}},receipt:{fetch:async({requestId})=>globalThis.receipts[requestId]?.status?globalThis.receipts[requestId]:({status:globalThis.receipts[requestId]?'succeeded':'not_found',result:globalThis.receipts[requestId]})}}})};
`;

/** Page-object navigation for the stepped studio; does not generate or change data. */
export async function showNovelStep(
  page: import("puppeteer").Page,
  step: "prepare" | "templates" | "novel" | "scripts"
) {
  await page.waitForSelector(`[data-novel-step="${step}"]`);
  await page.$eval(`[data-novel-step="${step}"]`, el =>
    (el as HTMLButtonElement).click()
  );
}
export async function showNovelTools(page: import("puppeteer").Page) {
  await page.waitForSelector("[data-novel-studio]");
  if (!(await page.$('section[aria-label="备份与设置"]')))
    await page.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent?.trim() === "备份与设置")!
        .click()
    );
  await page.$$eval('section[aria-label="备份与设置"] details', els =>
    els.forEach(el => ((el as HTMLDetailsElement).open = true))
  );
}
export async function prepareNovelAction(
  page: import("puppeteer").Page,
  label: string
) {
  if (
    /^(请创作顾问|发送给顾问|按新方向|生成3个故事|采用这条|生成本批续写|确认大纲|恢复此版本)/.test(
      label
    )
  )
    await showNovelStep(page, "prepare");
  if (label === "刷新模板库") await showNovelStep(page, "templates");
  if (/^(确认这版小说|生成本批未写|审阅通过)/.test(label))
    await showNovelStep(page, "novel");
  if (/^(单独生成|按分工组合生成)/.test(label)) {
    await showNovelStep(page, "scripts");
    await page.$eval(
      ".novel-script-generation",
      el => ((el as HTMLDetailsElement).open = true)
    );
  }
  if (
    /^(云端备份|回填备份|回填这一份|放弃本轮|开始下一季|切回此季)/.test(label)
  )
    await showNovelTools(page);
  if (label.startsWith("单独生成 · 模板")) {
    const index = Number(label.replace("单独生成 · 模板", "")) - 1;
    return await page.$eval(`[data-script-template="mt_000${index}"]`, el =>
      el.textContent!.trim()
    );
  }
  return label;
}
