import { remixDraftSchema, type RemixDraft } from "@shared/remixDraft";
import {
  NOVEL_SOURCE_MAX_CHARS,
  type ManhuaNovelDraft,
  type NovelChapter,
} from "@shared/manhuaNovelSource";

export const remixHandoffKey = (userId: number) =>
  `mvsp-remix-production-v1:${userId}`;
export function saveRemixProductionHandoff(
  userId: number,
  input: RemixDraft
): void {
  const draft = remixDraftSchema.parse(input);
  if (!draft.units.length || draft.units.some(row => !row.content.trim()))
    throw new Error("请补齐每一镜/页的内容后再继续制作");
  localStorage.setItem(remixHandoffKey(userId), JSON.stringify(draft));
}
export function readRemixProductionHandoff(userId: number): RemixDraft | null {
  const raw = localStorage.getItem(remixHandoffKey(userId));
  return raw ? remixDraftSchema.parse(JSON.parse(raw)) : null;
}
/** 用正式原文入口保留完整分镜，不塞进会截断的补充条件。 */
export function remixToNovelDraft(input: RemixDraft): ManhuaNovelDraft {
  const draft = remixDraftSchema.parse(input);
  if (draft.format !== "video") throw new Error("请选择视频复刻稿");
  let text = "";
  let line = 1;
  const chapters: NovelChapter[] = [];
  draft.units.forEach((row, i) => {
    if (!row.content.trim()) throw new Error(`镜头${i + 1}内容为空`);
    const block =
      [
        `第${i + 1}章 镜头${i + 1}`,
        i === 0 && draft.title ? `作品标题：${draft.title}` : "",
        draft.brief ? `创作要求：${draft.brief}` : "",
        row.content,
        row.durationSeconds !== null
          ? `目标时长：${row.durationSeconds}秒`
          : "时长待编排",
        row.sound ? `对白/声音：${row.sound}` : "",
      ]
        .filter(Boolean)
        .join("\n\n") + "\n\n";
    chapters.push({
      title: `镜头${i + 1}`,
      start: text.length,
      end: text.length + block.length,
      line,
    });
    text += block;
    line += (block.match(/\n/g) || []).length;
  });
  if (!text) throw new Error("请先添加镜头内容");
  if (text.length > NOVEL_SOURCE_MAX_CHARS)
    throw new Error(
      "本次原文超过编剧室40万字导入容量，请分批采用；编辑稿完整保留，未截断"
    );
  return {
    name: (draft.title || "视频复刻稿").slice(0, 120),
    text,
    from: 0,
    to: 0,
    enabled: true,
    chapters,
  };
}
