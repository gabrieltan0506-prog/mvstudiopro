import { describe,it,expect } from "vitest";
import {digitalHumanFilmTarget, newDigitalHumanDraft,prepareDigitalHumanVideo,loadDigitalHumanDraft,digitalHumanAdoptedFilmPrompt} from "./digitalHumanStudio";
import {compileDigitalHumanFilm,parseDigitalHumanFilmPlan,type DigitalHumanFilmPlan} from "./digitalHumanFilmDirector";
import {buildDigitalHumanAdvisorProject} from "../client/src/lib/digitalHumanAdvisor";
import {planDigitalHumanAudioSegments} from "./digitalHumanProduction";
import {buildManhuaCreativeAdvisorLlmMessages} from "../server/services/platformSkillQa";
const id="00000000-0000-4000-8000-000000000001",aid="00000000-0000-4000-8000-000000000002",vid="00000000-0000-4000-8000-000000000003";
function fixture(){
 const d=newDigitalHumanDraft("7",id);d.script="先整理资料。再核对事实。";d.direction="金色多发光弹，透明音波环，接住前短慢动作";d.voiceId="test-voice";
 d.portrait={source:"gs://test-only/p.png",name:"本人"};d.scene={source:"gs://test-only/s.png",name:"书房"};
 d.audios=[{request:{billingRequestId:aid,input:d.script,voice:d.voiceId,speakerZh:"本人",speakerId:"test",voiceStateZh:""},source:"gs://test-only/a.wav",durationSec:12,status:"succeeded"}];d.approvedAudioRequestId=aid;
 const t=digitalHumanFilmTarget(d);
 const shot={expression:"眉心轻收，随后放松",performance:"资料加重，句尾停顿",action:"右手抬起接住金色光弹，手臂卸力",camera:"中景小幅推近，接住前短慢动作",lighting:"左窗柔光，掌心局部金色反射",atmosphere:"紧张转为从容",soundEffect:"掌心接触时短促低鸣，随后结束",voiceMode:"onscreen" as const};
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
});
