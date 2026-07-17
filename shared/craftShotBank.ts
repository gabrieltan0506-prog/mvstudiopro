/**
 * 拍摄手法条目库（灯光 / 运镜 / 情绪 / 转场）。
 * 结构借鉴公开「条目化 prompt 库」分类法；成稿只写手法词，不出现导演名/片名/外仓名。
 * 与 `CRAFT_TECHNIQUE_PROFILES`（整卡气质）互补：本库是可点选的原子镜头手法。
 * 主消费：/canvas 节拍·反推·静帧注入。
 */

export type CraftShotCategory = "lighting" | "camera" | "emotion" | "transition";

export const CRAFT_SHOT_CATEGORY_LABEL_ZH: Record<CraftShotCategory, string> = {
  lighting: "灯光塑形",
  camera: "运镜调度",
  emotion: "情绪表演",
  transition: "转场卡点",
};

export type CraftShotEntry = {
  id: string;
  category: CraftShotCategory;
  no: number;
  nameZh: string;
  /** 交付效果一句 */
  effectZh: string;
  /** 何时用 */
  whenToUseZh: string;
  /** 注入分镜/生图的手法摘要（可占位，不成稿写来源） */
  craftSummaryZh: string;
  /** 英文像素锁短词 */
  craftLockEn: string;
};

export const CRAFT_SHOT_BANK: readonly CraftShotEntry[] = [
  // —— 灯光 ×8 ——
  {
    id: "light_01_window_motivated",
    category: "lighting",
    no: 1,
    nameZh: "窗光动机塑形",
    effectZh: "侧窗光勾出颧骨与肩线，暗部保留层次。",
    whenToUseZh: "室内对白、人物内心可读。",
    craftSummaryZh: "动机窗光；柔和衰减；面部优先；光源方向全程说得通。",
    craftLockEn: "motivated window key, soft falloff, face-readable",
  },
  {
    id: "light_02_practical_rim",
    category: "lighting",
    no: 2,
    nameZh: "实用光+轮廓",
    effectZh: "台灯/街灯当实用光，背后一条细轮廓分离主体。",
    whenToUseZh: "夜戏、都市独处、密谈。",
    craftSummaryZh: "实用光主导；硬 rim 分离；禁廉价全脸柔光糊。",
    craftLockEn: "practical key + thin rim; no soft mush",
  },
  {
    id: "light_03_high_contrast",
    category: "lighting",
    no: 3,
    nameZh: "高反差切面",
    effectZh: "半脸亮半脸暗，压迫感立刻成立。",
    whenToUseZh: "权谋、对峙、秘密揭露。",
    craftSummaryZh: "高反差明暗；建筑/门框塑形；冷暖可对切。",
    craftLockEn: "high-contrast split lighting, architectural edge",
  },
  {
    id: "light_04_volumetric",
    category: "lighting",
    no: 4,
    nameZh: "体积光尘雾",
    effectZh: "光束穿过尘雾，空间立刻有纵深。",
    whenToUseZh: "秘境、仓库、黎明发现。",
    craftSummaryZh: "体积光+薄雾；光束方向稳定；人物可被吞没再被找回。",
    craftLockEn: "volumetric rays through haze, recoverable figure",
  },
  {
    id: "light_05_neon_spill",
    category: "lighting",
    no: 5,
    nameZh: "霓虹溢色",
    effectZh: "暖黄与青绿对撞洒在湿反射地面。",
    whenToUseZh: "都市暧昧、夜街、情绪余韵。",
    craftSummaryZh: "霓虹溢色；潮湿反射；近景皮肤纹理可读。",
    craftLockEn: "neon spill, wet reflections, amber vs teal",
  },
  {
    id: "light_06_magic_hour",
    category: "lighting",
    no: 6,
    nameZh: "魔术时刻金晖",
    effectZh: "低角度金色轮廓光，温暖但不甜腻。",
    whenToUseZh: "和解、发现、亲情收束。",
    craftSummaryZh: "魔术时刻；暖 key+轮廓；面部始终可读。",
    craftLockEn: "magic-hour glow, warm key + rim, faces readable",
  },
  {
    id: "light_07_top_cut",
    category: "lighting",
    no: 7,
    nameZh: "顶侧硬光切面",
    effectZh: "顶侧硬光切开颧骨与桌面细节，冷静不安。",
    whenToUseZh: "审讯感、精算、阴谋细节。",
    craftSummaryZh: "低饱和；顶侧硬切；画面干净如手术刀。",
    craftLockEn: "hard top-side cut, desaturated precision",
  },
  {
    id: "light_08_weather_as_light",
    category: "lighting",
    no: 8,
    nameZh: "天气即灯光",
    effectZh: "风雨尘雾本身成为光源与情绪推手。",
    whenToUseZh: "群像抉择、史诗张力、户外冲突。",
    craftSummaryZh: "风雨尘雾塑光；群像层次；自然光戏剧化。",
    craftLockEn: "weather-as-light, layered ensemble, dramatic nature",
  },

  // —— 运镜 ×8 ——
  {
    id: "cam_01_slow_push",
    category: "camera",
    no: 1,
    nameZh: "缓慢推进压迫",
    effectZh: "固定轴线上缓慢推近，压迫感累积。",
    whenToUseZh: "对峙升级、真相逼近。",
    craftSummaryZh: "稳推；几何构图；少晃；终点落在眼神或手。",
    craftLockEn: "slow axial push, geometric, land on eyes/hands",
  },
  {
    id: "cam_02_locked_long",
    category: "camera",
    no: 2,
    nameZh: "固定长镜",
    effectZh: "不切镜让表演与空间自己说话。",
    whenToUseZh: "伦理张力、饭桌戏、隐忍。",
    craftSummaryZh: "锁机位；景深层次；靠走位与光变叙事。",
    craftLockEn: "locked-off long take, staging over cuts",
  },
  {
    id: "cam_03_track_follow",
    category: "camera",
    no: 3,
    nameZh: "侧向跟拍",
    effectZh: "与主体同速横移，地理轴线清晰。",
    whenToUseZh: "赶路、追逐、都市穿行。",
    craftSummaryZh: "跟拍保地平；写清谁往哪去；禁乱甩。",
    craftLockEn: "lateral track follow, readable geography",
  },
  {
    id: "cam_04_whip_insert",
    category: "camera",
    no: 4,
    nameZh: "甩镜切细节",
    effectZh: "甩入特写钉子，再拉回关系。",
    whenToUseZh: "悬念揭示、证据落地。",
    craftSummaryZh: "甩镜进细节；半拍静默；再拉开全景。",
    craftLockEn: "whip to insert, half-beat hold, pull wide",
  },
  {
    id: "cam_05_low_wonder",
    category: "camera",
    no: 5,
    nameZh: "略低机位仰望",
    effectZh: "略低仰角制造敬畏与发现感。",
    whenToUseZh: "初见奇观、人物立威、孩童视角。",
    craftSummaryZh: "略低仰；反应镜头；发现瞬间给眼睛。",
    craftLockEn: "slight low-angle wonder + reaction beat",
  },
  {
    id: "cam_06_intimate_cu",
    category: "camera",
    no: 6,
    nameZh: "贴身近景微晃",
    effectZh: "极近景+轻手持，暧昧与不安同在。",
    whenToUseZh: "感情戏、秘密耳语、欲言又止。",
    craftSummaryZh: "贴面；微晃；慢门余韵感；说一半留一半。",
    craftLockEn: "intimate CU, slight handheld linger",
  },
  {
    id: "cam_07_wide_scale",
    category: "camera",
    no: 7,
    nameZh: "远景尺度差",
    effectZh: "小人配巨物/大空间，敬畏立刻成立。",
    whenToUseZh: "开场立世界、危机降临。",
    craftSummaryZh: "远景压迫；缓慢推轨；尺度差先于台词。",
    craftLockEn: "oppressive wide, scale contrast, slow dolly",
  },
  {
    id: "cam_08_shot_reverse",
    category: "camera",
    no: 8,
    nameZh: "正反打关系",
    effectZh: "轴线清晰的正反打，关键句给反应。",
    whenToUseZh: "对白戏、谈判、伦理拉扯。",
    craftSummaryZh: "正反打干净；席间调度；金句落反应镜头。",
    craftLockEn: "clean shot-reverse, reaction on key line",
  },

  // —— 情绪 ×8 ——
  {
    id: "emo_01_restrained_dread",
    category: "emotion",
    no: 1,
    nameZh: "克制压迫",
    effectZh: "少表情，靠空间与停顿堆不安。",
    whenToUseZh: "权谋、悬疑、高压职场。",
    craftSummaryZh: "表演克制；停顿有重量；禁止夸张哭喊。",
    craftLockEn: "restrained dread via pause and space",
  },
  {
    id: "emo_02_warm_wonder",
    category: "emotion",
    no: 2,
    nameZh: "温暖惊奇",
    effectZh: "眼睛先看见，再让嘴角微动。",
    whenToUseZh: "发现、和解、亲情。",
    craftSummaryZh: "惊奇在眼；反应镜头；温暖但不煽情。",
    craftLockEn: "warm wonder in eyes first, then micro smile",
  },
  {
    id: "emo_03_ambiguous_longing",
    category: "emotion",
    no: 3,
    nameZh: "暧昧欲言又止",
    effectZh: "话说一半，目光落在别处。",
    whenToUseZh: "恋爱拉扯、错过、都市孤独。",
    craftSummaryZh: "半句停顿；重复小动作；余韵留给下一镜。",
    craftLockEn: "ambiguous longing, unfinished line, linger",
  },
  {
    id: "emo_04_cold_control",
    category: "emotion",
    no: 4,
    nameZh: "冷静掌控",
    effectZh: "语速稳、眼神稳，气场压过场面。",
    whenToUseZh: "霸总、谈判、反杀。",
    craftSummaryZh: "少眨眼；短句；身体静止比手势更强。",
    craftLockEn: "cold control, still body, short lines",
  },
  {
    id: "emo_05_family_tension",
    category: "emotion",
    no: 5,
    nameZh: "伦理隐忍",
    effectZh: "笑里藏刀，爆发前先攒三拍。",
    whenToUseZh: "家庭戏、饭桌、长辈对峙。",
    craftSummaryZh: "生活口语藏刀；隐忍→爆发；反应镜头吃重。",
    craftLockEn: "family tension: smile-then-cut, delayed release",
  },
  {
    id: "emo_06_ensemble_pulse",
    category: "emotion",
    no: 6,
    nameZh: "群戏同频",
    effectZh: "多人眼神接力，情绪像浪潮。",
    whenToUseZh: "团队、对峙群像、高潮。",
    craftSummaryZh: "谁先看谁；浪潮式反应；禁每人同表情。",
    craftLockEn: "ensemble eye-relay, wave reactions",
  },
  {
    id: "emo_07_obsessive_calm",
    category: "emotion",
    no: 7,
    nameZh: "偏执冷静",
    effectZh: "越危险越平静，细节手部出卖情绪。",
    whenToUseZh: "阴谋、调查、精算复仇。",
    craftSummaryZh: "脸冷手热；细节插入放大不安。",
    craftLockEn: "obsessive calm face, telling hands",
  },
  {
    id: "emo_08_solemn_quiet",
    category: "emotion",
    no: 8,
    nameZh: "庄严静默",
    effectZh: "少台词，靠呼吸与环境音撑住。",
    whenToUseZh: "告别、敬畏、命运落点。",
    craftSummaryZh: "留白；短句；一个意象撑段。",
    craftLockEn: "solemn quiet, sparse dialogue, one image holds",
  },

  // —— 转场 ×6 ——
  {
    id: "tr_01_match_cut_object",
    category: "transition",
    no: 1,
    nameZh: "物件匹配切",
    effectZh: "同一物件形状/动作匹配切到下一时空。",
    whenToUseZh: "时间跳跃、隐喻连接。",
    craftSummaryZh: "形状/运动方向匹配；切点干净；禁乱闪。",
    craftLockEn: "object match-cut on shape/motion",
  },
  {
    id: "tr_02_hard_cut_beat",
    category: "transition",
    no: 2,
    nameZh: "硬切卡点",
    effectZh: "音效/对白重音上硬切，节奏钉死。",
    whenToUseZh: "爽点、反转、广告感段落。",
    craftSummaryZh: "卡在重音；切后第一帧信息完整。",
    craftLockEn: "hard cut on beat, first frame readable",
  },
  {
    id: "tr_03_fade_through_black",
    category: "transition",
    no: 3,
    nameZh: "压黑过场",
    effectZh: "短压黑换时空，呼吸一拍。",
    whenToUseZh: "章节感、情绪落点后重启。",
    craftSummaryZh: "压黑≤0.5s；进出光向一致为佳。",
    craftLockEn: "brief fade-to-black chapter breath",
  },
  {
    id: "tr_04_whip_bridge",
    category: "transition",
    no: 4,
    nameZh: "甩镜桥接",
    effectZh: "甩出→甩入，两场动作能量不断。",
    whenToUseZh: "追逐、都市切换、高能蒙太奇。",
    craftSummaryZh: "甩出方向接甩入；中间可插一帧运动模糊。",
    craftLockEn: "whip-bridge, directional continuity",
  },
  {
    id: "tr_05_audio_lead",
    category: "transition",
    no: 5,
    nameZh: "声先画后",
    effectZh: "下一场声音提前半拍进入，再切画面。",
    whenToUseZh: "悬念、电话、门外声。",
    craftSummaryZh: "J-cut 感；声源稍后入画；禁声画错位乱。",
    craftLockEn: "audio leads picture (J-cut feel)",
  },
  {
    id: "tr_06_eye_line_bridge",
    category: "transition",
    no: 6,
    nameZh: "视线桥接",
    effectZh: "人物视线落点成为下一镜画面。",
    whenToUseZh: "发现、指认、感情对视后跳时空。",
    craftSummaryZh: "视线方向明确；下一镜兑现所看之物。",
    craftLockEn: "eyeline bridge into next frame pay-off",
  },
];

export function listCraftShotsByCategory(category: CraftShotCategory) {
  return CRAFT_SHOT_BANK.filter((e) => e.category === category);
}

export function getCraftShotById(id: string) {
  const key = String(id || "").trim();
  return CRAFT_SHOT_BANK.find((e) => e.id === key) || null;
}

/** 题材关键词 → 手法条目（与角色库 4.B 同口径：可自动套、可更换） */
const TOPIC_CRAFT_HINTS: Array<{ keys: string[]; preferIds: string[] }> = [
  // 细项在前，避免被「对峙/悬疑」等泛词抢走
  { keys: ["审讯", "阴谋", "精算", "算计"], preferIds: ["light_07_top_cut", "cam_02_locked_long", "emo_01_restrained_dread"] },
  { keys: ["群戏", "派对", "众人", "围观"], preferIds: ["emo_06_ensemble_pulse", "cam_03_track_follow", "tr_04_whip_bridge"] },
  { keys: ["奇观", "秘境", "史诗", "巨物", "星际", "修仙", "洞府"], preferIds: ["cam_07_wide_scale", "light_04_volumetric", "emo_08_solemn_quiet"] },
  { keys: ["权谋", "宫斗", "对峙", "翻盘", "步步为营", "宫墙", "朝堂"], preferIds: ["light_03_high_contrast", "cam_01_slow_push", "emo_01_restrained_dread"] },
  { keys: ["清冷", "克制", "高冷", "疏离", "冷感", "禁欲"], preferIds: ["light_01_window_motivated", "cam_02_locked_long", "emo_04_cold_control"] },
  { keys: ["甜", "恋爱", "暧昧", "治愈", "心动", "告白"], preferIds: ["light_05_neon_spill", "cam_06_intimate_cu", "emo_03_ambiguous_longing"] },
  { keys: ["悬疑", "秘密", "揭秘", "调查", "推理", "搜证"], preferIds: ["light_07_top_cut", "cam_04_whip_insert", "emo_07_obsessive_calm"] },
  { keys: ["追逐", "赛车", "速度", "动作", "逃", "飙车"], preferIds: ["cam_03_track_follow", "tr_04_whip_bridge", "emo_06_ensemble_pulse"] },
  { keys: ["家庭", "伦理", "饭桌", "长辈", "团圆", "婆媳"], preferIds: ["cam_08_shot_reverse", "emo_05_family_tension", "light_01_window_motivated"] },
  { keys: ["和解", "亲情", "温暖", "发现", "重逢", "释然"], preferIds: ["light_06_magic_hour", "cam_05_low_wonder", "emo_02_warm_wonder"] },
  { keys: ["谈判", "商战", "霸总", "会议室", "并购"], preferIds: ["emo_04_cold_control", "cam_08_shot_reverse", "light_07_top_cut"] },
  { keys: ["雨夜", "霓虹", "都市夜", "湿街"], preferIds: ["light_05_neon_spill", "cam_06_intimate_cu", "tr_05_audio_lead"] },
  { keys: ["校园", "教室", "校服", "青春"], preferIds: ["light_01_window_motivated", "cam_08_shot_reverse", "emo_02_warm_wonder"] },
  { keys: ["末日", "废土", "避难所", "丧尸"], preferIds: ["cam_07_wide_scale", "light_03_high_contrast", "emo_01_restrained_dread"] },
  { keys: ["科幻", "飞船", "赛博", "全息"], preferIds: ["cam_07_wide_scale", "light_04_volumetric", "emo_08_solemn_quiet"] },
  { keys: ["密室", "黑客入侵", "信息战"], preferIds: ["light_07_top_cut", "cam_04_whip_insert", "emo_07_obsessive_calm"] },
  { keys: ["古风", "皇宫", "长安", "边塞"], preferIds: ["light_03_high_contrast", "cam_02_locked_long", "emo_05_family_tension"] },
  { keys: ["边塞", "烽火", "出征", "关隘"], preferIds: ["cam_07_wide_scale", "light_06_magic_hour", "emo_08_solemn_quiet"] },
  { keys: ["声先画后", "卡点", "硬切"], preferIds: ["tr_05_audio_lead", "tr_04_whip_bridge", "cam_04_whip_insert"] },
];

export type CraftShotRecommendResult = {
  craftShotId: string | null;
  entry?: CraftShotEntry | null;
  reasonZh: string;
};

/**
 * 按题材气质推荐 1 条原子手法（灯光/运镜/情绪优先；无命中给高反差默认）。
 */
export function recommendCraftShotFromTopic(topic?: string): CraftShotRecommendResult {
  const t = String(topic || "").trim();
  if (!t) {
    const fallback = getCraftShotById("light_03_high_contrast");
    return {
      craftShotId: fallback?.id || null,
      entry: fallback,
      reasonZh: "未填题材时默认高反差切面（可更换）",
    };
  }

  for (const hint of TOPIC_CRAFT_HINTS) {
    if (!hint.keys.some((k) => t.includes(k))) continue;
    for (const id of hint.preferIds) {
      const entry = getCraftShotById(id);
      if (!entry) continue;
      return {
        craftShotId: entry.id,
        entry,
        reasonZh: `题材偏「${hint.keys.find((k) => t.includes(k))}」→ 推荐「${entry.nameZh}」`,
      };
    }
  }

  // 弱匹配：条目名出现在题材里
  for (const entry of CRAFT_SHOT_BANK) {
    if (t.includes(entry.nameZh)) {
      return {
        craftShotId: entry.id,
        entry,
        reasonZh: `题材命中「${entry.nameZh}」`,
      };
    }
  }

  const fallback = getCraftShotById("cam_01_slow_push");
  return {
    craftShotId: fallback?.id || null,
    entry: fallback,
    reasonZh: "按题材未强命中，推荐缓慢推进压迫（可更换）",
  };
}

/** 注入节拍 / 反推 / 静帧：只写手法，不写来源名 */
export function buildCraftShotInjectBlock(ids: string[]): string {
  const picked = ids.map(getCraftShotById).filter(Boolean) as CraftShotEntry[];
  if (!picked.length) return "";
  const lines = picked.map((e, i) => {
    const cat = CRAFT_SHOT_CATEGORY_LABEL_ZH[e.category];
    return `${i + 1}. 【${cat}】${e.nameZh}：${e.craftSummaryZh}（效果：${e.effectZh}）\n   EN: ${e.craftLockEn}`;
  });
  return [
    "【手法条目库·原子镜头】",
    "硬规则：成稿只写景别/运镜/灯光/情绪手法词；禁止导演名、片名、「某某风」。",
    "本集主用下列条目（可微调变奏，勿混炖无关风格）：",
    ...lines,
  ].join("\n");
}
