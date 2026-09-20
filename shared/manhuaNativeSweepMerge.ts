/**
 * 整形前补扫（GLM-5.3 Flash）的**合并合同**。
 *
 * 用户 0920 原话（逐条，全部是判据，不是建议）：
 *   ·「最後整形階段再用GLM5.3 flash掃一次所有的分片」
 *     「GLM5.3 flash整形之前，先讓他讀一遍所有的分片」
 *   ·「音頻GLM5.3 flash讀不了，只能讀視頻字幕並截圖」
 *   ·「只截取gemini 沒有列入的字幕與畫面」
 *     「不可以刪除原有gemini 3.8 flash已列出的keymonets跟內容」
 *     「Ｇemini 判定是keymonents的必須保留」
 *   ·「只截取gemini沒列入keymonts的精彩與有特色的畫面」
 *     「他也可以判斷哪些是有亮點跟特色的鏡頭，值得列入模板的」
 *   ·「補進來的畫面，禁止廣告或是商品宣傳內容」
 *   ·「需跟劇情相關才可以」
 *
 * 🔴 本文件是**纯函数合同**：不发请求、不读文件、不碰网关。
 *
 * 🔴 最重要的一条（0920 那轮就是死在这里）：补进来的条目**必须写得出 kindZh**。
 * 下游抽帧 `manhuaNativeKeyMomentFrames.ts` 是 `if (!atSec || !kindZh || !noteZh) continue;`——
 * 合并结果里少一个 kindZh，那一条就在抽帧阶段静默消失。
 * 白名单一律取 `MANHUA_NATIVE_KEY_MOMENT_KINDS`（shared/manhuaNativeDeepRead.ts 的单一真源），
 * 不在本文件另写一份。
 */
import { MANHUA_NATIVE_KEY_MOMENT_KINDS } from "./manhuaNativeDeepRead.js";

export type ManhuaNativeSweepCandidate = {
  /** 全片绝对秒，与 Gemini keyMoments 同坐标系。 */
  atSec: number;
  /** 五类之一；**音轨类不接受**——用户明令 GLM Flash 读不了音频。 */
  kindZh: string;
  /** 「精彩在哪」。空＝说不出理由，不收。 */
  noteZh: string;
  /** 可选：该秒的字幕原文（用户：只能读视频字幕并截图）。 */
  subtitleZh?: string;
};

export type ManhuaNativeSweepDropReason =
  | "kind_not_allowed"      // kindZh 不在五类白名单内
  | "kind_audio_not_readable" // 音轨类：GLM Flash 读不了音频
  | "note_missing"          // 说不出「精彩在哪」
  | "at_sec_invalid"
  | "already_in_gemini"     // Gemini 已列入，不重复补
  | "duplicate_candidate"   // 候选自身重复
  | "ad_or_promo"           // 广告或商品宣传
  | "not_story_related";    // 不落在剧情镜区间内

export type ManhuaNativeSweepMergeInput = {
  /** Gemini 已列出的 keyMoments。**原样保留，一条都不许删、不许改。** */
  geminiKeyMoments: ReadonlyArray<{ atSec: number; kindZh: string; noteZh: string }>;
  /** GLM Flash 补扫产出的候选。 */
  candidates: ReadonlyArray<ManhuaNativeSweepCandidate>;
  /** 剧情镜区间（evidenceRole==="story"）。候选必须落在其中才算「与剧情相关」。 */
  storyRanges: ReadonlyArray<{ startSec: number; endSec: number }>;
  /** 广告区间（excludedAdRanges / non_story_ad）。落在其中一律剔除。 */
  excludedAdRanges?: ReadonlyArray<{ startSec: number; endSec: number }>;
};

export type ManhuaNativeSweepMergeResult = {
  /** Gemini 原条目 + 通过的补扫条目，按 atSec 排序。 */
  keyMoments: Array<{ atSec: number; kindZh: string; noteZh: string; subtitleZh?: string; fromSweep?: true }>;
  /** 本次真正补进来的条数。 */
  addedCount: number;
  /** 被拦下的候选与原因，供 advisory 展示；不阻断入库。 */
  dropped: Array<{ atSec: number; kindZh: string; reason: ManhuaNativeSweepDropReason }>;
};

/**
 * 广告 / 商品宣传判词（用户：「禁止廣告或是商品宣傳內容」）。
 * ⚠️ 这是**黑名单**，与「必须落在剧情镜区间内」那条白名单判据**同时**生效，两道都要过。
 * 单靠黑名单挡不住没写关键词的贴片；单靠区间挡不住正片中插的口播。
 */
const SWEEP_AD_PROMO_PATTERNS: ReadonlyArray<RegExp> = [
  /广告/, /廣告/, /赞助/, /贊助/, /冠名/, /植入/,
  /带货/, /帶貨/, /promo/i, /sponsor/i,
  /优惠券/, /優惠券/, /折扣/, /促销/, /促銷/, /下单/, /下單/,
  /购买链接/, /購買鏈接/, /加购/, /加購/, /直播间/, /直播間/,
  /品牌宣传/, /品牌宣傳/, /商品/, /购物/, /購物/, /限时抢/, /限時搶/,
];

const round1 = (v: number) => Math.round(v * 10) / 10;
const inRange = (
  sec: number,
  ranges: ReadonlyArray<{ startSec: number; endSec: number }>,
) => ranges.some((r) => sec >= r.startSec && sec <= r.endSec);

/**
 * 合并补扫候选。**只增不减**：返回的 keyMoments 必然逐条包含全部 `geminiKeyMoments`。
 */
export function mergeManhuaNativeSweepCandidates(
  input: ManhuaNativeSweepMergeInput,
): ManhuaNativeSweepMergeResult {
  // 🔒 Gemini 原条目整体先落位，后续任何分支都不得改动这一段。
  const kept = input.geminiKeyMoments.map((m) => ({
    atSec: m.atSec, kindZh: m.kindZh, noteZh: m.noteZh,
  }));
  // 与解析层同口径：按 0.1 秒 + kindZh 去重。
  const seen = new Set(kept.map((m) => `${Math.round(m.atSec * 10)}|${m.kindZh}`));
  // 「Gemini 沒有列入的」：同一秒位（0.1 秒粒度）无论哪一类都算已列入，不重复补。
  const geminiSeconds = new Set(kept.map((m) => Math.round(m.atSec * 10)));
  const adRanges = input.excludedAdRanges ?? [];

  const added: ManhuaNativeSweepMergeResult["keyMoments"] = [];
  const dropped: ManhuaNativeSweepMergeResult["dropped"] = [];
  const drop = (c: ManhuaNativeSweepCandidate, reason: ManhuaNativeSweepDropReason) => {
    dropped.push({ atSec: Number(c.atSec) || 0, kindZh: String(c.kindZh || ""), reason });
  };

  for (const raw of input.candidates) {
    const atSec = Number(raw?.atSec);
    const kindZh = String(raw?.kindZh || "").trim();
    const noteZh = String(raw?.noteZh || "").trim();
    if (!Number.isFinite(atSec) || atSec < 0) { drop(raw, "at_sec_invalid"); continue; }
    // 用户：「音頻GLM5.3 flash讀不了，只能讀視頻字幕並截圖」——音轨类候选一律不收。
    if (kindZh === "音轨") { drop(raw, "kind_audio_not_readable"); continue; }
    if (!MANHUA_NATIVE_KEY_MOMENT_KINDS.has(kindZh)) { drop(raw, "kind_not_allowed"); continue; }
    // 用户：「只截取gemini沒列入keymonts的**精彩與有特色**的畫面」——说不出精彩在哪就不收。
    if (!noteZh) { drop(raw, "note_missing"); continue; }
    const at = round1(atSec);
    const decisec = Math.round(at * 10);
    if (geminiSeconds.has(decisec)) { drop(raw, "already_in_gemini"); continue; }
    const key = `${decisec}|${kindZh}`;
    if (seen.has(key)) { drop(raw, "duplicate_candidate"); continue; }
    // 两道内容闸，顺序无关但都必须过。
    if (inRange(at, adRanges)) { drop(raw, "ad_or_promo"); continue; }
    const text = `${noteZh} ${String(raw.subtitleZh || "")}`;
    if (SWEEP_AD_PROMO_PATTERNS.some((re) => re.test(text))) { drop(raw, "ad_or_promo"); continue; }
    // 用户：「需跟劇情相關才可以」＝必须落在 story 镜区间内。
    if (!inRange(at, input.storyRanges)) { drop(raw, "not_story_related"); continue; }
    seen.add(key);
    const entry: ManhuaNativeSweepMergeResult["keyMoments"][number] = {
      atSec: at, kindZh, noteZh, fromSweep: true,
    };
    const subtitleZh = String(raw.subtitleZh || "").trim();
    if (subtitleZh) entry.subtitleZh = subtitleZh;
    added.push(entry);
  }

  const keyMoments = [...kept, ...added].sort((a, b) => a.atSec - b.atSec);
  return { keyMoments, addedCount: added.length, dropped };
}
