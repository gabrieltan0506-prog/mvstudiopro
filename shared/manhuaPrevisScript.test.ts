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
    "阿菁不出拳。",
    "阿菁未出拳。",
    "阿菁出拳，随后连续出拳。",
    "阿菁站定，随后转身离开。",
    "阿菁向家丁出拳，家丁格挡，随后阿菁转身离开。",
    "阿菁向家丁出拳，家丁格挡，随后再次格挡。",
  ])("完整消费原句，否则保留未映射而不是部分冒充：%s", text => {
    const result = compile(text);
    expect(result.spec).toBeNull();
    expect(result.mappedShotIndices).toEqual([]);
    expect(result.unmapped).toEqual([expect.objectContaining({ index: 7, text })]);
  });
  it("简单肯定句仍生成动作，角色姓名含不字不视作否定", () => {
    const result = compile("杨不悔缓缓出拳一次。", {
      characters: [{ id: "yang", label: "杨不悔" }],
    });
    expect(result.spec?.actors[0].actions).toEqual([{ kind: "strike", startSec: 0, endSec: 4 }]);
    expect(result.mappedShotIndices).toEqual([7]);
    expect(result.unmapped).toEqual([]);
  });
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

describe("文戏动词草案（0917 PR-E）", () => {
  const act = (text: string) => compile(text).spec?.actors.find(a => a.actions.length)?.actions ?? [];

  it("看向必须写明目标，目标落成 lookAtId", () => {
    expect(act("阿菁看向家丁。")).toEqual([
      { kind: "look", startSec: 0, endSec: 4, lookAtId: "script-actor-2" },
    ]);
    expect(act("阿菁望向镜头。")).toEqual([
      { kind: "look", startSec: 0, endSec: 4, lookAtId: "camera" },
    ]);
    // 反例：没写看谁就不猜，退回未映射
    const vague = compile("阿菁看向远处。");
    expect(vague.mappedShotIndices).toEqual([]);
  });

  it("转身按转向背面写死目标朝向，人工可再调", () => {
    expect(act("阿菁转身。")).toEqual([
      { kind: "turn", startSec: 0, endSec: 4, facingDeg: 180 },
    ]);
  });

  it("坐下、指向、行礼各自落成对应动作", () => {
    expect(act("阿菁坐下。")[0]?.kind).toBe("sit");
    expect(act("阿菁抬手指。")[0]?.kind).toBe("gesture_point");
    expect(act("阿菁拱手。")[0]?.kind).toBe("bow");
  });

  it("走位只在角色真的有位移时才排，且写了目标不自作主张", () => {
    // 反例①：原文写了「走向家丁」，但白模改不了站位——退回未映射，不吞掉调度信息
    const withTarget = compile("阿菁走向家丁。");
    expect(withTarget.mappedShotIndices).toEqual([]);
    expect(withTarget.unmapped[0].reasonZh).toContain("白模还表达不了");
    // 反例②：站着不动的角色「迈步」＝原地摆臂假装在走，同样退回
    expect(compile("阿菁迈步。").mappedShotIndices).toEqual([]);
    // 正例：当前配置里该角色本来就有位移区间，才落成 walk
    const moving = createManhuaPrevisStudio(4).spec;
    moving.actors[0].assetRef = "qing";
    moving.actors[0].start = [-1, 0];
    moving.actors[0].end = [1, 0];
    moving.actors[0].moveStartSec = 0;
    moving.actors[0].moveEndSec = 4;
    const ok = compile("阿菁迈步。", { spec: moving });
    expect(ok.mappedShotIndices).toEqual([7]);
    expect(ok.spec?.actors.find(a => a.actions.length)?.actions[0].kind).toBe("walk");
  });

  it("指向写了目标也退回：白模只按自身朝向抬手，指不到那个人", () => {
    const pointed = compile("阿菁指向家丁。");
    expect(pointed.mappedShotIndices).toEqual([]);
    expect(pointed.unmapped[0].reasonZh).toContain("白模还表达不了");
  });

  it("镜头描述型分镜仍然 0 映射（设计边界没被扩库放宽）", () => {
    for (const text of ["中近景，阿菁立于堂前。", "特写推向阿菁的手。", "固定机位，全景。"])
      expect(compile(text).mappedShotIndices).toEqual([]);
  });

  it("部分匹配、多余成分仍然拒绝，不把半句当整镜", () => {
    expect(compile("阿菁看向家丁后又转身离开。").mappedShotIndices).toEqual([]);
    expect(compile("阿菁没有坐下。").mappedShotIndices).toEqual([]);
    expect(compile("阿菁走向家丁并坐下。").mappedShotIndices).toEqual([]);
  });

  it("产出的草案能通过正式 schema（转身/看向的必填参数都带齐了）", () => {
    for (const text of ["阿菁转身。", "阿菁看向家丁。", "阿菁坐下。"]) {
      const result = compile(text);
      expect(result.errors).toEqual([]);
      expect(manhuaPrevisSpecSchema.safeParse(result.spec).success).toBe(true);
    }
  });
});

describe("文戏草案 · 0917 二轮审查补漏", () => {
  const three: PrevisSourceCharacter[] = [
    { id: "qing", label: "阿菁", tag: "@人物1" },
    { id: "guard", label: "家丁", tag: "@人物2" },
    { id: "boy", label: "小二", tag: "@人物3" },
  ];
  const actionsOf = (r: ReturnType<typeof compile>) =>
    r.spec?.actors.find(a => a.actions.length)?.actions ?? [];

  it("三人及以上同场：主语取句首那个，目标落到真正被看的人", () => {
    const named = compile("阿菁看向家丁。", { characters: three });
    expect(named.mappedShotIndices).toEqual([7]);
    // 目标必须是「家丁」对应的那个 actor，不是角色表里的第二项碰巧对上
    const guardActor = named.spec?.actors.find(a => a.assetRef === "guard");
    expect(actionsOf(named)).toEqual([
      { kind: "look", startSec: 0, endSec: 4, lookAtId: guardActor?.id },
    ]);
    // 换成第三个人也要跟着换目标，而不是恒指第二项
    const other = compile("阿菁看向小二。", { characters: three });
    const boyActor = other.spec?.actors.find(a => a.assetRef === "boy");
    expect(actionsOf(other)[0].lookAtId).toBe(boyActor?.id);
    // 同一份草案里不该顺手把没被提到的家丁也建出来当目标
    expect(other.spec?.actors.map(a => a.assetRef)).toEqual(["qing", "boy"]);
    expect(guardActor?.assetRef).toBe("guard");
  });

  it("标签写法（@人物N）在三人同场也判对主语与目标", () => {
    const tagged = compile("@人物3看向@人物1。", { characters: three });
    expect(tagged.mappedShotIndices).toEqual([7]);
    const subject = tagged.spec?.actors.find(a => a.actions.length);
    expect(subject?.assetRef).toBe("boy");
    expect(subject?.actions[0].lookAtId).toBe(
      tagged.spec?.actors.find(a => a.assetRef === "qing")?.id
    );
  });

  it("目标名互为子串（菁 / 阿菁）时宁可退回未映射，绝不指错人", () => {
    const overlap: PrevisSourceCharacter[] = [
      { id: "jing", label: "菁" },
      { id: "aqing", label: "阿菁" },
      { id: "ming", label: "小明" },
    ];
    // 「阿菁」一出现，「菁」也被算作在场 → 三个人在场，不唯一，退回
    const ambiguous = compile("小明看向阿菁。", { characters: overlap });
    expect(ambiguous.mappedShotIndices).toEqual([]);
    // 正例对照：只提到短名时仍然映射，且指的是短名那个，不是长名那个
    const short = compile("小明看向菁。", { characters: overlap });
    expect(short.mappedShotIndices).toEqual([7]);
    expect(actionsOf(short)[0].lookAtId).toBe(
      short.spec?.actors.find(a => a.assetRef === "jing")?.id
    );
    expect(short.spec?.actors.find(a => a.assetRef === "aqing")).toBeUndefined();
  });

  it("草案里的转身朝向已归一到 ±180，不会产出提交必被拒的角度", () => {
    const spec = createManhuaPrevisStudio(4).spec;
    spec.actors[0].assetRef = "qing";
    spec.actors[0].facingDeg = 90;
    const turned = compile("阿菁转身。", { spec });
    expect(actionsOf(turned)).toEqual([
      { kind: "turn", startSec: 0, endSec: 4, facingDeg: -90 },
    ]);
    expect(manhuaPrevisSpecSchema.safeParse(turned.spec).success).toBe(true);
  });
});

describe("文戏草案 · 0917 三轮审查补漏", () => {
  const actionsOf = (r: ReturnType<typeof compile>) =>
    r.spec?.actors.find(a => a.actions.length)?.actions ?? [];

  it("角色 label 恰好叫「镜头」时，看向的是那个人，不是镜头", () => {
    const withCameraName: PrevisSourceCharacter[] = [
      { id: "qing", label: "阿菁", tag: "@人物1" },
      { id: "lens", label: "镜头", tag: "@人物2" },
    ];
    const result = compile("阿菁看向镜头。", { characters: withCameraName });
    expect(result.mappedShotIndices).toEqual([7]);
    const lensActor = result.spec?.actors.find(a => a.assetRef === "lens");
    expect(lensActor?.id).toBeTruthy();
    expect(actionsOf(result)[0].lookAtId).toBe(lensActor?.id);
    // 反例对照：角色表里没有叫「镜头」的人时，同一句仍然落成看镜头
    expect(actionsOf(compile("阿菁看向镜头。"))[0].lookAtId).toBe("camera");
  });

  it("带骨角色的坐下不再排进草案（与提交门禁同一条边界）", () => {
    const spec = createManhuaPrevisStudio(4).spec;
    spec.actors[0] = {
      ...spec.actors[0],
      assetRef: "qing",
      riggedModel: {
        sourceJobId: "m3d_test_only",
        forwardAxis: "+X",
        targetHeight: 1.7,
      },
    };
    expect(compile("阿菁坐下。", { spec }).mappedShotIndices).toEqual([]);
    // 反例对照：同一句在不带骨的角色上仍然映射得出来
    expect(compile("阿菁坐下。").mappedShotIndices).toEqual([7]);
    // 反例对照：带骨角色的其它文戏动作照常映射，不是被整条跳过
    expect(actionsOf(compile("阿菁行礼。", { spec }))).toEqual([
      { kind: "bow", startSec: 0, endSec: 4 },
    ]);
  });
});
