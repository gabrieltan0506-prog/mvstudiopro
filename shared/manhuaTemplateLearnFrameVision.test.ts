import { describe, expect, it } from "vitest";
import {
  MANHUA_TEMPLATE_FRAME_VISION_MODEL,
  MANHUA_TEMPLATE_FRAME_VISION_REASONING,
  applyFrameVisionToProposal,
  parseManhuaTemplateFrameVisionJson,
  selectFramesForVisionAnalysis,
} from "./manhuaTemplateLearnFrameVision";
import type { ManhuaViralTemplateCard } from "./manhuaViralTemplateBank";

describe("manhuaTemplateLearnFrameVision", () => {
  it("selectFramesForVisionAnalysis keeps hook frames and caps size", () => {
    const frames = Array.from({ length: 40 }, (_, i) => ({ atSec: i * 5 }));
    const picked = selectFramesForVisionAnalysis(frames, 12);
    expect(picked.length).toBeLessThanOrEqual(12);
    expect(picked.some((f) => f.atSec <= 5)).toBe(true);
    expect(picked[0]!.atSec).toBeLessThanOrEqual(picked[picked.length - 1]!.atSec);
  });

  it("parseManhuaTemplateFrameVisionJson accepts fenced JSON", () => {
    const raw = `\`\`\`json
{
  "nameZh": "开荒翻盘骨架",
  "laneZh": "古言种田",
  "summaryZh": "贬谪后开荒每15秒升级",
  "hook3sZh": "关外风雪里跪接贬令",
  "beatGrid": [
    {"atSec": 0, "conflictZh": "贬谪落地", "visualZh": "木牌砸下"},
    {"atSec": 30, "conflictZh": "生存压迫", "visualZh": "挖地修篱"}
  ],
  "scenePoolHints": ["边塞", "开荒"],
  "castShape": {"leadDesireZh": "活下去", "pressureZh": "断粮", "foilZh": "边军"}
}
\`\`\``;
    const parsed = parseManhuaTemplateFrameVisionJson(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.model).toBe(MANHUA_TEMPLATE_FRAME_VISION_MODEL);
    expect(parsed!.reasoningEffort).toBe(MANHUA_TEMPLATE_FRAME_VISION_REASONING);
    expect(parsed!.laneZh).toBe("古言种田");
    expect(parsed!.beatGrid).toHaveLength(2);
  });

  it("applyFrameVisionToProposal keeps proposed and fills fields", () => {
    const draft: ManhuaViralTemplateCard = {
      id: "tpl_learn_test_abc",
      nameZh: "学习草案（待读帧补全）",
      laneZh: "爽文逆袭",
      summaryZh: "草案",
      hook3sZh: "待补",
      beatGrid: [{ atSec: 0, conflictZh: "待视觉读帧补全", visualZh: "关键帧 @0s" }],
      scenePoolHints: [],
      castShape: { leadDesireZh: "待补", pressureZh: "待补" },
      densityHints: { minBodyChars: 280, minDialogueLines: 8, minLocationHits: 2 },
      sourceRefs: [{ url: "https://example.com/x", fetchedAt: "2026-07-21", noteZh: "时长60s" }],
      status: "proposed",
    };
    const vision = parseManhuaTemplateFrameVisionJson({
      nameZh: "边关翻盘",
      laneZh: "古言种田",
      summaryZh: "开荒翻盘节奏",
      hook3sZh: "开场贬令",
      beatGrid: [{ atSec: 0, conflictZh: "贬谪", visualZh: "接令" }],
      scenePoolHints: ["边塞"],
      castShape: { leadDesireZh: "翻盘", pressureZh: "绝境" },
    });
    expect(vision).not.toBeNull();
    const merged = applyFrameVisionToProposal(draft, vision!);
    expect(merged).not.toBeNull();
    expect(merged!.status).toBe("proposed");
    expect(merged!.nameZh).toBe("边关翻盘");
    expect(merged!.hook3sZh).toBe("开场贬令");
    expect(merged!.approvedAt).toBeUndefined();
    expect(String(merged!.sourceRefs[0]?.noteZh || "")).toMatch(/视觉读帧已填/);
  });
});
