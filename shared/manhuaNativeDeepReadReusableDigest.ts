/**
 * 可复用手法蒸馏（¥0，**零模型调用**）。
 *
 * 报告里的第二个可复用板块。第一个是模型自己写的 `reusableZh`（一段话），
 * 这一个是从整集逐镜字段里**用统计蒸馏出来的**：这部片反复用的那几套手法。
 *
 * 为什么不叫模型总结：渲染器的立身之本是「只渲染模型字段原文，不加编辑层」。
 * 一旦加 AI 总结，报告就开始自己编东西，出了偏差没人分得清是模型读错了
 * 还是总结写歪了。统计蒸馏是确定性的、可复现的、能逐条回指到镜号的。
 *
 * 附带效果：如果某个面向的高频项全是「剧情推进」「表情自然」这类通用词，
 * 这块板会当场把灌水暴露出来——与 manhuaNativeDeepReadQuality 的雷同率互为印证。
 */

/** 一个面向下的一条高频手法 */
export type ReusableDigestItem = {
  textZh: string;
  /** 出现镜数 */
  count: number;
  /** 占该面向有值镜数的比例，0–1，两位小数 */
  ratio: number;
};

export type ReusableDigestFacet = {
  keyZh: string;
  titleZh: string;
  /** 有值的镜数（分母）。0 表示该面向整集为空。 */
  sampleCount: number;
  items: ReusableDigestItem[];
  /** 模型自己写的原文（音轨面向才有），原样透出不改写 */
  modelTextsZh: string[];
};

export type ReusableDigestInput = {
  readonly shots: ReadonlyArray<Record<string, unknown>>;
  /** 各段音轨 analysis 原文 */
  readonly audioAnalyses: ReadonlyArray<Record<string, unknown>>;
  /** 每个面向最多列几条 */
  readonly topN?: number;
};

const text = (value: unknown): string => String(value ?? "").trim();

/**
 * 长文本（如 actionZh「少女推开门，快步走进屋内」）按中文标点切成子句再统计。
 * 整句几乎不会逐字重复，子句才看得出套路；子句短于 3 字的是语气碎片，丢掉。
 */
const clauses = (value: string): string[] => value
  .split(/[，。；、！？,.;!?\s]+/)
  .map((part) => part.trim())
  .filter((part) => part.length >= 3);

/**
 * 单子句（多数是「暖黄逆光」这类枚举式取值）只统计整值。
 * 多子句时整值与各子句都统计：整句几乎不会逐字重复，套路藏在子句里
 * （「快步走进屋内」在三条各不相同的描述里各出现一次，才是可复用的那件事）。
 * 不做更细的 n-gram——那会切出大量无意义碎片淹没真正的手法。
 */
const tokensOf = (value: string): string[] => {
  const parts = clauses(value);
  return parts.length <= 1 ? [value] : [value, ...parts];
};

function tally(
  shots: ReadonlyArray<Record<string, unknown>>,
  fields: readonly string[],
  topN: number,
): { items: ReusableDigestItem[]; sampleCount: number } {
  const counts = new Map<string, number>();
  let sampleCount = 0;
  for (const shot of shots) {
    // 一镜之内同一说法只算一次，避免多字段复述把同一条刷上去。
    const seen = new Set<string>();
    let hasValue = false;
    for (const field of fields) {
      const value = text(shot[field]);
      if (!value) continue;
      hasValue = true;
      for (const token of tokensOf(value)) seen.add(token);
    }
    if (hasValue) sampleCount += 1;
    for (const token of Array.from(seen)) counts.set(token, (counts.get(token) || 0) + 1);
  }
  const items = Array.from(counts.entries())
    // 只出现一次的不是「手法」，是一次性描写；列出来只会淹没真正的套路。
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([textZh, count]) => ({
      textZh,
      count,
      ratio: sampleCount ? Math.round((count / sampleCount) * 100) / 100 : 0,
    }));
  return { items, sampleCount };
}

/** 音轨五栏里属于「模型已写好的总结」的三栏，原样透出 */
const AUDIO_MODEL_TEXT_FIELDS = ["reusableAudioZh", "mixNotesZh", "genAudioHintZh"] as const;

export function buildManhuaReusableTechniqueDigest(
  input: ReusableDigestInput,
): ReusableDigestFacet[] {
  const topN = input.topN ?? 8;
  const shots = input.shots.filter((row): row is Record<string, unknown> =>
    Boolean(row && typeof row === "object" && !Array.isArray(row)));

  const facets: ReusableDigestFacet[] = [];

  const story = tally(shots, ["actionZh"], topN);
  facets.push({
    keyZh: "story", titleZh: "剧情推进手法",
    sampleCount: story.sampleCount, items: story.items, modelTextsZh: [],
  });

  const lighting = tally(shots, ["lightingZh"], topN);
  facets.push({
    keyZh: "lighting", titleZh: "灯光氛围",
    sampleCount: lighting.sampleCount, items: lighting.items, modelTextsZh: [],
  });

  // 音轨没有逐镜字段，统计的是各段分轨的情绪弧与 BGM 写法。
  const audioTracks = input.audioAnalyses.flatMap((analysis) => {
    const list = (analysis as { audioTrack?: unknown }).audioTrack;
    return Array.isArray(list)
      ? list.filter((row): row is Record<string, unknown> =>
        Boolean(row && typeof row === "object")) : [];
  });
  const audio = tally(audioTracks, ["emotionArcZh", "bgmZh"], topN);
  const audioModelTexts = Array.from(new Set(
    input.audioAnalyses.flatMap((analysis) =>
      AUDIO_MODEL_TEXT_FIELDS.map((field) => text((analysis as Record<string, unknown>)[field])))
      .filter(Boolean),
  ));
  facets.push({
    keyZh: "audio", titleZh: "音轨手法",
    sampleCount: audio.sampleCount, items: audio.items, modelTextsZh: audioModelTexts,
  });

  const acting = tally(
    shots, ["microExpressionZh", "gazeBreathZh", "relationshipReactionZh"], topN);
  facets.push({
    keyZh: "acting", titleZh: "表演细节",
    sampleCount: acting.sampleCount, items: acting.items, modelTextsZh: [],
  });

  return facets;
}
