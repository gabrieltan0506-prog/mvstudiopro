/**
 * 漫剧节奏模板审定库（产品只消费 status=approved）。
 * 提案层见 docs/manhua-template-lab/proposals/；批准后才写入本文件。
 * 成稿禁止竞品片名/台词抄袭；只借结构与中性手法标签。
 */

export type ManhuaViralTemplateStatus = "proposed" | "approved" | "rejected";

/** 赛道分组（UI 分类排布用） */
export type ManhuaViralTemplateLane =
  | "爽文逆袭"
  | "古言种田"
  | "系统觉醒"
  | "甜宠"
  | "悬疑权谋"
  | "搞笑沙雕"
  | "游戏竞技";

export const MANHUA_VIRAL_TEMPLATE_LANE_ORDER: readonly ManhuaViralTemplateLane[] = [
  "爽文逆袭",
  "古言种田",
  "系统觉醒",
  "甜宠",
  "悬疑权谋",
  "搞笑沙雕",
  "游戏竞技",
] as const;

export type ManhuaViralTemplateBeat = {
  /** 约第几秒起（0-based 区间起点） */
  atSec: number;
  /** 冲突/信息增量类型（中性） */
  conflictZh: string;
  /** 可视觉化动作一句 */
  visualZh: string;
};

export type ManhuaViralTemplateDensityHints = {
  /** 建议正文最少字（约 180s） */
  minBodyChars: number;
  /** 建议「」对白句数 */
  minDialogueLines: number;
  /** 建议不同场景名命中数 */
  minLocationHits: number;
};

export type ManhuaViralTemplateSourceRef = {
  url: string;
  fetchedAt: string;
  noteZh?: string;
};

export type ManhuaViralTemplateCard = {
  id: string;
  /** UI 短名（中性，不写竞品剧名） */
  nameZh: string;
  laneZh: ManhuaViralTemplateLane;
  /** 一句话用途 */
  summaryZh: string;
  hook3sZh: string;
  beatGrid: ManhuaViralTemplateBeat[];
  scenePoolHints: string[];
  castShape: {
    leadDesireZh: string;
    pressureZh: string;
    foilZh?: string;
  };
  densityHints: ManhuaViralTemplateDensityHints;
  sourceRefs: ManhuaViralTemplateSourceRef[];
  status: ManhuaViralTemplateStatus;
  approvedAt?: string;
  updatedAt?: string;
};

const DEFAULT_DENSITY: ManhuaViralTemplateDensityHints = {
  minBodyChars: 280,
  minDialogueLines: 8,
  minLocationHits: 2,
};

/** 审定库：仅 status=approved 进产品列表 */
export const MANHUA_VIRAL_TEMPLATE_BANK: readonly ManhuaViralTemplateCard[] = [
  {
    id: "tpl_border_farm_revenge",
    nameZh: "边关开荒翻盘",
    laneZh: "古言种田",
    summaryZh: "被发配→开荒求生→军功/人心翻盘；每 15s 可见升级。",
    hook3sZh: "开场即贬谪令或关外风雪；主角被扔进绝境，先落一句不服输的可见动作。",
    beatGrid: [
      { atSec: 0, conflictZh: "贬谪落地", visualZh: "关隘木牌砸下/雪地跪接令" },
      { atSec: 15, conflictZh: "生存压迫", visualZh: "破屋断粮，动手挖地或修篱" },
      { atSec: 30, conflictZh: "小人刁难", visualZh: "官吏抢种/扣农具，主角当众反制一步" },
      { atSec: 45, conflictZh: "第一收获", visualZh: "苗破土或猎获，邻人围观变色" },
      { atSec: 60, conflictZh: "同盟试探", visualZh: "边军/邻里递刀或递种子，条件暧昧" },
      { atSec: 75, conflictZh: "外部危机", visualZh: "烽火/狼烟/劫匪逼近田垄" },
      { atSec: 90, conflictZh: "战术反击", visualZh: "用田埂/陷阱/粮仓布局反杀" },
      { atSec: 105, conflictZh: "人情兑现", visualZh: "旧日仇人来求粮或求医" },
      { atSec: 120, conflictZh: "军功苗头", visualZh: "军旗/功牌出现，身份线抬头" },
      { atSec: 135, conflictZh: "二次打脸", visualZh: "京中来使当众认错或被揭穿" },
      { atSec: 150, conflictZh: "更大棋局", visualZh: "发现贬谪背后另有圣旨/密信" },
      { atSec: 165, conflictZh: "片尾钩子", visualZh: "密信未展全页，刀光或马蹄逼近" },
    ],
    scenePoolHints: ["边塞", "烽火", "关隘", "古风", "种田", "开荒", "军营"],
    castShape: {
      leadDesireZh: "在绝境活下去并夺回体面",
      pressureZh: "朝廷贬谪+边地物资匮乏+小人盯梢",
      foilZh: "边军将领或当地豪强，亦敌亦友",
    },
    densityHints: { ...DEFAULT_DENSITY },
    sourceRefs: [
      {
        url: "https://www.thepaper.cn/newsDetail_forward_33588420",
        fetchedAt: "2026-07-17",
        noteZh: "情报笔记提炼；结构中性化，不写原片名进成稿",
      },
    ],
    status: "approved",
    approvedAt: "2026-07-21T00:00:00.000Z",
  },
  {
    id: "tpl_system_devour_evolve",
    nameZh: "系统吞噬升级",
    laneZh: "系统觉醒",
    summaryZh: "弱体觉醒面板→吞噬进化→碾压同阶；视觉化数值与形态变化。",
    hook3sZh: "开场濒死或被欺压，面板/异能光纹突然亮起，先给一个可见进化微变。",
    beatGrid: [
      { atSec: 0, conflictZh: "濒死开局", visualZh: "倒地挨打，血泊中光纹闪" },
      { atSec: 15, conflictZh: "系统觉醒", visualZh: "半透明任务框/印记浮现（无可读乱码字）" },
      { atSec: 30, conflictZh: "首次吞噬", visualZh: "吞入异物/气息，外形微变" },
      { atSec: 45, conflictZh: "小怪试刀", visualZh: "反杀嘲讽者，围观哗然" },
      { atSec: 60, conflictZh: "资源争夺", visualZh: "洞府/废墟抢核芯" },
      { atSec: 75, conflictZh: "瓶颈提示", visualZh: "面板红字警报或肉身剧痛" },
      { atSec: 90, conflictZh: "形态跃迁", visualZh: "鳞甲/光翼/体型一阶变化" },
      { atSec: 105, conflictZh: "同阶碾压", visualZh: "昔日强敌一招落败" },
      { atSec: 120, conflictZh: "势力盯上", visualZh: "远处宗门探子或无人机式灵鸟" },
      { atSec: 135, conflictZh: "代价显形", visualZh: "失控征兆：黑纹蔓延/饥饿反噬" },
      { atSec: 150, conflictZh: "更大猎物", visualZh: "地图标记指向禁地" },
      { atSec: 165, conflictZh: "片尾钩子", visualZh: "禁地门缝张开一只眼或一只爪" },
    ],
    scenePoolHints: ["修仙", "洞府", "奇观", "系统", "进化", "吞噬", "废墟"],
    castShape: {
      leadDesireZh: "变强到无人敢欺",
      pressureZh: "弱小出身+追杀+系统饥饿代价",
      foilZh: "同门天才或猎杀者组织",
    },
    densityHints: { ...DEFAULT_DENSITY },
    sourceRefs: [
      {
        url: "https://www.tmtpost.com/7890548.html",
        fetchedAt: "2026-07-17",
        noteZh: "情报笔记提炼；结构中性化",
      },
    ],
    status: "approved",
    approvedAt: "2026-07-21T00:00:00.000Z",
  },
  {
    id: "tpl_esports_carry_flip",
    nameZh: "操作碾压翻盘",
    laneZh: "游戏竞技",
    summaryZh: "被嘲废物→高光操作→全局翻盘；赛场界面与现实羞辱对照。",
    hook3sZh: "开场弹幕/队友辱骂+败局倒计时；主角手指就位，先给一个反常识走位。",
    beatGrid: [
      { atSec: 0, conflictZh: "公开羞辱", visualZh: "赛后采访或队内会议室被指废物" },
      { atSec: 15, conflictZh: "被迫上场", visualZh: "替补位亮灯，耳机扣上" },
      { atSec: 30, conflictZh: "开局被动", visualZh: "比分落后，小地图全红" },
      { atSec: 45, conflictZh: "第一波操作", visualZh: "极限走位反杀，观战席起立" },
      { atSec: 60, conflictZh: "战术分歧", visualZh: "队长喊停，主角坚持路线" },
      { atSec: 75, conflictZh: "资源转换", visualZh: "偷塔/抢龙/夺核一镜到底" },
      { atSec: 90, conflictZh: "对手针对", visualZh: "五人包抄，主角诱敌入巷" },
      { atSec: 105, conflictZh: "团战高光", visualZh: "多段连招特写+慢镜命中" },
      { atSec: 120, conflictZh: "比分扳平", visualZh: "记分板翻红，弹幕刷屏（无可读乱字）" },
      { atSec: 135, conflictZh: "旧伤/作弊疑云", visualZh: "对手使阴招或掉线指控" },
      { atSec: 150, conflictZh: "最后一推", visualZh: "水晶/主基地血条见底" },
      { atSec: 165, conflictZh: "片尾钩子", visualZh: "冠军杯未及手，幕后金主短信弹出半句" },
    ],
    scenePoolHints: ["科幻", "赛博", "全息", "对峙", "翻盘", "竞技", "电竞馆"],
    castShape: {
      leadDesireZh: "用绝对操作证明自己",
      pressureZh: "舆论羞辱+队内排挤+决赛倒计时",
      foilZh: "昔日队友或商业俱乐部老板",
    },
    densityHints: { ...DEFAULT_DENSITY },
    sourceRefs: [
      {
        url: "https://www.oeeee.com/html/202604/29/1702585.html",
        fetchedAt: "2026-07-17",
        noteZh: "情报笔记提炼；结构中性化",
      },
    ],
    status: "approved",
    approvedAt: "2026-07-21T00:00:00.000Z",
  },
];

export function parseManhuaViralTemplateCard(raw: unknown): ManhuaViralTemplateCard | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<ManhuaViralTemplateCard>;
  const id = String(o.id || "").trim();
  const nameZh = String(o.nameZh || "").trim();
  const laneZh = String(o.laneZh || "").trim() as ManhuaViralTemplateLane;
  if (!id || !nameZh) return null;
  if (!MANHUA_VIRAL_TEMPLATE_LANE_ORDER.includes(laneZh)) return null;
  const status = o.status;
  if (status !== "proposed" && status !== "approved" && status !== "rejected") return null;
  const beatGrid = Array.isArray(o.beatGrid)
    ? o.beatGrid
        .map((b) => ({
          atSec: Math.max(0, Math.floor(Number((b as ManhuaViralTemplateBeat).atSec) || 0)),
          conflictZh: String((b as ManhuaViralTemplateBeat).conflictZh || "").trim().slice(0, 40),
          visualZh: String((b as ManhuaViralTemplateBeat).visualZh || "").trim().slice(0, 80),
        }))
        .filter((b) => b.conflictZh && b.visualZh)
        .slice(0, 24)
    : [];
  const cast = o.castShape || { leadDesireZh: "", pressureZh: "" };
  return {
    id: id.slice(0, 64),
    nameZh: nameZh.slice(0, 32),
    laneZh,
    summaryZh: String(o.summaryZh || "").trim().slice(0, 120),
    hook3sZh: String(o.hook3sZh || "").trim().slice(0, 200),
    beatGrid,
    scenePoolHints: (Array.isArray(o.scenePoolHints) ? o.scenePoolHints : [])
      .map((s) => String(s || "").trim())
      .filter(Boolean)
      .slice(0, 16),
    castShape: {
      leadDesireZh: String(cast.leadDesireZh || "").trim().slice(0, 80),
      pressureZh: String(cast.pressureZh || "").trim().slice(0, 80),
      foilZh: String(cast.foilZh || "").trim().slice(0, 80) || undefined,
    },
    densityHints: {
      minBodyChars: Math.max(
        80,
        Math.floor(Number(o.densityHints?.minBodyChars) || DEFAULT_DENSITY.minBodyChars),
      ),
      minDialogueLines: Math.max(
        2,
        Math.floor(Number(o.densityHints?.minDialogueLines) || DEFAULT_DENSITY.minDialogueLines),
      ),
      minLocationHits: Math.max(
        1,
        Math.floor(Number(o.densityHints?.minLocationHits) || DEFAULT_DENSITY.minLocationHits),
      ),
    },
    sourceRefs: (Array.isArray(o.sourceRefs) ? o.sourceRefs : [])
      .map((r) => ({
        url: String((r as ManhuaViralTemplateSourceRef).url || "").trim().slice(0, 500),
        fetchedAt: String((r as ManhuaViralTemplateSourceRef).fetchedAt || "").trim().slice(0, 32),
        noteZh: String((r as ManhuaViralTemplateSourceRef).noteZh || "").trim().slice(0, 120) || undefined,
      }))
      .filter((r) => r.url)
      .slice(0, 8),
    status,
    approvedAt: o.approvedAt ? String(o.approvedAt) : undefined,
    updatedAt: o.updatedAt ? String(o.updatedAt) : undefined,
  };
}

/**
 * 种子库 ∪ 动态 extras；同 id 以 extras 为准（后写覆盖）。
 * 用于 GCS approved 与出厂种子合并，避免改 TypeScript 数组。
 */
export function mergeManhuaViralTemplateBanks(
  seed: readonly ManhuaViralTemplateCard[],
  extras?: readonly ManhuaViralTemplateCard[] | null,
): ManhuaViralTemplateCard[] {
  const map = new Map<string, ManhuaViralTemplateCard>();
  for (const t of seed) {
    if (t?.id) map.set(t.id, t);
  }
  for (const t of extras || []) {
    if (t?.id) map.set(t.id, t);
  }
  return Array.from(map.values());
}

export function getManhuaViralTemplate(
  id?: string | null,
  extras?: readonly ManhuaViralTemplateCard[] | null,
): ManhuaViralTemplateCard | null {
  const key = String(id || "").trim();
  if (!key) return null;
  const bank = mergeManhuaViralTemplateBanks(MANHUA_VIRAL_TEMPLATE_BANK, extras);
  return bank.find((t) => t.id === key) || null;
}

/** 产品可选列表：仅 approved（可注入 GCS 动态库） */
export function listApprovedManhuaViralTemplates(
  extras?: readonly ManhuaViralTemplateCard[] | null,
): ManhuaViralTemplateCard[] {
  return mergeManhuaViralTemplateBanks(MANHUA_VIRAL_TEMPLATE_BANK, extras).filter(
    (t) => t.status === "approved",
  );
}

export function listApprovedManhuaViralTemplatesGrouped(
  extras?: readonly ManhuaViralTemplateCard[] | null,
): Array<{
  laneZh: ManhuaViralTemplateLane;
  items: ManhuaViralTemplateCard[];
}> {
  const approved = listApprovedManhuaViralTemplates(extras);
  return MANHUA_VIRAL_TEMPLATE_LANE_ORDER.map((laneZh) => ({
    laneZh,
    items: approved.filter((t) => t.laneZh === laneZh),
  })).filter((g) => g.items.length > 0);
}

/** 由完整卡片生成编剧扩写注入块 */
export function formatManhuaViralTemplateWriterAddonFromCard(
  tpl: ManhuaViralTemplateCard | null | undefined,
): string {
  if (!tpl || tpl.status !== "approved") return "";
  const beats = tpl.beatGrid
    .slice(0, 16)
    .map((b) => `- ${b.atSec}s｜${b.conflictZh}｜${b.visualZh}`)
    .join("\n");
  const d = tpl.densityHints;
  return [
    "【节奏模板·骨架建议】",
    `模板：${tpl.nameZh}（${tpl.laneZh}）`,
    tpl.summaryZh ? `用途：${tpl.summaryZh}` : "",
    `前3秒钩子：${tpl.hook3sZh}`,
    `人设槽：欲望=${tpl.castShape.leadDesireZh}；压迫=${tpl.castShape.pressureZh}${
      tpl.castShape.foilZh ? `；对照=${tpl.castShape.foilZh}` : ""
    }`,
    tpl.scenePoolHints.length
      ? `场景池关键词（写入场景表，勿写外部剧名）：${tpl.scenePoolHints.join("、")}`
      : "",
    `密度建议（约180秒/集）：正文≥${d.minBodyChars}字；「」对白≥${d.minDialogueLines}句；场景表命中≥${d.minLocationHits}`,
    beats ? `节拍格：\n${beats}` : "",
    "硬规则：只借结构与节奏；禁止抄外部剧名/台词/商标；成稿只写可拍动作与关系。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 注入编剧扩写：节拍格 + 密度 + 场景池关键词（不泄漏出处剧名） */
export function formatManhuaViralTemplateWriterAddon(
  id?: string | null,
  extras?: readonly ManhuaViralTemplateCard[] | null,
): string {
  return formatManhuaViralTemplateWriterAddonFromCard(getManhuaViralTemplate(id, extras));
}
