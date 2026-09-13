import { describe, expect, it } from "vitest";
import {
  compilePrevisScriptDraft,
  previsScriptSourceKey,
  type PrevisSourceCharacter,
} from "./manhuaPrevisScript";
import {
  createManhuaPrevisStudio,
  manhuaPrevisDraftSchema,
  manhuaPrevisSpecSchema,
  type ManhuaPrevisSpec,
} from "./manhuaPrevis";

const characters: PrevisSourceCharacter[] = [
  { id: "qing", label: "阿菁", tag: "@人物1" },
  { id: "guard", label: "家丁", tag: "@人物2" },
];
function compile(
  text: string,
  options: {
    characters?: PrevisSourceCharacter[];
    spec?: ManhuaPrevisSpec;
  } = {}
) {
  return compilePrevisScriptDraft({
    shots: [{ index: 7, durationSec: 4, actionZh: text }],
    characters: options.characters ?? characters,
    currentSpec: options.spec ?? createManhuaPrevisStudio(4).spec,
  });
}

describe("原镜动作草案的实际生产与身份", () => {
  it("明确击中和受击产出非空同事件双方，保存原镜文本与编号", () => {
    const text = "阿菁一拳击中家丁，家丁受击后仰。";
    const result = compile(text);
    expect(result.errors).toEqual([]);
    expect(result.spec?.actors.map(a => a.assetRef)).toEqual(["qing", "guard"]);
    expect(result.spec?.interactions).toEqual([
      {
        id: "shot-7-interaction",
        kind: "strike_recoil",
        actorId: "script-actor-1",
        targetActorId: "script-actor-2",
        startSec: 0,
        contactSec: 2,
        endSec: 4,
      },
    ]);
    expect(result.spec?.scriptSource?.shots).toEqual([
      { index: 7, durationSec: 4, actionZh: text },
    ]);
    expect(result.mappedShotIndices).toEqual([7]);
  });

  it("明确标签格挡指向正确资产而非列表前两项", () => {
    const result = compile("@人物2向@人物1出拳，@人物1抬臂格挡。");
    expect(result.spec?.actors.map(a => a.assetRef)).toEqual(["guard", "qing"]);
    expect(result.spec?.interactions?.[0].kind).toBe("strike_guard");
  });

  it("人物1不能借人物10的标签误认身份", () => {
    const result = compile("@人物10静立。");
    expect(result.spec).toBeNull();
    expect(result.unmapped).toHaveLength(1);
  });

  it("新增第十标签可独立匹配，不命中第一标签", () => {
    const result = compile("@人物10静立。", {
      characters: [...characters, { id: "ten", label: "老者", tag: "@人物10" }],
    });
    expect(result.spec?.actors.map(a => a.assetRef)).toEqual(["ten"]);
  });

  it("同名项目角色明确拒绝，不以数组顺序选择", () => {
    const result = compile("阿菁静立。", {
      characters: [characters[0], { id: "other", label: "阿菁" }],
    });
    expect(result.spec).toBeNull();
    expect(result.errors.join("")).toMatch(/重复/);
  });

  it("重复tag同样拒绝，避免两个身份共用引用", () => {
    const result = compile("@人物1静立。", {
      characters: [characters[0], { ...characters[1], tag: "@人物1" }],
    });
    expect(result.spec).toBeNull();
    expect(result.errors.join("")).toMatch(/重复|绑定|标签/);
  });

  it("带正则符号的真名作为字面值识别", () => {
    const result = compile("阿菁(成年)静立。", {
      characters: [{ id: "qing", label: "阿菁(成年)" }],
    });
    expect(result.spec?.actors[0].nameZh).toBe("阿菁(成年)");
  });
});

describe("不能把未发生、模糊动作或独立后仰编成击中", () => {
  it.each([
    "阿菁没有出拳。",
    "如果阿菁向家丁出拳，家丁后仰。",
    "阿菁试图向家丁出拳，家丁受击后仰。",
    "阿菁向家丁出拳但未击中，家丁后仰躲开。",
    "阿菁一拳打向家丁，家丁后仰躲开。",
    "阿菁向家丁出拳，家丁后仰避开。",
    "阿菁尚未出拳。",
    "阿菁准备出拳。",
    "阿菁欲出手。",
    "阿菁收住了即将出手的拳头。",
    "阿菁向家丁出拳，家丁后仰。",
    "阿菁向家丁出拳，家丁格挡失败后踉跄。",
  ])("保留原文而不是杜撰事件：%s", text => {
    const result = compile(text);
    expect(result.spec).toBeNull();
    expect(result.mappedShotIndices).toEqual([]);
    expect(result.unmapped).toEqual([
      expect.objectContaining({ index: 7, text }),
    ]);
  });

  it("同镜重复同一对攻击不能折叠成一次命中", () => {
    const result = compile(
      "阿菁向家丁出拳，家丁格挡；阿菁向家丁出拳，家丁格挡。"
    );
    expect(result.spec).toBeNull();
    expect(result.unmapped).toHaveLength(1);
  });
});

describe("原稿保全、旧配置与容量", () => {
  it("混合可识别与未识别镜完整保留原文，不把未识别秒数挪走", () => {
    const text = "家丁使用尚未支持的凌空旋踢并退至屋檐。";
    const shots = [
      { index: 1, durationSec: 2, actionZh: "阿菁静立。" },
      { index: 2, durationSec: 2, actionZh: text },
    ];
    const result = compilePrevisScriptDraft({
      shots,
      characters,
      currentSpec: createManhuaPrevisStudio(4).spec,
    });
    expect(result.spec?.durationSec).toBe(4);
    expect(result.spec?.scriptSource?.shots).toEqual(shots);
    expect(result.spec?.scriptSource?.unmappedShotIndices).toEqual([2]);
    expect(result.spec?.actors[0].actions).toEqual([
      { kind: "idle", startSec: 0, endSec: 2 },
    ]);
    expect(result.unmapped[0].text).toBe(text);
  });

  it("没有原镜时不伪造演示动作、不改原配置", () => {
    const currentSpec = createManhuaPrevisStudio(4).spec;
    const before = JSON.stringify(currentSpec);
    const result = compilePrevisScriptDraft({
      shots: [],
      characters,
      currentSpec,
    });
    expect(result.spec).toBeNull();
    expect(JSON.stringify(currentSpec)).toBe(before);
  });

  it("已有绑定角色沿用ID、站位、朝向、画幅，不修改传入对象", () => {
    const currentSpec = createManhuaPrevisStudio(4).spec;
    currentSpec.aspect = "9:16";
    Object.assign(currentSpec.actors[0], {
      assetRef: "qing",
      id: "old-qing",
      start: [2, 1],
      end: [2, 1],
      facingDeg: 90,
    });
    const before = JSON.stringify(currentSpec);
    const result = compile("阿菁静立。", { spec: currentSpec });
    expect(result.spec?.actors[0]).toMatchObject({
      id: "old-qing",
      start: [2, 1],
      end: [2, 1],
      facingDeg: 90,
    });
    expect(result.spec?.aspect).toBe("9:16");
    expect(JSON.stringify(currentSpec)).toBe(before);
  });

  it("阶段②编排不能静默剥掉同一角色已配置的阶段③形态", () => {
    const currentSpec = createManhuaPrevisStudio(4).spec;
    const creature = {
      preset: "four_tail_black_wings" as const,
      transformStartSec: 0.5,
      transformEndSec: 3,
    };
    Object.assign(currentSpec.actors[0], {
      assetRef: "horse",
      shape: "horse",
      creature,
    });
    const result = compile("墨屠静立。", {
      spec: currentSpec,
      characters: [{ id: "horse", label: "墨屠" }],
    });
    expect(result.spec?.actors[0].creature).toEqual(creature);
  });

  it("六人三十秒超旧2700预算必须拒绝，不能截成18秒", () => {
    const chars = Array.from({ length: 6 }, (_, i) => ({
      id: "id" + i,
      label: "角色" + i,
    }));
    const shots = chars.map((c, i) => ({
      index: i + 1,
      durationSec: 5,
      actionZh: c.label + "静立。",
    }));
    const result = compilePrevisScriptDraft({
      shots,
      characters: chars,
      currentSpec: createManhuaPrevisStudio(30).spec,
    });
    expect(result.spec).toBeNull();
    expect(result.errors.join("")).toMatch(/能力|预算|上限/);
  });

  it("文本或角色绑定变更产生不同完整sourceKey", () => {
    const shots = [{ index: 1, durationSec: 4, actionZh: "阿菁静立。" }];
    expect(previsScriptSourceKey(shots, characters)).not.toBe(
      previsScriptSourceKey(
        [{ ...shots[0], actionZh: "阿菁出拳。" }],
        characters
      )
    );
    expect(previsScriptSourceKey(shots, characters)).not.toBe(
      previsScriptSourceKey(shots, [
        { ...characters[0], id: "new-id" },
        characters[1],
      ])
    );
  });

  it("历史version1无高级字段仍正常读取，不凭空生成空轨道", () => {
    const legacy = createManhuaPrevisStudio(4).spec;
    const value = manhuaPrevisSpecSchema.parse(legacy);
    expect(value).toEqual(legacy);
    expect(value.interactions).toBeUndefined();
    expect(value.scriptSource).toBeUndefined();
    expect(manhuaPrevisDraftSchema.parse(legacy)).toEqual(legacy);
  });
});

describe("阶段②③提交门禁与恢复契约", () => {
  function interactionSpec() {
    return compile("阿菁一拳击中家丁，家丁受击后仰。").spec!;
  }

  it.each(["missing", "script-actor-1"])(
    "互动目标%s不能绕过真实双角色绑定",
    targetActorId => {
      const spec = interactionSpec();
      spec.interactions![0].targetActorId = targetActorId;
      expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
    }
  );

  it("命中点必须落实际24帧且不能等于片尾下一帧", () => {
    const spec = interactionSpec();
    spec.interactions![0].contactSec = 1.111;
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
    spec.interactions![0].contactSec = 4;
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("同角色不能在双人事件内再叠独立动作或第二互动", () => {
    const spec = interactionSpec();
    spec.actors[0].actions.push({ kind: "strike", startSec: 0, endSec: 1 });
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
    spec.actors[0].actions = [];
    spec.interactions!.push({ ...spec.interactions![0], id: "other" });
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("人体或无效显形区间不接收四尾黑翼", () => {
    const spec = createManhuaPrevisStudio(4).spec;
    spec.actors[0].creature = {
      preset: "four_tail_black_wings",
      transformStartSec: 0,
      transformEndSec: 3,
    };
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
    spec.actors[0].shape = "horse";
    spec.actors[0].actions = [];
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(true);
    spec.actors[0].creature.transformEndSec = 5;
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
    spec.actors[0].creature.transformEndSec = 0.25;
    expect(manhuaPrevisSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("草稿JSON读回保留原文与互动字段，不被schema剥除", () => {
    const spec = interactionSpec();
    expect(
      manhuaPrevisDraftSchema.parse(JSON.parse(JSON.stringify(spec)))
    ).toEqual(spec);
  });
});
