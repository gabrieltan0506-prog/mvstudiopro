import { novelTextHash } from "./novelSeries";
import type { NovelWorkspace } from "./novelWorkspace";
import { creativeVoiceNovelActionSchema, type CreativeVoiceNovelAction, type NovelVoiceCandidate } from "@shared/creativeVoiceNovel";
export async function readNovelVoiceChapter(workspace: NovelWorkspace, episode: number) {
  const text = workspace.chapters[episode - 1];
  if (!Number.isInteger(episode) || episode < 1 || !text?.trim()) throw new Error("该集尚无正文，不能凭空覆盖，请先生成或编辑本集。");
  if (text.length > 12000) throw new Error("本集超过语音完整读取范围，请在正文编辑器处理；未截断正文。");
  const revision = await novelTextHash(JSON.stringify({ roundId: workspace.roundId, episode, text, topic: workspace.topic,
    direction: workspace.direction, outline: workspace.outline, templates: workspace.templates, continuity: workspace.continuity }));
  return { episode, text, revision, roundId: workspace.roundId };
}
export async function prepareNovelVoiceCandidate(workspace: NovelWorkspace, input: Extract<CreativeVoiceNovelAction, {action:"preview"}>) {
  const action = creativeVoiceNovelActionSchema.parse(input);
  if (action.action !== "preview") throw new Error("需要完整修改稿");
  const source = await readNovelVoiceChapter(workspace, action.episode);
  if (source.revision !== action.revision) throw new Error("正文或创作条件已变化，请重新read后准备修改稿；原稿未动。");
  const spans = action.edits.map(edit => {
    const start = source.text.indexOf(edit.before);
    if (start < 0 || source.text.indexOf(edit.before, start + 1) !== -1) throw new Error("原文片段不存在或出现多次，请提供唯一完整段落，未改正文。");
    return { start, end: start + edit.before.length, after: edit.after };
  }).sort((a,b)=>a.start-b.start);
  for (let i=1;i<spans.length;i++) if (spans[i].start < spans[i-1].end) throw new Error("修改段落互相重叠，未改正文。");
  let text = source.text;
  for (const span of [...spans].reverse()) text = text.slice(0,span.start)+span.after+text.slice(span.end);
  if (!text.trim() || text.length > 6600) throw new Error("修改后正文为空或超过6600字，请分段调整，原稿保留。");
  if (text === source.text) throw new Error("修改稿与原文相同，未创建重复版本。");
  return { id: crypto.randomUUID(), roundId: workspace.roundId, episode: action.episode, revision: action.revision,
    before: source.text, text, summary: action.summary, createdAt: new Date().toISOString() } satisfies NovelVoiceCandidate;
}
export async function applyNovelVoiceCandidate(workspace: NovelWorkspace, candidate: NovelVoiceCandidate): Promise<NovelWorkspace> {
  if (workspace.roundId !== candidate.roundId) throw new Error("作品已切换，不能套用到另一部作品。");
  const source = await readNovelVoiceChapter(workspace, candidate.episode);
  if (source.revision !== candidate.revision || source.text !== candidate.before) throw new Error("正文或创作条件已变化，请重新比较，未覆盖现稿。");
  const i = candidate.episode - 1, chapters = [...workspace.chapters], chapterWarnings = {...workspace.chapterWarnings};
  chapters[i] = candidate.text;
  for (let j = i + 1; j < chapters.length; j++) if (chapters[j]) chapterWarnings[String(j)] = "前文已通过语音修改，请核对本集衔接。";
  return { ...workspace, chapters, chapterWarnings, novelApproved: "", chapterVersions: [ ...(workspace.chapterVersions || []),
    { index: i, text: source.text, savedAt: new Date().toISOString() } ] };
}
