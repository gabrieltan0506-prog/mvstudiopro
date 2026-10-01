import { describe, it, expect } from "vitest";
import { bgmNarrativeMixSchema, compileBgmNarrativeMix } from "./manhuaBgmNarrativeMix";
import { bgmMountParamsSchema, isSafePostProdVolumeExpr } from "../server/jobs/postProdInput";
import { buildBgmFilterPlan } from "../server/services/postProduction";

const cue = {startSec:3,endSec:8,gainStart:0.25,gainEnd:0.7,role:"支持表演" as const,noteZh:"眼神从担心转为决意，音乐补充对白"};
describe("声音技能执行契约",()=>{
  it("叙事强弱工作单穿过任务契约，进入实际滤镜；默认不自动退让",()=>{
    const params=bgmMountParamsSchema.parse({videoUri:"gs://test/video.mp4",bgmUri:"gs://test/music.wav",entrySec:3,bgmDurationSec:10,bgmVolume:0.25,duckUnderDialogue:false,narrativeMix:[cue]});
    expect(params.narrativeMix?.[0].noteZh).toBe(cue.noteZh);
    const expression=compileBgmNarrativeMix([cue],0.25);
    expect(expression).toBe("if(between(t,3,8),0.25+(0.7-0.25)*(t-3)/5,0.25)");
    expect(isSafePostProdVolumeExpr(expression)).toBe(true);
    const plan=buildBgmFilterPlan(params,{durationSec:29,hasAudio:true});
    expect(plan.filterGraph).toContain(`volume='${expression}':eval=frame`);
    expect(plan.filterGraph).not.toContain("sidechaincompress");
  });
  it("保留已采用留白，在新增音乐强弱段之外沿用原参数",()=>{
    const fallback="if(between(t,9,10),0,0.25)";
    expect(compileBgmNarrativeMix([cue],0.25,fallback)).toContain(fallback);
    expect(compileBgmNarrativeMix([{...cue,role:"留白",gainStart:0,gainEnd:0}],0.25)).toBe("if(between(t,3,8),0,0.25)");
  });
  it("重叠、越界、零长度和假留白都在建单或执行前拒绝",()=>{
    expect(bgmNarrativeMixSchema.safeParse([cue,{...cue,startSec:7,endSec:9}]).success).toBe(false);
    expect(bgmNarrativeMixSchema.safeParse([{...cue,endSec:3}]).success).toBe(false);
    expect(bgmNarrativeMixSchema.safeParse([{...cue,role:"留白"}]).success).toBe(false);
    expect(()=>buildBgmFilterPlan({videoUri:"gs://test/video.mp4",bgmUri:"gs://test/music.wav",entrySec:4,narrativeMix:[cue]}, {durationSec:29,hasAudio:true})).toThrow("进出窗口");
  });
  it("说明文字不进入可执行表达式，不自动变速或猜测听感",()=>{
    const malicious={...cue,noteZh:"[x];volume=9"};
    const expression=compileBgmNarrativeMix([malicious],0.25);
    expect(expression).not.toContain("volume=9");
    expect(isSafePostProdVolumeExpr(expression)).toBe(true);
  });
});
