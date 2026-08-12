/**
 * 漫剧 18 运镜词库（学公开「运镜提示词卡」结构，成稿自写，不抄外站文案/不露来源）。
 * 供节拍·反推·成片注入；与 craftShotBank / pathCamera 互补：本库是可点选的运镜原子。
 */

export type ManhuaCameraMoveId =
  | "cam_01_low_angle"
  | "cam_02_high_angle"
  | "cam_03_crane"
  | "cam_04_handheld"
  | "cam_05_whip_pan"
  | "cam_06_pov"
  | "cam_07_follow"
  | "cam_08_back_follow"
  | "cam_09_ots"
  | "cam_10_low_pressure"
  | "cam_11_high_lonely"
  | "cam_12_subjective"
  | "cam_13_closeup"
  | "cam_14_detail"
  | "cam_15_empty"
  | "cam_16_cut_in"
  | "cam_17_slowmo"
  | "cam_18_push_pull"
  | "cam_19_lateral_track"
  | "cam_20_pan_reveal"
  | "cam_21_rack_focus"
  | "cam_22_orbit"
  | "cam_23_peep"
  | "cam_24_establishing"
  | "cam_25_reaction"
  | "cam_26_shot_reverse"
  | "cam_27_low_rush"
  | "cam_28_ending_hold";

export type ManhuaCameraMoveEntry = {
  id: ManhuaCameraMoveId;
  no: number;
  nameZh: string;
  /** 镜头效果 */
  effectZh: string;
  /** 何时用 */
  whenToUseZh: string;
  /** 写入成片/节拍的运镜句 */
  promptZh: string;
  /** 情绪关键词（推荐匹配） */
  emotionTags: readonly string[];
  /**
   * 两拍时序（可选）：本就是两段的运镜给「先A，后B」的拆解句，
   * 秒轴单镜 ≥4s 时展开成时序，不再只落一个孤零零的标签词。
   */
  sequenceZh?: readonly [string, string];
};

export const MANHUA_CAMERA_MOVE_ORDER: readonly ManhuaCameraMoveId[] = [
  "cam_01_low_angle",
  "cam_02_high_angle",
  "cam_03_crane",
  "cam_04_handheld",
  "cam_05_whip_pan",
  "cam_06_pov",
  "cam_07_follow",
  "cam_08_back_follow",
  "cam_09_ots",
  "cam_10_low_pressure",
  "cam_11_high_lonely",
  "cam_12_subjective",
  "cam_13_closeup",
  "cam_14_detail",
  "cam_15_empty",
  "cam_16_cut_in",
  "cam_17_slowmo",
  "cam_18_push_pull",
  "cam_19_lateral_track",
  "cam_20_pan_reveal",
  "cam_21_rack_focus",
  "cam_22_orbit",
  "cam_23_peep",
  "cam_24_establishing",
  "cam_25_reaction",
  "cam_26_shot_reverse",
  "cam_27_low_rush",
  "cam_28_ending_hold",
] as const;

export const MANHUA_CAMERA_MOVE_BANK: readonly ManhuaCameraMoveEntry[] = [
  {
    id: "cam_01_low_angle",
    no: 1,
    nameZh: "低角仰拍",
    effectZh: "抬升角色视觉地位，英雄感/压迫感。",
    whenToUseZh: "逆袭亮相、强势出场、对峙抬势。",
    promptZh: "镜头从极低角度向上拍，角色显得高大有气势。",
    emotionTags: ["气势", "强势", "逆袭", "威压"],
  },
  {
    id: "cam_02_high_angle",
    no: 2,
    nameZh: "高角俯拍",
    effectZh: "人物显渺小无助，适合低落/孤立。",
    whenToUseZh: "失败、孤立、被审视。",
    promptZh: "镜头从高处俯拍，角色显得渺小无助。",
    emotionTags: ["无助", "低落", "孤立", "挫败"],
  },
  {
    id: "cam_03_crane",
    no: 3,
    nameZh: "升降长镜",
    effectZh: "垂直移动展现空间气势与尺度。",
    whenToUseZh: "开场建场、宫殿/都市尺度、转场。",
    promptZh: "镜头垂直向上或向下缓慢移动，展现垂直空间气势。",
    emotionTags: ["宏大", "建场", "震撼"],
    sequenceZh: ["先垂直升起拉开空间尺度", "再缓降落回人物"],
  },
  {
    id: "cam_04_handheld",
    no: 4,
    nameZh: "手持晃动",
    effectZh: "不规则晃动带来紧张与纪实感。",
    whenToUseZh: "追逐、慌乱、突发冲突。",
    promptZh: "手持镜头轻微剧烈晃动，纪实紧迫感。",
    emotionTags: ["紧张", "慌乱", "追逐", "危机"],
  },
  {
    id: "cam_05_whip_pan",
    no: 5,
    nameZh: "极速甩镜",
    effectZh: "横甩产生动态模糊，适合转场或眩晕。",
    whenToUseZh: "硬切转场、信息突转、动作衔接。",
    promptZh: "镜头快速向左或向右横甩，强动态模糊，作转场。",
    emotionTags: ["突转", "眩晕", "转场"],
    sequenceZh: ["先在主体起幅定住", "再瞬间横甩到落幅"],
  },
  {
    id: "cam_06_pov",
    no: 6,
    nameZh: "第一人称 POV",
    effectZh: "模拟角色双眼，强代入。",
    whenToUseZh: "发现异常、恐惧逼近、沉浸决策。",
    promptZh: "第一人称视角，模拟角色双眼所见，前景可带手部。",
    emotionTags: ["恐惧", "发现", "沉浸", "惊悚"],
  },
  {
    id: "cam_07_follow",
    no: 7,
    nameZh: "跟随镜头",
    effectZh: "镜头随角色移动，主体居中，背景动态变。",
    whenToUseZh: "赶路、冲刺、推进目标。",
    promptZh: "镜头跟随角色移动并保持居中，背景动态变化。",
    emotionTags: ["赶路", "冲刺", "紧迫"],
  },
  {
    id: "cam_08_back_follow",
    no: 8,
    nameZh: "背面跟拍",
    effectZh: "身后跟拍前方场景，增强代入。",
    whenToUseZh: "走向未知、潜入、进入场域。",
    promptZh: "镜头跟在角色身后，捕捉前方场景，增强代入感。",
    emotionTags: ["未知", "潜入", "进入"],
  },
  {
    id: "cam_09_ots",
    no: 9,
    nameZh: "过肩镜头",
    effectZh: "越过肩拍对方，对白空间感与真实感。",
    whenToUseZh: "对峙对白、审讯、谈判。",
    promptZh: "镜头越过角色肩膀拍摄对方，增强对话空间感。",
    emotionTags: ["对白", "对峙", "谈判", "审讯"],
  },
  {
    id: "cam_10_low_pressure",
    no: 10,
    nameZh: "低角度压迫",
    effectZh: "低机位仰拍突出气势与压迫。",
    whenToUseZh: "反派施压、权威亮相。",
    promptZh: "镜头从低角度仰拍角色，突出气势与压迫感。",
    emotionTags: ["压迫", "权威", "反派"],
  },
  {
    id: "cam_11_high_lonely",
    no: 11,
    nameZh: "高角度孤影",
    effectZh: "高处俯拍表现渺小或无助。",
    whenToUseZh: "被抛弃、被围观、失败落点。",
    promptZh: "镜头从高处俯拍角色，表现渺小或无助。",
    emotionTags: ["孤寂", "被弃", "落败"],
  },
  {
    id: "cam_12_subjective",
    no: 12,
    nameZh: "主观视角",
    effectZh: "以角色所见展现信息与情绪。",
    whenToUseZh: "看见关键证据/人物的瞬间。",
    promptZh: "以角色主观视角展现其所见画面与焦点。",
    emotionTags: ["证据", "看见", "震惊"],
  },
  {
    id: "cam_13_closeup",
    no: 13,
    nameZh: "特写镜头",
    effectZh: "聚焦五官局部，情绪可读。",
    whenToUseZh: "情绪落点、台词气口、微表情。",
    promptZh: "镜头聚焦角色眼睛或面部细节，突出情绪表情。",
    emotionTags: ["情绪", "微表情", "哭", "怒"],
  },
  {
    id: "cam_14_detail",
    no: 14,
    nameZh: "细节特写",
    effectZh: "聚焦道具/动作细节，信息落地。",
    whenToUseZh: "合同、车票、印章、手机屏等关键道具。",
    promptZh: "镜头聚焦动作或道具细节，增强信息可读与真实感。",
    emotionTags: ["道具", "证据", "细节"],
  },
  {
    id: "cam_15_empty",
    no: 15,
    nameZh: "空镜环境",
    effectZh: "无人环境镜烘托氛围、建场。",
    whenToUseZh: "转场喘息、氛围铺垫（短剧慎用时长）。",
    promptZh: "环境空镜建场烘托氛围；时长宜短，勿空转。",
    emotionTags: ["氛围", "建场", "寂静"],
  },
  {
    id: "cam_16_cut_in",
    no: 16,
    nameZh: "切入快切",
    effectZh: "A 切到 B，节奏与紧张感。",
    whenToUseZh: "反应镜、双人视线对切、信息对撞。",
    promptZh: "快速切入切换：从 A 切到 B，增强节奏与紧张感。",
    emotionTags: ["对切", "反应", "节奏"],
    sequenceZh: ["先定住 A 机位", "再快切到 B 的反应"],
  },
  {
    id: "cam_17_slowmo",
    no: 17,
    nameZh: "慢动作",
    effectZh: "放慢动作拉长情绪与氛围。",
    whenToUseZh: "关键落点、决绝转身、泪落瞬间。",
    promptZh: "以慢动作拍摄角色关键动作，强化情绪落点。",
    emotionTags: ["决绝", "泪", "落点", "诗意"],
    sequenceZh: ["先常速走向动作", "进落点时放慢"],
  },
  {
    id: "cam_18_push_pull",
    no: 18,
    nameZh: "推拉结合",
    effectZh: "先推后拉或先拉后推，叙事节奏起伏。",
    whenToUseZh: "情绪转折、关系远近变化。",
    promptZh: "镜头先推进再拉远，或先拉远再推进，强化叙事节奏。",
    emotionTags: ["转折", "关系", "节奏"],
    sequenceZh: ["先缓推贴近主体", "再匀速拉远还原"],
  },
  {
    id: "cam_19_lateral_track",
    no: 19,
    nameZh: "横移跟走",
    effectZh: "与人物并行等距横移，画面稳定有陪伴感。",
    whenToUseZh: "边走边谈、巡场、并行关系铺垫。",
    promptZh: "镜头与人物平行横向移动，等距跟走，背景匀速掠过。",
    emotionTags: ["行走", "并行", "巡场", "过渡"],
  },
  {
    id: "cam_20_pan_reveal",
    no: 20,
    nameZh: "摇镜引视",
    effectZh: "机位不动的水平摇转，把视线从环境引到主体。",
    whenToUseZh: "揭示新人物/新线索、环境切主体。",
    promptZh: "机位固定，镜头水平缓摇，从环境摇到主体完成视线引导。",
    emotionTags: ["引导", "揭示", "巡视", "转场"],
    sequenceZh: ["先停在环境交代空间", "再摇到主体落焦点"],
  },
  {
    id: "cam_21_rack_focus",
    no: 21,
    nameZh: "移焦切景",
    effectZh: "焦点在前景物与人物间转移，一镜完成情绪切换。",
    whenToUseZh: "道具线索揭示、由物及人的情绪过渡。",
    promptZh: "焦点从前景物件缓慢移到人物面部，同一镜内完成切换。",
    emotionTags: ["线索", "道具", "悬念", "转移"],
  },
  {
    id: "cam_22_orbit",
    no: 22,
    nameZh: "环绕回旋",
    effectZh: "绕主体低速环绕，制造心动或包围压迫。",
    whenToUseZh: "心动瞬间、对峙合围、群像打斗中心。",
    promptZh: "镜头绕人物低速环绕半圈，背景旋转虚化，主体居中。",
    emotionTags: ["心动", "压迫", "包围", "对峙"],
  },
  {
    id: "cam_23_peep",
    no: 23,
    nameZh: "窥视遮挡",
    effectZh: "前景遮挡的偷看视角，秘密感与紧张感并生。",
    whenToUseZh: "偷听密谋、暗中观察、危机逼近。",
    promptZh: "透过门缝、玻璃或遮挡物拍主体，画面带前景遮挡。",
    emotionTags: ["偷看", "密谋", "窥探", "紧张"],
  },
  {
    id: "cam_24_establishing",
    no: 24,
    nameZh: "建立全景",
    effectZh: "大全景先交代空间关系，再进入人物层级。",
    whenToUseZh: "段落开场、换场第一镜。",
    promptZh: "先用大全景交代场景与空间关系，再切入人物。",
    emotionTags: ["建场", "开场", "空间", "交代"],
    sequenceZh: ["先大全景立空间", "再切近景入人物"],
  },
  {
    id: "cam_25_reaction",
    no: 25,
    nameZh: "反应特写",
    effectZh: "台词/动作落点后接对方反应，情绪结果可见。",
    whenToUseZh: "关键台词后、冲突落点后。",
    promptZh: "关键动作或台词落点后，切对方面部反应特写，停半拍再推进。",
    emotionTags: ["反应", "震惊", "回应", "停顿"],
  },
  {
    id: "cam_26_shot_reverse",
    no: 26,
    nameZh: "正反打对话",
    effectZh: "双人对话交替肩背视角，说话归属始终清晰。",
    whenToUseZh: "谈判、质问、双人对手戏。",
    promptZh: "双人对话用正反打交替，过肩带画外者，观众始终知道谁在说话。",
    emotionTags: ["对话", "对峙", "谈判", "质问"],
  },
  {
    id: "cam_27_low_rush",
    no: 27,
    nameZh: "低位突进",
    effectZh: "低角度贴地跟进前冲，速度与力量感拉满。",
    whenToUseZh: "冲刺、追逐、爆发进攻。",
    promptZh: "低角度贴地跟进人物前冲，强化速度与力量感。",
    emotionTags: ["冲刺", "爆发", "追逐", "力量"],
  },
  {
    id: "cam_28_ending_hold",
    no: 28,
    nameZh: "收尾定格",
    effectZh: "段尾拉远或定格，留情绪余韵与下段钩子。",
    whenToUseZh: "每段最后一镜、悬念收口。",
    promptZh: "段落收尾镜头缓缓拉远或突然定格，留出情绪余韵。",
    emotionTags: ["收尾", "余韵", "钩子", "定格"],
    sequenceZh: ["先让动作收住落定", "再拉远或定格留白"],
  },
];

const BY_ID = new Map(MANHUA_CAMERA_MOVE_BANK.map((e) => [e.id, e]));

export function getManhuaCameraMove(id: string | null | undefined): ManhuaCameraMoveEntry | null {
  if (!id) return null;
  return BY_ID.get(id as ManhuaCameraMoveId) || null;
}

/** 运镜句里点名了库内条目名（如「推拉结合」）时认回该条目；自由文本不认，保持原样 */
export function matchManhuaCameraMoveByNameZh(text: string | null | undefined): ManhuaCameraMoveEntry | null {
  const t = String(text || "");
  if (!t) return null;
  return MANHUA_CAMERA_MOVE_BANK.find((e) => t.includes(e.nameZh)) || null;
}

/** 按情绪/动作文本推荐 1 条运镜 */
export function recommendManhuaCameraMoveFromText(raw: string): ManhuaCameraMoveEntry {
  const t = String(raw || "");
  // 硬优先：道具信息 / 对白空间 / 追逐（避免「证据」等泛词误伤）
  if (/合同|车票|红章|印章|手机屏|聊天记录|录音/.test(t) || (/细节/.test(t) && /特写|道具/.test(t))) {
    return BY_ID.get("cam_14_detail")!;
  }
  if (/过肩|对白|审讯|谈判|对话/.test(t)) return BY_ID.get("cam_09_ots")!;
  if (/跑|追|逃|冲刺/.test(t)) return BY_ID.get("cam_07_follow")!;

  let best: ManhuaCameraMoveEntry = MANHUA_CAMERA_MOVE_BANK[12]!; // 默认特写偏情绪
  let score = 0;
  for (const e of MANHUA_CAMERA_MOVE_BANK) {
    let s = 0;
    for (const tag of e.emotionTags) {
      if (t.includes(tag)) s += 2;
    }
    if (t.includes(e.nameZh)) s += 3;
    if (s > score) {
      score = s;
      best = e;
    }
  }
  return best;
}

export function buildManhuaCameraMoveInjectBlock(
  ids: string[] | null | undefined,
  opts?: { limit?: number; title?: string },
): string {
  const limit = opts?.limit ?? 2;
  const picked = (ids || [])
    .map((id) => getManhuaCameraMove(id))
    .filter(Boolean)
    .slice(0, limit) as ManhuaCameraMoveEntry[];
  if (!picked.length) return "";
  const title = opts?.title || "【运镜词库】";
  return [
    title,
    "运镜与人物动作分行写；按情绪选镜，转场要自然。",
    ...picked.map(
      (e) =>
        `${e.no}.${e.nameZh}：${e.promptZh}（效果：${e.effectZh}｜适用：${e.whenToUseZh}）`,
    ),
  ].join("\n");
}

/** 单镜：从动作行推荐并格式化为成片运镜句 */
export function formatRecommendedCameraMoveLine(actionOrScript: string): string {
  const e = recommendManhuaCameraMoveFromText(actionOrScript);
  return `推荐运镜·${e.nameZh}：${e.promptZh}`;
}
