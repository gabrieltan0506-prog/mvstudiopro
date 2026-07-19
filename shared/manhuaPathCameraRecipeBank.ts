/**
 * 路径运镜配方库：分阶段「镜头沿轨迹 + 主体微动」。
 * 语义来自公开 I2V 路径运镜工作流（自研条目，非第三方预设抄录）。
 */

export type ManhuaPathCameraPhase = {
  index: number;
  focusZh: string;
  cameraEn: string;
  subjectActionEn: string;
  durationHintSec: number;
};

export type ManhuaPathCameraRecipe = {
  id: string;
  no: number;
  nameZh: string;
  effectZh: string;
  whenToUseZh: string;
  craftSummaryZh: string;
  craftLockEn: string;
  phases: readonly ManhuaPathCameraPhase[];
};

export const MANHUA_PATH_CAMERA_RECIPE_BANK: readonly ManhuaPathCameraRecipe[] = [
  {
    id: "path_01_feet_to_face",
    no: 1,
    nameZh: "脚到脸扫描",
    effectZh: "镜头沿身体轨迹由脚推至脸，身份与气质最后落地。",
    whenToUseZh: "人物出场、欲望/压迫铺垫、竖屏人物立卡。",
    craftSummaryZh: "单主运镜：脚→腿→腰→肩→脸；主体分阶段微动；终点落眼神。",
    craftLockEn: "path scan feet-to-face, one primary move, land on eyes",
    phases: [
      { index: 1, focusZh: "脚", cameraEn: "start low on feet, slow push forward", subjectActionEn: "toes flex slightly", durationHintSec: 2 },
      { index: 2, focusZh: "腿", cameraEn: "glide up along legs", subjectActionEn: "subtle leg shift", durationHintSec: 2 },
      { index: 3, focusZh: "腰", cameraEn: "continue upward past waist", subjectActionEn: "soft torso breath", durationHintSec: 2 },
      { index: 4, focusZh: "肩", cameraEn: "rise to shoulders", subjectActionEn: "shoulder micro settle", durationHintSec: 2 },
      { index: 5, focusZh: "脸", cameraEn: "push into face CU", subjectActionEn: "eyes focus toward lens", durationHintSec: 3 },
      { index: 6, focusZh: "眼神", cameraEn: "hold facial CU with micro orbit", subjectActionEn: "tiny gaze shift", durationHintSec: 2 },
    ],
  },
  {
    id: "path_02_orbit_to_face",
    no: 2,
    nameZh: "环绕落脸",
    effectZh: "绕体半圈后收成大特写，空间感转亲密。",
    whenToUseZh: "暧昧、立威、揭面。",
    craftSummaryZh: "先环绕建立空间，再收脸；禁叠第二种大运镜。",
    craftLockEn: "orbit then settle face CU, single primary move",
    phases: [
      { index: 1, focusZh: "全身", cameraEn: "start wide on full figure", subjectActionEn: "still presence", durationHintSec: 2 },
      { index: 2, focusZh: "侧身", cameraEn: "begin soft orbit around subject", subjectActionEn: "hair drifts lightly", durationHintSec: 3 },
      { index: 3, focusZh: "背侧", cameraEn: "continue orbit behind shoulder", subjectActionEn: "fabric micro move", durationHintSec: 3 },
      { index: 4, focusZh: "侧脸", cameraEn: "arc into three-quarter face", subjectActionEn: "head turns slightly", durationHintSec: 3 },
      { index: 5, focusZh: "正脸", cameraEn: "settle into tight face CU", subjectActionEn: "eyes lock", durationHintSec: 3 },
    ],
  },
  {
    id: "path_03_evidence_push",
    no: 3,
    nameZh: "证据逼近推轨",
    effectZh: "从关系景推到证物特写，再抬到反应脸。",
    whenToUseZh: "悬念揭示、权谋翻盘、线索落地。",
    craftSummaryZh: "推轨动机明确：先证物后反应；半拍静默。",
    craftLockEn: "motivated push to evidence then reaction CU",
    phases: [
      { index: 1, focusZh: "关系", cameraEn: "medium two-shot locked", subjectActionEn: "tense stillness", durationHintSec: 2 },
      { index: 2, focusZh: "手", cameraEn: "slow push toward hands", subjectActionEn: "fingers reveal object", durationHintSec: 3 },
      { index: 3, focusZh: "证物", cameraEn: "insert CU on evidence", subjectActionEn: "object catches light", durationHintSec: 3 },
      { index: 4, focusZh: "反应", cameraEn: "whip-soft cut to reaction eyes", subjectActionEn: "pupils tighten", durationHintSec: 3 },
    ],
  },
  {
    id: "path_04_confrontation_track",
    no: 4,
    nameZh: "对峙侧跟",
    effectZh: "侧向跟拍保持轴线，压迫随距离缩短。",
    whenToUseZh: "对峙升级、谈判、走廊追杀前奏。",
    craftSummaryZh: "侧跟保地平；一人逼近一人退；终点落强势眼神。",
    craftLockEn: "lateral track confrontation, readable axis, land on power gaze",
    phases: [
      { index: 1, focusZh: "双人", cameraEn: "lateral track holding both", subjectActionEn: "slow approach", durationHintSec: 3 },
      { index: 2, focusZh: "间距", cameraEn: "keep lateral as gap shrinks", subjectActionEn: "one steps forward", durationHintSec: 3 },
      { index: 3, focusZh: "强势脸", cameraEn: "push slightly to dominant face", subjectActionEn: "jaw set, hard stare", durationHintSec: 3 },
      { index: 4, focusZh: "弱势反应", cameraEn: "cut reverse to reaction", subjectActionEn: "breath hitch", durationHintSec: 2 },
    ],
  },
  {
    id: "path_05_action_burst",
    no: 5,
    nameZh: "打斗短阶段",
    effectZh: "2–3 秒一段：起势→接触→反馈，禁止长段混炖。",
    whenToUseZh: "动作戏、兵器交锋、坠落冲击。",
    craftSummaryZh: "每段一个主运镜+一个击打反馈；景别阶梯清晰。",
    craftLockEn: "2-3s action beats: setup, contact, reaction",
    phases: [
      { index: 1, focusZh: "起势", cameraEn: "wide locked for geography", subjectActionEn: "ready stance", durationHintSec: 2 },
      { index: 2, focusZh: "接触", cameraEn: "quick push into impact zone", subjectActionEn: "strike lands", durationHintSec: 2 },
      { index: 3, focusZh: "反馈", cameraEn: "whip to impact detail", subjectActionEn: "body recoils", durationHintSec: 2 },
      { index: 4, focusZh: "余势", cameraEn: "pull wide for recovery", subjectActionEn: "reset balance", durationHintSec: 2 },
    ],
  },
  {
    id: "path_06_clue_reveal_tilt",
    no: 6,
    nameZh: "线索俯仰揭示",
    effectZh: "由环境细节仰/俯到人物决断脸。",
    whenToUseZh: "悬疑、发现、决意出发。",
    craftSummaryZh: "先锁线索物，再 tilt/push 到决断表情；光线动机一致。",
    craftLockEn: "tilt from clue detail to decisive face",
    phases: [
      { index: 1, focusZh: "线索物", cameraEn: "static insert on clue", subjectActionEn: "none, object still", durationHintSec: 2 },
      { index: 2, focusZh: "手触", cameraEn: "slow tilt up following hand", subjectActionEn: "hand reaches clue", durationHintSec: 3 },
      { index: 3, focusZh: "决断脸", cameraEn: "settle on decisive CU", subjectActionEn: "eyes harden with resolve", durationHintSec: 3 },
    ],
  },
  {
    id: "path_07_intimate_cu_linger",
    no: 7,
    nameZh: "贴面停留",
    effectZh: "极近景微晃停留，情绪说一半留一半。",
    whenToUseZh: "感情戏、耳语、欲言又止。",
    craftSummaryZh: "贴面；微晃；禁大范围环绕；微表情优先。",
    craftLockEn: "intimate CU linger, slight handheld, micro-expression first",
    phases: [
      { index: 1, focusZh: "嘴角", cameraEn: "start on mouth CU", subjectActionEn: "lips part slightly", durationHintSec: 2 },
      { index: 2, focusZh: "眼", cameraEn: "micro tilt to eyes", subjectActionEn: "gaze hesitates", durationHintSec: 3 },
      { index: 3, focusZh: "双眼", cameraEn: "hold with tiny handheld", subjectActionEn: "blink once, withheld emotion", durationHintSec: 4 },
    ],
  },
  {
    id: "path_08_power_crane_down",
    no: 8,
    nameZh: "权力俯落",
    effectZh: "从高位空间俯落到服从/决裂的脸。",
    whenToUseZh: "权谋、宫斗、上下位翻转。",
    craftSummaryZh: "高位起幅→缓慢俯落→终落弱势或翻盘者眼神。",
    craftLockEn: "crane-down from power space to face endpoint",
    phases: [
      { index: 1, focusZh: "空间", cameraEn: "high wide establishing", subjectActionEn: "figures small in space", durationHintSec: 2 },
      { index: 2, focusZh: "下行", cameraEn: "slow crane down", subjectActionEn: "one kneels or stands firm", durationHintSec: 4 },
      { index: 3, focusZh: "终脸", cameraEn: "land on decisive face CU", subjectActionEn: "power gaze or broken stare", durationHintSec: 3 },
    ],
  },
];

export function getPathCameraRecipeById(id?: string | null): ManhuaPathCameraRecipe | null {
  const key = String(id || "").trim();
  if (!key) return null;
  return MANHUA_PATH_CAMERA_RECIPE_BANK.find((e) => e.id === key) || null;
}

export function listPathCameraRecipes(): readonly ManhuaPathCameraRecipe[] {
  return MANHUA_PATH_CAMERA_RECIPE_BANK;
}

/** 将配方 phases 编译为 Seedance 时段运镜句（镜头与主体分写） */
export function compilePathCameraRecipeToMotionPrompt(recipe: ManhuaPathCameraRecipe): string {
  const parts = recipe.phases.map((p) => {
    const t0 = recipe.phases.slice(0, p.index - 1).reduce((s, x) => s + x.durationHintSec, 0);
    const t1 = t0 + p.durationHintSec;
    return `${t0}-${t1}s: camera ${p.cameraEn}; subject ${p.subjectActionEn}`;
  });
  return [
    `One primary path move: ${recipe.craftLockEn}.`,
    "Separate camera from subject action. No stacked camera moves.",
    ...parts,
  ].join(" ");
}

export function buildPathCameraInjectBlock(ids: string[]): string {
  const picked = ids.map(getPathCameraRecipeById).filter(Boolean) as ManhuaPathCameraRecipe[];
  if (!picked.length) return "";
  const lines = picked.map((e, i) => {
    const phaseLine = e.phases
      .map((p) => `${p.index}.${p.focusZh}(${p.durationHintSec}s)`)
      .join("→");
    return `${i + 1}. 【路径运镜】${e.nameZh}：${e.craftSummaryZh}（效果：${e.effectZh}）\n   阶段：${phaseLine}\n   EN: ${e.craftLockEn}`;
  });
  return [
    "【路径运镜配方】",
    "硬规则：每镜一个主运镜；镜头运动与主体动作分开写；按时段推进；禁止导演名/外仓名。",
    "本集主用下列路径配方（可微调变奏）：",
    ...lines,
  ].join("\n");
}

export function recommendPathCameraFromTopic(topic?: string): {
  recipeId: string | null;
  entry: ManhuaPathCameraRecipe | null;
  reasonZh: string;
} {
  const t = String(topic || "").trim();
  const hints: Array<{ keys: string[]; id: string }> = [
    { keys: ["打斗", "对打", "比武", "交锋", "动作"], id: "path_05_action_burst" },
    { keys: ["证据", "线索", "揭穿", "翻盘"], id: "path_03_evidence_push" },
    { keys: ["对峙", "谈判", "逼近"], id: "path_04_confrontation_track" },
    { keys: ["暧昧", "耳语", "欲言又止", "亲吻"], id: "path_07_intimate_cu_linger" },
    { keys: ["权谋", "宫斗", "下跪", "俯视"], id: "path_08_power_crane_down" },
    { keys: ["发现", "决意", "启程"], id: "path_06_clue_reveal_tilt" },
    { keys: ["出场", "立卡", "扫视", "环绕"], id: "path_02_orbit_to_face" },
  ];
  for (const h of hints) {
    if (h.keys.some((k) => t.includes(k))) {
      const entry = getPathCameraRecipeById(h.id);
      return {
        recipeId: entry?.id || null,
        entry,
        reasonZh: `题材偏「${h.keys.find((k) => t.includes(k))}」→ 推荐「${entry?.nameZh}」`,
      };
    }
  }
  const fallback = getPathCameraRecipeById("path_01_feet_to_face");
  return {
    recipeId: fallback?.id || null,
    entry: fallback,
    reasonZh: t ? "未强命中，推荐脚到脸扫描（可更换）" : "未填题材时默认脚到脸扫描（可更换）",
  };
}
