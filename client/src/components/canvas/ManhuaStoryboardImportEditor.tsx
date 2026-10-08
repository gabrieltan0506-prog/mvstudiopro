import { useEffect, useState } from "react";
import { manhuaProjectStorage } from "@shared/manhuaProjectScope";
import { MANHUA_SEGMENT_CAPACITY_MODE_LABEL_ZH, MANHUA_SEGMENT_CAPACITY_MODES, type ManhuaSegmentCapacityMode } from "@shared/manhuaSegmentCapacity";

type Props = {
  scopeKey: string;
  episode: { index: number; body: string };
  busyReason?: string;
  capacityMode?: ManhuaSegmentCapacityMode;
  onChangeCapacityMode?: (mode: ManhuaSegmentCapacityMode) => void;
  onPrepare: (text: string) => void | Promise<void>;
};
type Draft = { version: 1; episode: number; originalBody: string; text: string };

export default function ManhuaStoryboardImportEditor(props: Props) {
  return <ImportEditor key={`${props.scopeKey}:${props.episode.index}`} {...props} />;
}

function ImportEditor({ scopeKey, episode, busyReason, capacityMode, onChangeCapacityMode, onPrepare }: Props) {
  const key = `mv-manhua-storyboard-import:${encodeURIComponent(scopeKey)}:${episode.index}`;
  const [initial] = useState(() => {
    const fresh: Draft = { version: 1, episode: episode.index, originalBody: episode.body, text: "" };
    try {
      const raw = manhuaProjectStorage.getItem(key);
      if (!raw) return { draft: fresh, error: "" };
      const saved = JSON.parse(raw) as Draft;
      if (saved.version !== 1 || saved.episode !== episode.index || typeof saved.originalBody !== "string" || typeof saved.text !== "string") throw new Error();
      return { draft: saved, error: "" };
    } catch { return { draft: fresh, error: "导入草稿未能读取；原记录保留，请先核对。" }; }
  });
  const [draft, setDraft] = useState(initial.draft);
  const [error, setError] = useState(initial.error);
  const [preparing, setPreparing] = useState(false);
  const stale = draft.originalBody !== episode.body;
  useEffect(() => {
    if (stale && !draft.text) setDraft({ ...draft, originalBody: episode.body });
  }, [stale, draft, episode.body]);

  function change(next: Draft) {
    setDraft(next);
    try {
      const raw = JSON.stringify(next);
      manhuaProjectStorage.setItem(key, raw);
      if (manhuaProjectStorage.getItem(key) !== raw) throw new Error();
      setError("");
    } catch { setError("导入草稿未能完整保存，请复制原文后再刷新；当前作品未改。"); }
  }

  async function prepare() {
    if (!scopeKey || stale || busyReason || preparing || !draft.text.trim()) return;
    setPreparing(true);
    setError("");
    try { await onPrepare(draft.text); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "分镜校验失败；草稿保留，作品未改。"); }
    finally { setPreparing(false); }
  }

  return <details className="rounded-xl border border-cyan-300/20 bg-slate-950/35 p-3" data-manhua-storyboard-import>
    <summary className="cursor-pointer text-sm font-medium text-cyan-50">导入已审文字分镜 · 免费</summary>
    <p className="my-2 text-xs leading-6 text-white/60">粘贴第{episode.index}集完整分镜表，包含镜号、起止秒位、画面、运镜与对白。先校验并展示候选，确认采用后才写回。不会生成图片、音轨或视频，不自动补镜或补秒数。未采用的导入草稿仅保存在本机。</p>
    {capacityMode && onChangeCapacityMode ? <label className="mb-3 block text-xs text-white/65">
      本集分镜容量
      <select aria-label={`第${episode.index}集导入分镜容量`} value={capacityMode} disabled={Boolean(busyReason) || preparing}
        onChange={event => onChangeCapacityMode(event.target.value as ManhuaSegmentCapacityMode)}
        className="ml-2 rounded border border-white/15 bg-slate-950 p-2 text-white">
        {MANHUA_SEGMENT_CAPACITY_MODES.map(mode => <option key={mode} value={mode}>{MANHUA_SEGMENT_CAPACITY_MODE_LABEL_ZH[mode]}</option>)}
      </select>
      <span className="mt-1 block text-white/50">按原稿分段会随镜头数和时长增加规划片段；实际生成仍需另行核对费用。不会自动改容量或删镜。</span>
    </label> : null}
    <label className="block text-xs text-white/65">
      第{episode.index}集分镜表原文
      <textarea aria-label={`第${episode.index}集分镜表原文`} value={draft.text} disabled={preparing || !scopeKey}
        onChange={event => change({ ...draft, text: event.target.value })}
        className="mt-2 min-h-48 w-full rounded-lg border border-white/15 bg-black/20 p-3 text-sm leading-6 text-white/90" />
    </label>
    {stale ? <div role="alert" className="my-2 text-xs text-amber-100">
      <p>正文已改变，导入草稿保留。请先对照当前正文核对，避免用旧分镜覆盖新剧情。</p>
      <button type="button" disabled={preparing} className="mt-2 rounded border border-amber-200/30 px-2 py-1"
        onClick={() => { if (window.confirm("已对照当前正文核对这份分镜？只更新草稿来源，不采用或生成。")) change({ ...draft, originalBody: episode.body }); }}>已核对当前正文</button>
    </div> : null}
    {busyReason ? <p role="status" className="my-2 text-xs text-amber-100">{busyReason}；可继续编辑导入草稿。</p> : null}
    {error ? <p role="alert" className="my-2 text-xs text-red-200">{error}</p> : null}
    <button type="button" disabled={!scopeKey || stale || Boolean(busyReason) || preparing || !draft.text.trim()}
      onClick={() => void prepare()} className="mt-3 rounded-lg border border-cyan-300/40 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40">
      {preparing ? "正在校验…" : "校验并查看分镜候选（不生成）"}
    </button>
  </details>;
}
