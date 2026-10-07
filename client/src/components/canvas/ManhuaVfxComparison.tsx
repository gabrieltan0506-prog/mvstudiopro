import { useEffect, useRef, useState } from "react";
import { gcsTransferUrl } from "@/lib/gcsTransfer";

/** Only receives real source/output URLs; never substitutes generated concept art. */
export function ManhuaVfxComparison({ sourceUrl, candidateUrl }: { sourceUrl: string; candidateUrl: string }) {
  const source = useRef<HTMLVideoElement>(null), candidate = useRef<HTMLVideoElement>(null);
  const generation = useRef(0);
  const playingRequest = useRef(false);
  const mounted = useRef(true);
  const [starting, setStarting] = useState(false);
  const [ready, setReady] = useState({ source: false, candidate: false });
  const [audio, setAudio] = useState<"source" | "candidate">("source");
  const [error, setError] = useState("");
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { generation.current++; setReady({ source: false, candidate: false }); setError(""); return () => { generation.current++; source.current?.pause(); candidate.current?.pause(); }; }, [sourceUrl, candidateUrl]);
  const pause = () => { generation.current++; source.current?.pause(); candidate.current?.pause(); };
  const playTogether = async () => {
    const left = source.current, right = candidate.current;
    if (!left || !right || !ready.source || !ready.candidate || playingRequest.current) return;
    playingRequest.current = true; setStarting(true);
    const epoch = ++generation.current;
    left.pause(); right.pause(); left.currentTime = 0; right.currentTime = 0; setError("");
    try { await Promise.all([left.play(), right.play()]); }
    catch { if (generation.current === epoch) { left.pause(); right.pause(); setError("比较视频暂未开始播放，请核对素材读取后重试播放；不会重新生成。"); } }
    if (generation.current !== epoch) { left.pause(); right.pause(); }
    playingRequest.current = false; if (mounted.current) setStarting(false);
  };
  return <section aria-label="原片与候选比较" className="space-y-3 rounded-xl border border-cyan-300/20 bg-slate-950/60 p-3">
    <h5 className="text-xs font-semibold text-white">原片 / 真实候选</h5>
    <div className="grid gap-3 sm:grid-cols-2">{([{ key: "source", title: "原片 · 保留", url: sourceUrl, ref: source }, { key: "candidate", title: "渲染候选", url: candidateUrl, ref: candidate }] as const).map(item => <div key={`${item.key}:${item.url}`}><p className="mb-2 text-[11px] text-white/60">{item.title}</p><video ref={item.ref} playsInline controls preload="metadata" muted={audio !== item.key} src={gcsTransferUrl(item.url)} className="aspect-video w-full rounded bg-black object-contain" onLoadedMetadata={() => setReady(value => ({ ...value, [item.key]: true }))} onError={() => { pause(); setReady(value => ({ ...value, [item.key]: false })); setError("比较素材暂不可播放，原片与候选均保留；请稍后重新读取。"); }} /></div>)}</div>
    <div className="flex flex-wrap items-center gap-2 text-xs"><button type="button" disabled={starting || !ready.source || !ready.candidate} onClick={() => void playTogether()} className="rounded border border-cyan-300/40 px-3 py-2 text-cyan-100 disabled:opacity-40">{starting ? "正在开始播放…" : "从头一起播放"}</button><button type="button" onClick={pause} className="rounded border border-white/20 px-3 py-2 text-white/75">暂停比较</button><label className="ml-auto text-white/60">声音 <select aria-label="比较时播放哪一路声音" className="rounded bg-slate-900 p-2 text-white" value={audio} onChange={event => setAudio(event.target.value as "source" | "candidate")}><option value="source">原片</option><option value="candidate">候选</option></select></label></div>
    <p className="text-[11px] text-white/45">播放现有真实文件，不触发生成。比较后仍需明确采用候选。</p>
    {error ? <p role="alert" className="text-xs text-amber-200">{error}</p> : null}
  </section>;
}
