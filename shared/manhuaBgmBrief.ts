/**
 * 剧情/读片结论 → Suno BGM brief。
 *
 * 写法遵循 `bgm-scoring` skill（用户七条实弹 prompt 蒸馏出来的），
 * 核心是**五要素按序 ＋ 结构标签**，不是标签堆砌：
 *
 *   ① 情绪弧线（写「从哪到哪」，不是「是什么」）
 *   ② 乐器点名带演奏法（「琵琶轮指扫弦」强于「琵琶」）
 *   ③ 节奏走向（变化过程；有节拍点时用分段 bpm）
 *   ④ 收尾方式（必须写死，最后几秒最容易崩）
 *   ⑤ 硬参数（时长 · bpm · 44.1KHz）
 *
 * 另加两条实弹教训：
 *   · `prompt` 字段放**结构标签**而非留空 —— `[End]` 是治「长档偏短」的正解
 *     （实测 22s 档给 21.4s、20s 档给 17.7s，都是没写 [End]）
 *   · style **约 10 个描述词，超 12 臃肿**；同义词堆叠互相稀释，
 *     变化拆进结构标签，别全塞 style
 */

/** V5.5 硬边界（EvoLink 文档） */
export const BGM_DURATION_MIN_SEC = 10;
export const BGM_DURATION_MAX_SEC = 360;
export const BGM_STYLE_MAX_CHARS = 1000;
export const BGM_TITLE_MAX_CHARS = 80;
export const BGM_NEGATIVE_TAGS_MAX_CHARS = 200;

/** 描述词纪律：超过这个数就互相稀释 */
export const BGM_STYLE_MAX_DESCRIPTORS = 12;

/**
 * 纯音乐双保险的第二道。
 * `instrumental=true` 是第一道，但 `no [element]` 类排除是**概率抑制不是硬过滤**，
 * 两道都要上。
 */
export const BGM_INSTRUMENTAL_NEGATIVE_TAGS = "vocals, singing, voice, choir, lyrics";

/** 要它听话就往上；配乐要托底不抢戏，weirdness 压低 */
export const BGM_STYLE_WEIGHT = 0.78;
export const BGM_WEIRDNESS_CONSTRAINT = 0.25;

/** 时长比片子长 2–4 秒留裁切余量；长档还偏短，取上限更稳 */
export const BGM_DURATION_HEADROOM_SEC = 3;

export type BgmBeatMood = "蓄力" | "冲突" | "反转" | "收束";

/** 题材 → 乐器**带演奏法**。只写乐器名模型自由发挥，带演奏法才锁得住 */
const LANE_INSTRUMENTS: Record<string, string> = {
  古言种田: "古筝主线轮指扫弦，二胡副线弓法绵长，竹笛点缀",
  悬疑权谋: "低音弦乐持续音铺底，太鼓由疏到密推进，琵琶三次凌厉拨弦",
  爽文逆袭: "铜管厚重齐奏为主线，战鼓由疏到密，弦乐层层叠加",
  系统觉醒: "合成器脉冲低频铺底，铜管突入，电子打击乐切分",
  甜宠: "钢琴分解和弦为主线，弦乐弱奏铺底，音乐盒点缀",
  搞笑沙雕: "拨奏弦乐跳音，木管短促应答，马林巴滚奏",
  游戏竞技: "失真吉他riff主线，底鼓四拍推进，合成器高音穿刺",
};
const LANE_FALLBACK = "弦乐主线弓法绵长，钢琴厚重和弦，低音提琴托底";

/** 段情绪 → 结构标签的 Performance Cue（拆到每段，比全堆 style 里准） */
const MOOD_CUE: Record<BgmBeatMood, { tag: string; cueZh: string }> = {
  蓄力: { tag: "Build", cueZh: "压迫渐增，稀疏留白" },
  冲突: { tag: "Peak", cueZh: "断裂点砸下，能量顶格" },
  反转: { tag: "Turn", cueZh: "调性骤变，一拍之内翻面" },
  收束: { tag: "Outro", cueZh: "余波不泄，悬着" },
};

/** 弧线用「从哪到哪」，不是「是什么」 */
const MOOD_ARC_POINT: Record<BgmBeatMood, string> = {
  蓄力: "压抑积压",
  冲突: "情绪炸开",
  反转: "局面翻面",
  收束: "余韵沉落",
};

export type BgmBriefInput = {
  laneZh: string;
  /** 画面时长（秒）。BGM 会在此基础上加余量 */
  durationSec: number;
  /** 段情绪走向，按时间顺序 */
  moods: readonly BgmBeatMood[];
  /**
   * 读片得到的情绪弧线原文（片后配乐时优先用它）。
   * 有它就不用 moods 拼弧线 —— 读片看到的比剧本猜的准。
   */
  moodArcZh?: string;
  /** 收尾方式；不写死的话模型会自己选，混进片子和尾钩打架 */
  endingZh?: string;
  /** 有明确节拍点时给分段 bpm，如「1-6秒60bpm，7-13秒70bpm」 */
  tempoPlanZh?: string;
  bpm?: number;
  /** 作品风格锚（作品名可用，**人名不可用**） */
  styleAnchorZh?: string;
  titleZh?: string;
  /** 用户在卡面改过的 style；给了就原样用，不再自动拼 */
  styleOverrideZh?: string;
  /** 画面有静音停顿时，结构里插 [Break] 让模型自己留空 */
  hasSilenceBreak?: boolean;
};

export type BgmBrief = {
  model: "suno-v5.5-beta";
  custom_mode: true;
  instrumental: true;
  style: string;
  /** instrumental 下不放歌词，放结构标签 */
  prompt: string;
  title: string;
  duration: number;
  negative_tags: string;
  style_weight: number;
  weirdness_constraint: number;
};

const cut = (v: string, max: number) => v.trim().slice(0, max).replace(/[,，]\s*$/, "");

/** 时长：画面时长 + 余量，再夹到 10–360 */
export function resolveBgmDurationSec(pictureSec: number): number {
  const n = Math.round(Number(pictureSec) || 0) + BGM_DURATION_HEADROOM_SEC;
  if (!Number.isFinite(n)) return BGM_DURATION_MIN_SEC;
  return Math.min(BGM_DURATION_MAX_SEC, Math.max(BGM_DURATION_MIN_SEC, n));
}

/** 兼容旧调用：直接夹取，不加余量 */
export function clampBgmDurationSec(sec: number): number {
  const n = Math.round(Number(sec) || 0);
  if (!Number.isFinite(n)) return BGM_DURATION_MIN_SEC;
  return Math.min(BGM_DURATION_MAX_SEC, Math.max(BGM_DURATION_MIN_SEC, n));
}

/**
 * 描述词计数：按逗号切。
 * 超过 12 会互相稀释，这是实弹教训不是风格偏好。
 */
export function countBgmStyleDescriptors(style: string): number {
  return String(style || "")
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

/**
 * 在世音乐家点名检测。
 *
 * Suno **主动拦艺人名**，写了会静默失败。作品名可以用
 * （「Mission Impossible 风格」「十面埋伏拨弦」实测有效），人名不行。
 * 这里只能做提示，不做黑名单——名单永远不全。
 */
/**
 * 明确点名在世音乐家 → Suno 会拦，写了静默失败。
 *
 * ⚠️ 上一版带了 `/(风格|style)\s*$/` 这种泛化规则，把「悬疑电影风格」也误判了 ——
 * **作品名是允许且有效的**（「Mission Impossible 风格」「十面埋伏拨弦」实测通过），
 * 只有人名不行。所以这里只查名单，不猜句式。
 */
const ARTIST_NAME_PATTERNS = [
  /Yo\s*Yo\s*Ma/i,
  /Hans\s*Zimmer/i,
  /Ennio\s*Morricone/i,
  /John\s*Williams/i,
  /久石让/,
  /坂本龍一|坂本龙一/,
  /谭盾/,
];

export function looksLikeArtistName(text: string): boolean {
  const t = String(text || "");
  return ARTIST_NAME_PATTERNS.some((re) => re.test(t));
}

/**
 * 提交前的最终 style 校验。**必须在 createJob 之前调用** ——
 * 上一版这个函数只有定义没人调，styleOverrideZh 可以原样绕过。
 */
export function assertBgmStyleSubmittable(brief: Pick<BgmBrief, "style">): void {
  if (looksLikeArtistName(brief.style)) {
    throw new Error(
      "配乐风格里出现了在世音乐家姓名，Suno 会拦。请改成可听特征描述："
      + "乐器与演奏法、速度、节奏走向、氛围（例：大提琴音色温暖醇厚、弓法绵长如歌唱）",
    );
  }
}

/** 结构标签：段落数是时长的主要杠杆，`[End]` 强制终止 */
export function buildBgmStructurePrompt(input: {
  moods: readonly BgmBeatMood[];
  hasSilenceBreak?: boolean;
  endingZh?: string;
}): string {
  const lines = ["[Intro - 建置，稀疏]"];
  const seen = new Set<string>();
  for (const m of input.moods) {
    const cue = MOOD_CUE[m];
    if (!cue) continue;
    // [Break] 直接对应画面的静音停顿，插在爆点之前
    if (input.hasSilenceBreak && cue.tag === "Peak" && !seen.has("Break")) {
      lines.push("[Break - 全频静音，最大一刀之前的憋]");
      seen.add("Break");
    }
    if (seen.has(cue.tag)) continue;
    seen.add(cue.tag);
    lines.push(`[${cue.tag} - ${cue.cueZh}]`);
  }
  if (!seen.has("Outro")) {
    lines.push(`[Outro - ${input.endingZh?.trim() || "余波不泄，悬着"}]`);
  }
  // 治「长档偏短、收尾不可控」的正解
  lines.push("[End]");
  return lines.join("\n");
}

export function buildManhuaBgmBrief(input: BgmBriefInput): BgmBrief {
  const duration = resolveBgmDurationSec(input.durationSec);
  const moods = input.moods.length ? input.moods : (["蓄力", "冲突", "收束"] as const);

  // ① 弧线：读片结论优先；没有才用段情绪拼「从哪到哪」
  const arc =
    input.moodArcZh?.trim()
    || `${MOOD_ARC_POINT[moods[0]!]}，转为${MOOD_ARC_POINT[moods[moods.length - 1]!]}`;
  // ② 乐器带演奏法  ③ 节奏走向  ④ 收尾  ⑤ 硬参数
  const instruments = LANE_INSTRUMENTS[input.laneZh] || LANE_FALLBACK;
  const tempo = input.tempoPlanZh?.trim() || (input.bpm ? `${input.bpm}bpm` : "节奏由慢渐快");
  const ending = input.endingZh?.trim() || "最后两秒淡出";

  const style = input.styleOverrideZh?.trim()
    ? cut(input.styleOverrideZh, BGM_STYLE_MAX_CHARS)
    : cut(
        [
          arc,
          instruments,
          tempo,
          ending,
          input.styleAnchorZh?.trim(),
          `${duration}秒`,
          "44.1KHz",
          "纯器乐",
        ]
          .filter(Boolean)
          .join("，"),
        BGM_STYLE_MAX_CHARS,
      );

  return {
    model: "suno-v5.5-beta",
    custom_mode: true,
    instrumental: true,
    style,
    prompt: buildBgmStructurePrompt({
      moods,
      hasSilenceBreak: input.hasSilenceBreak,
      endingZh: input.endingZh,
    }),
    title: cut(input.titleZh?.trim() || `${input.laneZh}·配乐`, BGM_TITLE_MAX_CHARS),
    duration,
    negative_tags: cut(BGM_INSTRUMENTAL_NEGATIVE_TAGS, BGM_NEGATIVE_TAGS_MAX_CHARS),
    style_weight: BGM_STYLE_WEIGHT,
    weirdness_constraint: BGM_WEIRDNESS_CONSTRAINT,
  };
}
