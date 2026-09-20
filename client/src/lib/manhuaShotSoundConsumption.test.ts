import { recordManhuaKeyartLookOutput } from "@shared/manhuaKeyartLookState";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { previewCanvasBlockOutbound } from "./canvasRunBlock";
import { describe, expect, it, vi } from "vitest";
import { readManhuaTimedStoryboard } from "@shared/manhuaTimedStoryboard";
import { parseWorkbenchShotsFromText, groupShotsIntoSegments, formatWorkbenchSegmentClipInjectBlock, formatWorkbenchShotInjectBlock, recutWorkbenchShotsTo } from "@shared/manhuaScriptWorkbench";
import { compileManhuaDialogueTtsPlan } from "@shared/manhuaDialogueTtsCompile";
import { buildManhuaDialogueTimelineBeats } from "@shared/manhuaClipDialogueTimeline";
import { buildManhuaAutoSegmentBinding } from "@shared/manhuaAutoSegment";
import { prepareManhuaFactoryClipInput, spawnManhuaDramaStudio, expandManhuaShotKeyartsAfterReverse, ensureManhuaFragmentClips, queuedManhuaClipBlocks } from "./canvasDramaStudio";
const model="seedance-2.0-mini";
const header="|镜号|约时码|景别|角度|运镜|灯光|构图|主体动作|音频|转场/卡点|时长建议|\n|---|---|---|---|---|---|---|---|---|---|---|";
const row=(id:number,time:string,duration:number,audio:string)=>`|${id}|${time}|中景|平视|跟拍|晨光|街巷|甲背娘缓慢走过石板路|${audio}|直切|${duration}s|`;
const text=(sound="咳喘、脚步")=>header+"\n"+row(1,"0:00",4,`娘：「慢点。」＋${sound}`)+"\n"+row(2,"0:04",3,"无对白＋配乐：低弦渐弱");
const prompt=(shots:ReturnType<typeof parseWorkbenchShotsFromText>,durationSec=7)=>formatWorkbenchSegmentClipInjectBlock({segmentIndex:1,durationSec,shots,speakerTagByNameZh:{娘:"@角色1"},segmentDialogueLines:shots.map(s=>s.dialogueZh||"").filter(Boolean)});
describe("反推独立声音的真实成片消费",()=>{
 it("无声音旧稿不增加音轨块或改变派生源身份",()=>{
  const plain=header+"\n"+row(1,"0:00",4,'娘：「慢点。」')+"\n"+row(2,"0:04",3,'无对白');
  const shots=parseWorkbenchShotsFromText(plain);expect(shots.every(s=>!("soundZh" in s))).toBe(true);
  expect(prompt(shots)).not.toContain("【原稿声音指示】");
  const copy=shots.map(s=>{const {soundZh,...rest}=s;return rest;});expect(prompt(shots)).toBe(prompt(copy));
  expect(buildManhuaAutoSegmentBinding(1,groupShotsIntoSegments(shots,{videoModel:model})[0],model)).toEqual(buildManhuaAutoSegmentBinding(1,groupShotsIntoSegments(copy,{videoModel:model})[0],model));
 });
 it("reader声音进入shot与段prompt，台词/TTS/静帧保持隔离",()=>{
  expect(readManhuaTimedStoryboard(text()).errors).toEqual([]);
  const shots=parseWorkbenchShotsFromText(text());
  expect(shots[0]).toMatchObject({soundZh:"咳喘、脚步"});
  const out=prompt(shots);expect(out).toContain("【原稿声音指示】");expect(out).toContain("咳喘、脚步");expect(out).toContain("低弦渐弱");
  expect(buildManhuaDialogueTimelineBeats(shots,7).map(b=>b.dialogueZh).join(" ")).not.toMatch(/咳喘|脚步|低弦/);
  expect(compileManhuaDialogueTtsPlan(out).map(l=>l.dialogueZh)).toEqual(["慢点。"]);
  expect(shots.map(formatWorkbenchShotInjectBlock).join("\n")).not.toMatch(/咳喘|脚步|低弦/);
 });
 it("无对白拟声与长镜窗口保留声音上下文，不强制每窗重复瞬态",()=>{
  const raw=header+"\n"+row(1,"0:00",18,'无对白＋「咯」一声、雨声不断')+"\n"+row(2,"0:18",3,'无对白＋配乐：停');
  const segments=groupShotsIntoSegments(parseWorkbenchShotsFromText(raw),{videoModel:model});
  const long=segments.filter(s=>s.shots.some(sh=>sh.index===1));expect(long).toHaveLength(2);
  for(const segment of long){const out=prompt(segment.shots,segment.durationSec);expect(out).toContain('「咯」一声、雨声不断');expect(out).toContain('仅在本窗口实际发生');expect(compileManhuaDialogueTtsPlan(out)).toEqual([]);}
  expect(prompt(long[1].shots,long[1].durationSec)).toContain('原镜内9–18秒');
 });
 it("合镜保留各声音，声音单独修改使同镜号同秒数源版本改变",()=>{
  const a=parseWorkbenchShotsFromText(text()),b=parseWorkbenchShotsFromText(text("铃响、脚步"));
  const merged=recutWorkbenchShotsTo(a,1).shots;expect(prompt(merged)).toContain("咳喘、脚步");expect(prompt(merged)).toContain("低弦渐弱");
  const sa=groupShotsIntoSegments(a,{videoModel:model})[0],sb=groupShotsIntoSegments(b,{videoModel:model})[0];
  expect(buildManhuaAutoSegmentBinding(1,sa,model).revision).not.toBe(buildManhuaAutoSegmentBinding(1,sb,model).revision);
 });
 it("真实expand→ensure成片prompt消费，改音效旧段归档不复用旧视频",async()=>{
  const spawned=spawnManhuaDramaStudio({topic:"街巷",episodeIndex:1,videoModel:model});const reverse=spawned.blocks.find(b=>b.id.startsWith("reverse-"))!;
  const expanded=expandManhuaShotKeyartsAfterReverse(spawned.blocks.map(b=>b.id===reverse.id?{...b,status:"done" as const,outputText:text()}:b),spawned.edges,reverse.id,{videoModel:model});
  expect(expanded.blocks.filter(b=>b.id.startsWith("keyart-")).map(b=>b.prompt).join("\n")).not.toMatch(/咳喘|低弦渐弱/);
  const first=ensureManhuaFragmentClips(expanded.blocks.map(b=>b.id.startsWith("keyart-")?{...b,status:"done" as const,outputUrl:`https://test.invalid/${b.id}.jpg`,manhuaKeyartLookState:recordManhuaKeyartLookOutput(b,`https://test.invalid/${b.id}.jpg`),manhuaKeyartSourceState:recordManhuaKeyartLookOutput({manhuaKeyartLookState:b.manhuaKeyartSourceState},`https://test.invalid/${b.id}.jpg`)}:b),expanded.edges,1,{videoModel:model});const clip=queuedManhuaClipBlocks(first.blocks,1,model)[0];
  expect(clip.prompt).toContain("咳喘、脚步");expect(clip.prompt).toContain("低弦渐弱");
  const noNetwork=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("声音消费探针禁止网络"));
  let outbound:unknown;
  try {
    const prepared=await prepareManhuaFactoryClipInput({blocks:first.blocks,edges:first.edges,blockId:clip.id,fallbackBlock:clip,stage:"clip",episodeIndex:1,preparedVideoEdit:false});
    const preview=await previewCanvasBlockOutbound({userRole:"admin",userId:"test-user",optimizeCopy:async()=>""},prepared.preparedBlock,prepared.upstream);
    expect(preview.compile.blocked).toBe(false);
    expect(JSON.stringify(preview.body)).toContain("咳喘、脚步");expect(JSON.stringify(preview.body)).toContain("低弦渐弱");
    expect(noNetwork).not.toHaveBeenCalled();outbound=preview;
  } finally { noNetwork.mockRestore(); }

  const next=ensureManhuaFragmentClips(first.blocks.map(b=>b.id===reverse.id?{...b,outputText:text("铃响、脚步")}:b.id===clip.id?{...b,outputUrl:"https://test.invalid/old.mp4",outputUrls:["https://test.invalid/old.mp4"]}:b),first.edges,1,{videoModel:model});
  const current=queuedManhuaClipBlocks(next.blocks,1,model)[0];expect(current.manhuaAutoSegment?.revision).not.toBe(clip.manhuaAutoSegment?.revision);expect(current.prompt).toContain("铃响、脚步");expect(current.outputUrl).not.toBe("https://test.invalid/old.mp4");expect(next.blocks.find(b=>b.id===clip.id)).toMatchObject({archivedFromPreviousScript:true,outputUrl:"https://test.invalid/old.mp4"});
  const dir=process.env.MANHUA_SOUND_EVIDENCE_DIR;
  if(dir){mkdirSync(dir,{recursive:true});writeFileSync(join(dir,"actual-consumption.json"),JSON.stringify({reader:readManhuaTimedStoryboard(text()),shots:parseWorkbenchShotsFromText(text()),oldClip:clip,newClip:current,archived:next.blocks.find(b=>b.id===clip.id),outbound},null,2));}

 });
});
