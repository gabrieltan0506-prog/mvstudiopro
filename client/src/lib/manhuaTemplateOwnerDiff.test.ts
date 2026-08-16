import { describe, expect, it } from "vitest";
import type { ManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";
import {
  changedManhuaTemplateBeatIndexes,
  isManhuaTemplateFieldChanged,
} from "./manhuaTemplateOwnerDiff";

function card(): ManhuaViralTemplateCard {
  return {
    id: "tpl_series_diff",
    nameZh: "原模板",
    laneZh: "系统觉醒",
    summaryZh: "摘要",
    hook3sZh: "原钩子",
    beatGrid: [
      { atSec: 0, conflictZh: "冲突一", visualZh: "画面一" },
      { atSec: 15, conflictZh: "冲突二", visualZh: "画面二" },
    ],
    scenePoolHints: ["山门"],
    castShape: { leadDesireZh: "生存", pressureZh: "追杀" },
    densityHints: { minBodyChars: 280, minDialogueLines: 8, minLocationHits: 2 },
    sourceRefs: [],
    status: "approved",
  };
}

describe("owner 模板 Diff 高亮数据", () => {
  it("只标记真实变化字段与变化节拍，不把未变化内容整块点亮", () => {
    const original = card();
    const candidate: ManhuaViralTemplateCard = {
      ...original,
      hook3sZh: "优化钩子",
      beatGrid: [
        original.beatGrid[0]!,
        { ...original.beatGrid[1]!, visualZh: "优化画面二" },
      ],
    };
    expect(isManhuaTemplateFieldChanged(original, candidate, "hook3sZh")).toBe(true);
    expect(isManhuaTemplateFieldChanged(original, candidate, "summaryZh")).toBe(false);
    expect(isManhuaTemplateFieldChanged(original, candidate, "beatGrid")).toBe(true);
    expect(changedManhuaTemplateBeatIndexes(original, candidate)).toEqual([1]);
    expect(changedManhuaTemplateBeatIndexes(original, {
      ...candidate,
      beatGrid: [candidate.beatGrid[0]!],
    })).toEqual([1]);
  });
});
