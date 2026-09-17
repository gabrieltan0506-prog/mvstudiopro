/** 本段原镜 → 可审阅动作草案。纯本地编译，不调用模型、不修改原剧本。 */
import {
  createManhuaPrevisStudio,
  manhuaPrevisSpecSchema,
  type ManhuaPrevisSpec,
  type PrevisInteraction,
} from "./manhuaPrevis";

export type PrevisSourceShot = {
  index: number;
  durationSec: number;
  actionZh: string;
};
export type PrevisSourceCharacter = { id: string; label: string; tag?: string };
export type PrevisScriptDraft = {
  spec: ManhuaPrevisSpec | null;
  sourceKey: string;
  mappedShotIndices: number[];
  unmapped: Array<{ index: number; text: string; reasonZh: string }>;
  notes: string[];
  errors: string[];
};
export function previsScriptSourceKey(
  shots: PrevisSourceShot[],
  characters: PrevisSourceCharacter[]
) {
  // 保存完整身份而不是有碰撞风险的短哈希，换剧/改稿后旧草案不可被确认。
  return JSON.stringify({ shots, characters });
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const aliases = (c: PrevisSourceCharacter) =>
  [c.label, c.tag]
    .filter((s): s is string => Boolean(s?.trim()))
    .sort((a, b) => b.length - a.length);
const mention = (c: PrevisSourceCharacter) =>
  "(?:" +
  aliases(c)
    .map(s => escape(s) + (s.startsWith("@") ? "(?![0-9])" : ""))
    .join("|") +
  ")";
const frameTime = (t: number) => Math.round(t * 24) / 24;

export function compilePrevisScriptDraft(input: {
  shots: PrevisSourceShot[];
  characters: PrevisSourceCharacter[];
  currentSpec: ManhuaPrevisSpec;
}): PrevisScriptDraft {
  const { shots, characters, currentSpec } = input;
  const result: PrevisScriptDraft = {
    spec: null,
    sourceKey: previsScriptSourceKey(shots, characters),
    mappedShotIndices: [],
    unmapped: [],
    notes: [],
    errors: [],
  };
  if (currentSpec.effects?.length || currentSpec.exportLayers) {
    result.errors.push(
      "当前特效与分层设置需手动调整；剧本动作草案暂不覆盖已有配置"
    );
    return result;
  }
  if (currentSpec.actors.some(a => a.motionRoute)) {
    result.errors.push(
      "当前分段运动轨需在角色设置中调整；剧本动作草案暂不改写该轨道，已有配置保留"
    );
    return result;
  }
  if (currentSpec.waterEmergence) {
    result.errors.push(
      "当前出水轨需在出水设置中调整；剧本动作草案暂不改写出水轨，已有配置保留"
    );
    return result;
  }
  if (!shots.length) {
    result.errors.push("本段没有真实分镜动作，不能生成草案");
    return result;
  }
  if (
    shots.length > 120 ||
    new Set(shots.map(s => s.index)).size !== shots.length ||
    shots.some(
      s =>
        !Number.isInteger(s.index) ||
        s.index < 1 ||
        !Number.isFinite(s.durationSec) ||
        s.durationSec <= 0 ||
        s.actionZh.length > 20000
    )
  ) {
    result.errors.push("原镜编号、时长或文本不合法；未截断原文");
    return result;
  }
  if (
    characters.some(c => !c.id || !c.label.trim()) ||
    new Set(characters.map(c => c.id)).size !== characters.length ||
    new Set(characters.map(c => c.label)).size !== characters.length ||
    new Set(characters.flatMap(c => (c.tag ? [c.tag] : []))).size !==
      characters.filter(c => c.tag).length
  ) {
    result.errors.push("项目角色身份或名称有重复，请先明确绑定");
    return result;
  }
  const duration = shots.reduce((n, s) => n + s.durationSec, 0);
  if (
    duration < 2 ||
    duration > 30 ||
    Math.abs(duration - Math.round(duration)) > 1e-6
  ) {
    result.errors.push("本段动作草案须为2—30整数秒；不自动缩短或拉伸原镜");
    return result;
  }
  const spec = createManhuaPrevisStudio(duration).spec;
  spec.aspect = currentSpec.aspect;
  if (currentSpec.durationSec === duration)
    spec.cameras = structuredClone(currentSpec.cameras);
  spec.actors = [];
  const interactions: PrevisInteraction[] = [];
  const actorByAsset = new Map<string, ManhuaPrevisSpec["actors"][number]>();
  const actorFor = (c: PrevisSourceCharacter) => {
    let actor = actorByAsset.get(c.id);
    if (actor) return actor;
    const old = currentSpec.actors.find(a => a.assetRef === c.id);
    const i = spec.actors.length;
    const x = i === 0 ? -0.35 : i === 1 ? 0.35 : (i - 1) * 1.2;
    actor = {
      ...createManhuaPrevisStudio(duration).spec.actors[0],
      ...(old ? structuredClone(old) : {}),
      id: old?.id ?? "script-actor-" + (i + 1),
      nameZh: c.label,
      assetRef: c.id,
      start: old ? [...old.start] : [x, 0],
      end: old ? [...old.end] : [x, 0],
      facingDeg: old?.facingDeg ?? (i === 1 ? 180 : 0),
      actions: [],
    };
    if (
      old &&
      old.moveStartSec >= 0 &&
      old.moveEndSec <= duration &&
      old.moveEndSec > old.moveStartSec
    ) {
      actor.moveStartSec = old.moveStartSec;
      actor.moveEndSec = old.moveEndSec;
    }
    spec.actors.push(actor);
    actorByAsset.set(c.id, actor);
    return actor;
  };
  let cursor = 0;
  for (const shot of shots) {
    const start = cursor,
      end = cursor + shot.durationSec;
    cursor = end;
    const text = shot.actionZh.trim();
    // 仅忽略排版符号，不能删除否定词、连接词或未支持的动作后假装整镜已映射。
    const sentence = text.replace(/[\s，,。.!！；;]/g, "");
    const reject = (reasonZh: string) =>
      result.unmapped.push({ index: shot.index, text, reasonZh });
    if (
      Math.abs(start * 24 - Math.round(start * 24)) > 1e-6 ||
      Math.abs(end * 24 - Math.round(end * 24)) > 1e-6 ||
      end - start < 0.5
    ) {
      reject("原镜边界不落在24帧时间轴或短于半秒，需要人工配置");
      continue;
    }
    // 否定、假设或多动作长句不猜意图；原文完整进入未映射清单。
    if (
      /(?:没有|并未|未曾|尚未|未击中|不再|不要|不能|试图|想要|假装|如果|可能|准备|欲出|即将|躲开|避开|格挡失败|收住)/.test(
        text
      )
    ) {
      reject("含否定或未发生动作，不能自动当作实际事件");
      continue;
    }
    const pairs: Array<[PrevisSourceCharacter, PrevisSourceCharacter]> = [];
    for (const a of characters)
      for (const b of characters) {
        if (a.id === b.id) continue;
        const ar = mention(a),
          br = mention(b);
        const matches =
          text.match(
            new RegExp(
              ar +
                "(?:向|朝|对)" +
                br +
                "(?:的胸前|胸前)?(?:出拳|出手|挥拳|攻击|击打)|" +
                ar +
                "(?:出拳击中|挥拳击中|一拳打向|一拳击中)" +
                br,
              "g"
            )
          ) ?? [];
        for (const _match of matches) pairs.push([a, b]);
      }
    if (pairs.length > 1) {
      reject("同镜含多次或多方攻击，需要人工拆分事件");
      continue;
    }
    if (pairs.length === 1) {
      const [a, b] = pairs[0];
      const targetPattern = mention(b);
      const guard = new RegExp(
        targetPattern + "(?:抬臂|举手|抬手)?(?:格挡|挡住)"
      ).test(text);
      const explicitHit = new RegExp(
        mention(a) + "(?:出拳击中|挥拳击中|一拳击中)" + targetPattern
      ).test(text);
      const recoil =
        new RegExp(
          targetPattern + "(?:受击|中拳|被击中)(?:后缩|后仰|踉跄)?"
        ).test(text) ||
        (explicitHit &&
          new RegExp(targetPattern + "(?:后缩|后仰|踉跄)").test(text));
      if (!guard && !recoil) {
        reject("已找到出手双方，但原文没有明确格挡或受击反应");
        continue;
      }
      if (guard && recoil) {
        reject("同镜同时格挡与受击，需人工明确接触结果");
        continue;
      }
      const attackPattern =
        mention(a) +
        "(?:向|朝|对)" +
        targetPattern +
        "(?:的胸前|胸前)?(?:出拳|出手|挥拳|攻击|击打)|" +
        mention(a) +
        "(?:出拳击中|挥拳击中|一拳打向|一拳击中)" +
        targetPattern;
      const reactionPattern = guard
        ? targetPattern + "(?:抬臂|举手|抬手)?(?:格挡|挡住)"
        : targetPattern +
          "(?:(?:受击|中拳|被击中)(?:后缩|后仰|踉跄)?|后缩|后仰|踉跄)";
      if (
        !new RegExp(
          "^(?:" +
            attackPattern +
            ")(?:随后|接着|然后)?" +
            reactionPattern +
            "$"
        ).test(sentence)
      ) {
        reject("同镜还有未支持或重复的动作，不能将部分匹配当作整镜完成");
        continue;
      }
      const actor = actorFor(a),
        target = actorFor(b);
      if (actor.shape !== "human" || target.shape !== "human") {
        reject("双人短打仅支持人体角色");
        continue;
      }
      interactions.push({
        id: "shot-" + shot.index + "-interaction",
        kind: guard ? "strike_guard" : "strike_recoil",
        actorId: actor.id,
        targetActorId: target.id,
        startSec: start,
        contactSec: frameTime((start + end) / 2),
        endSec: end,
      });
      result.mappedShotIndices.push(shot.index);
      continue;
    }
    const present = characters.filter(c => new RegExp(mention(c)).test(text));
    const kinds = [
      ["strike", /(?:出拳|挥拳|出手)/],
      ["guard", /(?:抬臂保护|抬手保护|格挡)/],
      ["recoil", /(?:后缩|后仰|受惊)/],
      ["idle", /(?:待机|静立|站定|保持站位)/],
    ] as const;
    const matches = kinds.filter(([, re]) => re.test(text));
    if (present.length !== 1 || matches.length !== 1) {
      reject("动作或角色无法唯一匹配当前动作库");
      continue;
    }
    const wholeAction = new RegExp(
      "^" +
        mention(present[0]) +
        "(?:缓慢|缓缓|轻轻|迅速|快速|原地)?" +
        matches[0][1].source +
        "(?:一次)?$"
    );
    if (!wholeAction.test(sentence)) {
      reject("含否定、重复或未支持动作，不能将部分匹配当作整镜完成");
      continue;
    }
    const actor = actorFor(present[0]);
    if (actor.shape === "horse" && matches[0][0] !== "idle") {
      reject("四足角色不能套人体动作");
      continue;
    }
    actor.actions.push({ kind: matches[0][0], startSec: start, endSec: end });
    result.mappedShotIndices.push(shot.index);
  }
  if (!result.mappedShotIndices.length) {
    result.errors.push("没有可执行的已识别动作，保留原配置");
    return result;
  }
  spec.interactions = interactions;
  spec.scriptSource = {
    compilerVersion: 1,
    shots: shots.map(s => ({ ...s })),
    unmappedShotIndices: result.unmapped.map(s => s.index),
  };
  result.notes.push(
    "只编排上述基础动作；未识别原镜完整保留，不自动生成。",
    "新增角色站位为待审建议，已有绑定角色沿用站位；接触秒位为镜内中点建议，提交前可调整。"
  );
  const parsed = manhuaPrevisSpecSchema.safeParse(spec);
  if (!parsed.success)
    result.errors.push(...parsed.error.issues.map(i => i.message));
  else result.spec = parsed.data;
  return result;
}
