/**
 * 编剧室扩写前后对比（0902 用户拍板：「全部扩写也没列出跟原来的对比，
 * 应该要以高亮的方式呈现才对」）。
 *
 * 纯函数：旧包 vs 新包 → 逐集状态 + 行级差异（LCS）。行数超限的集不做行级
 * 对比只标「整集改写」，防止超长剧本把浏览器算爆。
 */
import type { ManhuaWriterPack } from "./manhuaWriterRoom.js";

export const WRITER_PACK_DIFF_MAX_LINES = 400;

export type WriterPackDiffLine = { kind: "same" | "add" | "del"; text: string };

export type WriterPackEpisodeDiff = {
  episodeIndex: number;
  titleZh: string;
  status: "added" | "removed" | "changed" | "unchanged";
  /** changed 集的行级差异；超限或未变时为空 */
  lines: WriterPackDiffLine[];
  addedLineCount: number;
  removedLineCount: number;
  /** 行数超限、只能整集看时为 true */
  tooLargeForLineDiff: boolean;
};

export type WriterPackDiffResult = {
  episodes: WriterPackEpisodeDiff[];
  changedCount: number;
  addedCount: number;
  removedCount: number;
  summaryZh: string;
};

function splitLines(raw: string): string[] {
  return String(raw || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
}

/** 经典 LCS 行对齐；调用方保证两侧行数都 ≤ WRITER_PACK_DIFF_MAX_LINES */
export function diffLines(prevLines: string[], nextLines: string[]): WriterPackDiffLine[] {
  const m = prevLines.length;
  const n = nextLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i]![j] = prevLines[i] === nextLines[j]
        ? dp[i + 1]![j + 1]! + 1
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: WriterPackDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (prevLines[i] === nextLines[j]) {
      out.push({ kind: "same", text: prevLines[i]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ kind: "del", text: prevLines[i]! });
      i += 1;
    } else {
      out.push({ kind: "add", text: nextLines[j]! });
      j += 1;
    }
  }
  while (i < m) out.push({ kind: "del", text: prevLines[i++]! });
  while (j < n) out.push({ kind: "add", text: nextLines[j++]! });
  return out;
}

function episodeText(episode: { title: string; body: string; endHook: string }): string {
  return [episode.title, episode.body, episode.endHook ? `片尾钩子：${episode.endHook}` : ""]
    .filter(Boolean)
    .join("\n");
}

export function diffManhuaWriterPacks(
  prev: ManhuaWriterPack | null | undefined,
  next: ManhuaWriterPack | null | undefined,
): WriterPackDiffResult {
  const prevEpisodes = new Map((prev?.episodes || []).map((e) => [e.index, e] as const));
  const nextEpisodes = new Map((next?.episodes || []).map((e) => [e.index, e] as const));
  const allIndexes = Array.from(
    new Set([
      ...Array.from(prevEpisodes.keys()),
      ...Array.from(nextEpisodes.keys()),
    ]),
  ).sort((a, b) => a - b);

  const episodes: WriterPackEpisodeDiff[] = [];
  for (const index of allIndexes) {
    const before = prevEpisodes.get(index);
    const after = nextEpisodes.get(index);
    if (!before && after) {
      episodes.push({
        episodeIndex: index,
        titleZh: after.title,
        status: "added",
        lines: [],
        addedLineCount: splitLines(episodeText(after)).length,
        removedLineCount: 0,
        tooLargeForLineDiff: false,
      });
      continue;
    }
    if (before && !after) {
      episodes.push({
        episodeIndex: index,
        titleZh: before.title,
        status: "removed",
        lines: [],
        addedLineCount: 0,
        removedLineCount: splitLines(episodeText(before)).length,
        tooLargeForLineDiff: false,
      });
      continue;
    }
    const prevText = episodeText(before!);
    const nextText = episodeText(after!);
    if (prevText === nextText) {
      episodes.push({
        episodeIndex: index,
        titleZh: after!.title,
        status: "unchanged",
        lines: [],
        addedLineCount: 0,
        removedLineCount: 0,
        tooLargeForLineDiff: false,
      });
      continue;
    }
    const prevLines = splitLines(prevText);
    const nextLines = splitLines(nextText);
    const tooLarge =
      prevLines.length > WRITER_PACK_DIFF_MAX_LINES
      || nextLines.length > WRITER_PACK_DIFF_MAX_LINES;
    const lines = tooLarge ? [] : diffLines(prevLines, nextLines);
    episodes.push({
      episodeIndex: index,
      titleZh: after!.title,
      status: "changed",
      lines,
      addedLineCount: lines.filter((l) => l.kind === "add").length,
      removedLineCount: lines.filter((l) => l.kind === "del").length,
      tooLargeForLineDiff: tooLarge,
    });
  }

  const changedCount = episodes.filter((e) => e.status === "changed").length;
  const addedCount = episodes.filter((e) => e.status === "added").length;
  const removedCount = episodes.filter((e) => e.status === "removed").length;
  const unchangedCount = episodes.filter((e) => e.status === "unchanged").length;
  const parts: string[] = [];
  if (changedCount) parts.push(`改写 ${changedCount} 集`);
  if (addedCount) parts.push(`新增 ${addedCount} 集`);
  if (removedCount) parts.push(`删除 ${removedCount} 集`);
  if (unchangedCount) parts.push(`未动 ${unchangedCount} 集`);
  const nothingChanged = !changedCount && !addedCount && !removedCount;
  return {
    episodes,
    changedCount,
    addedCount,
    removedCount,
    summaryZh: nothingChanged
      ? "两版内容完全一致（配方没变，产出不会变——想换剧情请改题材/补充条件）"
      : parts.join("；"),
  };
}
