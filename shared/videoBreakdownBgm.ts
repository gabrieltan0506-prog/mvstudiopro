/**
 * 拉片结果 → 配乐提示词（纯函数，不调模型）。
 * 复用漫剧工厂现成的两套确定性函数，不另写规则：
 *   - `manhuaBgmArcFromShots`（配音间「建议配乐要求」）：按段把叙事意图/节奏与情绪/表现手法写成秒位情绪线，有人声处降低存在感；
 *   - `deriveManhuaBgmBriefSeed` + `buildManhuaBgmBrief`（配乐间 brief）：情绪弧 → 风格五要素与 [Intro]…[End] 结构标签。
 * 这里只做字段映射：拉片的每一段当作一镜。
 */
import type { VideoBreakdown, VideoBreakdownSegment } from "./videoBreakdown";
import type { ManhuaWorkbenchShot } from "./manhuaScriptWorkbench";
import { manhuaBgmArcFromShots } from "./manhuaBgmArcFromShots";
import { buildManhuaBgmBrief, deriveManhuaBgmBriefSeed, type BgmBeatMood } from "./manhuaBgmBrief";

/** 段落表达文本 → 配乐间四拍情绪；按优先级命中，命不中按段位兜底（首段蓄力、末段收束、中段冲突）。 */
const MOOD_KEYWORDS: ReadonlyArray<[BgmBeatMood, RegExp]> = [
  ["反转", /反转|转折|翻转|骤变|突然|意外|急转/],
  ["冲突", /冲突|爆发|高潮|激烈|紧张|对峙|扑|撕|追|打斗|爆|急促|快切|顶点|压迫/],
  ["收束", /收束|收尾|结尾|落幅|平息|余韵|渐弱|淡出|舒缓|释然|归于平静|安静/],
  ["蓄力", /铺垫|蓄力|蓄势|压抑|酝酿|悬念|建立|开场|缓慢|慢推|静谧|克制/],
];

export function videoBreakdownSegmentMood(segment: VideoBreakdownSegment, position: { index: number; total: number }): BgmBeatMood {
  const text = [segment.expression.rhythm, segment.expression.narrativeIntent, segment.expression.technique].join(" ");
  for (const [mood, re] of MOOD_KEYWORDS) if (re.test(text)) return mood;
  if (position.index === 0) return "蓄力";
  if (position.index === position.total - 1) return "收束";
  return "冲突";
}

const VOICE_RE = /对白|台词|人声|旁白|说话|独白|喊|哭|笑声/;
const SILENCE_RE = /静默|无声|静音|留白|万籁俱寂/;

/** 一段 → 配音间的一镜（只填配乐情绪线需要的字段）。 */
export function videoBreakdownSegmentToBgmShot(segment: VideoBreakdownSegment): ManhuaWorkbenchShot {
  const sound = segment.expression.sound?.trim() || "";
  return {
    index: segment.index,
    durationSec: Math.max(0, segment.endSec - segment.startSec),
    cameraZh: "",
    actionZh: segment.expression.technique,
    intentZh: segment.expression.narrativeIntent,
    emotionZh: segment.expression.rhythm,
    ...(VOICE_RE.test(sound) ? { dialogueZh: sound } : {}),
  };
}

/** 按工厂 brief 同一五要素顺序（弧线 · 乐器 · 节奏 · 收尾 · 硬参数）拼风格，只把乐器换成看片得到的声音要素。 */
function bgmStyleWithElements(brief: { duration: number }, elements: string, arc: string, tempo: string | undefined, ending: string | undefined): string {
  return [arc, elements, tempo || "节奏由慢渐快", ending || "最后两秒淡出", `${brief.duration}秒`, "44.1KHz", "纯器乐"].join("，");
}

/** 全片配乐提示词：情绪线（按段秒位）+ 风格五要素 + 结构标签。 */
export function buildVideoBreakdownBgmPrompt(breakdown: VideoBreakdown): string {
  const segments = [...breakdown.segments].sort((a, b) => a.index - b.index);
  const durationSec = Math.round(breakdown.durationSec * 10) / 10;
  const arc = manhuaBgmArcFromShots(segments.map(videoBreakdownSegmentToBgmShot), durationSec);
  const moods = segments.map((segment, index) => videoBreakdownSegmentMood(segment, { index, total: segments.length }));
  const hasSilenceBreak = segments.some(segment => SILENCE_RE.test(segment.expression.sound || ""));
  const seed = deriveManhuaBgmBriefSeed({
    laneZh: "",
    segmentBeatFunctionsZh: segments.map(() => []),
    storyEmotion: { moods, hasSilenceBreak },
  });
  // 种子按「段数 × 15 秒」估时长；拉片有实测片长，用实测值。
  // 看片时给了声音拆解 / 情绪推进就优先用（读片结论比按文字推导准）：
  //   craft.emotionArc → moodArcZh（工厂 brief「读片得到的情绪弧线原文，片后配乐时优先用它」）；
  //   sound.rhythm → tempoPlanZh（节奏走向）；sound.generationElements 取代按题材兜底的乐器句。
  const sound = breakdown.overview.sound;
  const moodArcZh = breakdown.overview.craft?.emotionArc?.trim() || undefined;
  const tempoPlanZh = sound?.rhythm?.trim() || undefined;
  const elements = sound?.generationElements?.trim();
  const base = { ...seed, durationSec, moodArcZh, tempoPlanZh };
  const brief = buildManhuaBgmBrief(elements
    ? { ...base, styleOverrideZh: bgmStyleWithElements(buildManhuaBgmBrief(base), elements, moodArcZh || seed.moods.join("→"), tempoPlanZh, seed.endingZh) }
    : base);
  return [
    arc,
    `【配乐风格】${brief.style}`,
    "【结构】",
    brief.prompt,
    `【时长】约 ${brief.duration} 秒（含 ${brief.duration - Math.round(durationSec)} 秒裁切余量）· 纯器乐，不要人声与歌词`,
  ].join("\n");
}
