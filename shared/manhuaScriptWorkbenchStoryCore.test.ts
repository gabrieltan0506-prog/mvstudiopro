import { describe, expect, it } from "vitest";
import { formatWorkbenchSegmentClipInjectBlock } from "./manhuaScriptWorkbench";

const shots = [
  { index: 1, durationSec: 5, actionZh: "阿菁推门进医馆", dialogueZh: "先生，我娘的药。", cameraZh: "中近景" },
] as never;

const base = { segmentIndex: 2, totalSegments: 5, durationSec: 5, shots, sceneHintZh: "长明医馆" };

describe("段成片提示词注入本段戏核（0919）", () => {
  it("有戏核就写进【本段戏核】，并排在秒轴之前", () => {
    const out = formatWorkbenchSegmentClipInjectBlock({
      ...base,
      storyEmotionLineZh: "本段情绪目的：押上信物；人物动作动机：阿菁，要拿回娘的药，受阻于先生不肯赊，选择把银镯押上",
    });
    expect(out).toContain("【本段戏核】");
    expect(out).toContain("押上信物");
    expect(out).toContain("受阻于先生不肯赊");
    // 先说要达成什么，再说逐秒怎么拍：戏核必须排在秒轴行（0–5s：…）之前、段头之后
    const core = out.indexOf("【本段戏核】");
    const timeline = out.indexOf("0–5s：");
    const sceneLock = out.indexOf("【场景锁】");
    expect(timeline).toBeGreaterThan(0);
    expect(core).toBeGreaterThan(sceneLock);
    expect(core).toBeLessThan(timeline);
  });

  it("没做分析就一个字都不注入，旧项目提示词逐字节不变（反例对照）", () => {
    const withoutField = formatWorkbenchSegmentClipInjectBlock(base);
    for (const empty of [undefined, null, "", "   "]) {
      const out = formatWorkbenchSegmentClipInjectBlock({ ...base, storyEmotionLineZh: empty as never });
      expect(out).not.toContain("【本段戏核】");
      expect(out).toBe(withoutField);
    }
  });

  it("戏核不挤掉原有段头与对白：场景锁和台词仍在", () => {
    const out = formatWorkbenchSegmentClipInjectBlock({ ...base, storyEmotionLineZh: "本段情绪目的：押上信物" });
    expect(out).toContain("长明医馆");
    expect(out).toContain("我娘的药");
  });
});
