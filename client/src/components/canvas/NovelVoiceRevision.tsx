import { useEffect, useRef, useState } from "react";
import { CreativeVoicePanel } from "./CreativeVoicePanel";
import type { ComponentProps } from "react";
import { creativeVoiceNovelActionSchema, novelVoiceCandidateSchema, type CreativeVoiceNovelAction, type NovelVoiceCandidate } from "@shared/creativeVoiceNovel";
import { prepareNovelVoiceCandidate, readNovelVoiceChapter } from "@/lib/novelVoiceEditing";
import type { NovelWorkspace } from "@/lib/novelWorkspace";
export function NovelVoiceRevision(props: ComponentProps<typeof CreativeVoicePanel> & {
  getWorkspace: () => NovelWorkspace;
  onApplyRevision: (candidate: NovelVoiceCandidate, signal: AbortSignal) => Promise<void>;
}) {
  const [candidate, setCandidate] = useState<NovelVoiceCandidate | null>(null), [message, setMessage] = useState("");
  const latest = useRef(props); latest.current = props;
  const value = useRef<NovelVoiceCandidate | null>(null), busy = useRef(false), blocked = useRef(false);
  const lifecycle = useRef(new AbortController());
  const key = `novel-voice-revision:${props.scopeKey}`;
  useEffect(() => {
    lifecycle.current = new AbortController(); value.current = null; setCandidate(null); blocked.current = false;
    try { const raw = localStorage.getItem(key); if (raw) { value.current = novelVoiceCandidateSchema.parse(JSON.parse(raw)); setCandidate(value.current); } }
    catch { blocked.current = true; setMessage("旧语音修改稿读取失败，原记录保留，请先下载备份。"); }
    return () => lifecycle.current.abort();
  }, [key]);
  function save(next: NovelVoiceCandidate) { localStorage.setItem(key, JSON.stringify(next)); value.current = next; setCandidate(next); }
  async function action(input: CreativeVoiceNovelAction, signal: AbortSignal): Promise<string> {
    const action = creativeVoiceNovelActionSchema.parse(input), before = latest.current.getWorkspace();
    if (signal.aborted || lifecycle.current.signal.aborted) throw new Error("语音已结束，未修改正文。");
    if (busy.current || latest.current.disabled || blocked.current) throw new Error("工作区忙或保存有问题，请处理后继续；未改正文。");
    busy.current = true;
    try {
      if (action.action === "read") {
        const result = JSON.stringify(await readNovelVoiceChapter(before, action.episode));
        if (result.length > 16000) throw new Error("本集超过语音工具返回范围，请在正文编辑器处理，未截断原文。");
        return result;
      }
      if (action.action === "preview") {
        const next = await prepareNovelVoiceCandidate(before, action);
        if (signal.aborted || lifecycle.current.signal.aborted || latest.current.getWorkspace() !== before) throw new Error("作品在读取期间变化，请重新读取。");
        if (value.current) localStorage.setItem(`${key}:history:${value.current.id}`, JSON.stringify(value.current));
        save(next); setMessage("修改稿已准备好。查看对比后，可说“套用这版”或点击确认应用。");
        return JSON.stringify({ status: "awaiting_confirmation", candidateId: next.id, episode: next.episode, summary: next.summary, message: "修改稿已显示，尚未改正文。用户要采用时调用apply，页面将请用户确认。" });
      }
      const current = value.current;
      if (!current || current.id !== action.candidateId || current.roundId !== before.roundId) throw new Error("没有匹配的本作品修改稿，请先读取并预览。");
      if (current.applied) return "此修改稿已保存过，不重复套用。";
      if (!window.confirm(`确认将这份修改稿应用到第${current.episode}集正文？\n${current.summary}\n原文会保留在本集历史版本。`)) return "用户取消套用，原文未改，修改稿保留。";
      if (signal.aborted || lifecycle.current.signal.aborted) throw new Error("语音已结束，未修改正文。");
      await latest.current.onApplyRevision(current, signal);
      const completed = {...current, applied: true}; value.current = completed;
      if (!lifecycle.current.signal.aborted) setCandidate(completed);
      try { localStorage.setItem(key, JSON.stringify(completed)); }
      catch { setMessage("正文已保存，但语音回执保存失败；请下载修改记录，不要重复应用。"); return `第${current.episode}集正文已保存，旧版保留；语音回执存储失败，请下载记录。`; }
      const result = `已将修改实际写入第${current.episode}集小说正文并保存到本机，旧稿保留在本集历史版本。未自动更新已生成剧本或云端作品。`;
      setMessage(result); return result;
    } finally { busy.current = false; }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([localStorage.getItem(key) || "{}"],{type:"application/json"}));
    const a = document.createElement("a"); a.href = url; a.download = "语音小说修改稿.json"; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <>
    <CreativeVoicePanel {...props} onNovelAction={action} />
    <section aria-label="语音小说修改稿" className="space-y-3 rounded-xl border border-white/20 p-3">
      <p>可以说“读取第二集，按刚才讨论修改正文”，看过修改稿后说“套用这版”，确认后会写入正文并保留旧稿。</p>
      {candidate && <><h3>第{candidate.episode}集 · {candidate.applied ? "已应用" : "待确认修改稿"}</h3><p>{candidate.summary}</p>
        <div className="grid gap-3 lg:grid-cols-2"><details open><summary>原文</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap">{candidate.before}</pre></details><details open><summary>修改稿</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap">{candidate.text}</pre></details></div>
        <button type="button" disabled={props.disabled || candidate.applied} onClick={()=>void action({action:"apply",candidateId:candidate.id},lifecycle.current.signal).then(setMessage).catch(e=>setMessage(e instanceof Error?e.message:"保存未完成"))}>确认应用到正文</button>
      </>}
      {(candidate || blocked.current) && <button type="button" onClick={download}>下载语音修改稿</button>}
      {message && <p role="status">{message}</p>}
    </section>
  </>;
}
