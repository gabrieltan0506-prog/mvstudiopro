import { describe,it,expect,vi } from "vitest";
import {digitalHumanFilmTarget, newDigitalHumanDraft,prepareDigitalHumanVideo,loadDigitalHumanDraft,digitalHumanDraftSchema,digitalHumanAdoptedFilmPrompt} from "./digitalHumanStudio";
import {DIGITAL_HUMAN_DIRECTION_MAX_CHARS, digitalHumanFilmTargetSchema, compileDigitalHumanFilm,parseDigitalHumanFilmPlan,type DigitalHumanFilmPlan} from "./digitalHumanFilmDirector";
import {buildDigitalHumanAdvisorProject} from "../client/src/lib/digitalHumanAdvisor";
import {planDigitalHumanAudioSegments} from "./digitalHumanProduction";
import {buildManhuaCreativeAdvisorLlmMessages} from "../server/services/platformSkillQa";
const id="00000000-0000-4000-8000-000000000001",aid="00000000-0000-4000-8000-000000000002",vid="00000000-0000-4000-8000-000000000003";
function fixture(){
 const d=newDigitalHumanDraft("7",id);d.script="先整理资料。再核对事实。";d.direction="金色多发光弹，透明音波环，接住前短慢动作";d.voiceId="test-voice";
 d.portrait={source:"gs://test-only/p.png",name:"本人"};d.scene={source:"gs://test-only/s.png",name:"书房"};
 d.audios=[{request:{billingRequestId:aid,input:d.script,voice:d.voiceId,speakerZh:"本人",speakerId:"test",voiceStateZh:""},source:"gs://test-only/a.wav",durationSec:12,status:"succeeded"}];d.approvedAudioRequestId=aid;
 const t=digitalHumanFilmTarget(d);
 const shot={expression:"眉心轻收，随后放松",performance:"资料加重，句尾停顿",action:"右手抬起接住金色光弹，手臂卸力",camera:"中景小幅推近，接住前短慢动作",lighting:"左窗柔光，掌心局部金色反射",atmosphere:"紧张转为从容",soundEffect:"掌心接触时短促低鸣，随后结束",visualEffect:"光弹入画空气波，掌心接触脉冲，衣袖局部金色反射",environmentSound:"书房持续低环境声，纸页轻响，切镜连续",voiceMode:"onscreen" as const};
 const plan:DigitalHumanFilmPlan={kind:"digital-human-film",targetId:id,revision:t.revision,summary:"资料归序后核对事实",bgm:"post",subtitles:"off",shots:[{...shot,startSec:0,endSec:6,dialogue:"先整理资料。"},{...shot,startSec:6,endSec:12,dialogue:"再核对事实。"}]};
 return {d,t,plan};
}
describe("数字人成片导演真实数据消费",()=>{
 it("镜内时点不能混入绝对秒数，微调采用恢复后供空间顾问与成片共同消费",()=>{
  const {d,t,plan}=fixture();plan.shots[1].camera="6.5–9秒从中景推近";
  expect(()=>parseDigitalHumanFilmPlan(JSON.stringify(plan),t)).toThrow("本镜0秒");
  plan.shots[1].camera="3–1秒从中景推近";expect(()=>parseDigitalHumanFilmPlan(JSON.stringify(plan),t)).toThrow("倒序");
  plan.shots[1].camera="0.5–3秒从中景推近，85毫米镜头";
  d.filmDirector={target:t,plan:parseDigitalHumanFilmPlan(JSON.stringify(plan),t),adopted:false};
  expect(buildDigitalHumanAdvisorProject(d).context.shotSummary).not.toContain("85毫米");
  expect(()=>prepareDigitalHumanVideo(d,vid)).toThrow("采用");
  d.filmDirector.adopted=true;const restored=loadDigitalHumanDraft(JSON.stringify(d),"7")!;
  expect(prepareDigitalHumanVideo(restored,vid).prompt).toContain("0.5–3秒");
  expect(buildDigitalHumanAdvisorProject(restored).context.shotSummary).toContain("85毫米");
  restored.direction+="调整表演";expect(buildDigitalHumanAdvisorProject(restored).context.shotSummary).not.toContain("85毫米");
 });
 it("顾问系统输入包含完整演法与目标，采用后保存恢复进入视频而非只展示",()=>{
  const {d,t,plan}=fixture();
  const messages=buildManhuaCreativeAdvisorLlmMessages({question:"生成完整导演方案",context:{seriesTitle:"测试",episodeTitle:"本集",episodeIndex:1,stage:"storyboard",videoModel:t.model,writerConfirmed:true,episodeBody:d.script,assetSummary:"本人和书房",shotSummary:d.direction,blockers:[],digitalHumanFilm:t}});
  expect(messages[0].content).toContain("digital-human-film");expect(messages[1].content).toContain(t.revision);expect(messages[1].content).toContain(d.script);
  d.filmDirector={target:t,plan:parseDigitalHumanFilmPlan(JSON.stringify(plan),t),adopted:true};
  const saved=loadDigitalHumanDraft(JSON.stringify(d),"7");if(!saved)throw Error("恢复失败");
  const video=prepareDigitalHumanVideo(saved,vid);expect(video.prompt).toContain("眉心轻收");expect(video.prompt).toContain("左窗柔光");expect(video.prompt).toContain("{先整理资料。}");expect(video.prompt).toContain("(BGM：本次不生成");expect(video.prompt).toContain("[字幕关闭");
  saved.direction+="不戴墨镜";expect(()=>prepareDigitalHumanVideo(saved,vid)).toThrow("版本");
 });
 it("台词不全、镜头重叠和跨分段不能采用；纯口型不冒充表演",()=>{
  const {t,plan}=fixture();const bad=structuredClone(plan);bad.shots[0].dialogue="删改了";expect(()=>parseDigitalHumanFilmPlan(JSON.stringify(bad),t)).toThrow("台词");
  bad.shots=plan.shots;bad.shots[1].startSec=5;expect(()=>parseDigitalHumanFilmPlan(JSON.stringify(bad),t)).toThrow("连续");
 });
 it("Mini按15秒在真实静音切分；Wan编译没有Seedance四标记，模型切换使旧方案过期",()=>{
  const cuts=planDigitalHumanAudioSegments(27,[{start:12,end:13},{start:24,end:25}],15);expect(cuts.every(s=>s.endSec-s.startSec<=15)).toBe(true);expect(cuts.at(-1)?.endSec).toBe(27);
  const {d,t,plan}=fixture();d.filmDirector={target:t,plan,adopted:true};d.filmModel="wan-3.0";expect(()=>digitalHumanAdoptedFilmPrompt(d)).toThrow("版本");
  const prompt=compileDigitalHumanFilm(plan,"wan-3.0");expect(prompt).toContain("音效：");expect(prompt).not.toContain("{先整理");expect(prompt).not.toContain("[字幕");
  d.filmModel="seedance-2.0-mini";d.audios[0].durationSec=16;expect(()=>digitalHumanFilmTarget(d)).toThrow("15秒");
 });
 it("完整长导演文字保存恢复不截断，并穿过顾问真实输入和三模型分段生成",()=>{
  const {d}=fixture();d.direction="环境底声与表演要求。".repeat(700)+"结尾保留窗外远声与人物嘴角放松";
  expect(d.direction.length).toBeGreaterThan(6000);
  const restored=loadDigitalHumanDraft(JSON.stringify(d),"7")!;expect(restored.direction).toBe(d.direction);
  const target=digitalHumanFilmTarget(restored);expect(digitalHumanFilmTargetSchema.parse(target).direction).toBe(d.direction);
  const project=buildDigitalHumanAdvisorProject(restored);
  expect(project.context.digitalHumanProduction?.direction).toBe(d.direction);
  const messages=buildManhuaCreativeAdvisorLlmMessages({question:"安排完整动作",context:project.context});
  expect(messages[1].content).toContain(d.direction);
  expect(prepareDigitalHumanVideo(restored,vid).prompt).toContain(d.direction);
  expect(()=>digitalHumanDraftSchema.parse({...d,direction:"长".repeat(DIGITAL_HUMAN_DIRECTION_MAX_CHARS+1)})).toThrow();
 });
 it("特效和环境底声从采用保存到空间顾问和真实生成提示词，并按段保留",()=>{
  const {d,t,plan}=fixture();plan.shots[1].voiceMode="narration";
  d.filmDirector={target:t,plan:parseDigitalHumanFilmPlan(JSON.stringify(plan),t),adopted:true};
  const saved=loadDigitalHumanDraft(JSON.stringify(d),"7")!;
  const context=buildDigitalHumanAdvisorProject(saved).context;
  expect(context.digitalHumanProduction?.adoptedPlan?.shots[0].visualEffect).toContain("空气波");
  const messages=buildManhuaCreativeAdvisorLlmMessages({question:"按已采用导演方案调机位",context});
  expect(messages[1].content).toContain("衣袖局部金色反射");expect(messages[1].content).toContain("切镜连续");
  for(const model of ["seedance-2.5","seedance-2.0-mini","wan-3.0"] as const){
    const compiled=compileDigitalHumanFilm(plan,model,6,12);
    expect(compiled).toContain("视觉特效：光弹入画空气波");expect(compiled).toContain("环境底声");
    expect(compiled).toContain("旁白");expect(compiled).not.toContain("{先整理资料。}");
  }
  expect(prepareDigitalHumanVideo(saved,vid).prompt).toContain("书房持续低环境声");
  const absent=structuredClone(plan);delete absent.shots[0].environmentSound;
  expect(()=>parseDigitalHumanFilmPlan(JSON.stringify(absent),t)).toThrow("环境底声");
  absent.shots[0].environmentSound="TODO";expect(()=>parseDigitalHumanFilmPlan(JSON.stringify(absent),t)).toThrow("实际演法");
  absent.shots[0].environmentSound="9秒播放房间底声";expect(()=>parseDigitalHumanFilmPlan(JSON.stringify(absent),t)).toThrow("本镜0秒");
 });

});


describe("完整导演合同的云稿与旧稿恢复", () => {
 it("20000字与逐镜新字段经真实云稿序列化函数往返，存储替身禁止外部访问", async () => {
  const { readDigitalHumanCloudDraft, writeDigitalHumanCloudDraft } = await import("../server/services/digitalHumanDraftStore");
  const { d, plan } = fixture();
  d.direction = "长".repeat(19996) + "末尾保留";
  const target = digitalHumanFilmTarget(d);
  plan.revision = target.revision;
  d.filmDirector = { target, plan, adopted: true };
  let stored: Buffer = Buffer.alloc(0);
  const write = vi.fn(async (input: { buffer: Buffer }) => { stored = input.buffer; return { generation: "12", bucket: "test-only", objectName: "draft.json", gcsUri: "gs://test-only/draft.json" }; });
  const read = vi.fn(async () => ({ buffer: stored, generation: "12", bucket: "test-only", objectName: "draft.json" }));
  const deps = { read, write } as Parameters<typeof writeDigitalHumanCloudDraft>[3];
  await writeDigitalHumanCloudDraft(7, d, "11", deps);
  const saved = (await readDigitalHumanCloudDraft(7, deps)).draft!;
  expect(saved.direction).toBe(d.direction);
  expect(saved.filmDirector).toEqual(d.filmDirector);
  const prompt = prepareDigitalHumanVideo(saved, vid).prompt;
  expect(prompt).toContain(d.direction);
  expect(prompt).toContain(plan.shots[0].visualEffect);
  expect(prompt).toContain(plan.shots[0].environmentSound);
  expect(write).toHaveBeenCalledTimes(1);
 });
 it("旧方案无新字段仍可恢复但不能冒充新版已采用方案", () => {
  const { d, t, plan } = fixture();
  delete t.productionVersion;
  t.revision = "legacy-revision";
  plan.revision = t.revision;
  for (const shot of plan.shots) { delete shot.visualEffect; delete shot.environmentSound; }
  d.filmDirector = { target: t, plan, adopted: true };
  const saved = loadDigitalHumanDraft(JSON.stringify(d), "7")!;
  expect(saved.filmDirector?.plan).toEqual(plan);
  expect(() => prepareDigitalHumanVideo(saved, vid)).toThrow("版本");
  expect(buildDigitalHumanAdvisorProject(saved).context.digitalHumanProduction?.adoptedPlan).toBeUndefined();
 });
});
