import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MANHUA_DIRECTOR_STRATEGY_FORMAT,
  MANHUA_DIRECTOR_STRATEGY_APPROVED_MANIFEST_VERSION,
  MANHUA_DIRECTOR_STRATEGY_VERSION,
  formatManhuaDirectorStrategyClipLine,
  formatManhuaDirectorStrategyStage,
  getManhuaDirectorStrategyAuditTrace,
  listManhuaDirectorStrategyContracts,
  parseManhuaDirectorStrategyContract,
  readManhuaDirectorStrategyContract,
  resolveManhuaDirectorStrategyContract,
} from "./manhuaDirectorStrategy";
import { listManhuaDirectorStrategyV1Snapshots } from "./manhuaDirectorStrategyV1Snapshot";

describe("manhuaDirectorStrategy", () => {
  it.each([
    ["悬疑调查里的多线秘密", "information_causality"],
    ["末日救援与深海灾难", "emotion_space"],
    ["赛车追逐与团队闯关", "character_action"],
    ["亲情重逢后发现未知世界", "audience_discovery"],
    ["非人怪物进入异世界仪式", "embodied_world"],
    ["兄弟背叛后的江湖对决", "relational_action"],
  ])("按题材把 %s 稳定匹配为 %s", (topic, expected) => {
    expect(resolveManhuaDirectorStrategyContract({ topic }).strategyId).toBe(
      expected
    );
  });

  it("题材无命中时让现有拍摄手法成为第二信号", () => {
    expect(
      resolveManhuaDirectorStrategyContract({
        topic: "一个普通场景",
        craftShotId: "cam_03_track_follow",
      }).strategyId
    ).toBe("character_action");
  });

  it("六份合同均带版本，正式来源只从内部审计口读取", () => {
    const contracts = listManhuaDirectorStrategyContracts();
    expect(contracts).toHaveLength(6);
    for (const contract of contracts) {
      expect(contract.format).toBe(MANHUA_DIRECTOR_STRATEGY_FORMAT);
      expect(contract.version).toBe(MANHUA_DIRECTOR_STRATEGY_VERSION);
      expect(contract.revision).toBe(
        MANHUA_DIRECTOR_STRATEGY_APPROVED_MANIFEST_VERSION
      );
      expect(Object.keys(contract).sort()).toEqual(
        [
          "format",
          "labelZh",
          "projections",
          "revision",
          "strategyId",
          "version",
        ].sort()
      );
      expect(contract).not.toHaveProperty("sourceClaimIds");
      expect(contract).not.toHaveProperty("sourceProfileIds");
      expect(contract).not.toHaveProperty("sourceRevision");
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
    const contract = resolveManhuaDirectorStrategyContract({
      topic: "怪物与异世界",
    });
    const stage = formatManhuaDirectorStrategyStage(contract, "storyboard");
    const clip = formatManhuaDirectorStrategyClipLine(contract);
    const publicText = `${stage}\n${clip}`;
    expect(publicText).toContain(
      `【创作策略·v2·${MANHUA_DIRECTOR_STRATEGY_APPROVED_MANIFEST_VERSION}·embodied_world】`
    );
    expect(publicText).not.toMatch(
      /Nolan|Cameron|Spielberg|Abrams|Ridley|Scott|del Toro|Justin Lin|John Woo|诺兰|卡梅隆|斯皮尔伯格|艾布拉姆斯|雷德利|林诣彬|吴宇森/i
    );
    expect(readManhuaDirectorStrategyContract(stage)?.strategyId).toBe(
      "embodied_world"
    );
    expect(readManhuaDirectorStrategyContract("旧节点，无策略标记")).toBeNull();
  });

  it("内部溯源使用正式卡 id、完整 claim id 与来源修订", () => {
    expect(
      getManhuaDirectorStrategyAuditTrace("information_causality")
    ).toMatchObject({
      sourceProfileIds: [
        "parallel_action_editing",
        "world_space_previsualization",
        "mystery_reveal",
      ],
      sourceClaimIds: [
        "CN-DM-02",
        "CN-DM-04",
        "CN-DM-05",
        "CN-DM-06",
        "CN-DM-10",
        "WSPV-001",
        "AB-D-01",
      ],
      sourceRevision: "parallel_action_editing@2026-09-04",
    });
    expect(
      getManhuaDirectorStrategyAuditTrace("character_action")?.sourceClaimIds
    ).toEqual([
      "KE-01-character-pov-before-scale",
      "KE-02-beat-contract-before-scale",
      "KE-03-spatial-tactile-causality",
      "WSPV-001",
      "AB-D-01",
    ]);
    expect(
      getManhuaDirectorStrategyAuditTrace("emotion_space")?.sourceProfileIds[0]
    ).toBe("human_scale_causal_staging");
    expect(
      getManhuaDirectorStrategyAuditTrace("audience_discovery")
        ?.sourceProfileIds[0]
    ).toBe("audience_aligned_discovery");
    expect(
      getManhuaDirectorStrategyAuditTrace("embodied_world")?.sourceProfileIds[0]
    ).toBe("embodied_fable_system");
    expect(
      getManhuaDirectorStrategyAuditTrace("relational_action")
        ?.sourceProfileIds[0]
    ).toBe("relational_action_rhythm");
  });

  it("关键帧投影只描述静态构图终态、光影与材质", () => {
    for (const contract of listManhuaDirectorStrategyContracts()) {
      const text = formatManhuaDirectorStrategyStage(contract, "keyframe");
      expect(text).toMatch(/静态|终态/);
      expect(text).toContain("光影");
      expect(text).toContain("材质");
      expect(text).not.toMatch(/推近|拉远|跟拍|摇镜|横移|甩镜|环绕/);
      expect(text).toMatch(/不得写运镜|不写运镜/);
    }
  });

  it("旧 v1 合同与标记从不可变快照恢复，不升级成当前 revision", () => {
    const legacy = {
      format: "mv-manhua-director-strategy-v1",
      version: 1,
      strategyId: "relational_action",
      labelZh: "不可信旧文案",
      projections: {},
    };
    const restored = parseManhuaDirectorStrategyContract(legacy);
    expect(restored).toMatchObject({
      format: "mv-manhua-director-strategy-v1",
      version: 1,
      strategyId: "relational_action",
      labelZh: "关系驱动动作",
    });
    expect(restored).not.toHaveProperty("revision");
    expect(restored?.projections.clip.directivesZh).toEqual([
      "同帧主要动作主体不超过两人",
      "延时效果改写为目光停留、材质余振、呼吸或光影状态变化",
    ]);
    const oldStoryboardGolden = [
      "【创作策略·v1·relational_action】关系驱动动作",
      "目标：动作覆盖交代起点、变化、结果与关系反应。",
      "- 常速保持因果可读",
      "- 只在目光、身体转折、道德选择或冲击余韵处延时",
      "边界：禁止整场统一慢速，也不规定固定帧率、镜头数或焦段。",
    ].join("\n");
    expect(formatManhuaDirectorStrategyStage(restored!, "storyboard")).toBe(
      oldStoryboardGolden,
    );
    expect(formatManhuaDirectorStrategyStage(restored!, "keyframe")).toBe("");
    const fromMarker = readManhuaDirectorStrategyContract(oldStoryboardGolden);
    expect(formatManhuaDirectorStrategyStage(fromMarker!, "storyboard")).toBe(
      oldStoryboardGolden,
    );
    expect(fromMarker).not.toHaveProperty("revision");
    expect(
      parseManhuaDirectorStrategyContract({ ...legacy, strategyId: "unknown" })
    ).toBeNull();
    expect(
      readManhuaDirectorStrategyContract("【创作策略·v1·unknown】")
    ).toBeNull();
    expect(
      parseManhuaDirectorStrategyContract({
        ...resolveManhuaDirectorStrategyContract({ topic: "关系动作" }),
        revision: "unapproved-r9",
      })
    ).toBeNull();
  });

  it("8ef1555 的六份 v1 快照只含去名生产字段且运行时不可变", () => {
    const snapshots = listManhuaDirectorStrategyV1Snapshots();
    expect(snapshots).toHaveLength(6);
    expect(
      createHash("sha256").update(JSON.stringify(snapshots)).digest("hex"),
    ).toBe("40982eb4b629cae60cbf921c9980e94b268dc8de603afc5c3c192df9bcc393b5");
    for (const contract of snapshots) {
      expect(Object.keys(contract).sort()).toEqual(
        ["format", "labelZh", "projections", "strategyId", "version"].sort(),
      );
      expect(Object.keys(contract.projections).sort()).toEqual(
        ["assets", "clip", "review", "story", "storyboard"].sort(),
      );
      expect(contract).not.toHaveProperty("revision");
      expect(contract).not.toHaveProperty("sourceClaimIds");
      expect(contract).not.toHaveProperty("sourceProfileIds");
      expect(Object.isFrozen(contract)).toBe(true);
      expect(Object.isFrozen(contract.projections)).toBe(true);
      expect(Object.isFrozen(contract.projections.clip.directivesZh)).toBe(true);
    }
  });

  it("每次只输出当前阶段，不把五阶段合同整包灌入", () => {
    const contract = resolveManhuaDirectorStrategyContract({
      topic: "悬疑调查",
    });
    const story = formatManhuaDirectorStrategyStage(contract, "story");
    const assets = formatManhuaDirectorStrategyStage(contract, "assets");
    expect(story).toContain("并行行动");
    expect(story).not.toContain("装饰性资产");
    expect(assets).toContain("装饰性资产");
    expect(assets).not.toContain("无因果交叉剪辑");
  });
});
