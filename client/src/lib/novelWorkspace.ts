import { z } from "zod";
import {
  parseNovelDraft,
  type ManhuaNovelDraft,
} from "@shared/manhuaNovelSource";
import {
  novelChapterSchema,
  novelReviseResultSchema,
  type NovelReview,
  type NovelRevisedChapter,
  type NovelTestInput,
  type NovelTestResult,
} from "@shared/novelWorkspace";
import { novelWorkspaceStateSchema as stateSchema } from "@shared/novelWorkspaceState";
import {
  detectOutlineDrift,
  extractEpisodeOutline,
  novelOutlineAlertLevel,
  type NovelOutlineAlert,
} from "@shared/novelOutlineDrift";
export type NovelWorkspace = Omit<z.infer<typeof stateSchema>, "source"> & {
  source: ManhuaNovelDraft | null;
};
export type NovelRun = { input: NovelTestInput; result: NovelTestResult };
export const novelWorkspaceKey = (userId: string) =>
  `mv-novel-lab-v2:${encodeURIComponent(userId)}`;
export const emptyNovelWorkspace = (): NovelWorkspace => {
  const roundId = crypto.randomUUID();
  return {
    projectId: roundId,
    roundId,
    topic: "",
    direction: "",
    mode: "source",
    source: null,
    templates: [],
    episodeCount: 3,
    outline: "",
    outlineApproved: "",
    chapters: [],
    novelApproved: "",
    runs: [],
  };
};
export function readNovelWorkspace(
  storage: Pick<Storage, "getItem">,
  userId: string
) {
  const raw = storage.getItem(novelWorkspaceKey(userId));
  if (!raw) return { raw, value: emptyNovelWorkspace() };
  const value = stateSchema.parse(JSON.parse(raw));
  const source = value.source === null ? null : parseNovelDraft(value.source);
  if (value.source !== null && !source) throw new Error("底本无法读取");
  return { raw, value: { ...value, source } };
}
export function saveNovelWorkspace(
  storage: Pick<Storage, "getItem" | "setItem">,
  userId: string,
  previous: string | null,
  value: NovelWorkspace
) {
  const key = novelWorkspaceKey(userId);
  if (storage.getItem(key) !== previous)
    throw new Error("另一页面已更新，请下载当前备份再刷新。");
  const raw = JSON.stringify(value);
  storage.setItem(key, raw);
  return raw;
}
export function archiveNovelRound(
  storage: Pick<Storage, "getItem" | "setItem">,
  userId: string,
  previous: string | null,
  value: NovelWorkspace
) {
  const key = novelWorkspaceKey(userId);
  if (storage.getItem(key) !== previous)
    throw new Error("另一页面已更新，请下载当前备份再刷新。");
  storage.setItem(`${key}:archive:${value.roundId}`, JSON.stringify(value));
  const next = emptyNovelWorkspace();
  const raw = saveNovelWorkspace(storage, userId, previous, next);
  return { raw, value: next };
}
export function downloadNovelText(
  name: string,
  text: string,
  type = "text/plain;charset=utf-8"
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function novelSourceIdentity(draft: NovelWorkspace) {
  return JSON.stringify([
    draft.topic,
    draft.direction,
    draft.mode,
    draft.mode === "source" ? draft.source : null,
    draft.episodeCount,
    draft.episodeStart,
  ]);
}
export function scriptBaseline(input: NovelTestInput) {
  return JSON.stringify([
    input.roundId,
    input.topic,
    input.direction,
    input.source,
    input.outline,
    input.novel,
    input.episodeCount,
    input.episodeStart,
    input.scriptBatch?.baseline,
  ]);
}

/** A late completion may add a candidate, never overwrite concurrent manual edits. */
export function applyNovelChapterCompletion(
  now: NovelWorkspace,
  input: NovelTestInput,
  result: NovelTestResult
): Partial<NovelWorkspace> {
  const index = input.chapterIndex - 1;
  const chapter = novelChapterSchema.parse(JSON.parse(result.text));
  const chapters = [...now.chapters];
  const chapterWarnings = { ...now.chapterWarnings };
  const edited = (chapters[index] || "") !== (now.pendingChapterBase || "");
  const earlierChanged =
    chapters.slice(0, index).join("\n\n") !==
    (now.pendingContextBase ?? input.novel);
  const continuityEdited = (now.continuity || "") !== (input.continuity || "");
  if (edited)
    chapterWarnings[String(index)] =
      "你在生成期间修改了本集，已保留手动修改；本次生成稿可在下方查看并选择采用。";
  else {
    chapters[index] = `${chapter.title}\n\n${chapter.text}`;
    if (earlierChanged)
      chapterWarnings[String(index)] =
        "前文在生成期间有修改，本集使用的是修改前的内容，请核对衔接。";
    else if (continuityEdited)
      chapterWarnings[String(index)] =
        "续写档案在生成期间有修改，已保留修改，请核对本集衔接。";
    else delete chapterWarnings[String(index)];
  }
  return {
    chapters,
    chapterWarnings,
    pendingChapterBase: undefined,
    pendingContextBase: undefined,
    ...(chapter.continuity && !edited && !earlierChanged && !continuityEdited
      ? {
          continuity: chapter.continuity,
          continuityThrough: input.chapterIndex,
          continuityBase: chapters.slice(0, input.chapterIndex).join("\n\n"),
        }
      : {}),
    ...(now.chapters[index] && !edited
      ? {
          chapterVersions: [
            ...(now.chapterVersions || []),
            {
              index,
              text: now.chapters[index],
              savedAt: new Date().toISOString(),
            },
          ],
        }
      : {}),
    novelApproved: "",
  };
}

export type NovelRevisionEntry = NonNullable<
  NovelWorkspace["chapterRevisions"]
>[number];
const revisionOutcomeSchema = novelReviseResultSchema.extend({
  revised: novelReviseResultSchema.shape.revised.optional(),
});
/** 读取一条审稿改稿记录；坏数据返回 null，不让整份草稿读取失败。 */
export function parseNovelRevisionEntry(entry: NovelRevisionEntry): {
  original: string;
  review: NovelReview;
  revised?: NovelRevisedChapter;
  models?: { review?: string; revise?: string };
} | null {
  try {
    return revisionOutcomeSchema.parse(JSON.parse(entry.outcome));
  } catch {
    return null;
  }
}
/**
 * 某条审稿改稿记录的大纲偏离：模型申报 + 代码兜底核对。
 * 当前大纲里的本集条目已与提交时不同（用户已核对并更新大纲）时不再提醒。
 */
export function novelRevisionOutlineAlert(
  now: Pick<NovelWorkspace, "outline" | "outlineApproved">,
  entry: NovelRevisionEntry
) {
  const parsed = parseNovelRevisionEntry(entry);
  const currentItem = extractEpisodeOutline(
    now.outlineApproved || now.outline,
    entry.index + 1
  );
  const item = entry.outlineItem ?? currentItem;
  if (!parsed?.revised)
    return { level: "none" as NovelOutlineAlert, hints: [], item, stale: false };
  const hints = detectOutlineDrift(
    item,
    parsed.original,
    `${parsed.revised.title}\n${parsed.revised.text}`
  );
  const level = novelOutlineAlertLevel(parsed.revised.outlineImpact, hints);
  const stale = entry.outlineItem !== undefined && entry.outlineItem !== currentItem;
  return { level, hints, item, stale };
}
/** 需要提醒核对大纲的最高级别（每集只看最近一条记录）；用于大纲所在步骤入口的角标。 */
export function novelOutlineAlertSummary(
  now: Pick<NovelWorkspace, "outline" | "outlineApproved" | "chapterRevisions">
): { level: NovelOutlineAlert; chapters: number[] } {
  const latestByChapter = new Map<number, NovelRevisionEntry>();
  for (const entry of now.chapterRevisions || []) latestByChapter.set(entry.index, entry);
  let level: NovelOutlineAlert = "none";
  const chapters: number[] = [];
  for (const entry of Array.from(latestByChapter.values())) {
    const alert = novelRevisionOutlineAlert(now, entry);
    if (alert.stale || alert.level === "none") continue;
    chapters.push(entry.index + 1);
    if (alert.level === "major" || level === "none") level = alert.level;
  }
  return { level, chapters: chapters.sort((a, b) => a - b) };
}
/** 审稿改稿成功：记录未修改版、审稿与修改版，不改动本集正文。 */
export function recordNovelRevision(
  now: NovelWorkspace,
  input: NovelTestInput,
  result: NovelTestResult
): Partial<NovelWorkspace> {
  if ((now.chapterRevisions || []).some(r => r.requestId === input.requestId))
    return {};
  return {
    chapterRevisions: [
      ...(now.chapterRevisions || []),
      {
        index: input.chapterIndex - 1,
        requestId: input.requestId,
        savedAt: new Date().toISOString(),
        outcome: result.text,
        outlineItem: extractEpisodeOutline(input.outline, input.chapterIndex),
      },
    ],
  };
}
/** 改稿失败但审稿已完成：保留审稿意见供查看（无修改版）。 */
export function recordNovelReviewOnly(
  now: NovelWorkspace,
  input: NovelTestInput,
  review: unknown,
  failure: string
): Partial<NovelWorkspace> {
  if ((now.chapterRevisions || []).some(r => r.requestId === input.requestId))
    return {};
  return {
    chapterRevisions: [
      ...(now.chapterRevisions || []),
      {
        index: input.chapterIndex - 1,
        requestId: input.requestId,
        savedAt: new Date().toISOString(),
        outcome: JSON.stringify({
          chapterIndex: input.chapterIndex,
          original: input.reviseDraft || "",
          review,
        }),
        failure,
        outlineItem: extractEpisodeOutline(input.outline, input.chapterIndex),
      },
    ],
  };
}
/** 采用最终修改版：写入本集正文，当前正文（未修改版或手动稿）存进 chapterVersions。 */
export function adoptNovelRevision(
  now: NovelWorkspace,
  requestId: string
): Partial<NovelWorkspace> {
  const entry = now.chapterRevisions?.find(r => r.requestId === requestId);
  const parsed = entry && parseNovelRevisionEntry(entry);
  if (!entry || !parsed?.revised) throw new Error("这次审稿改稿没有可采用的修改版");
  const i = entry.index;
  const chapters = [...now.chapters];
  chapters[i] = `${parsed.revised.title}\n\n${parsed.revised.text}`;
  const chapterWarnings = {
    ...now.chapterWarnings,
    [String(i)]:
      (now.chapters[i] || "") === parsed.original
        ? "已采用最终修改版，请核对衔接。"
        : "已采用最终修改版；审稿后本集曾有修改，修改前的正文已存为历史版本，请核对。",
  };
  for (let j = i + 1; j < chapters.length; j++)
    if (chapters[j]) chapterWarnings[String(j)] = "前文已修改，请核对本集衔接。";
  const savedAt = new Date().toISOString();
  return {
    chapters,
    chapterWarnings,
    chapterVersions: [
      ...(now.chapterVersions || []),
      { index: i, text: now.chapters[i] || "", savedAt },
    ],
    chapterRevisions: (now.chapterRevisions || []).map(r =>
      r.requestId === requestId ? { ...r, adoptedAt: savedAt } : r
    ),
    novelApproved: "",
  };
}
