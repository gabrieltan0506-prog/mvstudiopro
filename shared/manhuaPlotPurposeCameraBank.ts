/**
 * AI 短剧分镜：剧情目的 → 镜头功能；戏种节奏通用规则。
 * 成稿只写手法词；禁止账号名/外仓品牌水印。
 * 主消费：编导分镜 enrich（bianDaoStoryboard）。
 */

export type ManhuaPlotPurposeId =
  | "deliver_info"
  | "amplify_emotion"
  | "suspense"
  | "tension"
  | "twist"
  | "thriller"
  | "show_clue";

export type ManhuaPlotPurposeEntry = {
  id: ManhuaPlotPurposeId;
  nameZh: string;
  coreTaskZh: string;
  preferredShotsZh: string[];
  craftSummaryZh: string;
  craftLockEn: string;
};

export const MANHUA_PLOT_PURPOSE_BANK: readonly ManhuaPlotPurposeEntry[] = [
  {
    id: "deliver_info",
    nameZh: "交代信息",
    coreTaskZh: "让观众看懂场景、人物与人物关系。",
    preferredShotsZh: ["全景", "中景", "双人镜头"],
    craftSummaryZh: "先立空间与关系；全景/中景/双人镜优先；信息点一次说清。",
    craftLockEn: "establishing wide/medium/two-shot; clear spatial relations",
  },
  {
    id: "amplify_emotion",
    nameZh: "放大情绪",
    coreTaskZh: "让观众清楚看到表情与心理变化。",
    preferredShotsZh: ["近景", "特写", "慢推"],
    craftSummaryZh: "贴近脸与微表情；近景/特写/慢推；少切环境干扰。",
    craftLockEn: "close-up / ECU / slow push-in; face-readable emotion",
  },
  {
    id: "suspense",
    nameZh: "制造悬念",
    coreTaskZh: "让观众察觉异常，但暂不揭开全部真相。",
    preferredShotsZh: ["遮挡镜头", "主观视角", "物件特写"],
    craftSummaryZh: "遮挡/POV/物件特写；只露线索不露答案。",
    craftLockEn: "obscured / POV / object ECU; withhold full reveal",
  },
  {
    id: "tension",
    nameZh: "制造紧张",
    coreTaskZh: "让观众感到压迫与倒计时感。",
    preferredShotsZh: ["手持镜头", "反应快切", "低角度镜头"],
    craftSummaryZh: "手持微晃+反应快切+低机位；节奏收紧。",
    craftLockEn: "handheld / reaction cuts / low angle; tightening beat",
  },
  {
    id: "twist",
    nameZh: "制造反转",
    coreTaskZh: "先铺垫，再抛出关键信息。",
    preferredShotsZh: ["证据特写", "停顿", "反应镜头"],
    craftSummaryZh: "证据特写→停顿→反应镜；反转落点要留白。",
    craftLockEn: "evidence ECU → pause → reaction; twist payoff",
  },
  {
    id: "thriller",
    nameZh: "制造惊悚",
    coreTaskZh: "先建立不安全感，再突然释放刺激。",
    preferredShotsZh: ["空镜", "长廊背影", "切黑"],
    craftSummaryZh: "空镜/长廊背影蓄压，惊吓点极快，可切黑。",
    craftLockEn: "empty frame / corridor back / smash cut to black",
  },
  {
    id: "show_clue",
    nameZh: "展示线索",
    coreTaskZh: "把关键证据或道具讲清楚。",
    preferredShotsZh: ["手部特写", "前后对比", "近景展示"],
    craftSummaryZh: "手部特写+前后对比+近景展示；步骤可读。",
    craftLockEn: "hand ECU / before-after / close display; readable steps",
  },
] as const;

export type ManhuaScenePacingId =
  | "romance"
  | "confrontation"
  | "twist"
  | "mystery"
  | "thriller"
  | "comedy"
  | "clue"
  | "action";

export type ManhuaScenePacingEntry = {
  id: ManhuaScenePacingId;
  nameZh: string;
  pacingRuleZh: string;
  timelineHintZh?: string;
  craftSummaryZh: string;
};

export const MANHUA_SCENE_PACING_BANK: readonly ManhuaScenePacingEntry[] = [
  {
    id: "romance",
    nameZh: "心动戏",
    pacingRuleZh: "慢，眼神和细节要停留。",
    craftSummaryZh: "整体偏慢；眼神/手部细节多留一拍。",
  },
  {
    id: "confrontation",
    nameZh: "对峙戏",
    pacingRuleZh: "前慢后快，关键台词后停顿。",
    craftSummaryZh: "开场蓄压慢切；冲突加速；金句后停顿给反应。",
  },
  {
    id: "twist",
    nameZh: "反转戏",
    pacingRuleZh: "铺垫稳，证据出现要快，反应镜头要停顿。",
    craftSummaryZh: "铺垫稳→证据快抛→反应镜停顿。",
  },
  {
    id: "mystery",
    nameZh: "悬疑戏",
    pacingRuleZh: "前慢，中间给细节，真相延迟提示。",
    craftSummaryZh: "前慢立疑；中段物件细节；真相延后。",
  },
  {
    id: "thriller",
    nameZh: "惊悚戏",
    pacingRuleZh: "前面放慢，惊吓瞬间极快。",
    craftSummaryZh: "惊吓前减速蓄压；惊吓点极快切。",
  },
  {
    id: "comedy",
    nameZh: "喜剧戏",
    pacingRuleZh: "包袱出现后，必须停顿给反应。",
    craftSummaryZh: "包袱抛出后停顿，留给反应/笑点落点。",
  },
  {
    id: "clue",
    nameZh: "线索戏",
    pacingRuleZh: "前3秒先讲重点，使用步骤要清楚。",
    timelineHintZh: "前3秒先抛重点信息。",
    craftSummaryZh: "开场3秒内讲清重点；操作步骤镜头清晰。",
  },
  {
    id: "action",
    nameZh: "动作戏",
    pacingRuleZh: "先交代空间，再快切动作，关键一下可慢动作。",
    craftSummaryZh: "先空间建立→动作快切→关键一击可慢动作。",
  },
] as const;

export function getManhuaPlotPurposeById(id?: string | null): ManhuaPlotPurposeEntry | null {
  const key = String(id || "").trim();
  if (!key) return null;
  return MANHUA_PLOT_PURPOSE_BANK.find((e) => e.id === key) || null;
}

export function getManhuaScenePacingById(id?: string | null): ManhuaScenePacingEntry | null {
  const key = String(id || "").trim();
  if (!key) return null;
  return MANHUA_SCENE_PACING_BANK.find((e) => e.id === key) || null;
}

export function formatPlotPurposeCameraBlock(entry: ManhuaPlotPurposeEntry): string {
  return [
    "【剧情目的·镜头】",
    `目的：${entry.nameZh}。任务：${entry.coreTaskZh}`,
    `优先镜头：${entry.preferredShotsZh.join("、")}。`,
    `手法：${entry.craftSummaryZh}`,
    "先问这一段剧情想让观众获得什么，再决定镜头怎么拍。",
  ].join("\n");
}

export function formatScenePacingBlock(entry: ManhuaScenePacingEntry): string {
  const lines = [
    "【戏种节奏】",
    `戏种：${entry.nameZh}。规则：${entry.pacingRuleZh}`,
    `手法：${entry.craftSummaryZh}`,
  ];
  if (entry.timelineHintZh) lines.push(`节拍提示：${entry.timelineHintZh}`);
  lines.push("真正有冲击力的，不是一直快切，而是关键点的停顿。");
  return lines.join("\n");
}
