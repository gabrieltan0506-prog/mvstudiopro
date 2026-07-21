/**
 * 漫剧「机位密码」10 角（学公开机位卡结构，成稿自写；不抄外站原文、不露来源）。
 * 与 manhuaCameraMoveBank（运镜运动）互补：本库偏构图角度/视线关系。
 */

export type ManhuaCameraAngleId =
  | "ang_01_eye_level"
  | "ang_02_low"
  | "ang_03_high"
  | "ang_04_ots"
  | "ang_05_pov"
  | "ang_06_front"
  | "ang_07_profile"
  | "ang_08_top"
  | "ang_09_back"
  | "ang_10_oblique";

export type ManhuaCameraAngleEntry = {
  id: ManhuaCameraAngleId;
  no: number;
  nameZh: string;
  /** 视觉功能 */
  functionZh: string;
  whenToUseZh: string;
  /** 写入分镜/静帧的机位句 */
  promptZh: string;
  /** 技术参数摘要（对用户中性表述） */
  techHintZh: string;
  /** 可与运镜库搭配的 emotion/场景词 */
  tags: readonly string[];
};

export const MANHUA_CAMERA_ANGLE_ORDER: readonly ManhuaCameraAngleId[] = [
  "ang_01_eye_level",
  "ang_02_low",
  "ang_03_high",
  "ang_04_ots",
  "ang_05_pov",
  "ang_06_front",
  "ang_07_profile",
  "ang_08_top",
  "ang_09_back",
  "ang_10_oblique",
] as const;

export const MANHUA_CAMERA_ANGLE_BANK: readonly ManhuaCameraAngleEntry[] = [
  {
    id: "ang_01_eye_level",
    no: 1,
    nameZh: "平视",
    functionZh: "客观自然，角色与观众视线平等。",
    whenToUseZh: "日常对白、人物介绍、室内生活戏。",
    promptZh: "平视机位，镜头高度与角色双眼齐平，正面或微侧，中近景，表情自然。",
    techHintZh: "高度≈眼平 · 倾角 0°",
    tags: ["对白", "日常", "介绍", "平静"],
  },
  {
    id: "ang_02_low",
    no: 2,
    nameZh: "仰拍",
    functionZh: "抬升气场，强调权威与压迫。",
    whenToUseZh: "反派登场、英雄亮相、战前对峙。",
    promptZh: "低机位仰拍，镜头低于腰线向上看，中景，突出高大轮廓与压迫背景。",
    techHintZh: "高度低于腰 · 仰角约 30–35°",
    tags: ["气势", "威压", "亮相", "对峙"],
  },
  {
    id: "ang_03_high",
    no: 3,
    nameZh: "俯拍",
    functionZh: "人物显渺小，环境压力与孤立感。",
    whenToUseZh: "挫败、被困、孤独、压抑情绪。",
    promptZh: "高机位俯拍，镜头高于头顶向下约 45°，中远景，冷调氛围，留白压迫。",
    techHintZh: "高度高于头 · 俯角约 45°",
    tags: ["无助", "孤立", "压抑", "挫败"],
  },
  {
    id: "ang_04_ots",
    no: 4,
    nameZh: "过肩",
    functionZh: "建立双方空间关系，引导注视对白。",
    whenToUseZh: "谈判、争辩、审讯、师生对谈。",
    promptZh: "越过一人右肩看向对面角色，前景肩部虚化轮廓，对焦对方中近景。",
    techHintZh: "前景肩线 · 对焦对面",
    tags: ["对白", "谈判", "审讯", "关系"],
  },
  {
    id: "ang_05_pov",
    no: 5,
    nameZh: "第一人称",
    functionZh: "模拟角色所见，强沉浸。",
    whenToUseZh: "醒来、追逐、窥探、突袭。",
    promptZh: "第一人称主观视角，正前方视线，画面可含角色双手或兵器前景，临场感强。",
    techHintZh: "主观视线 · 可带手部/兵器",
    tags: ["沉浸", "恐惧", "追逐", "发现"],
  },
  {
    id: "ang_06_front",
    no: 6,
    nameZh: "正面",
    functionZh: "直给情绪与表情信息。",
    whenToUseZh: "情绪爆发、独白、正面对峙、人物定妆。",
    promptZh: "角色正对镜头，高度与面部齐平，中近景，五官与情绪清晰可读。",
    techHintZh: "正对镜头 · 面平高度",
    tags: ["情绪", "独白", "对峙", "定妆"],
  },
  {
    id: "ang_07_profile",
    no: 7,
    nameZh: "侧面",
    functionZh: "强调轮廓与运动轨迹方向感。",
    whenToUseZh: "行走奔跑、策马、挥剑横移、双人对峙侧面。",
    promptZh: "90° 侧面机位，胸平高度，中景，轮廓清晰，运动轨迹可读。",
    techHintZh: "侧向 90° · 胸平",
    tags: ["动作", "轮廓", "行走", "剑"],
  },
  {
    id: "ang_08_top",
    no: 8,
    nameZh: "顶视",
    functionZh: "交代空间布局与人物站位关系。",
    whenToUseZh: "群戏、宴席、阵型、房间结构、倒地。",
    promptZh: "镜头垂直向下 90° 顶视，清楚交代人物与场景相对位置，几何构图。",
    techHintZh: "垂直俯视 90°",
    tags: ["布局", "群戏", "宴席", "阵型"],
  },
  {
    id: "ang_09_back",
    no: 9,
    nameZh: "背面",
    functionZh: "情绪留白与悬念，角色看向远方。",
    whenToUseZh: "离别、望向远方、踏入新空间、战前沉默。",
    promptZh: "机位在人物身后向前延伸，中远景，角色背影看向远景空间，神秘沉浸。",
    techHintZh: "身后向前 · 倾角 0°",
    tags: ["离别", "悬念", "远望", "开场"],
  },
  {
    id: "ang_10_oblique",
    no: 10,
    nameZh: "斜侧",
    functionZh: "45° 斜侧增加立体层次与张力。",
    whenToUseZh: "出场亮相、回眸、持械pose、情绪中近景。",
    promptZh: "前侧 45° 斜侧机位，平视，中近景，脸与动作与空间层次兼得。",
    techHintZh: "前侧 45° · 平视",
    tags: ["立体", "亮相", "回眸", "张力"],
  },
];

const BY_ID = new Map(MANHUA_CAMERA_ANGLE_BANK.map((e) => [e.id, e]));

export function getManhuaCameraAngle(id: string | null | undefined): ManhuaCameraAngleEntry | null {
  if (!id) return null;
  return BY_ID.get(id as ManhuaCameraAngleId) || null;
}

export function recommendManhuaCameraAngleFromText(raw: string): ManhuaCameraAngleEntry {
  const t = String(raw || "");
  if (/过肩|对白|审讯|谈判/.test(t)) return BY_ID.get("ang_04_ots")!;
  if (/第一人称|主观|pov|手持武器看/.test(t)) return BY_ID.get("ang_05_pov")!;
  if (/顶视|鸟瞰|布局|宴席|阵型/.test(t)) return BY_ID.get("ang_08_top")!;
  if (/背面|背影|远望|离别/.test(t)) return BY_ID.get("ang_09_back")!;
  if (/侧面|轮廓|策马|挥剑/.test(t)) return BY_ID.get("ang_07_profile")!;
  if (/仰拍|仰视|气势|威压|亮相/.test(t)) return BY_ID.get("ang_02_low")!;
  if (/俯拍|俯视|无助|孤立|压抑/.test(t)) return BY_ID.get("ang_03_high")!;
  if (/斜侧|45|回眸/.test(t)) return BY_ID.get("ang_10_oblique")!;
  if (/正面|独白|正对/.test(t)) return BY_ID.get("ang_06_front")!;
  return BY_ID.get("ang_01_eye_level")!;
}

export function formatManhuaCameraAngleLine(entry: ManhuaCameraAngleEntry): string {
  return `机位·${entry.nameZh}：${entry.promptZh}`;
}

export function buildManhuaCameraAngleInjectBlock(
  ids: string[] | null | undefined,
  opts?: { limit?: number },
): string {
  const limit = opts?.limit ?? 2;
  const picked = (ids || [])
    .map((id) => getManhuaCameraAngle(id))
    .filter(Boolean)
    .slice(0, limit) as ManhuaCameraAngleEntry[];
  if (!picked.length) return "";
  return [
    "【机位密码】",
    ...picked.map(
      (e) =>
        `${e.no}.${e.nameZh}：${e.promptZh}（功能：${e.functionZh}｜适用：${e.whenToUseZh}）`,
    ),
  ].join("\n");
}
