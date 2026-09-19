import { describe, expect, it } from "vitest";
import { buildManhuaDirectorCardView } from "./manhuaDirectorCardView";
import type { ManhuaDirectionCanon } from "./manhuaDirectionCanon";

const card = (id: string, labelZh: string) => ({
  id,
  labelZh,
  rules: [
    { id: `${id}-r1`, ruleZh: "手法一", stages: ["story", "storyboard"], status: "verified" },
    { id: `${id}-r2`, ruleZh: "手法二", stages: ["keyframe"], status: "verified" },
  ],
});

const canon = (over: Partial<ManhuaDirectionCanon> = {}): ManhuaDirectionCanon =>
  ({
    mainCardId: "main",
    cards: [card("main", "信息位置可控"), card("fight", "动作改变关系")],
    authorizedCardIds: ["main", "fight"],
    ...over,
  }) as ManhuaDirectionCanon;

describe("紧凑导演卡：这一段到底用哪张", () => {
  it("没有场次副卡时走主卡，来源写「集级主卡」，覆盖理由为空", () => {
    const view = buildManhuaDirectorCardView({ canon: canon(), sceneType: "action", hasSpawnedNodes: false })!;
    expect(view.effectiveCardId).toBe("main");
    expect(view.sourceZh).toBe("系列主卡");
    expect(view.overrideReasonZh).toBe("");
    expect(view.sceneTypeZh).toBe("打戏");
  });

  it("本段场次有副卡就用副卡，并说清为什么覆盖了哪张主卡", () => {
    const view = buildManhuaDirectorCardView({
      canon: canon({ sceneOverrides: { action: { cardId: "fight" } } }),
      sceneType: "action",
      hasSpawnedNodes: false,
    })!;
    expect(view.effectiveCardId).toBe("fight");
    expect(view.sourceZh).toBe("场次副卡 · 打戏");
    expect(view.overrideReasonZh).toContain("本段判为打戏");
    expect(view.overrideReasonZh).toContain("信息位置可控");
    // 反例对照：换一种场次类型就不该再用这张副卡
    const dialogue = buildManhuaDirectorCardView({
      canon: canon({ sceneOverrides: { action: { cardId: "fight" } } }),
      sceneType: "dialogue",
      hasSpawnedNodes: false,
    })!;
    expect(dialogue.effectiveCardId).toBe("main");
    expect(dialogue.sourceZh).toBe("系列主卡");
  });

  it("副卡未授权时如实说明仍走主卡，不静默降级", () => {
    const view = buildManhuaDirectorCardView({
      canon: canon({ sceneOverrides: { action: { cardId: "fight" } }, authorizedCardIds: ["main"] }),
      sceneType: "action",
      hasSpawnedNodes: false,
    })!;
    expect(view.effectiveCardId).toBe("main");
    expect(view.overrideReasonZh).toContain("未获生产准入");
  });

  it("副卡只声明部分阶段时，影响预览只报那几处", () => {
    const view = buildManhuaDirectorCardView({
      canon: canon({ sceneOverrides: { action: { cardId: "fight", stages: ["keyframe", "clip"] } } }),
      stage: "clip",
      sceneType: "action",
      hasSpawnedNodes: false,
    })!;
    expect(view.impactZh).toBe("投影到 关键帧 / 成片");
    // 没声明阶段时是全流程五处
    const all = buildManhuaDirectorCardView({
      canon: canon({ sceneOverrides: { action: { cardId: "fight" } } }),
      sceneType: "action",
      hasSpawnedNodes: false,
    })!;
    expect(all.impactZh).toBe("投影到 剧本 / 资产 / 分镜 / 关键帧 / 成片 / 审查");
  });

  it("已铺过节点才给连续性提醒；没铺过不吓唬人", () => {
    const spawned = buildManhuaDirectorCardView({ canon: canon(), sceneType: "emotion", hasSpawnedNodes: true })!;
    expect(spawned.continuityZh).toContain("保留旧版");
    const clean = buildManhuaDirectorCardView({ canon: canon(), sceneType: "emotion", hasSpawnedNodes: false })!;
    expect(clean.continuityZh).toBe("");
  });

  it("没有导演包时返回 null，不编一张默认卡", () => {
    expect(buildManhuaDirectorCardView({ canon: null, sceneType: "action", hasSpawnedNodes: true })).toBeNull();
    expect(
      buildManhuaDirectorCardView({
        canon: canon({ mainCardId: "missing" }),
        sceneType: "action",
        hasSpawnedNodes: true,
      }),
    ).toBeNull();
  });
});

it("摘要遵守生产准入和覆盖阶段，不把未生效副卡写成当前卡", () => {
 const c = canon({ sceneOverrides: { action: { cardId: "fight", stages: ["clip"] } } });
 expect(buildManhuaDirectorCardView({ canon: c, sceneType: "action", stage: "storyboard", hasSpawnedNodes: false })?.effectiveCardId).toBe("main");
 expect(buildManhuaDirectorCardView({ canon: c, sceneType: "action", stage: "clip", hasSpawnedNodes: false })?.effectiveCardId).toBe("fight");
 c.authorizedCardIds = ["fight"];
 expect(buildManhuaDirectorCardView({ canon: c, sceneType: "action", hasSpawnedNodes: false })).toBeNull();
});
