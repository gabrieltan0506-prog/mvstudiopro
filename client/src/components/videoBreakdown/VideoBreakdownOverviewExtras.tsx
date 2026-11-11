/**
 * 全片拆解的可选块（借鉴模板学习的逐帧审片手记）：镜长分布、手法与节奏情绪、风格判词、声音拆解、重点时刻。
 * 可选字段缺失时整块不渲染（返回 null），不留空壳。纯展示。
 */
// 单测在 node 环境走经典 JSX 转换，需要 React 在作用域内。
import React from "react";
import { VIDEO_BREAKDOWN_KEY_MOMENT_LABELS, videoBreakdownShotLengthDistribution, type VideoBreakdown } from "@shared/videoBreakdown";
import { gcsTransferUrl } from "@/lib/gcsTransfer";
import { formatClock, sortedKeyMoments, splitArrowStages, viralStrategyRows } from "@/lib/videoBreakdownView";

const card = "rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5";
const h3 = "mb-3 text-sm font-medium text-white/70";

export function ShotLengthBars({ result }: { result: VideoBreakdown }) {
  const rows = videoBreakdownShotLengthDistribution(result);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (!total) return null;
  const max = Math.max(...rows.map(row => row.count));
  return (
    <div data-lapian-shot-lengths className={card}>
      <h3 className={h3}>镜长分布 <span className="ml-1 text-xs text-white/40">共 {total} 镜</span></h3>
      <ul className="space-y-1.5">
        {rows.map(row => (
          <li key={row.label} className="grid grid-cols-[4rem_minmax(0,1fr)_2rem] items-center gap-2 text-xs">
            <span className="font-mono text-white/55">{row.label}</span>
            <span className="h-3 overflow-hidden rounded-full bg-white/5" aria-hidden="true">
              <span className="block h-full rounded-full bg-violet-400/70" style={{ width: `${max ? (row.count / max) * 100 : 0}%` }} />
            </span>
            <span data-count={row.count} className="text-right font-mono text-white/70">{row.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Steps({ label, text }: { label: string; text: string }) {
  const stages = splitArrowStages(text);
  return (
    <div>
      <h3 className={h3}>{label}</h3>
      {stages.length > 1 ? (
        <ol className="flex flex-wrap items-center gap-1.5 text-sm" aria-label={label}>
          {stages.map((stage, i) => (
            <li key={i} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden="true" className="text-white/30">→</span>}
              <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-white/85">{stage}</span>
            </li>
          ))}
        </ol>
      ) : <p className="text-sm leading-6 text-white/85">{text}</p>}
    </div>
  );
}

export function CraftBlock({ result }: { result: VideoBreakdown }) {
  const craft = result.overview.craft;
  if (!craft) return null;
  return (
    <div data-lapian-craft className={`${card} space-y-5`}>
      <div>
        <h3 className={h3}>可复用手法</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-white/85">{craft.reusableTechniques.map((item, i) => <li key={i}>{item}</li>)}</ul>
      </div>
      <Steps label="节奏结构" text={craft.rhythmStructure} />
      <Steps label="情绪推进" text={craft.emotionArc} />
      <div>
        <h3 className={h3}>风格判词</h3>
        <ul className="flex flex-wrap gap-1.5">{craft.styleTags.map((tag, i) => <li key={i} className="rounded-full border border-violet-300/30 bg-violet-500/10 px-2.5 py-0.5 text-xs text-violet-100">{tag}</li>)}</ul>
      </div>
    </div>
  );
}

/**
 * 爆款策略（1111，原「爆款复刻」的内容策略分析并入拉片）：同一次看片顺带产出，不另计价；字段缺失整块不渲染。
 * 「口播 / 文案结构」带箭头时按阶段展示。
 */
export function ViralStrategyBlock({ result }: { result: VideoBreakdown }) {
  const rows = viralStrategyRows(result);
  if (!rows.length) return null;
  const titles = result.overview.viralStrategy?.titleIdeas || [];
  return (
    <div data-lapian-viral-strategy className={`${card} space-y-4 border-amber-300/25 bg-amber-400/[0.05]`}>
      {rows.map(row => row.label === "口播 / 文案结构"
        ? <Steps key={row.label} label={row.label} text={row.value} />
        : (
          <div key={row.label}>
            <h3 className={h3}>{row.label}</h3>
            <p className="text-sm leading-6 text-white/85">{row.value}</p>
          </div>
        ))}
      {titles.length > 0 && (
        <div>
          <h3 className={h3}>标题参考</h3>
          <ul className="space-y-1 text-sm leading-6 text-white/85">{titles.map((title, i) => <li key={i} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5">{title}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

export const SOUND_ROWS = [
  { key: "rhythm", label: "声音节奏" },
  { key: "mix", label: "混音" },
  { key: "reusableTechniques", label: "可复用声音手法" },
  { key: "generationElements", label: "生成声音要素" },
] as const;

export function SoundBlock({ result }: { result: VideoBreakdown }) {
  const sound = result.overview.sound;
  if (!sound) return null;
  return (
    <div data-lapian-sound className={card}>
      <h3 className={h3}>声音拆解</h3>
      <div className="-mx-1 overflow-x-auto px-1" role="region" aria-label="声音拆解" tabIndex={0}>
        <table className="w-full min-w-[420px] border-collapse">
          <tbody>
            {SOUND_ROWS.map(row => (
              <tr key={row.key}>
                <th scope="row" className="w-32 whitespace-nowrap border-b border-white/10 px-3 py-2 text-left align-top text-xs font-medium text-white/50">{row.label}</th>
                <td className="border-b border-white/5 px-3 py-2.5 align-top text-sm leading-6 text-white/85">{sound[row.key]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function KeyMomentsBlock({ result, frameUrls, onSeek }: { result: VideoBreakdown; frameUrls?: string[]; onSeek?: (sec: number) => void }) {
  const moments = sortedKeyMoments(result, frameUrls);
  if (!moments.length) return null;
  return (
    <div data-lapian-key-moments className={card}>
      <h3 className={h3}>重点时刻</h3>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {moments.map(moment => {
          const body = (
            <>
              {moment.frameUrl ? <img src={gcsTransferUrl(moment.frameUrl)} alt={`${formatClock(moment.atSec)} ${moment.note}`} loading="lazy" className="aspect-video w-full rounded-lg bg-black object-cover" /> : null}
              <span className="mt-2 flex items-center gap-2">
                <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[11px] text-violet-100">{VIDEO_BREAKDOWN_KEY_MOMENT_LABELS[moment.type]}</span>
                <span className="font-mono text-[11px] text-white/50">{formatClock(moment.atSec)}</span>
              </span>
              <span className="mt-1 block text-xs leading-5 text-white/80">{moment.note}</span>
            </>
          );
          return (
            <li key={`${moment.atSec}-${moment.originalIndex}`} data-key-moment={moment.atSec}>
              {onSeek
                ? <button type="button" onClick={() => onSeek(moment.atSec)} className="block w-full rounded-xl border border-white/10 p-2 text-left hover:border-violet-300/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300">{body}</button>
                : <div className="rounded-xl border border-white/10 p-2">{body}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
