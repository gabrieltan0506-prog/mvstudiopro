import { describe, expect, it } from "vitest";
import {
  compileManhuaDialogueTtsPlan,
  defaultVoiceForSpeakerTag,
  inferQwenEmotionTags,
  mergeManhuaDialogueTtsLinesByVoice,
} from "./manhuaDialogueTtsCompile";

const SAMPLE = [
  "【第 1 段/共 4 段】",
  "0–5s：@角色2 抬头，眼眶发红，说「爹——」。近景微推。",
  "6-12s：@角色1 沉声说「认错人不要紧」。低机位仰拍。",
  "13–18s：@角色2 咬牙，说「我没有认错」。手持晃动。",
  "20–28s：@角色1 缓缓说「别认错东西」。",
].join("\n");

describe("compileManhuaDialogueTtsPlan", () => {
  it("按秒轴逐句抽说话人/台词，台词一字不差且不带标签", () => {
    const plan = compileManhuaDialogueTtsPlan(SAMPLE);
    expect(plan).toHaveLength(4);
    expect(plan[0]).toMatchObject({
      startSec: 0,
      endSec: 5,
      speakerTag: "@角色2",
      dialogueZh: "爹——",
    });
    expect(plan[1]!.dialogueZh).toBe("认错人不要紧");
    // en-dash 与连字符两种秒轴写法都要认
    expect(plan[1]!.startSec).toBe(6);
  });

  it("从微表情/动作词推情绪控制标签并拼进 input", () => {
    const plan = compileManhuaDialogueTtsPlan(SAMPLE);
    expect(plan[0]!.emotionTags).toContain("[crying]");
    expect(plan[0]!.input).toBe("[crying]爹——");
    expect(plan[1]!.emotionTags).toContain("[serious]");
    expect(plan[3]!.emotionTags).toContain("[very slowly]");
  });

  it("默认音色奇女偶男轮换，voiceByTag 可覆盖", () => {
    expect(defaultVoiceForSpeakerTag("@角色1")).toBe("longanlingxin");
    expect(defaultVoiceForSpeakerTag("@角色2")).toBe("longanlufeng");
    const plan = compileManhuaDialogueTtsPlan(SAMPLE, {
      voiceByTag: { "@角色2": "cloned-grandpa-01" },
    });
    expect(plan[0]!.voice).toBe("cloned-grandpa-01");
    expect(plan[1]!.voice).toBe("longanlingxin");
  });

  it("纯动作段（无对白行）返回空数组", () => {
    expect(compileManhuaDialogueTtsPlan("0–5s：篝火渐弱，无人说话。远景。")).toEqual([]);
    expect(compileManhuaDialogueTtsPlan(null)).toEqual([]);
  });

  it("情绪最多两个，按规则优先级取", () => {
    const tags = inferQwenEmotionTags("她眼眶泛泪，咬牙怒吼，随后惊愕");
    expect(tags).toHaveLength(2);
    expect(tags[0]).toBe("[crying]");
    expect(tags[1]).toBe("[angry]");
  });
});

describe("mergeManhuaDialogueTtsLinesByVoice", () => {
  it("同音色连续句合并、跨音色切开，秒位跨度保留", () => {
    const plan = compileManhuaDialogueTtsPlan(SAMPLE);
    const merged = mergeManhuaDialogueTtsLinesByVoice(plan);
    // 男(段1)→女(段2)→男(段3)→女(段4)：无连续同音色，保持 4 组
    expect(merged).toHaveLength(4);
    const sameVoice = compileManhuaDialogueTtsPlan(SAMPLE, {
      voiceByTag: { "@角色1": "longanlufeng", "@角色2": "longanlufeng" },
    });
    const mergedOne = mergeManhuaDialogueTtsLinesByVoice(sameVoice);
    // 秒轴 5→6、12→13、18→20 都有明确停顿；即使音色相同也不能吞掉换气。
    expect(mergedOne).toHaveLength(4);
    expect(mergedOne.map((item) => item.input)).toEqual([
      "[crying]爹——", "[serious]认错人不要紧", "[angry]我没有认错", "[very slowly]别认错东西",
    ]);
    expect(mergedOne[0]!.startSec).toBe(0);
    expect(mergedOne[3]!.endSec).toBe(28);
  });

  it("无标签句不并进带标签的组——前句情绪不许管到后句", () => {
    const withPlainTail = compileManhuaDialogueTtsPlan(
      SAMPLE + "\n29–30s：@角色1 说「嗯」。定格。",
      { voiceByTag: { "@角色1": "longanlufeng", "@角色2": "longanlufeng" } },
    );
    expect(withPlainTail).toHaveLength(5);
    expect(withPlainTail[4]!.emotionTags).toEqual([]);
    const merged = mergeManhuaDialogueTtsLinesByVoice(withPlainTail);
    expect(merged).toHaveLength(5);
    expect(merged[4]!.input).toBe("嗯");
  });

  it("时间真正连续的同音色句仍可合并", () => {
    const plan = compileManhuaDialogueTtsPlan(
      "0–1s：@角色1 沉声说「先走」。\n1–2s：@角色2 咬牙说「我断后」。",
      { voiceByTag: { "@角色1": "same", "@角色2": "same" } },
    );
    const merged = mergeManhuaDialogueTtsLinesByVoice(plan);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ startSec: 0, endSec: 2, input: "[serious]先走。[angry]我断后" });
  });
});
