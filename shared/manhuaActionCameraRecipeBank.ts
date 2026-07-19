/**
 * 动作运镜配方：FPV / 打斗全景轨迹 / 红蓝双轨迹一镜到底。
 * 语义来自公开 I2V 轨迹教程（自研条目，不抄原片）。
 */

export type ManhuaActionTrackMode = "fpv" | "single_action" | "dual";

export type ManhuaActionCameraRecipe = {
  id: string;
  no: number;
  nameZh: string;
  trackMode: ManhuaActionTrackMode;
  effectZh: string;
  whenToUseZh: string;
  craftSummaryZh: string;
  craftLockEn: string;
  seedancePromptZh: string;
};

export const MANHUA_ACTION_CAMERA_RECIPE_BANK: readonly ManhuaActionCameraRecipe[] = [
  {
    id: "action_fpv_stadium",
    no: 1,
    nameZh: "穿越机掠群",
    trackMode: "fpv",
    effectZh: "鱼眼畸变+径向运动模糊，高速俯冲掠过人群/球场。",
    whenToUseZh: "球赛、战争群像、大场面开场、多人群演。",
    craftSummaryZh: "单主运镜=FPV 冲刺；禁叠第二种大运镜；人群地理可读。",
    craftLockEn: "FPV fisheye dive, radial motion blur, readable crowd geography, one primary move",
    seedancePromptZh:
      "第一人称穿越机视角高速掠过人群与场地，鱼眼畸变，径向运动模糊，方向清晰，主体位置稳定，禁止轨迹线出现在成片。",
  },
  {
    id: "action_fight_panorama_track",
    no: 2,
    nameZh: "打斗全景轨迹",
    trackMode: "single_action",
    effectZh: "先全景静帧，再沿动作轨迹完成移动/闪避/攻击。",
    whenToUseZh: "打斗、追逐、对战、兵器交锋。",
    craftSummaryZh: "人物沿红色动作轨；镜头相对稳或轻跟；2–3 秒一段击打反馈。",
    craftLockEn: "fight along action track: move dodge attack, smooth, stable positions, hide guides",
    seedancePromptZh:
      "两人或多人沿着画面中的运动轨迹进行打斗，完成移动、闪避和攻击。动作流畅，方向明确，人物位置稳定。轨迹线仅作参考，最终画面不显示。",
  },
  {
    id: "action_dual_track_oner",
    no: 3,
    nameZh: "红蓝双轨一镜",
    trackMode: "dual",
    effectZh: "红轨=人物动作，蓝轨=镜头路径；可绕过主体的一镜调度。",
    whenToUseZh: "一镜到底、多人群演、复杂空间调度。",
    craftSummaryZh: "人物严格沿红轨；镜头严格沿蓝轨；人/景/空间关系稳定；可绕过主体。",
    craftLockEn:
      "dual tracks: subject on red path, camera on blue path, may bypass subject, hide guide lines",
    seedancePromptZh:
      "参考轨迹图、人物参考与场景图生成视频。人物严格沿红色轨迹移动与打斗；镜头严格沿蓝色轨迹运动。保持人物一致、场景一致、空间关系稳定；动作流畅、方向明确。轨迹线仅作参考，最终画面不显示。",
  },
];

export function getActionCameraRecipeById(id?: string | null): ManhuaActionCameraRecipe | null {
  const key = String(id || "").trim();
  if (!key) return null;
  return MANHUA_ACTION_CAMERA_RECIPE_BANK.find((e) => e.id === key) || null;
}

export function listActionCameraRecipes(): readonly ManhuaActionCameraRecipe[] {
  return MANHUA_ACTION_CAMERA_RECIPE_BANK;
}

export function buildActionCameraInjectBlock(ids: string[]): string {
  const picked = ids.map(getActionCameraRecipeById).filter(Boolean) as ManhuaActionCameraRecipe[];
  if (!picked.length) return "";
  const lines = picked.map(
    (e, i) =>
      `${i + 1}. 【动作运镜·${e.trackMode}】${e.nameZh}：${e.craftSummaryZh}\n   Seedance：${e.seedancePromptZh}`,
  );
  return [
    "【动作运镜配方】",
    "硬规则：红轨人物 / 蓝轨镜头（双轨时）；轨迹线最终不显示；禁止导演名与外仓品牌。",
    ...lines,
  ].join("\n");
}

export function recommendActionCameraFromTopic(topic?: string): {
  recipeId: string | null;
  entry: ManhuaActionCameraRecipe | null;
  reasonZh: string;
} {
  const t = String(topic || "").trim();
  const hints: Array<{ keys: string[]; id: string }> = [
    { keys: ["穿越", "FPV", "球场", "球赛", "人群", "战争群"], id: "action_fpv_stadium" },
    { keys: ["打斗", "对打", "比武", "交锋", "闪避"], id: "action_fight_panorama_track" },
    { keys: ["一镜", "双轨", "绕过", "群演", "调度"], id: "action_dual_track_oner" },
  ];
  for (const h of hints) {
    if (h.keys.some((k) => t.includes(k))) {
      const entry = getActionCameraRecipeById(h.id);
      return {
        recipeId: entry?.id || null,
        entry,
        reasonZh: `题材偏「${h.keys.find((k) => t.includes(k))}」→ 推荐「${entry?.nameZh}」`,
      };
    }
  }
  const fallback = getActionCameraRecipeById("action_dual_track_oner");
  return {
    recipeId: fallback?.id || null,
    entry: fallback,
    reasonZh: "未强命中，推荐红蓝双轨一镜（可更换）",
  };
}

/** 双轨中文编译（Seedance / I2V / 界面同一套） */
export function compileDualTrackMotionPrompt(opts: {
  subjectBeats: string[];
  cameraBeats: string[];
}): string {
  const subject = opts.subjectBeats.filter(Boolean);
  const camera = opts.cameraBeats.filter(Boolean);
  return [
    "红蓝双轨：人物沿红轨动作，镜头沿蓝轨调度。",
    "成片不显示轨迹参考线。",
    subject.length ? `人物节拍：${subject.join(" → ")}` : "",
    camera.length ? `镜头节拍：${camera.join(" → ")}` : "",
    "保持人物身份、场景连续与空间关系稳定，动作流畅。",
  ]
    .filter(Boolean)
    .join("\n");
}
