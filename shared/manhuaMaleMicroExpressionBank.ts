/**
 * 男生高张力微表情库：眼神 / 嘴角 / 叙事关键词。
 * 与 craft emotion 并列，不覆盖；成稿禁止来源账号名。
 */

export type ManhuaMaleMicroExpressionEntry = {
  id: string;
  no: number;
  nameZh: string;
  keywordsZh: string[];
  eyesZh: string;
  mouthZh: string;
  narrativeZh: string;
  craftSummaryZh: string;
  craftLockEn: string;
};

export const MANHUA_MALE_MICRO_EXPRESSION_BANK: readonly ManhuaMaleMicroExpressionEntry[] = [
  {
    id: "mmicro_01_held_tears",
    no: 1,
    nameZh: "压抑落泪",
    keywordsZh: ["心痛", "克制", "低落", "隐忍"],
    eyesZh: "泪在眶内打转，下睫毛湿，目光下压",
    mouthZh: "唇线抿紧，几乎不张",
    narrativeZh: "情绪到临界却不肯崩，观众先心疼。",
    craftSummaryZh: "泪不落；眼神下压；嘴角死咬；近景优先。",
    craftLockEn: "held tears in sockets, downcast eyes, tight lips",
  },
  {
    id: "mmicro_02_breakdown",
    no: 2,
    nameZh: "崩溃失控",
    keywordsZh: ["崩裂", "失守", "痛哭", "绝望"],
    eyesZh: "紧闭或睁裂，泪线失控",
    mouthZh: "大张或扭曲嘶喊形",
    narrativeZh: "防线一次性冲垮，声先于形。",
    craftSummaryZh: "失守瞬间；五官拉开；禁假笑残留。",
    craftLockEn: "emotional breakdown, open cry shape, no residual smirk",
  },
  {
    id: "mmicro_03_grit_teeth",
    no: 3,
    nameZh: "咬牙硬撑",
    keywordsZh: ["隐忍", "克制", "逞强", "不甘"],
    eyesZh: "目光前顶，眼白紧张",
    mouthZh: "咬肌隆起，齿关紧",
    narrativeZh: "痛却站着，力量来自拒绝倒下。",
    craftSummaryZh: "侧脸咬肌；眼神逞强；呼吸短促可读。",
    craftLockEn: "jaw clenched, strained forward gaze, forced stance",
  },
  {
    id: "mmicro_04_angry_stare",
    no: 4,
    nameZh: "愤怒对视",
    keywordsZh: ["愤怒", "警告", "压迫", "对抗"],
    eyesZh: "眉压眼，直刺镜头/对手",
    mouthZh: "唇薄而紧，几乎无笑意",
    narrativeZh: "沉默比吼叫更压迫。",
    craftSummaryZh: "对视轴；眉压；光切半脸强化怒。",
    craftLockEn: "angry direct stare, compressed brows, thin hard mouth",
  },
  {
    id: "mmicro_05_voiceless_roar",
    no: 5,
    nameZh: "失声怒吼",
    keywordsZh: ["爆发", "宣泄", "压抑", "释放"],
    eyesZh: "仰或平视失焦一瞬",
    mouthZh: "大张，颈筋绷起",
    narrativeZh: "积压一次倒出，声画可不同步。",
    craftSummaryZh: "张口爆发；颈线紧张；随后可切静默。",
    craftLockEn: "voiceless roar mouth open, neck taut, release beat",
  },
  {
    id: "mmicro_06_cold_sneer",
    no: 6,
    nameZh: "冷笑不屑",
    keywordsZh: ["轻蔑", "疏离", "冷感", "不屑"],
    eyesZh: "眼尾微挑，目光淡",
    mouthZh: "一侧嘴角极轻上扬",
    narrativeZh: "最小动作拉最大距离。",
    craftSummaryZh: "半边嘴角；眼神疏离；禁夸张龇牙。",
    craftLockEn: "tiny asymmetric sneer, distant eyes, cold contempt",
  },
  {
    id: "mmicro_07_hollow_smile",
    no: 7,
    nameZh: "空洞假笑",
    keywordsZh: ["伪装", "社交", "抽离", "心死"],
    eyesZh: "笑不达眼，目光空",
    mouthZh: "标准社交弧度",
    narrativeZh: "面子还在，人已经离开。",
    craftSummaryZh: "嘴笑眼空；近景拆穿；灯光可偏平。",
    craftLockEn: "social smile not reaching eyes, hollow gaze",
  },
  {
    id: "mmicro_08_shock_freeze",
    no: 8,
    nameZh: "震惊冻结",
    keywordsZh: ["震惊", "停顿", "失语", "空白"],
    eyesZh: "瞳孔放大，眨眼停半拍",
    mouthZh: "微张，停在半句",
    narrativeZh: "信息击中后 0.5 秒世界静止。",
    craftSummaryZh: "冻结半拍；微张嘴；禁过度挥手。",
    craftLockEn: "shock freeze, dilated pupils, half-open mouth pause",
  },
  {
    id: "mmicro_09_tender_soften",
    no: 9,
    nameZh: "温柔松动",
    keywordsZh: ["心软", "怜惜", "松动", "克制爱"],
    eyesZh: "眼睑略松，目光变暖",
    mouthZh: "唇线松开一线",
    narrativeZh: "硬壳出现裂缝，但仍克制。",
    craftSummaryZh: "眼先软；嘴后跟；运镜贴面停留。",
    craftLockEn: "softening eyes first, slight lip ease, restrained tenderness",
  },
  {
    id: "mmicro_10_resolve_set",
    no: 10,
    nameZh: "决意落定",
    keywordsZh: ["决断", "启程", "复仇", "赴死"],
    eyesZh: "目光钉死一点，不再游移",
    mouthZh: "唇线水平，短吸气",
    narrativeZh: "决定已下，表情反而更静。",
    craftSummaryZh: "静比闹更强；眼神钉点；可接决断轮廓光。",
    craftLockEn: "resolved still gaze, level lips, quiet decision",
  },
];

export function getMaleMicroExpressionById(id?: string | null): ManhuaMaleMicroExpressionEntry | null {
  const key = String(id || "").trim();
  if (!key) return null;
  return MANHUA_MALE_MICRO_EXPRESSION_BANK.find((e) => e.id === key) || null;
}

export function listMaleMicroExpressions(): readonly ManhuaMaleMicroExpressionEntry[] {
  return MANHUA_MALE_MICRO_EXPRESSION_BANK;
}

export function buildMaleMicroExpressionInjectBlock(ids: string[]): string {
  const picked = ids
    .map(getMaleMicroExpressionById)
    .filter(Boolean) as ManhuaMaleMicroExpressionEntry[];
  if (!picked.length) return "";
  const lines = picked.map(
    (e, i) =>
      `${i + 1}. 【微表情】${e.nameZh}（${e.keywordsZh.join("、")}）：${e.craftSummaryZh}\n   眼：${e.eyesZh}；嘴：${e.mouthZh}\n   EN: ${e.craftLockEn}`,
  );
  return [
    "【男生微表情库】",
    "硬规则：写入表演与近景可读细节；禁止账号名/水印来源；与运镜灯光一致。",
    ...lines,
  ].join("\n");
}

export function recommendMaleMicroExpressionFromTopic(topic?: string): {
  expressionId: string | null;
  entry: ManhuaMaleMicroExpressionEntry | null;
  reasonZh: string;
} {
  const t = String(topic || "").trim();
  const hints: Array<{ keys: string[]; id: string }> = [
    { keys: ["复仇", "决断", "启程"], id: "mmicro_10_resolve_set" },
    { keys: ["对峙", "警告", "愤怒"], id: "mmicro_04_angry_stare" },
    { keys: ["崩溃", "痛哭"], id: "mmicro_02_breakdown" },
    { keys: ["逞强", "咬牙"], id: "mmicro_03_grit_teeth" },
    { keys: ["冷笑", "不屑", "轻蔑"], id: "mmicro_06_cold_sneer" },
    { keys: ["震惊", "反转"], id: "mmicro_08_shock_freeze" },
    { keys: ["温柔", "心软", "暧昧"], id: "mmicro_09_tender_soften" },
    { keys: ["落泪", "心痛"], id: "mmicro_01_held_tears" },
  ];
  for (const h of hints) {
    if (h.keys.some((k) => t.includes(k))) {
      const entry = getMaleMicroExpressionById(h.id);
      return {
        expressionId: entry?.id || null,
        entry,
        reasonZh: `题材偏「${h.keys.find((k) => t.includes(k))}」→ 推荐「${entry?.nameZh}」`,
      };
    }
  }
  for (const e of MANHUA_MALE_MICRO_EXPRESSION_BANK) {
    if (t.includes(e.nameZh)) {
      return {
        expressionId: e.id,
        entry: e,
        reasonZh: `题材命中「${e.nameZh}」`,
      };
    }
  }
  const fallback = getMaleMicroExpressionById("mmicro_03_grit_teeth");
  return {
    expressionId: fallback?.id || null,
    entry: fallback,
    reasonZh: "未强命中，推荐咬牙硬撑（可更换）",
  };
}
