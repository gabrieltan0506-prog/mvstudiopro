import { describe, expect, it } from "vitest";
import { buildManhuaEpisodeSegmentPlanFixtureMarkdown, parseManhuaEpisodeSegmentPlanFromMarkdown } from "./manhuaEpisodeSegmentPlan";
import {
  formatManhuaEpisodeSegmentPlanMarkdown,
  packManhuaSegmentRefsForEngine,
  relayoutManhuaSegmentPlanForEngine,
  replaceManhuaEpisodeSegmentPlanInMarkdown,
} from "./manhuaEngineRelayout";

/** 每段三句互不重复的对白（解析器对段内重复句去重，夹具不能用重复句测保序） */
function uniquePlanMarkdown(): string {
  const scenes = ["临水坊市", "临水坊市", "巷子", "长明医馆", "医馆后院", "河滩"];
  const blocks = scenes.map((scene, i) => {
    const n = String(i + 1).padStart(2, "0");
    return [
      `#### 段${n}`,
      `- 意图：第${i + 1}段意图`,
      `- 对白：`,
      `  - 阿菁：「第${i + 1}段第一句。」`,
      `  - 曹三：「第${i + 1}段第二句！」`,
      `  - 墨屠：「第${i + 1}段第三句？」`,
      `- 表演：阿菁攥拳；曹三冷笑；墨屠低头`,
      `- 场景：${scene}`,
      `- 配色风格：青灰`,
      `- 角色：阿菁；曹三；墨屠`,
      `- 服装道具：粗布衣；赭红短打`,
      `- 光影运镜：过肩中景；反应特写`,
    ].join("\n");
  });
  return ["### 五至六段可拍表", ...blocks].join("\n");
}
const plan6 = parseManhuaEpisodeSegmentPlanFromMarkdown(uniquePlanMarkdown());
const fixture6 = parseManhuaEpisodeSegmentPlanFromMarkdown(buildManhuaEpisodeSegmentPlanFixtureMarkdown());

describe("双引擎重铺", () => {
  it("15s→30s：6 段并 3 段，对白句集合不变、顺序不变；场景不同时写 A → B", () => {
    const r = relayoutManhuaSegmentPlanForEngine(plan6, { fromDurationSec: 15, toDurationSec: 30, toSegmentMax: 4 });
    expect(r.mode).toBe("merge");
    expect(r.plan.segments.length).toBe(3);
    expect(r.dialoguePreserved).toBe(true);
    expect(r.plan.segments[0]!.sceneZh).toBe("临水坊市");
    expect(r.plan.segments[1]!.sceneZh).toBe("巷子 → 长明医馆");
    expect(r.plan.segments[0]!.castZh).toBe("阿菁；曹三；墨屠");
    expect(r.plan.segments[0]!.dialogueZh.split("\n").length).toBe(6);
    // 夹具里有重复句：集合仍一致
    expect(relayoutManhuaSegmentPlanForEngine(fixture6, { fromDurationSec: 15, toDurationSec: 30 }).dialoguePreserved).toBe(true);
    expect(r.plan.durationSecPerSegment).toBe(30);
    expect(r.notesZh.join("")).toContain("6 段×15s → 3 段×30s");
  });

  it("30s→15s：拆回 6 段，对白句集合不变；来回一次后句子顺序与原稿一致", () => {
    const merged = relayoutManhuaSegmentPlanForEngine(plan6, { fromDurationSec: 15, toDurationSec: 30 }).plan;
    const back = relayoutManhuaSegmentPlanForEngine(merged, { fromDurationSec: 30, toDurationSec: 15 });
    expect(back.mode).toBe("split");
    expect(back.plan.segments.length).toBe(6);
    expect(back.dialoguePreserved).toBe(true);
    const orig = plan6.segments.flatMap((s) => s.dialogueZh).join("|");
    const round = back.plan.segments.flatMap((s) => s.dialogueZh).join("|");
    expect(round.replace(/\s/g, "")).toBe(orig.replace(/\s/g, ""));
    expect(back.plan.segments.map((s) => s.sceneZh)).toEqual(["临水坊市", "临水坊市", "巷子", "长明医馆", "医馆后院", "河滩"]);
  });

  it("段长相同不重铺；超过引擎段数上限给提示", () => {
    expect(relayoutManhuaSegmentPlanForEngine(plan6, { fromDurationSec: 15, toDurationSec: 15 }).mode).toBe("same");
    const r = relayoutManhuaSegmentPlanForEngine(plan6, { fromDurationSec: 15, toDurationSec: 30, toSegmentMax: 2 });
    expect(r.notesZh.join("")).toContain("超过该引擎上限 2");
  });

  it("markdown 往返：序列化后解析回同一份段表；整段替换保住片尾钩子与正文", () => {
    const md = formatManhuaEpisodeSegmentPlanMarkdown(plan6);
    const again = parseManhuaEpisodeSegmentPlanFromMarkdown(md);
    expect(again.segments.map((s) => [s.index, s.intentZh, s.sceneZh, s.castZh])).toEqual(plan6.segments.map((s) => [s.index, s.intentZh, s.sceneZh, s.castZh]));
    expect(again.segments.map((s) => s.dialogueZh.replace(/\s/g, ""))).toEqual(plan6.segments.map((s) => s.dialogueZh.replace(/\s/g, "")));
    const body = `清晨坊市，一段正文。\n\n${uniquePlanMarkdown()}\n### 片尾钩子\n眼睁开了。`;
    const merged = relayoutManhuaSegmentPlanForEngine(plan6, { fromDurationSec: 15, toDurationSec: 30 }).plan;
    const out = replaceManhuaEpisodeSegmentPlanInMarkdown(body, merged);
    expect(out.startsWith("清晨坊市，一段正文。")).toBe(true);
    expect(out).toContain("### 四段可拍表（Seedance 2.5）");
    expect(out).toContain("### 片尾钩子\n眼睁开了。");
    expect(parseManhuaEpisodeSegmentPlanFromMarkdown(out).segments.length).toBe(3);
    expect(replaceManhuaEpisodeSegmentPlanInMarkdown("只有正文", merged)).toContain("#### 段01");
  });

  it("参考重打包：按 锁脸>白模>关键帧>场景 装到上限，砍掉的带原因；mini 图 9 vs 2.5 图 30", () => {
    const refs = [
      ...Array.from({ length: 6 }, (_, i) => ({ id: `scene${i}`, kind: "image" as const, priority: "scene" as const })),
      { id: "kf1", kind: "image" as const, priority: "keyframe" as const },
      { id: "kf2", kind: "image" as const, priority: "keyframe" as const },
      { id: "face1", kind: "image" as const, priority: "identity" as const },
      { id: "face2", kind: "image" as const, priority: "identity" as const },
      { id: "pv", kind: "video" as const, priority: "previs" as const },
      { id: "pv2", kind: "video" as const, priority: "previs" as const },
      { id: "vo", kind: "audio" as const, priority: "other" as const },
    ];
    const mini = packManhuaSegmentRefsForEngine(refs, { image: 9, video: 3, audio: 3 });
    expect(mini.kept.filter((r) => r.kind === "image").length).toBe(9);
    expect(mini.kept.map((r) => r.id).slice(0, 2)).toEqual(["face1", "face2"]);
    expect(mini.dropped.map((r) => r.id)).toEqual(["scene5"]);
    expect(mini.dropped[0]!.reasonZh).toContain("上限 9");
    const s25 = packManhuaSegmentRefsForEngine(refs, { image: 30, video: 10, audio: 10 });
    expect(s25.dropped).toEqual([]);
    const tight = packManhuaSegmentRefsForEngine(refs, { image: 2, video: 1, audio: 0 });
    expect(tight.kept.map((r) => r.id)).toEqual(["face1", "face2", "pv"]);
  });
});
