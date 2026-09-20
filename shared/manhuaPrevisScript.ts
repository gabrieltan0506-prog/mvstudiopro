/** 本段原镜 → 可审阅动作草案。纯本地编译，不调用模型、不修改原剧本。 */
import {
  PREVIS_LOOK_AT_CAMERA,
  createManhuaPrevisStudio,
  manhuaPrevisSpecSchema,
  normalizeFacingDeg,
  previsActorTravelsDuring,
  type PrevisActionKind,
  type ManhuaPrevisSpec,
  type PrevisInteraction,
} from "./manhuaPrevis";

/** 朝向归一的唯一实现在 manhuaPrevis.ts；这里只做转出，旧引用路径不断。 */
export { normalizeFacingDeg };

/**
 * 草案编译认得的动作动词表（唯一真源，面板提示也读它）。
 * 0917 PR-E：打戏四类之外补文戏六类；镜头描述型分镜（中近景/特写/固定机位）仍会 0 映射——设计边界。
 */
export const PREVIS_SCRIPT_DRAFT_KINDS = [
  ["strike", /(?:出拳|挥拳|出手)/],
  ["guard", /(?:抬臂保护|抬手保护|格挡)/],
  ["recoil", /(?:后缩|后仰|受惊)/],
  ["idle", /(?:待机|静立|站定|保持站位)/],
  ["walk", /(?:走向|走到|走近|迈步)/],
  // 「回头」通常是扭头去看，不是整个人站位翻面；写进 turn 会把它排成 180 度整体转身，
  // 而它又没有注视目标可落 → 从词表拿掉，让这类句子退回未映射由人工写清楚（0917 审查提出）。
  ["turn", /(?:转身|回身)/],
  ["look", /(?:看向|望向|注视|看着)/],
  ["sit", /(?:坐下|落座|坐到)/],
  ["gesture_point", /(?:指向|抬手指|伸手指)/],
  ["bow", /(?:行礼|拱手|鞠躬|俯身行礼)/],
  ["cough", /(?:咳嗽|咳喘|轻咳)/],
] as const satisfies readonly (readonly [PrevisActionKind, RegExp])[];

/**
 * 这些动作后面可能跟一个目标（同场角色或镜头）。整镜唯一匹配要把它吃进来才判得准，
 * 但只有「看向」能真的落进 spec；其余写了目标一律退回未映射（见下方编译处）。
 */
export const PREVIS_DRAFT_KINDS_WITH_TARGET: readonly PrevisActionKind[] = [
  "walk",
  "look",
  "gesture_point",
  "bow",
];

/** 提示文案用：把上表摊平成「出拳 / 挥拳 / 出手」这样的可读词组。 */
export function previsScriptDraftVocabularyZh(): string[] {
  return PREVIS_SCRIPT_DRAFT_KINDS.map(([, re]) =>
    re.source.replace(/^\(\?:/, "").replace(/\)$/, "").split("|").join(" / "),
  );
}


/** 角色在已排动作之后的朝向：前一次转身的目标，否则是初始朝向。 */
function lastFacingOf(actor: { facingDeg: number; actions: { kind: string; facingDeg?: number }[] }): number {
  for (let i = actor.actions.length - 1; i >= 0; i -= 1) {
    const action = actor.actions[i];
    if (action.kind === "turn" && Number.isFinite(action.facingDeg)) return Number(action.facingDeg);
  }
  return actor.facingDeg;
}

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
/** 首次白模沿用成片段长以满足采用合同；无有效段长才用原镜总时长。 */
export function previsInitialDurationSec(shots: PrevisSourceShot[], clipDuration?: number | null): number {
  if (clipDuration != null && Number.isInteger(clipDuration) && clipDuration >= 2 && clipDuration <= 30) return clipDuration;
  const total = shots.reduce((n, shot) => n + shot.durationSec, 0);
  if (shots.length && shots.every(s => Number.isFinite(s.durationSec) && s.durationSec > 0)
    && Number.isInteger(total) && total >= 2 && total <= 30) return total;
  return 10;
}
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
    const matches = PREVIS_SCRIPT_DRAFT_KINDS.filter(([, re]) => re.test(text));
    if (matches.length !== 1) {
      reject("动作或角色无法唯一匹配当前动作库");
      continue;
    }
    const [kind, kindPattern] = matches[0];
    const takesTarget = PREVIS_DRAFT_KINDS_WITH_TARGET.includes(kind);
    // 「阿菁看向家丁」里出现两个人物，但只有一个是动作主语：句首那个。
    // 不带目标的动作仍然只许出现一个人物，免得把双人戏当独角戏排。
    const subject = present.find(c => new RegExp("^" + mention(c)).test(sentence));
    if (present.length !== 1 && !(takesTarget && present.length === 2 && subject)) {
      reject("动作或角色无法唯一匹配当前动作库");
      continue;
    }
    if (subject && present.length === 2) present.splice(0, present.length, subject, ...present.filter(c => c !== subject));
    // 0917 PR-E：文戏动作可以带一个目标（「阿菁看向娘」「阿菁走向娘」）。
    // 目标只认同场角色名或「镜头」，不认自由文本——否则又变成把部分匹配当整镜。
    const others = characters.filter(c => c !== present[0]);
    const targetPattern =
      "(?:" + [...others.map(c => mention(c)), "镜头", "镜头方向"].join("|") + ")";
    const wholeAction = new RegExp(
      "^" +
        mention(present[0]) +
        "(?:缓慢|缓缓|轻轻|迅速|快速|原地)?" +
        kindPattern.source +
        (PREVIS_DRAFT_KINDS_WITH_TARGET.includes(kind) ? "(" + targetPattern + ")?" : "") +
        "(?:一次)?$"
    );
    const whole = wholeAction.exec(sentence);
    if (!whole) {
      reject("含否定、重复或未支持动作，不能将部分匹配当作整镜完成");
      continue;
    }
    const actor = actorFor(present[0]);
    if (actor.shape === "horse" && kind !== "idle") {
      reject("四足角色不能套人体动作");
      continue;
    }
    // 与提交门禁同一条边界：带骨真模坐下会穿地（实测 21—32 厘米），草案就不要排出来
    // 让用户到提交时才被拒。判据在 manhuaPrevisSpecSchema，这里只是提前退回未映射。
    if (kind === "sit" && actor.riggedModel) {
      reject("带骨角色暂不支持坐下：静止姿态差会让脚穿地（1.70 米约 21 厘米），待重定向补偿后开放（PR-F）；棍人角色可以坐下，带骨角色的看向/转身/行礼不受影响");
      continue;
    }
    const targetText = whole[1] ?? "";
    // 0917 审查：只有「看向」能把目标真的落进 spec。走位/指向的目标白模表达不了
    // （走位不改站位、指向只按角色自身朝向抬手），映射了等于把原文的调度信息吞掉，
    // 还要让白模摆出一个指不到人的姿势。写了目标就退回未映射，让人工补站位/朝向。
    if (targetText && kind !== "look") {
      reject("原文写了动作目标，但走位/指向的目标白模还表达不了，请人工设站位或朝向");
      continue;
    }
    if (kind === "walk") {
      // 走位只出摆臂步态，位移来自站位区间；站着不动就不排走位，免得原地摆臂假装在走。
      // 判据与提交门禁共用 previsActorTravelsDuring，不在这里再写一遍。
      if (!previsActorTravelsDuring(actor, start, end)) {
        reject("该角色本段没有实际位移，走位步态会原地摆臂，请先设好起止站位");
        continue;
      }
    }
    if (kind === "look") {
      // 看向必须知道看谁：写不清就不猜，退回未映射让人工补。
      if (!targetText) {
        reject("看向没有写明目标，不替用户猜注视对象");
        continue;
      }
      // 0917 二轮审查：这里过去是 `others.find(…)!` 的非空断言 + 子串匹配。
      // 子串匹配在「菁」与「阿菁」并存时会先命中短的那个（实测这种句子会先被
      // present.length 拦下，没有真的映错）；但判据不能靠另一道门兜着。
      // 改成整串匹配，并把非空断言换成显式退回：解不出目标时只该这一镜未映射，
      // 不能抛异常把整份草案编译炸掉。
      // 0917 三轮审查：先解角色、解不出才当镜头。原来是先看 startsWith("镜头")，
      // 于是一个 label 就叫「镜头」的角色会被判成看镜头——原文明明写的是看那个人。
      const targetActor = others.find(c => new RegExp("^" + mention(c) + "$").test(targetText));
      if (!targetActor && !/^镜头(?:方向)?$/.test(targetText)) {
        reject("看向的目标对应不到唯一的同场角色");
        continue;
      }
      const lookAtId = targetActor ? actorFor(targetActor).id : PREVIS_LOOK_AT_CAMERA;
      actor.actions.push({ kind, startSec: start, endSec: end, lookAtId });
    } else if (kind === "turn") {
      // 原文只说「转身/回头」，没有角度信息：一律按转向背面 180°，由人工再调。
      if (actor.motionRoute?.length) {
        reject("该角色已有运动轨迹，朝向以轨迹为准，不再叠加转身");
        continue;
      }
      const from = lastFacingOf(actor);
      actor.actions.push({
        kind,
        startSec: start,
        endSec: end,
        facingDeg: normalizeFacingDeg(from + 180),
      });
    } else {
      actor.actions.push({ kind, startSec: start, endSec: end });
    }
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
