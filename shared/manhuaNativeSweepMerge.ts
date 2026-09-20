/**
 * GLM-5.3 Flash「整形前补扫」的合并契约（纯函数）。
 *
 * 0920 用户令：**整形前让 GLM-5.3 Flash 再读一次分片，只截取 Gemini 没有列入的字幕与画面；
 * 不可以删除 Gemini 3.8 Flash 已列出的 keyMoments 跟内容。**
 *
 * 所以这里的唯一职责是「只增不减」地并进去：
 * - 读片稿里的每一条 keyMoment / subtitle **原样保留**，一条都不许被覆盖或丢弃；
 * - 补扫结果只有落在**时间上没人占**的位置才收，撞上已有条目就丢弃补扫那条（读片稿优先）；
 * - 0920 用户追加的精确口径：**只补「精彩、有特色」的画面** —— 所以补进来的每条
 *   必须自带说明（noteZh），说不出它哪里精彩就不收。这挡的是「把平淡空镜也一股脑补进来」。
 * - 每条补进来的都打上来源标记，下游与审核能一眼看出哪条不是读片稿原有的。
 *
 * ⚠️ GLM-5.3 Flash **读不了音频**（用户 0920 明确）：本模块只处理字幕与画面（keyMoments），
 * 音轨分析一律不动 —— 补扫产出里若带音轨字段，这里也不会采纳。
 *
 * ✅ 0920 用户令：**补进来的必须跟剧情相关**。所以是「白名单」而不是「黑名单」——
 * 补扫每条都要显式标成剧情证据（`evidenceRole === "story"`）并写出它精彩在哪；
 * 标不出、或标成别的，一律不收。光靠「不是广告」不够：空镜、片头字卡也不是广告。
 *
 * 🚫 同时**禁止广告或商品宣传**。三道一起拦：
 *   ① 落在读片稿已标出的广告区间（`excludedAdRanges`）内 —— 这是最硬的依据，模型已经判过了；
 *   ② 补扫自己把这条标成广告（`evidenceRole === "non_story_ad"`）；
 *   ③ 说明文案里出现明显推销词（下单/优惠/扫码/旗舰店…）。
 * ③ 是兜底，**可能误伤**剧情里真出现的商铺招牌；所以只看补扫自己写的说明，不看画面内容判断，
 * 且被拦下的一律计进 droppedKeyMoments，回执里看得到。
 */
export const MANHUA_SWEEP_SOURCE_ZH = "GLM补扫" as const;

export type ManhuaSweepKeyMoment = {
  atSec: number;
  noteZh?: string;
  /** 补扫加进来的会被打上这个标记；读片稿原有条目没有 */
  sourceZh?: string;
};

export type ManhuaSweepSubtitle = {
  atSec: number;
  textZh: string;
  sourceZh?: string;
};

/** 明显推销词兜底表：只匹配补扫自己写的说明文案，不据此判断画面内容 */
export const MANHUA_SWEEP_AD_WORDS_ZH = [
  "广告", "推广", "赞助", "商品", "带货", "下单", "购买", "优惠", "折扣", "促销",
  "扫码", "二维码", "旗舰店", "点击链接", "加微信", "关注领取", "限时", "价格",
] as const;

export type ManhuaSweepMergeResult = {
  keyMoments: ManhuaSweepKeyMoment[];
  subtitles: ManhuaSweepSubtitle[];
  /** 实际补进去的条数（用于回执与计费对账） */
  addedKeyMoments: number;
  addedSubtitles: number;
  /** 因为撞上读片稿已有条目而被丢弃的补扫条数 */
  droppedKeyMoments: number;
  droppedSubtitles: number;
  summaryZh: string;
};

const num = (value: unknown): number | null => {
  // `Number(null)` 是 0，`Number("")` 也是 0 —— 不先挡掉，缺秒位的脏条目会被当成第 0 秒收进来
  // （自己的测试当场抓到：一条 `{atSec:null}` 的字幕被补进了 0 秒）。
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : null;
};

const text = (value: unknown, max: number): string => String(value ?? "").trim().slice(0, max);

/**
 * @param keyMomentWindowSec 补扫的重点时刻距离已有条目多近算「同一处」（默认 ±2 秒）
 * @param subtitleWindowSec 字幕同理（默认 ±1 秒，字幕比画面密）
 */
export function mergeManhuaNativeSweepAdditions(input: {
  baseKeyMoments: readonly unknown[];
  baseSubtitles: readonly unknown[];
  sweepKeyMoments: readonly unknown[];
  sweepSubtitles: readonly unknown[];
  keyMomentWindowSec?: number;
  subtitleWindowSec?: number;
  /** 补扫一次最多补多少条，防止把读片稿淹掉（默认各 30） */
  maxAdded?: number;
  /** 读片稿已判定的广告区间；落在里面的补扫条目一律不收 */
  excludedAdRanges?: readonly { startSec?: unknown; endSec?: unknown }[];
}): ManhuaSweepMergeResult {
  const kmWindow = Math.max(0, Number(input.keyMomentWindowSec ?? 2));
  const subWindow = Math.max(0, Number(input.subtitleWindowSec ?? 1));
  const maxAdded = Math.max(0, Math.floor(Number(input.maxAdded ?? 30)));

  // 读片稿原样保留：不改字段、不改顺序来源，只做类型收敛
  const keyMoments: ManhuaSweepKeyMoment[] = [];
  for (const row of input.baseKeyMoments) {
    const r = (row || {}) as Record<string, unknown>;
    const atSec = num(r.atSec);
    if (atSec === null) continue;
    keyMoments.push({ atSec, ...(text(r.noteZh, 400) ? { noteZh: text(r.noteZh, 400) } : {}) });
  }
  const subtitles: ManhuaSweepSubtitle[] = [];
  for (const row of input.baseSubtitles) {
    const r = (row || {}) as Record<string, unknown>;
    const atSec = num(r.atSec);
    const textZh = text(r.textZh, 200);
    if (atSec === null || !textZh) continue;
    subtitles.push({ atSec, textZh });
  }

  const adRanges = (input.excludedAdRanges || [])
    .map((row) => ({ startSec: num(row?.startSec), endSec: num(row?.endSec) }))
    .filter((row): row is { startSec: number; endSec: number } =>
      row.startSec !== null && row.endSec !== null && row.endSec >= row.startSec);
  const insideAdRange = (atSec: number) =>
    adRanges.some((range) => atSec >= range.startSec && atSec <= range.endSec);
  const looksLikeAd = (row: Record<string, unknown>, noteZh: string) =>
    String(row.evidenceRole || "") === "non_story_ad"
    || row.isAd === true
    || MANHUA_SWEEP_AD_WORDS_ZH.some((word) => noteZh.includes(word));

  let addedKeyMoments = 0;
  let droppedKeyMoments = 0;
  for (const row of input.sweepKeyMoments) {
    const r = (row || {}) as Record<string, unknown>;
    const atSec = num(r.atSec);
    if (atSec === null) { droppedKeyMoments += 1; continue; }
    if (addedKeyMoments >= maxAdded) { droppedKeyMoments += 1; continue; }
    // 只补「精彩、有特色」的画面：说不出理由的一律不收
    const noteZh = text(r.noteZh, 400);
    if (!noteZh) { droppedKeyMoments += 1; continue; }
    // 必须是剧情证据（白名单），再排除广告与商品宣传（0920 用户令）
    if (String(r.evidenceRole || "") !== "story") { droppedKeyMoments += 1; continue; }
    if (insideAdRange(atSec) || looksLikeAd(r, noteZh)) { droppedKeyMoments += 1; continue; }
    // 撞上读片稿已有条目 → 丢补扫这条，读片稿优先
    if (keyMoments.some((kept) => Math.abs(kept.atSec - atSec) <= kmWindow)) {
      droppedKeyMoments += 1;
      continue;
    }
    keyMoments.push({ atSec, noteZh, sourceZh: MANHUA_SWEEP_SOURCE_ZH });
    addedKeyMoments += 1;
  }

  let addedSubtitles = 0;
  let droppedSubtitles = 0;
  for (const row of input.sweepSubtitles) {
    const r = (row || {}) as Record<string, unknown>;
    const atSec = num(r.atSec);
    const textZh = text(r.textZh, 200);
    if (atSec === null || !textZh) { droppedSubtitles += 1; continue; }
    if (addedSubtitles >= maxAdded) { droppedSubtitles += 1; continue; }
    if (subtitles.some((kept) => Math.abs(kept.atSec - atSec) <= subWindow)) {
      droppedSubtitles += 1;
      continue;
    }
    // 字幕同样不收广告段与推销文案
    if (insideAdRange(atSec) || looksLikeAd(r, textZh)) { droppedSubtitles += 1; continue; }
    subtitles.push({ atSec, textZh, sourceZh: MANHUA_SWEEP_SOURCE_ZH });
    addedSubtitles += 1;
  }

  keyMoments.sort((a, b) => a.atSec - b.atSec);
  subtitles.sort((a, b) => a.atSec - b.atSec);

  return {
    keyMoments,
    subtitles,
    addedKeyMoments,
    addedSubtitles,
    droppedKeyMoments,
    droppedSubtitles,
    summaryZh: addedKeyMoments || addedSubtitles
      ? `补扫新增 ${addedKeyMoments} 个画面、${addedSubtitles} 条字幕（读片稿原有内容一条未动）`
      : "补扫没有发现读片稿之外的内容",
  };
}
