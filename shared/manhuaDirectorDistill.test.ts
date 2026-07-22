import { describe, expect, it } from "vitest";
import {
  composeManhuaWriterCanonSheetPrompt,
  formatManhuaCharacterContractBlock,
  formatManhuaDirectingCoherenceBlock,
  formatManhuaEnsembleActionHierarchyBlock,
} from "./manhuaDirectorDistill";

describe("manhuaDirectorDistill", () => {
  it("builds character contract without vendor names", () => {
    const block = formatManhuaCharacterContractBlock({
      nameZh: "沈照雪",
      aliasZh: "失忆女侠",
      lookZh: "墨发湿润，半枚玉珏在腕",
      motiveZh: "寻回身份",
    });
    expect(block).toContain("角色造型参考");
    expect(block).toContain("沈照雪");
    expect(block).toContain("禁字硬锁");
    expect(block).not.toMatch(/Seedance|Dreamina|BytePlus|EvoLink/i);
  });

  it("composes sheet prompt with hard no-text lock", () => {
    const p = composeManhuaWriterCanonSheetPrompt({
      nameZh: "贺沉沙",
      lookZh: "青衫束发，眉骨锋利",
      basePromptZh: "竖屏角色设定卡，三视图可辨",
      artStyleLabelZh: "CG 漫剧",
      topic: "雨夜仙门",
    });
    expect(p).toContain("请画出的外形");
    expect(p).toContain("CG 漫剧");
    expect(p).toContain("雨夜仙门");
    expect(p).toContain("定妆肖像");
    expect(p).toContain("禁字硬锁");
    expect(p).toContain("STRICT NO TEXT");
    expect(p).not.toContain("竖屏角色设定卡");
  });

  it("keeps directing coherence and ensemble hierarchy product-neutral", () => {
    expect(formatManhuaDirectingCoherenceBlock({ intentionZh: "她的信任裂开" })).toContain(
      "单一意图",
    );
    expect(formatManhuaEnsembleActionHierarchyBlock()).toContain("动作分层");
    expect(formatManhuaDirectingCoherenceBlock()).not.toMatch(/Seedance/i);
  });
});
