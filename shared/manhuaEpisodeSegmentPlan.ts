/**
 * 单集预算期 5–6 段 × 15s 可拍表：意图 / 对白 / 表演 / 场景配色 / 角色 / 服化道 / 光影运镜。
 * 禁止灌水：缺字段、寒暄对白、段间高度重复、对白过稀 → 质量不通过。
 * 数值与 `manhuaScriptWorkbench` 的 MANHUA_SEGMENT_MIN/MAX/DEFAULT / 15s 对齐。
 * 成熟后再扩 10–12 段。
 */

import {
  compileManhuaDirectedSegmentPrompt,
  stripManhuaPromptSlop,
} from "./manhuaDirectingWorkflow.js";

/** 推荐段数（扩写默认目标·预算期 · Seedance 2.0） */
export const MANHUA_EPISODE_SEGMENT_COUNT = 6;
/** 短档下限 4（与时长档 short.segmentMin 对齐；2.0 默认仍铺 5–6） */
export const MANHUA_EPISODE_SEGMENT_COUNT_MIN = 4;
export const MANHUA_EPISODE_SEGMENT_COUNT_MAX = 6;
/** Seedance 2.5：4 段 × 30s */
export const MANHUA_EPISODE_SEGMENT_COUNT_SEEDANCE_25 = 4;
export const MANHUA_EPISODE_SEGMENT_DURATION_SEC = 15;
export const MANHUA_EPISODE_SEGMENT_DURATION_SEEDANCE_25_SEC = 30;
export const MANHUA_EPISODE_SEGMENT_TARGET_SEC = 90;
export const MANHUA_EPISODE_SEGMENT_TARGET_SEEDANCE_25_SEC = 120;
export const MANHUA_EPISODE_SEGMENT_TARGET_MIN_SEC = 75;

/** 每段约 15s：至少 3 句「」对白（推荐 3–4） */
export const MANHUA_EPISODE_SEGMENT_MIN_DIALOGUE_QUOTES = 3;

/**
 * 单集时长档位。
 *
 * 段长恒定 15s，切档只改「一集几段」：短档 4–6 段、长档 10–12 段。
 * 密度门禁与节拍格都按 targetSec 推算，因此加档位不需要另写一套阈值。
 */
export type ManhuaEpisodeLengthTierId = "short" | "long";

export type ManhuaEpisodeLengthTier = {
  id: ManhuaEpisodeLengthTierId;
  labelZh: string;
  /** 该档的目标秒数：门禁与节拍格都以它为准 */
  targetSec: number;
  minSec: number;
  segmentMin: number;
  segmentMax: number;
};

export const MANHUA_EPISODE_LENGTH_TIERS: readonly ManhuaEpisodeLengthTier[] = [
  {
    id: "short",
    labelZh: "60–90 秒",
    targetSec: MANHUA_EPISODE_SEGMENT_TARGET_SEC,
    minSec: 60,
    segmentMin: 4,
    segmentMax: MANHUA_EPISODE_SEGMENT_COUNT_MAX,
  },
  {
    id: "long",
    labelZh: "150–180 秒",
    targetSec: 180,
    minSec: 150,
    segmentMin: 10,
    segmentMax: 12,
  },
];

export const MANHUA_EPISODE_LENGTH_TIER_DEFAULT: ManhuaEpisodeLengthTierId = "short";

export function getManhuaEpisodeLengthTier(
  id: string | null | undefined,
): ManhuaEpisodeLengthTier {
  const hit = MANHUA_EPISODE_LENGTH_TIERS.find((t) => t.id === id);
  return hit || MANHUA_EPISODE_LENGTH_TIERS[0];
}

/** 该档一集几段（节拍格按它降采样） */
export function manhuaEpisodeSegmentsForTier(id: string | null | undefined): number {
  const tier = getManhuaEpisodeLengthTier(id);
  return Math.max(1, Math.round(tier.targetSec / MANHUA_EPISODE_SEGMENT_DURATION_SEC));
}

/** 每段正文字数下限；旧值 280 是「10 段 × 28 字」，按段数还原成每段口径 */
const MIN_BODY_CHARS_PER_SEGMENT = 28;
const MIN_LOCATION_HITS = 2;

/** 单段对白句数门槛按段长走：15s 段 3 句，≥30s 段 4 句（段更长必须多几句才撑得满） */
function minDialogueQuotesPerSegment(durationSecPerSegment: number): number {
  return durationSecPerSegment >= 30 ? 4 : MANHUA_EPISODE_SEGMENT_MIN_DIALOGUE_QUOTES;
}

/**
 * 按目标秒数推密度门槛。
 *
 * 旧代码把三分钟档（10 段）的 30 句写死成默认值，而成片实际是 5–6 段共 90 秒，
 * 于是编剧被逼写出约一倍拍不出来的台词——多出来的那半永远进不了成片。
 *
 * 门槛取段数的 5/6，沿用原作者的留白比例（他把 12 段的三分钟档算作「约 10 段」）。
 * 这样 180s 仍精确落回旧阈值 280 字 / 30 句，90s 则落到 5 段 × 3 句 = 15 句。
 *
 * 门禁与节拍模板共用本函数：模板若自报一套更松的建议，编剧照着写就必然卡门禁。
 *
 * `layout` 只影响对白句数门槛（minDlg），正文字数门槛（minBody）不跟着走：
 * Seedance 2.5 是 4 段×30s＝120 秒，比 2.0-fast 的 90 秒更长，字数要求只能更高
 * 不能更低，所以 minBody 仍按「每 15 秒一个内容单元」的旧口径从 targetSec 反推，
 * 不能借用 2.5 的真实段数（4 段）去算，否则字数门槛反而比短档还松。
 * minDlg 则必须用真实段数与真实段长：2.5 每段实际 30 秒、写 4 句就是正常密度，
 * 如果仍按「总秒数 / 15」倒推出 8 个虚拟段再乘 3 句，门槛会变成 21 句，
 * 比真实能撑的台词量高出近一倍，逼编剧写注定拍不出来的对白。
 */
export function manhuaEpisodeDensityFloors(
  targetSec: number,
  layout?: { segmentCount?: number; durationSecPerSegment?: number } | null,
): {
  segments: number;
  minBody: number;
  minDlg: number;
  minLoc: number;
} {
  const segs = Math.max(1, Math.floor(targetSec / MANHUA_EPISODE_SEGMENT_DURATION_SEC));
  const gateSegs = Math.max(1, Math.round((segs * 5) / 6));

  const realSegCount = Math.max(1, Math.floor(layout?.segmentCount ?? segs));
  const durationPerSeg = Math.max(
    1,
    Math.floor(layout?.durationSecPerSegment ?? MANHUA_EPISODE_SEGMENT_DURATION_SEC),
  );
  const gateSegsForDlg = Math.max(1, Math.round((realSegCount * 5) / 6));
  const dlgPerSeg = minDialogueQuotesPerSegment(durationPerSeg);

  return {
    segments: segs,
    minBody: gateSegs * MIN_BODY_CHARS_PER_SEGMENT,
    minDlg: gateSegsForDlg * dlgPerSeg,
    minLoc: gateSegs >= 5 ? MIN_LOCATION_HITS : 1,
  };
}

export type ManhuaEpisodeSegmentBeat = {
  index: number;
  /** 本段单一意图：观众应感到什么（导戏硬锚） */
  intentZh: string;
  dialogueZh: string;
  /** 表情 / 肢体 / 情绪起伏（可拍表演） */
  performanceZh: string;
  sceneZh: string;
  paletteZh: string;
  castZh: string;
  wardrobePropZh: string;
  lightingCameraZh: string;
};

export type ManhuaEpisodeSegmentPlan = {
  segmentCount: number;
  durationSecPerSegment: number;
  targetSec: number;
  segments: ManhuaEpisodeSegmentBeat[];
};

export type ManhuaEpisodeSegmentPlanQuality = {
  ok: boolean;
  readyCount: number;
  requiredCount: number;
  issues: string[];
};

const FILLER_DIALOGUE_RE =
  /^(嗯+|啊+|哦+|好的|是的|对啊|哈哈+|今天天气|你好啊|在吗|没事|随便|加油|晚安|早啊)[.。!！?？…]*$/i;

// 可拍表演线索：表情 / 面部 / 肢体动作 / 情绪起伏。词表宁宽勿窄——
// 真实表演几乎必含身体或面部动作词；只写「很生气」这类纯抽象仍会被 length + 词表拦下。
const PERFORMANCE_CUE_RE =
  /表情|眼|瞳|眉|嘴|唇|齿|咬|牙|泪|哽|颤|抖|震|笑|怒|慌|沉|惊|僵|滞|顿|绷|松|垂|扬|皱|瞪|盯|避|躲|迟疑|停顿|呼吸|气口|握|攥|拳|指|掌|手|腕|臂|肩|背|胸|膝|腿|脚|步|身|头|面|脸|推|拉|退|逼近|侧|抬|低|转|跪|扑|甩|扶|挡|护|拦|按|抓|伸|俯|仰|靠|撞|踢|踩|跃|挥|拨|顶|肢体|情绪|摸|抠|掐|捏|扣|绞|拧|扭|屈|蜷|缩|蹲|跨|翻|栽|坠|瘫|踉|蹒|怔|愣|愕|瞥|眨|闭|睁|抿|噎|咽|喉|颈|腰|肘|喘|叹|屏|哼|嗤|瑟|停|发飘|滚动/;

const FIELD_KEYS: Array<{
  key: keyof Omit<ManhuaEpisodeSegmentBeat, "index">;
  aliases: string[];
}> = [
  { key: "intentZh", aliases: ["意图", "本段意图", "戏剧意图", "观众感受"] },
  { key: "dialogueZh", aliases: ["对白", "台词", "对话"] },
  { key: "performanceZh", aliases: ["表演", "表情肢体", "情绪表演", "表情", "肢体"] },
  { key: "sceneZh", aliases: ["场景", "地点", "场次"] },
  { key: "paletteZh", aliases: ["配色风格", "配色", "色调", "风格色"] },
  { key: "castZh", aliases: ["角色", "出演", "人物"] },
  { key: "wardrobePropZh", aliases: ["服装道具", "服化道", "服装", "道具"] },
  { key: "lightingCameraZh", aliases: ["光影运镜", "光影", "运镜", "镜头"] },
];

function normalizeFieldLine(raw: string): string {
  return String(raw || "")
    .replace(/^[\s>*\-•·]+/, "")
    .replace(/\*\*/g, "")
    .trim();
}

function pickField(block: string, aliases: string[]): string {
  for (const alias of aliases) {
    const re = new RegExp(
      `(?:^|\\n)\\s*[-*·]?\\s*${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:：]\\s*([^\\n]+)`,
      "i",
    );
    const m = block.match(re)?.[1];
    // 阈值放到 ≥1：编剧明确写「无」（此段确无该字段）也算已填，不算漏填。
    // 对白字段不走这里（见 dialogueZh 分支），密度仍由引号句数门禁把关，不受影响。
    if (m && normalizeFieldLine(m).length >= 1) return normalizeFieldLine(m).slice(0, 400);
  }
  return "";
}

/**
 * 对白可单行，也可写成：
 * - 对白：
 *   - 甲：「…」
 *   - 乙：「…」
 */
function pickDialogueField(block: string): string {
  // 冒号后只用同行空白，避免 \s 吃掉换行把下一子弹进「行内」
  const header = block.match(
    /(?:^|\n)[ \t]*[-*·]?[ \t]*(?:对白|台词|对话)[ \t]*[:：][ \t]*([^\n]*)/i,
  );
  if (!header || header.index == null) return "";
  const inline = normalizeFieldLine(header[1] || "");
  const collected: string[] = [];
  if (inline) collected.push(inline);

  const after = block.slice(header.index + header[0].length);
  for (const rawLine of after.split("\n")) {
    const line = String(rawLine || "");
    if (
      /^[ \t]*[-*·]?[ \t]*(表演|表情肢体|情绪表演|场景|地点|场次|配色风格|配色|色调|角色|出演|人物|服装道具|服化道|服装|道具|光影运镜|光影|运镜|镜头)[ \t]*[:：]/.test(
        line,
      )
    ) {
      break;
    }
    const t = line.replace(/^[ \t]*[-*·][ \t]*/, "").trim();
    if (!t) {
      if (collected.length) break;
      continue;
    }
    collected.push(t);
  }
  const readable = collected.join(" ").replace(/\s+/g, " ").trim();
  return readable.slice(0, 500);
}

function emptyBeat(index: number): ManhuaEpisodeSegmentBeat {
  return {
    index,
    intentZh: "",
    dialogueZh: "",
    performanceZh: "",
    sceneZh: "",
    paletteZh: "",
    castZh: "",
    wardrobePropZh: "",
    lightingCameraZh: "",
  };
}

/** 统计对白行内直角/弯引号句数 */
export function countManhuaSegmentDialogueQuotes(dialogueZh: string): number {
  return extractManhuaSegmentDialogueQuotes(dialogueZh).length;
}

/**
 * 从可拍表对白字段抽出「」句，供成片秒轴灌入。
 * 若原文有「苏照雪：「…」」说话人，保留为 `苏照雪：「…」`，禁止只剩光秃台词导致锁错脸。
 */
export function extractManhuaSegmentDialogueQuotes(dialogueZh: string): string[] {
  const t = String(dialogueZh || "");
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (line: string) => {
    const s = String(line || "").trim();
    if (s.length < 1 || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  // 已经识别出说话人的引号原文，避免被下面的「无说话人回落」再当匿名句重复计入
  const consumedQuotes = new Set<string>();
  /**
   * 优先：姓名：「台词」/ 姓名（批注）：「台词」（批注如「气声」「自语」「低」不进名字，
   * 否则锁脸会锁错）。Array.from 兼容 Fly tsc 旧 target。
   */
  const withSpeaker = Array.from(
    t.matchAll(
      /([\u4e00-\u9fff·A-Za-z]{2,12})(?:[（(][^）)]{0,16}[）)])?\s*[：:]\s*「([^」]{1,80})」/g,
    ),
  );
  for (const m of withSpeaker) {
    const name = String(m[1] || "").trim();
    const quote = String(m[2] || "").trim();
    if (name && quote) {
      push(`${name}：「${quote}」`);
      consumedQuotes.add(quote);
    }
  }
  const withSpeakerCurly = Array.from(
    t.matchAll(
      /([\u4e00-\u9fff·A-Za-z]{2,12})(?:[（(][^）)]{0,16}[）)])?\s*[：:]\s*[\u201c“]([^\u201d”]{1,80})[\u201d”]/g,
    ),
  );
  for (const m of withSpeakerCurly) {
    const name = String(m[1] || "").trim();
    const quote = String(m[2] || "").trim();
    if (name && quote) {
      push(`${name}：「${quote}」`);
      consumedQuotes.add(quote);
    }
  }

  /**
   * 回落：无法识别说话人的引号句仍要计入，不能因为本段已经抓到几句带说话人的
   * 台词就整段跳过——之前在这里 `if (out.length) return` 提前返回，会把带批注
   * 说话人的句子静默丢掉且不进回落，两三句台词就这样在门禁里凭空消失。
   */
  const cn = t.match(/「([^」]{1,80})」/g) || [];
  const curly = t.match(/[\u201c“]([^\u201d”]{1,80})[\u201d”]/g) || [];
  const en = t.match(/"([^"]{1,80})"/g) || [];
  for (const raw of [...cn, ...curly, ...en]) {
    const inner = String(raw || "")
      .replace(/^[「『"“\u201c]|[」』"”\u201d]$/g, "")
      .trim();
    if (inner.length < 1 || consumedQuotes.has(inner)) continue;
    push(inner);
  }
  return out.slice(0, 8);
}

/** 从 `苏照雪：「台词」` 或行首姓名抽出说话人名 */
export function extractManhuaDialogueSpeakerName(
  dialogueZh: string | null | undefined,
): string {
  const t = String(dialogueZh || "").trim();
  const m =
    t.match(/^([\u4e00-\u9fff·A-Za-z]{2,12})(?:[（(][^）)]{0,16}[）)])?\s*[：:]\s*[「『"“]/) ||
    t.match(/^([\u4e00-\u9fff·A-Za-z]{2,12})\s*[「『"“]/);
  return String(m?.[1] || "").trim();
}

/**
 * 可拍表缺「角色：」时，从对白说话人补出场名单（供锁脸与 UI 预填）。
 * 有 castZh 则原样返回；禁止编造未出现的人名。
 */
export function inferManhuaCastZhFromDialogue(
  castZh: string | null | undefined,
  dialogueZh: string | null | undefined,
): string {
  const existing = String(castZh || "").trim();
  if (existing) return existing;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const line of extractManhuaSegmentDialogueQuotes(String(dialogueZh || ""))) {
    const n = extractManhuaDialogueSpeakerName(line);
    if (n.length < 2 || seen.has(n)) continue;
    seen.add(n);
    names.push(n);
  }
  return names.slice(0, 4).join("；");
}

/**
 * 意图兜底：某段缺「意图」但对白+表演齐全时，从对白+表演自动概括一句
 * 「观众应感到什么」，让门禁不再因单缺意图卡住、导戏也拿得到锚。
 * 机器概括（够用可改）；不改写用户原文，仅在解析时补进 plan。
 */
export function deriveManhuaSegmentIntentFallbackZh(
  beat: Pick<ManhuaEpisodeSegmentBeat, "dialogueZh" | "performanceZh">,
): string {
  const quotes = extractManhuaSegmentDialogueQuotes(beat.dialogueZh || "");
  // 取末句对白（多为本段落点/情绪高点）去掉说话人名，作情绪落点
  const lastQuote = quotes.length
    ? String(quotes[quotes.length - 1] || "").replace(/^[^「『"“:：]{1,12}\s*[：:]\s*/, "").replace(/[「『」』"“”]/g, "").trim()
    : "";
  const perf = String(beat.performanceZh || "")
    .split(/[；;。\n]/)[0]
    ?.trim()
    .slice(0, 40);
  const hook = lastQuote ? lastQuote.slice(0, 28) : "";
  if (hook && perf) return `让观众抓住本段落点「${hook}」，随${perf}的情绪推进`.slice(0, 60);
  if (hook) return `让观众抓住本段落点：「${hook}」`.slice(0, 60);
  if (perf) return `让观众感到本段情绪推进：${perf}`.slice(0, 60);
  return "";
}

/** 从「#### 段01」或「#### 段 1」块解析 */
export function parseManhuaEpisodeSegmentPlanFromMarkdown(md: string): ManhuaEpisodeSegmentPlan {
  const text = String(md || "");
  const segments: ManhuaEpisodeSegmentBeat[] = [];
  const re = /(?:^|\n)#{2,4}\s*段\s*0*(\d{1,2})\s*\n([\s\S]*?)(?=\n#{2,4}\s*段\s*0*\d|\n#{2,3}\s*片尾钩子|\n##\s*第\d+集|\n##\s[^#]|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const index = Math.floor(Number(m[1]));
    if (!Number.isFinite(index) || index < 1 || index > 24) continue;
    const block = m[2] || "";
    const beat = emptyBeat(index);
    for (const field of FIELD_KEYS) {
      if (field.key === "dialogueZh") {
        beat.dialogueZh = pickDialogueField(block);
        continue;
      }
      beat[field.key] = pickField(block, field.aliases);
    }
    // 意图兜底：缺意图但对白+表演齐全 → 自动概括一句，永不因单缺意图卡门禁
    if (
      !String(beat.intentZh || "").trim() &&
      String(beat.dialogueZh || "").trim() &&
      String(beat.performanceZh || "").trim()
    ) {
      beat.intentZh = deriveManhuaSegmentIntentFallbackZh(beat);
    }
    segments.push(beat);
  }
  segments.sort((a, b) => a.index - b.index);
  // 去重同 index，保留字段更全的一条
  const byIndex = new Map<number, ManhuaEpisodeSegmentBeat>();
  for (const s of segments) {
    const prev = byIndex.get(s.index);
    if (!prev) {
      byIndex.set(s.index, s);
      continue;
    }
    const score = (b: ManhuaEpisodeSegmentBeat) =>
      FIELD_KEYS.reduce((n, f) => n + (b[f.key] ? 1 : 0), 0);
    if (score(s) >= score(prev)) byIndex.set(s.index, s);
  }
  const ordered = Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
  return {
    segmentCount: MANHUA_EPISODE_SEGMENT_COUNT,
    durationSecPerSegment: MANHUA_EPISODE_SEGMENT_DURATION_SEC,
    targetSec: MANHUA_EPISODE_SEGMENT_TARGET_SEC,
    segments: ordered,
  };
}

function isFillerDialogue(s: string): boolean {
  const t = s.replace(/\s+/g, "").trim();
  if (t.length < 4) return true;
  if (FILLER_DIALOGUE_RE.test(t)) return true;
  if (/^(哈哈|嘿嘿|呵呵|嗯嗯|啊啊)+$/.test(t)) return true;
  return false;
}

function nearDuplicate(a: string, b: string): boolean {
  const x = a.replace(/\s+/g, "");
  const y = b.replace(/\s+/g, "");
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 8 && y.length >= 8 && (x.includes(y) || y.includes(x))) return true;
  return false;
}

export function evaluateManhuaEpisodeSegmentPlanQuality(
  plan: ManhuaEpisodeSegmentPlan | null | undefined,
  requiredCount:
    | number
    | { min?: number; max?: number } = {
      min: MANHUA_EPISODE_SEGMENT_COUNT_MIN,
      max: MANHUA_EPISODE_SEGMENT_COUNT_MAX,
    },
): ManhuaEpisodeSegmentPlanQuality {
  const issues: string[] = [];
  const segments = plan?.segments || [];
  const minRequired =
    typeof requiredCount === "number"
      ? Math.max(1, Math.min(24, requiredCount))
      : Math.max(
          1,
          Math.min(
            24,
            Math.floor(requiredCount.min ?? MANHUA_EPISODE_SEGMENT_COUNT_MIN),
          ),
        );
  const maxRequired =
    typeof requiredCount === "number"
      ? minRequired
      : Math.max(
          minRequired,
          Math.min(
            24,
            Math.floor(requiredCount.max ?? MANHUA_EPISODE_SEGMENT_COUNT_MAX),
          ),
        );

  let readyCount = 0;
  const seenDialogue: string[] = [];

  // 从段 1 连续验收到 max；允许在 [min,max] 提前收束
  for (let i = 1; i <= maxRequired; i++) {
    const beat = segments.find((s) => s.index === i);
    if (!beat) {
      if (readyCount < minRequired) {
        issues.push(`缺段 ${String(i).padStart(2, "0")}`);
      }
      break;
    }
    const missing = FIELD_KEYS.filter((f) => !String(beat[f.key] || "").trim()).map((f) => f.aliases[0]);
    if (missing.length) {
      issues.push(`段${String(i).padStart(2, "0")} 缺字段：${missing.join("、")}`);
      break;
    }
    if (isFillerDialogue(beat.dialogueZh)) {
      issues.push(`段${String(i).padStart(2, "0")} 对白灌水或过短`);
      break;
    }
    const quotes = countManhuaSegmentDialogueQuotes(beat.dialogueZh);
    if (quotes < MANHUA_EPISODE_SEGMENT_MIN_DIALOGUE_QUOTES) {
      issues.push(
        `段${String(i).padStart(2, "0")} 对白仅 ${quotes} 句「」，约15秒段至少 ${MANHUA_EPISODE_SEGMENT_MIN_DIALOGUE_QUOTES} 句（推荐3–4句）`,
      );
      break;
    }
    const intent = String(beat.intentZh || "").trim();
    if (intent.length < 4) {
      issues.push(`段${String(i).padStart(2, "0")} 缺本段意图：须写清观众应感到什么`);
      break;
    }
    const perf = String(beat.performanceZh || "").trim();
    if (perf.length < 8 || !PERFORMANCE_CUE_RE.test(perf)) {
      issues.push(
        `段${String(i).padStart(2, "0")} 表演过薄：须写清表情/肢体/情绪起伏（可拍）`,
      );
      break;
    }
    if (seenDialogue.some((d) => nearDuplicate(d, beat.dialogueZh))) {
      issues.push(`段${String(i).padStart(2, "0")} 对白与他段重复`);
      break;
    }
    seenDialogue.push(beat.dialogueZh);
    readyCount += 1;
  }

  if (readyCount < minRequired) {
    issues.unshift(
      `可拍段不足：需要 ${minRequired}–${maxRequired} 段，当前连续合格 ${readyCount} 段`,
    );
  }

  // 换场判定按「全集所有段」的场景算，而非只看前 minRequired–maxRequired 窗口：
  // 高潮集常把决战集中在同一主场景、结尾才切一笔（如 御河水门×9 → 芦苇渡口×1），
  // 这是正当空间结构；只有「整集从头到尾仅 1 个场景」才算空壳复读。
  const allScenes = segments
    .map((s) => String(s.sceneZh || "").replace(/\s+/g, ""))
    .filter(Boolean);
  const uniqueScenes = new Set(allScenes).size;
  if (readyCount >= minRequired && uniqueScenes < 2) {
    issues.push(
      `场景几乎不换场：整集所有段都在同一场景复读，须有空间/氛围递进`,
    );
  }

  return {
    ok: readyCount >= minRequired && readyCount <= maxRequired && issues.length === 0,
    readyCount,
    requiredCount: minRequired,
    issues: issues.slice(0, 16),
  };
}

/** 编剧扩写 prompt 用的五至六段表头说明（禁灌水·预算期） */
export function formatManhuaEpisodeSegmentPlanPromptBlock(
  segmentCount = MANHUA_EPISODE_SEGMENT_COUNT,
  durationSec = MANHUA_EPISODE_SEGMENT_DURATION_SEC,
): string {
  const isSeedance25 =
    segmentCount === MANHUA_EPISODE_SEGMENT_COUNT_SEEDANCE_25 &&
    durationSec === MANHUA_EPISODE_SEGMENT_DURATION_SEEDANCE_25_SEC;
  const minSegs = isSeedance25
    ? MANHUA_EPISODE_SEGMENT_COUNT_SEEDANCE_25
    : MANHUA_EPISODE_SEGMENT_COUNT_MIN;
  const maxSegs = isSeedance25
    ? MANHUA_EPISODE_SEGMENT_COUNT_SEEDANCE_25
    : MANHUA_EPISODE_SEGMENT_COUNT_MAX;
  const n = Math.max(minSegs, Math.min(maxSegs, segmentCount));
  const minSec = minSegs * durationSec;
  const maxSec = maxSegs * durationSec;
  return [
    isSeedance25 ? `### 四段可拍表（成片·加长）` : `### 五至六段可拍表`,
    `（硬性：至少 ${minSegs} 段、至多 ${maxSegs} 段；推荐 ${n} 段；每段约 ${durationSec} 秒；整集约 ${minSec}–${maxSec} 秒。预算期勿写满十多段；禁止寒暄灌水、禁止段间复制粘贴。）`,
    `每一段必须用下列字段（缺一不可）：`,
    `- 意图：一句「观众应感到什么」（单一戏剧意图）；机位/光/表演只服务这一句。`,
    `- 对白：至少 ${MANHUA_EPISODE_SEGMENT_MIN_DIALOGUE_QUOTES} 句直角引号「」（推荐 3–4 句），须推动关系/信息/冲突；禁止两句口号撑满 ${durationSec} 秒。每句带说话人（写法：苏照雪：「…」或 @角色N「…」），群戏尤其必须带——不带名字的台词成片里锁不到脸、口型没人认领。`,
    `- 表演：写清表情、肢体与情绪起伏（可拍），与对白气口对齐；禁止只写抽象词如「很生气」。`,
    /**
     * 这几栏原文会被直接拼进视频生成提示词，中间不再过模型润色。写成「推近」
     * 「他很紧张」这种词条，成片就只能拿到词条；写成可看见的画面，成片才有画面。
     */
    `- 光影运镜：写成看得见的镜头动作，含机位高度、景别与动势走向（例：「贴桥板低机位，全景缓推至中近景，火光从画左扫过侧脸」）；禁止只写「推近」「特写」这类孤零零的词条。情绪在本镜内转折时写成两拍时序（例：「先环绕半周看清局势，再推近到面部」），单动势仍写一句。`,
    `- 段内白描：把本段拆成约 ${Math.max(2, Math.round(durationSec / 5))} 个 5 秒左右的镜头，每镜一句连贯白描，写清「谁做了什么、镜头怎么动、光怎么变」，像描述一段已经拍好的画面；禁止写成「动作：X／运镜：Y」的字段表。`,
    `#### 段01`,
    `- 意图：`,
    `- 对白：`,
    `- 表演：`,
    `- 场景：`,
    `- 配色风格：`,
    `- 角色：（写真名，如「苏文谦；苏照雪」；禁止只写黑衣剑客这类描述词）`,
    `- 服装道具：`,
    `- 光影运镜：`,
    `- 段内白描：`,
    `（段02…段${String(n).padStart(2, "0")} 同结构；至少 ${minSegs} 段、至多 ${maxSegs} 段；跨段须有信息增量与场面变化。禁止把后段钩子提前写进本段对白。）`,
  ].join("\n");
}

/** 单测夹具：6 段合格可拍表（禁止当产品灌水生成器用） */
export function buildManhuaEpisodeSegmentPlanFixtureMarkdown(): string {
  const scenes = [
    "雨夜回廊",
    "烛火偏殿",
    "鹤影湖堤",
    "山神破庙",
    "雨夜回廊侧门",
    "偏殿屏风后",
  ];
  const blocks = scenes.map((scene, i) => {
    const n = String(i + 1).padStart(2, "0");
    const k = i + 1;
    return [
      `#### 段${n}`,
      `- 意图：压迫感逼近，旧盟从硬撑到松口`,
      `- 对白：「把玉珏交出来——第${k}次。」「你再装傻，我就掀了这屏风。」「……拿去，别碰她。」`,
      `- 表演：逼近方眉心紧、握拳指节发白；对方先冷笑再眼神一颤，后退半步攥袖。`,
      `- 场景：${scene}`,
      `- 配色风格：冷青主色，烛金辅，血锈点缀`,
      `- 角色：沈清逼近；旧盟冷笑后退`,
      `- 服装道具：青衣银簪；半枚玉珏握于掌心`,
      `- 光影运镜：侧逆光压暗；中景推至近景`,
    ].join("\n");
  });
  return ["### 五至六段可拍表", ...blocks].join("\n");
}

/**
 * 把某段「意图」写回可拍表 markdown（有则替换，无则在段标题后插入）。
 * 找不到 #### 段NN 时原样返回。
 */
export function upsertManhuaSegmentIntentInMarkdown(
  markdown: string,
  segmentIndex: number,
  intentZh: string,
): string {
  const src = String(markdown || "");
  const idx = Math.max(1, Math.floor(segmentIndex));
  const intent = String(intentZh || "").trim().slice(0, 80);
  if (!intent) return src;
  const pad = String(idx).padStart(2, "0");
  const headerRe = new RegExp(
    `(#{2,4}\\s*段\\s*0*${idx}\\b[^\\n]*\\n)([\\s\\S]*?)(?=#{2,4}\\s*段\\s*\\d|$)`,
    "i",
  );
  const m = src.match(headerRe);
  if (!m || m.index == null) return src;
  const header = m[1] || "";
  let body = m[2] || "";
  if (/(?:^|\n)\s*[-*·]?\s*(?:意图|本段意图|戏剧意图|观众感受)\s*[:：]/.test(body)) {
    body = body.replace(
      /((?:^|\n)\s*[-*·]?\s*(?:意图|本段意图|戏剧意图|观众感受)\s*[:：]\s*)([^\n]*)/i,
      `$1${intent}`,
    );
  } else {
    body = `- 意图：${intent}\n${body.replace(/^\n*/, "")}`;
  }
  return src.slice(0, m.index) + header + body + src.slice(m.index + m[0].length);
}

/**
 * 把某段「角色：」写回可拍表 markdown（有则替换，无则在段标题后插入）。
 */
export function upsertManhuaSegmentCastInMarkdown(
  markdown: string,
  segmentIndex: number,
  castZh: string,
): string {
  const src = String(markdown || "");
  const idx = Math.max(1, Math.floor(segmentIndex));
  const cast = String(castZh || "").trim().slice(0, 80);
  // 允许清空：用户删光出场行时写回空字段
  const headerRe = new RegExp(
    `(#{2,4}\\s*段\\s*0*${idx}\\b[^\\n]*\\n)([\\s\\S]*?)(?=#{2,4}\\s*段\\s*\\d|$)`,
    "i",
  );
  const m = src.match(headerRe);
  if (!m || m.index == null) return src;
  const header = m[1] || "";
  let body = m[2] || "";
  if (/(?:^|\n)\s*[-*·]?\s*(?:角色|出演|人物)\s*[:：]/.test(body)) {
    body = body.replace(
      /((?:^|\n)\s*[-*·]?\s*(?:角色|出演|人物)\s*[:：]\s*)([^\n]*)/i,
      `$1${cast}`,
    );
  } else {
    body = `- 角色：${cast}\n${body.replace(/^\n*/, "")}`;
  }
  return src.slice(0, m.index) + header + body + src.slice(m.index + m[0].length);
}

/** 从可拍表取某段意图（供工作台/成片注入） */
export function getManhuaSegmentIntentZh(
  plan: ManhuaEpisodeSegmentPlan | null | undefined,
  segmentIndex: number,
): string {
  const idx = Math.max(1, Math.floor(segmentIndex));
  const hit = (plan?.segments || []).find((s) => s.index === idx);
  return String(hit?.intentZh || "").trim();
}

/** 把可拍表压成工厂节拍提示（不编造缺失段；含意图 + 节拍防火墙 + 去空话） */
export function formatManhuaEpisodeSegmentPlanBeatsBlock(
  plan: ManhuaEpisodeSegmentPlan | null | undefined,
): string {
  const segs = (plan?.segments || []).slice().sort((a, b) => a.index - b.index);
  if (!segs.length) return "";
  const lines = segs.map((s, idx) => {
    const already = segs
      .slice(0, idx)
      .map((p) => `段${p.index}:${p.intentZh || String(p.dialogueZh || "").slice(0, 24)}`)
      .join("；")
      .slice(0, 280);
    const later = segs
      .slice(idx + 1, idx + 3)
      .map((p) => `段${p.index}:${p.intentZh || "后段冲突"}`)
      .join("；")
      .slice(0, 200);
    const body = stripManhuaPromptSlop(
      [
        `对白：${s.dialogueZh}`,
        `表演：${s.performanceZh}`,
        `场景：${s.sceneZh}｜配色：${s.paletteZh}`,
        `角色：${s.castZh}｜服化道：${s.wardrobePropZh}`,
        `光影运镜：${s.lightingCameraZh}`,
      ].join("\n"),
    );
    return [
      `【段${String(s.index).padStart(2, "0")}·${MANHUA_EPISODE_SEGMENT_DURATION_SEC}s】`,
      compileManhuaDirectedSegmentPrompt({
        segmentIndex: s.index,
        intentZh: s.intentZh,
        thisBeatZh: body,
        alreadyHappenedZh: already,
        reservedForLaterZh: later,
      }),
    ].join("\n");
  });
  return `【已确认五至六段可拍表·禁止改写成灌水】\n${lines.join("\n\n")}`;
}
