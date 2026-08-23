/**
 * 剧情 → BGM brief 编译器（编译器第四出口）。
 *
 * 七成确定性拼装，LLM 只补一句氛围：
 *   风格包情绪 → style tags
 *   题材查表   → 器乐（古风武侠→国风弦乐战鼓）
 *   段表       → duration + 段情绪标签（蓄力/冲突/反转/收束）
 *   negative_tags 常量
 *
 * ⚠️ EvoLink Suno 的参数约束（文档明写，现有实现全踩了）：
 *   `duration` **只在 `model=suno-v5.5-beta` 且 `custom_mode=true` 时生效**，
 *   simple mode 下 style / title / negative_tags / duration 一律「have no effect
 *   whatsoever」—— 不报错，就是不生效，省略时上游默认 20 秒。
 *   把「生成32秒」写进提示词是没用的，模型不看那句。
 *
 * 所以本模块产出的 brief 永远按 custom_mode=true 组织，且 duration 必填。
 */

/** V5.5 的硬边界，来自 EvoLink 文档 */
export const BGM_DURATION_MIN_SEC = 10;
export const BGM_DURATION_MAX_SEC = 360;
export const BGM_STYLE_MAX_CHARS = 1000;
export const BGM_TITLE_MAX_CHARS = 80;
export const BGM_NEGATIVE_TAGS_MAX_CHARS = 200;

/**
 * 纯音乐必排的东西。
 *
 * `instrumental=true` 已经在要纯音乐，但实测仍会飘人声哼鸣，
 * negative_tags 是第二道；两道都上才稳。
 */
export const BGM_INSTRUMENTAL_NEGATIVE_TAGS =
  "vocals, singing, lyrics, rap, spoken word, choir, humming";

/** 题材 → 器乐底色。查表，不问模型 */
const LANE_INSTRUMENT_TAGS: Record<string, string> = {
  古言种田: "guzheng, erhu, bamboo flute, guqin, oriental strings",
  悬疑权谋: "low strings, taiko drums, dark ambient pad, tension pulse",
  爽文逆袭: "epic orchestral, brass, war drums, rising strings",
  系统觉醒: "hybrid orchestral, synth pulse, electronic percussion, epic brass",
  甜宠: "warm piano, light strings, music box, gentle acoustic guitar",
  搞笑沙雕: "pizzicato strings, playful woodwind, marimba, light percussion",
  游戏竞技: "electronic rock, driving drums, distorted synth, energetic bass",
};

/** 段情绪 → 曲式提示。段表里的位置决定用哪个 */
const BEAT_MOOD_TAGS: Record<BgmBeatMood, string> = {
  蓄力: "slow build, restrained, sparse arrangement, growing tension",
  冲突: "driving rhythm, dense percussion, aggressive, high intensity",
  反转: "sudden shift, dramatic accent, tonal change",
  收束: "resolving, sustained pad, fading intensity, cadence",
};

export type BgmBeatMood = "蓄力" | "冲突" | "反转" | "收束";

export type BgmBriefInput = {
  /** 赛道（题材），决定器乐底色 */
  laneZh: string;
  /** 段情绪；给多个就按顺序拼进 style，描述整条曲式走向 */
  moods: readonly BgmBeatMood[];
  /** 这段画面多长（秒）。会被夹到 10–360 */
  durationSec: number;
  /** 风格包自带的情绪词（可选，直接进 style） */
  stylePackMoodEn?: string;
  /** LLM 补的那一句氛围（可选，只占一小段） */
  ambienceEn?: string;
  /** 卡面标题，中性即可，不写外部剧名 */
  titleZh?: string;
};

export type BgmBrief = {
  /** 直接喂 EvoLink 的字段 */
  model: "suno-v5.5-beta";
  custom_mode: true;
  instrumental: true;
  style: string;
  title: string;
  duration: number;
  negative_tags: string;
};

const cut = (v: string, max: number) => v.trim().slice(0, max).replace(/,\s*$/, "");

/**
 * 时长夹取：低于 10 秒补到 10，高于 360 截到 360，非整数取整。
 *
 * **不静默放过越界值** —— 越界会被上游判参数错误、整单失败，
 * 而失败在异步任务里要等轮询才知道。
 */
export function clampBgmDurationSec(sec: number): number {
  const n = Math.round(Number(sec) || 0);
  if (!Number.isFinite(n)) return BGM_DURATION_MIN_SEC;
  return Math.min(BGM_DURATION_MAX_SEC, Math.max(BGM_DURATION_MIN_SEC, n));
}

export function buildManhuaBgmBrief(input: BgmBriefInput): BgmBrief {
  const instruments = LANE_INSTRUMENT_TAGS[input.laneZh] || "cinematic orchestral, strings, piano";
  const moods = (input.moods.length ? input.moods : (["蓄力"] as const))
    .map((m) => BEAT_MOOD_TAGS[m])
    .filter(Boolean)
    .join(", ");
  const style = cut(
    [
      "instrumental score",
      instruments,
      moods,
      input.stylePackMoodEn?.trim(),
      input.ambienceEn?.trim(),
      "no vocals",
    ]
      .filter(Boolean)
      .join(", "),
    BGM_STYLE_MAX_CHARS,
  );
  return {
    model: "suno-v5.5-beta",
    custom_mode: true,
    instrumental: true,
    style,
    title: cut(input.titleZh?.trim() || `${input.laneZh}·配乐`, BGM_TITLE_MAX_CHARS),
    duration: clampBgmDurationSec(input.durationSec),
    negative_tags: cut(BGM_INSTRUMENTAL_NEGATIVE_TAGS, BGM_NEGATIVE_TAGS_MAX_CHARS),
  };
}
