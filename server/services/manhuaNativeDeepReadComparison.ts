/** 两路整形探针的来源对账；只读原稿与输出，不补字段、不改时间、不以计数代替内容核验。 */
export type NativeDeepReadComparisonRow = {
  kind: "shots" | "keyMoments" | "subtitles" | "audioTracks" | "audioCues" | "excludedAdRanges";
  inputCount: number;
  outputCount: number;
  missing: string[];
  unexpected: string[];
};

type Row = Record<string, unknown>;
const record = (value: unknown): value is Row => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter(record) : [];
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const string = (value: unknown) => typeof value === "string" ? value.trim() : "";

/** 同秒同类的重点时刻、同秒同文字幕去重；镜头仍按实际边界和来源观察逐条匹配。 */
export function auditNativeDeepReadStructuringEvidence(
  sourceRows: readonly Row[],
  output: Row,
): { passed: boolean; checks: NativeDeepReadComparisonRow[] } {
  const collect = (cards: readonly Row[], kind: NativeDeepReadComparisonRow["kind"]): string[] => {
    if (kind === "shots") return cards.flatMap(card => rows(card.shots).filter(row => row.evidenceRole !== "non_story_ad")
      .map(row => JSON.stringify([number(row.startSec), number(row.endSec), string(row.hintZh)])));
    if (kind === "keyMoments") return cards.flatMap(card => rows(card.keyMoments)
      .map(row => JSON.stringify([number(row.atSec), string(row.kindZh)])));
    if (kind === "subtitles") return cards.flatMap(card => rows(card.subtitles)
      .map(row => JSON.stringify([number(row.atSec), string(row.textZh)])));
    if (kind === "excludedAdRanges") return cards.flatMap(card => [
      ...rows(card.excludedAdRanges), ...rows(card.shots).filter(row => row.evidenceRole === "non_story_ad"),
    ].map(row => JSON.stringify([number(row.startSec), number(row.endSec)])));
    return cards.flatMap(card => rows(card.audioResolution).flatMap(entry => {
      const tracks = record(entry.analysis) ? rows(entry.analysis.audioTrack) : [];
      if (kind === "audioTracks") return tracks.map(track => JSON.stringify([
        number(entry.chunkIndex), number(track.fromSec), number(track.toSec),
      ]));
      return tracks.flatMap(track => rows(track.cues).map(cue => JSON.stringify([
        number(entry.chunkIndex), number(cue.atSec), string(cue.kind), string(cue.detailZh),
      ])));
    }));
  };
  const kinds: NativeDeepReadComparisonRow["kind"][] = ["shots", "keyMoments", "subtitles", "audioTracks", "audioCues", "excludedAdRanges"];
  const checks = kinds.map(kind => {
    const input = new Set(collect(sourceRows, kind));
    const actual = new Set(collect([output], kind));
    return { kind, inputCount: input.size, outputCount: actual.size,
      missing: Array.from(input).filter(key => !actual.has(key)),
      unexpected: Array.from(actual).filter(key => !input.has(key)),
    };
  });
  // 音轨描述、可选分析的事实正确性仍需单独对照来源；这里不因润色措辞不同判造假。
  return { passed: checks.every(check => check.missing.length === 0 && check.unexpected.length === 0), checks };
}
