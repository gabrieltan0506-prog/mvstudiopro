/**
 * 拉片结果展示（纯展示，不碰接口）：原片 + 摘要 + 分段时间轴、全片创作拆解、逐段卡片、复制/导出。
 * 另含失败态与空态说明，供页面与单测共用。
 */
// 单测在 node 环境走经典 JSX 转换，需要 React 在作用域内。
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ClipboardCopy, Clapperboard, Download, Film, Copy as RecreateIcon, Music, Wand2, X, RotateCcw, Send, Sparkles, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { formatVideoBreakdownRecreatePrompt, type VideoBreakdown, type VideoBreakdownSegment } from "@shared/videoBreakdown";
import { buildVideoBreakdownBgmPrompt } from "@shared/videoBreakdownBgm";
import { CraftBlock, KeyMomentsBlock, ShotLengthBars, SoundBlock, ViralStrategyBlock } from "./VideoBreakdownOverviewExtras";
import { videoBreakdownRemakeInputSchema, type VideoBreakdownRemakeInput } from "@shared/videoBreakdownRemake";
import { gcsTransferUrl } from "@/lib/gcsTransfer";
import {
  VISUAL_GENE_ROWS,
  buildAllRecreatePromptsText,
  buildVideoBreakdownMarkdown,
  expressionRows,
  formatClock,
  formatDuration,
  formatSegmentRange,
  markdownFileName,
  segmentHeading,
  segmentPlayback,
  speechRows,
} from "@/lib/videoBreakdownView";

export type CopyHandler = (text: string, label: string) => void | Promise<void>;
/** 送入自由画布：按段序；整片送入时一并带配乐提示词。 */
export type SendToCanvasRequest = { segmentIndexes: number[]; includeBgm: boolean; remake?: VideoBreakdownRemakeInput };
export type SendToCanvasHandler = (request: SendToCanvasRequest) => void;

export async function copyTextToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`已复制${label}`);
  } catch {
    toast.error("复制未成功，请手动选中文字复制。");
  }
}

function downloadText(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const card = "rounded-2xl border border-white/10 bg-white/[0.04]";
const th = "whitespace-nowrap border-b border-white/10 px-3 py-2 text-left text-xs font-medium text-white/50";
const td = "border-b border-white/5 px-3 py-2.5 align-top text-sm leading-6 text-white/85";

function ScrollTable({ label, children, minWidth = 560 }: { label: string; children: ReactNode; minWidth?: number }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1" role="region" aria-label={label} tabIndex={0}>
      <table className="w-full border-collapse" style={{ minWidth }}>{children}</table>
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <h2 className="flex items-center gap-2 text-lg font-semibold text-white">{icon}{children}</h2>;
}

type Focus = { index: number; nonce: number };

function SegmentPlayer({ segment, clipUrl, sourceUrl, focus }: { segment: VideoBreakdownSegment; clipUrl?: string; sourceUrl?: string; focus: Focus | null }) {
  const playback = segmentPlayback(segment, clipUrl, sourceUrl);
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!focus || focus.index !== segment.index || playback.mode === "none") return;
    const video = ref.current;
    if (!video) return;
    video.currentTime = playback.startSec;
    void video.play().catch(() => undefined);
  }, [focus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  if (playback.mode === "none") {
    return <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-black/60 text-xs text-white/40">片段暂不可播放</div>;
  }
  const isSource = playback.mode === "source";
  return (
    <div>
      <video
        ref={ref}
        data-playback={playback.mode}
        src={gcsTransferUrl(playback.src)}
        controls
        playsInline
        preload="metadata"
        className="aspect-video w-full rounded-xl bg-black object-contain"
        onLoadedMetadata={event => { if (isSource) event.currentTarget.currentTime = playback.startSec; }}
        onPlay={event => {
          if (!isSource) return;
          const v = event.currentTarget;
          if (v.currentTime < playback.startSec - 0.2 || v.currentTime >= playback.endSec - 0.05) v.currentTime = playback.startSec;
        }}
        onTimeUpdate={event => { if (isSource && event.currentTarget.currentTime >= playback.endSec) event.currentTarget.pause(); }}
      />
      {isSource && <p className="mt-1.5 text-[11px] text-white/40">本段片段暂未裁好，正在原片中按 {formatClock(playback.startSec)}–{formatClock(playback.endSec)} 播放</p>}
    </div>
  );
}

function SegmentCard({ segment, clipUrl, sourceUrl, focus, onCopy, onSendToCanvas }: { segment: VideoBreakdownSegment; clipUrl?: string; sourceUrl?: string; focus: Focus | null; onCopy: CopyHandler; onSendToCanvas?: SendToCanvasHandler }) {
  const prompt = formatVideoBreakdownRecreatePrompt(segment);
  return (
    <article id={`lapian-seg-${segment.index}`} data-segment-index={segment.index} className={`${card} scroll-mt-24 p-4 sm:p-5`}>
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-white">{segmentHeading(segment)}</h3>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-xs text-white/50">{formatSegmentRange(segment)}</span>
          {onSendToCanvas && (
            <button type="button" data-send-segment={segment.index} title={clipUrl ? "带复刻提示词与本段片段（作参考视频）" : "本段片段未裁好，只带复刻提示词"} onClick={() => onSendToCanvas({ segmentIndexes: [segment.index], includeBgm: false })} className="inline-flex items-center gap-1.5 rounded-full border border-violet-300/40 px-3 py-1 text-xs text-violet-100 hover:border-violet-200 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300">
              <Send className="h-3.5 w-3.5" />到自由画布创作
            </button>
          )}
        </div>
      </header>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="min-w-0"><SegmentPlayer segment={segment} clipUrl={clipUrl} sourceUrl={sourceUrl} focus={focus} /></div>
        <div className="min-w-0 space-y-5">
          <section>
            <h4 className="mb-2 text-sm font-medium text-white/70">镜头构造</h4>
            <ScrollTable label={`${segmentHeading(segment)} 镜头构造表`} minWidth={620}>
              <thead><tr><th className={th}>时间</th><th className={th}>画面景别</th><th className={th}>摄影机</th><th className={th}>调度 · 构图与焦点</th></tr></thead>
              <tbody>
                {segment.shots.map((shot, i) => (
                  <tr key={i}>
                    <td className={`${td} whitespace-nowrap font-mono text-xs text-white/60`}>{formatClock(shot.startSec)}<br />{formatClock(shot.endSec)}</td>
                    <td className={td}>{shot.framing}</td>
                    <td className={td}>{shot.camera}</td>
                    <td className={td}>{shot.blockingAndFocus}</td>
                  </tr>
                ))}
              </tbody>
            </ScrollTable>
          </section>
          <section>
            <h4 className="mb-2 text-sm font-medium text-white/70">段落表达</h4>
            <ScrollTable label={`${segmentHeading(segment)} 段落表达`} minWidth={420}>
              <tbody>
                {expressionRows(segment).map(row => (
                  <tr key={row.label}><th scope="row" className={`${th} w-28 align-top`}>{row.label}</th><td className={td}>{row.value}</td></tr>
                ))}
              </tbody>
            </ScrollTable>
          </section>
          {speechRows(segment).length > 0 && (
            <section data-segment-speech={segment.index}>
              <h4 className="mb-2 text-sm font-medium text-white/70">口播与字幕</h4>
              <ScrollTable label={`${segmentHeading(segment)} 口播与字幕`} minWidth={420}>
                <tbody>
                  {speechRows(segment).map(row => (
                    <tr key={row.label}><th scope="row" className={`${th} w-28 align-top`}>{row.label}</th><td className={`${td} whitespace-pre-wrap`}>{row.value}</td></tr>
                  ))}
                </tbody>
              </ScrollTable>
            </section>
          )}
        </div>
      </div>
      <section className="mt-5 rounded-xl border border-violet-400/20 bg-violet-500/[0.06] p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="flex items-center gap-1.5 text-sm font-medium text-violet-200"><Sparkles className="h-4 w-4" />复刻生成提示词</h4>
          <button type="button" onClick={() => void onCopy(prompt, `片段 ${segment.index + 1} 提示词`)} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1 text-xs text-white/80 hover:border-violet-300/60 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300">
            <ClipboardCopy className="h-3.5 w-3.5" />复制
          </button>
        </div>
        <pre data-recreate-prompt={segment.index} className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-sans text-[13px] leading-6 text-white/80">{prompt}</pre>
      </section>
    </article>
  );
}

/** 很轻的两项输入：新主体必填、新场景可选；校验沿用 shared/videoBreakdownRemake 的规则。 */
function RemakeForm({ onSubmit, onCancel }: { onSubmit: (input: VideoBreakdownRemakeInput) => void; onCancel: () => void }) {
  const [subject, setSubject] = useState("");
  const [scene, setScene] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      data-remake-form
      onSubmit={event => {
        event.preventDefault();
        const parsed = videoBreakdownRemakeInputSchema.safeParse({ subject, ...(scene.trim() ? { scene } : {}) });
        if (!parsed.success) { setError(parsed.error.issues[0]?.message || "请检查输入"); return; }
        setError("");
        onSubmit(parsed.data);
      }}
      className="space-y-2 rounded-xl border border-violet-300/30 bg-violet-500/[0.06] p-3"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-white">换成你的主体与场景</p>
        <button type="button" aria-label="收起" onClick={onCancel} className="text-white/50 hover:text-white"><X className="h-4 w-4" /></button>
      </div>
      <label className="block text-xs text-white/70">新主体（必填，一句话）
        <input value={subject} onChange={event => setSubject(event.target.value)} maxLength={300} required placeholder="如：穿红色雨衣的小女孩，短发，背黄色书包" className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-violet-300/60 focus:outline-none" />
      </label>
      <label className="block text-xs text-white/70">新场景（可选，留空沿用原片场景）
        <input value={scene} onChange={event => setScene(event.target.value)} maxLength={300} placeholder="如：夜晚霓虹街头的积水路面" className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-violet-300/60 focus:outline-none" />
      </label>
      <p className="text-[11px] leading-5 text-white/45">原片片段只作动作与运镜参考带入；到画布后请在各方块补上你自己的主体外观参考图。</p>
      {error && <p role="alert" className="text-xs text-amber-200">{error}</p>}
      <button type="submit" className="rounded-full bg-violet-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-500">送入自由画布</button>
    </form>
  );
}

export function VideoBreakdownResultView({ result, sourceUrl, clipUrls, keyMomentFrameUrls, onCopy = copyTextToClipboard, onSendToCanvas }: { result: VideoBreakdown; sourceUrl?: string; clipUrls?: string[]; keyMomentFrameUrls?: string[]; onCopy?: CopyHandler; onSendToCanvas?: SendToCanvasHandler }) {
  const sourceRef = useRef<HTMLVideoElement>(null);
  const seekSource = (sec: number) => {
    const video = sourceRef.current;
    if (!video) return;
    video.scrollIntoView({ behavior: "smooth", block: "center" });
    video.currentTime = sec;
    void video.play().catch(() => undefined);
  };
  const [focus, setFocus] = useState<Focus | null>(null);
  const bgmPrompt = buildVideoBreakdownBgmPrompt(result);
  const [remakeOpen, setRemakeOpen] = useState(false);
  const allIndexes = result.segments.map(segment => segment.index);
  const total = Math.max(result.durationSec, result.segments[result.segments.length - 1]?.endSec || 0, 0.1);
  const jump = (index: number) => {
    document.getElementById(`lapian-seg-${index}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setFocus(prev => ({ index, nonce: (prev?.nonce || 0) + 1 }));
  };
  return (
    <div className="space-y-8" data-lapian-result>
      <section className={`${card} overflow-hidden`}>
        <div className="grid gap-0 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="bg-black">
            {sourceUrl ? <video ref={sourceRef} data-source-player src={gcsTransferUrl(sourceUrl)} controls playsInline preload="metadata" className="aspect-video w-full object-contain" /> : <div className="flex aspect-video items-center justify-center text-xs text-white/40">原片暂不可播放</div>}
          </div>
          <div className="flex flex-col justify-between gap-4 p-5">
            <div>
              <p className="text-xs text-white/50">全片 {formatDuration(result.durationSec)} · 共 {result.segments.length} 段</p>
              <p data-lapian-summary className="mt-2 text-base leading-7 text-white">{result.summary}</p>
            </div>
            <div className="space-y-3">
              {onSendToCanvas && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <button type="button" data-send-all="recreate" onClick={() => onSendToCanvas({ segmentIndexes: allIndexes, includeBgm: true })} className="flex flex-col items-start rounded-xl bg-violet-600 px-4 py-3 text-left text-white hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300">
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold"><RecreateIcon className="h-4 w-4" />复刻这支片</span>
                    <span className="mt-1 text-xs text-white/75">全部分段按序送入自由画布，配好参考片段与配乐，逐段生成拼成一支</span>
                  </button>
                  <button type="button" data-send-all="remake" aria-expanded={remakeOpen} onClick={() => setRemakeOpen(open => !open)} className="flex flex-col items-start rounded-xl border border-violet-300/40 px-4 py-3 text-left text-violet-50 hover:border-violet-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300">
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold"><Wand2 className="h-4 w-4" />用这套拍法创作新片</span>
                    <span className="mt-1 text-xs text-white/65">同样的分段、镜头节奏、运镜与光色，主体和场景换成你的</span>
                  </button>
                </div>
              )}
              {onSendToCanvas && remakeOpen && <RemakeForm onCancel={() => setRemakeOpen(false)} onSubmit={remake => onSendToCanvas({ segmentIndexes: allIndexes, includeBgm: true, remake })} />}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void onCopy(buildAllRecreatePromptsText(result), "全部提示词")} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/85 hover:border-white/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300">
                  <ClipboardCopy className="h-3.5 w-3.5" />复制全部提示词
                </button>
                <button type="button" onClick={() => downloadText(buildVideoBreakdownMarkdown(result), markdownFileName())} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/85 hover:border-white/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300">
                  <Download className="h-3.5 w-3.5" />导出 Markdown
                </button>
              </div>
            </div>
          </div>
        </div>
        <nav aria-label="分段时间轴" className="border-t border-white/10 p-4">
          <div className="flex h-11 w-full gap-1 overflow-hidden rounded-lg">
            {result.segments.map(segment => (
              <button
                key={segment.index}
                type="button"
                title={`${segmentHeading(segment)} · ${formatClock(segment.startSec)}–${formatClock(segment.endSec)}`}
                onClick={() => jump(segment.index)}
                style={{ flexGrow: Math.max(segment.endSec - segment.startSec, 0.1) / total, flexBasis: 0 }}
                className={`min-w-[28px] truncate rounded-md px-2 text-left text-[11px] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300 ${focus?.index === segment.index ? "bg-violet-500 text-white" : "bg-white/10 text-white/70 hover:bg-white/20"}`}
              >
                <span className="font-mono">{segment.index + 1}</span><span className="ml-1 hidden sm:inline">{segment.title}</span>
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[10px] text-white/35"><span>{formatClock(0)}</span><span>{formatClock(total)}</span></div>
        </nav>
      </section>

      {result.overview.viralStrategy && (
        <section className="space-y-4">
          <SectionTitle icon={<TrendingUp className="h-5 w-5 text-amber-300" />}>爆款策略</SectionTitle>
          <ViralStrategyBlock result={result} />
        </section>
      )}

      <section className="space-y-4">
        <SectionTitle icon={<Film className="h-5 w-5 text-violet-300" />}>全片创作拆解</SectionTitle>
        <div className={`${card} p-4 sm:p-5`}>
          <h3 className="mb-2 text-sm font-medium text-white/70">视觉基因</h3>
          <ScrollTable label="视觉基因六维表" minWidth={480}>
            <thead><tr><th className={th}>维度</th><th className={th}>全片特征</th></tr></thead>
            <tbody>{VISUAL_GENE_ROWS.map(row => <tr key={row.key}><th scope="row" className={`${th} w-32 align-top`}>{row.label}</th><td className={td}>{result.overview.visualGenes[row.key]}</td></tr>)}</tbody>
          </ScrollTable>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className={`${card} p-4 sm:p-5`}>
            <h3 className="mb-3 text-sm font-medium text-white/70">反复出现的画面元素</h3>
            <ul className="flex flex-wrap gap-2">{result.overview.recurringElements.map((item, i) => <li key={i} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/85">{item}</li>)}</ul>
          </div>
          <div className={`${card} p-4 sm:p-5`}>
            <h3 className="mb-3 text-sm font-medium text-white/70">复刻时要保留的要点</h3>
            <ul className="space-y-2">{result.overview.mustKeep.map((item, i) => <li key={i} className="flex gap-2 text-sm leading-6 text-white/85"><Check className="mt-1 h-4 w-4 shrink-0 text-emerald-300" />{item}</li>)}</ul>
          </div>
        </div>
        <div className={result.overview.craft ? "grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" : ""}>
          <ShotLengthBars result={result} />
          <CraftBlock result={result} />
        </div>
        <SoundBlock result={result} />
        <KeyMomentsBlock result={result} frameUrls={keyMomentFrameUrls} onSeek={sourceUrl ? seekSource : undefined} />
      </section>

      <section className="space-y-4">
        <SectionTitle icon={<Music className="h-5 w-5 text-violet-300" />}>配乐提示词</SectionTitle>
        <div className={`${card} p-4 sm:p-5`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs text-white/50">按各段叙事意图、节奏与情绪和片长生成的纯器乐配乐要求；整片送入画布时会一并放进配乐方块。</p>
            <button type="button" onClick={() => void onCopy(bgmPrompt, "配乐提示词")} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 px-3 py-1 text-xs text-white/80 hover:border-violet-300/60 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300">
              <ClipboardCopy className="h-3.5 w-3.5" />复制
            </button>
          </div>
          <pre data-bgm-prompt className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-sans text-[13px] leading-6 text-white/80">{bgmPrompt}</pre>
        </div>
      </section>

      <section className="space-y-4">
        <SectionTitle icon={<Clapperboard className="h-5 w-5 text-violet-300" />}>逐段镜头拆解</SectionTitle>
        {result.segments.map(segment => <SegmentCard key={segment.index} segment={segment} clipUrl={clipUrls?.[segment.index]} sourceUrl={sourceUrl} focus={focus} onCopy={onCopy} onSendToCanvas={onSendToCanvas} />)}
      </section>
    </div>
  );
}

export function VideoBreakdownFailed({ error, onRetry }: { error?: string; onRetry: () => void }) {
  return (
    <div role="alert" data-lapian-failed className={`${card} flex flex-col items-center gap-4 px-6 py-10 text-center`}>
      <AlertTriangle className="h-8 w-8 text-amber-300" />
      <div>
        <p className="text-base font-semibold text-white">这次拉片没有完成</p>
        <p className="mt-2 max-w-md text-sm leading-6 text-white/60">{error?.trim() || "处理过程中出了点问题，请稍后重新拉片。"}</p>
      </div>
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300">
        <RotateCcw className="h-4 w-4" />重新拉片
      </button>
    </div>
  );
}

export function VideoBreakdownIntro() {
  return (
    <div data-lapian-intro className="space-y-3 text-sm leading-7 text-white/65">
      <p><strong className="text-white">拉一支片</strong>，逐段拆开它的美术、光色、景别、运镜与节奏。拆完有两种用法：<strong className="text-white">直接复刻</strong>这支片，或<strong className="text-white">套用它的拍法</strong>，换上你自己的主体和场景，做一支新的短视频。</p>
      <ul className="grid gap-2 sm:grid-cols-3">
        {[
          ["拆解", "爆款原因与开头钩子、全片视觉基因、逐段镜头与口播台词，每段可回放"],
          ["直接复刻", "每段按秒锁定的复刻提示词＋参考片段＋配乐，一键送入画布逐段生成"],
          ["套用拍法做新片", "保留分段、镜头节奏、运镜与光色，主体和场景换成你的"],
        ].map(([title, desc]) => (
          <li key={title} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5"><span className="block font-medium text-white/90">{title}</span><span className="text-xs text-white/50">{desc}</span></li>
        ))}
      </ul>
    </div>
  );
}
