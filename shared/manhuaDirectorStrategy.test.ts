import { describe, expect, it } from "vitest";
import {
  MANHUA_DIRECTOR_STRATEGY_FORMAT,
  formatManhuaDirectorStrategyClipLine,
  formatManhuaDirectorStrategyStage,
  getManhuaDirectorStrategyAuditTrace,
  listManhuaDirectorStrategyContracts,
  readManhuaDirectorStrategyContract,
  resolveManhuaDirectorStrategyContract,
} from "./manhuaDirectorStrategy";

describe("manhuaDirectorStrategy", () => {
  it.each([
    ["悬疑调查里的多线秘密", "information_causality"],
    ["末日救援与深海灾难", "emotion_space"],
    ["赛车追逐与团队闯关", "character_action"],
    ["亲情重逢后发现未知世界", "audience_discovery"],
    ["非人怪物进入异世界仪式", "embodied_world"],
    ["兄弟背叛后的江湖对决", "relational_action"],
  ])("按题材把 %s 稳定匹配为 %s", (topic, expected) => {
    expect(resolveManhuaDirectorStrategyContract({ topic }).strategyId).toBe(expected);
  });

  it("题材无命中时让现有拍摄手法成为第二信号", () => {
    expect(
      resolveManhuaDirectorStrategyContract({
        topic: "一个普通场景",
        craftShotId: "cam_03_track_follow",
      }).strategyId,
    ).toBe("character_action");
  });

  it("六份合同均带版本，正式来源只从内部审计口读取", () => {
    const contracts = listManhuaDirectorStrategyContracts();
    expect(contracts).toHaveLength(6);
    for (const contract of contracts) {
      expect(contract.format).toBe(MANHUA_DIRECTOR_STRATEGY_FORMAT);
      expect(contract.version).toBe(1);
      expect(contract).not.toHaveProperty("sourceClaimIds");
      expect(contract).not.toHaveProperty("moduleIds");
      const trace = getManhuaDirectorStrategyAuditTrace(contract.strategyId);
      expect(trace?.sourceClaimIds.length).toBeGreaterThanOrEqual(3);
      expect(trace?.moduleIds).toEqual([
        "spatial-previsualization",
        "final-perceptual-allocation",
      ]);
    }
  });

  it("生产投影去名且可从已存节点恢复同一策略", () => {
    const contract = resolveManhuaDirectorStrategyContract({ topic: "怪物与异世界" });
    const stage = formatManhuaDirectorStrategyStage(contract, "storyboard");
    const clip = formatManhuaDirectorStrategyClipLine(contract);
    const publicText = `${stage}\n${clip}`;
    expect(publicText).toContain("【创作策略·v1·embodied_world】");
    expect(publicText).not.toMatch(
      /Nolan|Cameron|Spielberg|Abrams|Ridley|Scott|del Toro|Justin Lin|John Woo|诺兰|卡梅隆|斯皮尔伯格|艾布拉姆斯|雷德利|林诣彬|吴宇森/i,
    );
    expect(readManhuaDirectorStrategyContract(stage)?.strategyId).toBe("embodied_world");
    expect(readManhuaDirectorStrategyContract("旧节点，无策略标记")).toBeNull();
  });

  it("每次只输出当前阶段，不把五阶段合同整包灌入", () => {
    const contract = resolveManhuaDirectorStrategyContract({ topic: "悬疑调查" });
    const story = formatManhuaDirectorStrategyStage(contract, "story");
    const assets = formatManhuaDirectorStrategyStage(contract, "assets");
    expect(story).toContain("并行行动");
    expect(story).not.toContain("装饰性资产");
    expect(assets).toContain("装饰性资产");
    expect(assets).not.toContain("无因果交叉剪辑");
  });
});
