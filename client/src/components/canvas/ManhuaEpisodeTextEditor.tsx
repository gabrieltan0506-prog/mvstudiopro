import { useEffect, useId, useState } from "react";
import { manhuaProjectStorage } from "@shared/manhuaProjectScope";
import { splitManhuaEpisodeStoryText } from "@shared/manhuaAdvisorRewrite";
import type { ManualEpisodeEdit } from "@/lib/manhuaAdvisorAdoption";

type Episode = { index: number; title?: string; body: string; endHook?: string };
export type ManhuaEpisodeTextEditorProps = {
  scopeKey: string;
  episode: Episode;
  busyReason?: string;
  onApplyEdit: (edit: ManualEpisodeEdit) => boolean | Promise<boolean>;
};
type Draft = ManualEpisodeEdit & { version: 1 };
const DRAFT_EVENT = "manhua-episode-text-draft";
const draftKey = (scopeKey: string, episodeIndex: number) => `mv-manhua-episode-edit:${encodeURIComponent(scopeKey)}:${episodeIndex}`;
const freshDraft = (episode: Episode): Draft => ({ version: 1, episodeIndex: episode.index,
  originalBody: episode.body, originalEndHook: episode.endHook || "", body: splitManhuaEpisodeStoryText(episode.body).story, endHook: episode.endHook || "" });
const isDirty = (draft: Draft) => draft.body !== splitManhuaEpisodeStoryText(draft.originalBody).story || draft.endHook !== draft.originalEndHook;
function readDraft(key: string, episode: Episode): { draft: Draft; error: string } {
  try {
    const raw = manhuaProjectStorage.getItem(key);
    if (!raw) return { draft: freshDraft(episode), error: "" };
    const saved = JSON.parse(raw) as Draft;
    if (saved.version !== 1 || saved.episodeIndex !== episode.index ||
      [saved.originalBody, saved.originalEndHook, saved.body, saved.endHook].some(value => typeof value !== "string"))
      throw new Error("草稿结构不可读取");
    return { draft: saved, error: "" };
  } catch { return { draft: freshDraft(episode), error: "本机草稿未能读取；原记录未覆盖，请先核对已保存正文。" }; }
}

/** 切集时独立挂载，避免上集草稿短暂写入下一集存储键。 */
export default function ManhuaEpisodeTextEditor(props: ManhuaEpisodeTextEditorProps) {
  return <EpisodeTextEditor key={draftKey(props.scopeKey, props.episode.index)} {...props} />;
}

function EpisodeTextEditor({ scopeKey, episode, busyReason, onApplyEdit }: ManhuaEpisodeTextEditorProps) {
  const key = draftKey(scopeKey, episode.index);
  const sourceId = useId();
  const [initial] = useState(() => readDraft(key, episode));
  const [draft, setDraft] = useState(initial.draft);
  const [error, setError] = useState(initial.error);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const dirty = isDirty(draft);
  const stale = draft.originalBody !== episode.body || draft.originalEndHook !== (episode.endHook || "");
  const technical = splitManhuaEpisodeStoryText(episode.body).technicalSections;

  function persistDraft(next: Draft) {
    setDraft(next);
    setStatus("");
    try {
      manhuaProjectStorage.setItem(key, JSON.stringify(next));
      setError("");
      window.dispatchEvent(new CustomEvent(DRAFT_EVENT, { detail: { key, draft: next, sourceId } }));
    } catch { setError("本机草稿保存失败，请先复制正在编辑的内容；切集或刷新可能丢失本次编辑。"); }
  }

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; draft: Draft; sourceId: string }>).detail;
      if (detail?.key === key && detail.sourceId !== sourceId) setDraft(detail.draft);
    };
    window.addEventListener(DRAFT_EVENT, receive);
    return () => window.removeEventListener(DRAFT_EVENT, receive);
  }, [key, sourceId]);

  useEffect(() => {
    if (!stale) return;
    // 外部顾问采用会更新真源；只有无本地改动或同一草稿已成功采用，才自动跟进。
    const source = freshDraft(episode);
    if (!dirty || (draft.body.trim() === source.body && draft.endHook === source.endHook)) {
      setDraft(source);
      try { manhuaProjectStorage.removeItem(key); }
      catch { setError("正文已更新，但旧本机草稿未能清理。刷新后请核对版本。"); }
    }
  }, [episode.body, episode.endHook, stale, dirty, draft.body, draft.endHook, key]);

  async function apply() {
    if (!dirty || stale || busyReason || saving || !draft.body.trim()) return;
    const snapshot = draft;
    setSaving(true);
    setStatus("");
    try {
      const accepted = await onApplyEdit({ episodeIndex: snapshot.episodeIndex, originalBody: snapshot.originalBody,
        originalEndHook: snapshot.originalEndHook, body: snapshot.body, endHook: snapshot.endHook });
      if (accepted) {
        setStatus("本集修改已写回，旧稿和旧资产已保留。");
        // 宿主更新真源后统一清理，不能提前丢掉仍未进入真源的草稿。
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "写回失败，草稿已保留。"); }
    finally { setSaving(false); }
  }

  return <section className="space-y-3 rounded-xl border border-cyan-300/20 bg-slate-950/35 p-3" aria-label={`第${episode.index}集剧情编辑`}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-sm font-medium text-cyan-50">第 {episode.index} 集 · {episode.title || "剧情与对白"}</h3>
      <span className="text-[11px] text-white/50">{dirty ? "有待确认的编辑草稿" : "与已保存正文一致"}</span>
    </div>
    <label className="block space-y-1 text-xs text-white/65">
      <span>剧情与对白</span>
      <textarea aria-label={`第${episode.index}集剧情与对白`} value={draft.body} disabled={saving}
        onChange={event => persistDraft({ ...draft, body: event.target.value })}
        className="min-h-72 w-full resize-y rounded-lg border border-white/15 bg-black/20 p-3 text-sm leading-7 text-white/90 outline-none focus:border-cyan-300/60" />
    </label>
    <label className="block space-y-1 text-xs text-white/65">
      <span>片尾钩子</span>
      <textarea aria-label={`第${episode.index}集片尾钩子`} value={draft.endHook} disabled={saving}
        onChange={event => persistDraft({ ...draft, endHook: event.target.value })}
        className="min-h-20 w-full resize-y rounded-lg border border-white/15 bg-black/20 p-3 text-sm leading-6 text-white/90 outline-none focus:border-cyan-300/60" />
    </label>
    {stale ? <div role="alert" className="space-y-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-100">
      <p>已保存正文在编辑期间发生变化，当前草稿仍保留。请核对下方新稿，重新编辑后再确认，避免覆盖新版本。</p>
      <details><summary className="cursor-pointer">查看当前已保存正文</summary><pre className="whitespace-pre-wrap py-2">{splitManhuaEpisodeStoryText(episode.body).story}</pre><p>{episode.endHook}</p></details>
      <button type="button" onClick={() => { if (window.confirm("放弃当前未采用草稿，使用最新保存的正文重新编辑？")) persistDraft(freshDraft(episode)); }} className="rounded border border-amber-200/30 px-2 py-1">以当前已保存稿重新编辑</button>
    </div> : null}
    {technical.length ? <details className="text-xs text-white/50"><summary className="cursor-pointer">已保留的原技术材料 · 剧情改变后需在分镜步骤复核</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap">{technical.join("\n\n")}</pre></details> : null}
    {busyReason ? <p role="status" className="text-xs text-amber-100">{busyReason}；可继续编辑草稿，任务结束后再确认写回。</p> : null}
    {error ? <p role="alert" className="text-xs text-red-200">{error}</p> : null}
    {status ? <p role="status" className="text-xs text-emerald-200">{status}</p> : null}
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={!dirty || stale || Boolean(busyReason) || saving || !draft.body.trim()} onClick={() => void apply()}
        className="rounded-lg bg-cyan-300 px-3 py-2 text-xs font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">{saving ? "正在写回…" : "确认写回本集并更新相关资产"}</button>
      <p className="text-[11px] text-white/50">确认后更新相关道具、服装和场景设定并生成新版本，按原资产流程计费；保留旧稿和旧资产。</p>
    </div>
  </section>;
}
