/**
 * 模板学习 · 拉片式视图（站长专用，挂在正式模板详情抽屉里）。
 * 三个区块：镜头构造（逐镜全量，按段展开）、复刻提示词（点开某段才生成并缓存）、视觉基因（一次汇总）。
 * 镜头构造表与分段由 shared 纯函数在前端从已加载的卡上算，和服务端同一份函数，不另走接口。
 */
import { useEffect, useMemo, useState } from "react";
import type { ManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";
import {
  buildManhuaTemplateShotTable,
  formatManhuaTemplateShotTableTsv,
  MANHUA_TEMPLATE_LAPIAN_GENE_LABELS,
  planManhuaTemplateLapianSegments,
  summarizeManhuaTemplateVisualStats,
  type ManhuaTemplateLapianCount,
} from "@shared/manhuaTemplateLapianView";
import { trpc } from "@/lib/trpc";
import { copyTextWithToast } from "@/lib/copyText";

const clock = (sec: number) => `${Math.floor(sec / 60).toString().padStart(2, "0")}:${(sec % 60).toFixed(1).padStart(4, "0")}`;
const errText = (e: unknown) => (e instanceof Error ? e.message : "请求失败");

function CopyButton({ text, label = "复制" }: { text: string; label?: string }) {
  return (
    <button
      type="button"
      disabled={!text}
      onClick={() => void copyTextWithToast(text)}
      className="rounded border border-cyan-300/30 px-2 py-0.5 text-[10px] text-cyan-100 hover:bg-cyan-400/10 disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function Counts({ title, rows, missing }: { title: string; rows: ManhuaTemplateLapianCount[]; missing: number }) {
  return (
    <div className="text-[11px] leading-5 text-white/70">
      <span className="text-white/45">{title}：</span>
      {rows.map(r => `${r.valueZh} ${r.count}`).join(" · ") || "—"}
      {missing ? <span className="text-white/35">（未记录 {missing}）</span> : null}
    </div>
  );
}

function SegmentBody({ templateId, segmentIndex, rows }: {
  templateId: string;
  segmentIndex: number;
  rows: ReturnType<typeof buildManhuaTemplateShotTable>;
}) {
  const prompt = trpc.manhuaTemplateLapian.segmentPrompt.useMutation();
  const clip = trpc.manhuaTemplateLapian.segmentClip.useMutation();
  // 点开某段才生成（已缓存直接返回，不重复调用模型）
  useEffect(() => {
    prompt.mutate({ templateId, segmentIndex, generate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, segmentIndex]);
  const tsv = formatManhuaTemplateShotTableTsv(rows);
  return (
    <div className="mt-2 space-y-3">
      <div>
        <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold text-cyan-100">
          镜头构造 · {rows.length} 镜 <CopyButton text={tsv} label="复制本段镜头表" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[11px] leading-5 text-white/75">
            <thead>
              <tr className="text-left text-white/45">
                <th className="w-28 border-b border-white/10 py-1 pr-2">时间</th>
                <th className="w-20 border-b border-white/10 py-1 pr-2">画面景别</th>
                <th className="w-48 border-b border-white/10 py-1 pr-2">摄影机</th>
                <th className="border-b border-white/10 py-1">调度 · 构图与焦点</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.index} className="align-top">
                  <td className="border-b border-white/5 py-1 pr-2 font-mono text-white/55">
                    {clock(r.startSec)}{r.endSec != null ? `–${clock(r.endSec)}` : ""}
                    {r.transitionIn ? <div className="text-[10px] text-white/35">{r.transitionIn}</div> : null}
                  </td>
                  <td className="border-b border-white/5 py-1 pr-2">{r.framing}</td>
                  <td className="border-b border-white/5 py-1 pr-2">{r.camera}</td>
                  <td className="border-b border-white/5 py-1">{r.blockingAndFocus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold text-amber-100">
          复刻提示词（竖屏漫剧）
          {prompt.data?.text ? <CopyButton text={prompt.data.text} label="一键复制" /> : null}
        </div>
        {prompt.isPending ? <p className="text-[11px] text-white/45">正在生成本段复刻提示词…</p>
          : prompt.error ? (
            <p className="text-[11px] text-rose-200">
              {errText(prompt.error)}{" "}
              <button type="button" className="underline" onClick={() => prompt.mutate({ templateId, segmentIndex, generate: true })}>重试</button>
            </p>
          ) : prompt.data?.text ? (
            <>
              {prompt.data.title ? <div className="mb-1 text-[11px] text-amber-50">{prompt.data.title}</div> : null}
              <pre className="whitespace-pre-wrap rounded border border-amber-300/20 bg-black/30 p-2 text-[11px] leading-5 text-white/80">{prompt.data.text}</pre>
            </>
          ) : null}
      </div>

      <div>
        <div className="mb-1 text-[11px] font-semibold text-emerald-100">可播放片段</div>
        {clip.data?.available ? (
          <video src={clip.data.url} controls preload="metadata" className="max-h-72 rounded border border-white/10" />
        ) : clip.data && !clip.data.available ? (
          <p className="text-[11px] text-white/55">{clip.data.reasonZh}</p>
        ) : clip.error ? (
          <p className="text-[11px] text-rose-200">{errText(clip.error)}</p>
        ) : (
          <button
            type="button"
            disabled={clip.isPending}
            onClick={() => clip.mutate({ templateId, segmentIndex })}
            className="rounded border border-emerald-300/30 px-2 py-1 text-[11px] text-emerald-100 hover:bg-emerald-400/10 disabled:opacity-40"
          >
            {clip.isPending ? "正在裁切…" : "载入本段片段"}
          </button>
        )}
      </div>
    </div>
  );
}

export function ManhuaTemplateLapianPanel({ card }: { card: ManhuaViralTemplateCard }) {
  const rows = useMemo(() => buildManhuaTemplateShotTable(card), [card]);
  const segments = useMemo(() => planManhuaTemplateLapianSegments(card), [card]);
  const stats = useMemo(() => summarizeManhuaTemplateVisualStats(card), [card]);
  const [open, setOpen] = useState<number | null>(null);
  const genes = trpc.manhuaTemplateLapian.genes.useMutation();
  useEffect(() => {
    genes.mutate({ templateId: card.id, generate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);
  if (!rows.length) return null;
  const allTsv = formatManhuaTemplateShotTableTsv(rows);
  const g = genes.data?.genes;
  return (
    <section className="mb-5 space-y-4 rounded-xl border border-amber-300/20 bg-amber-400/[0.03] p-3" aria-label="拉片式视图">
      <div className="text-xs font-semibold text-amber-50">拉片式视图 · 漫剧创作参考</div>

      <div>
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-cyan-50">
          镜头构造 · 全片 {rows.length} 镜 · {segments.length} 段
          <CopyButton text={allTsv} label="复制全片镜头表" />
        </div>
        <p className="mb-2 text-[10px] text-white/40">逐镜全量（不抽样）；展开某段查看镜头表、生成该段复刻提示词与片段。「—」表示学习时该镜未记录此项。</p>
        <div className="space-y-1">
          {segments.map(s => {
            const segRows = s.shotIndexes.map(i => rows[i]!);
            const isOpen = open === s.index;
            return (
              <div key={s.index} className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
                <button
                  type="button"
                  className="flex w-full items-center justify-between text-left text-[11px] text-white/80"
                  onClick={() => setOpen(isOpen ? null : s.index)}
                  aria-expanded={isOpen}
                >
                  <span>第 {s.index + 1} 段 · {clock(s.startSec)}–{clock(s.endSec)} · {segRows.length} 镜</span>
                  <span className="text-white/40">{isOpen ? "收起" : "展开"}</span>
                </button>
                {isOpen ? (
                  segRows.length
                    ? <SegmentBody templateId={card.id} segmentIndex={s.index} rows={segRows} />
                    : <p className="mt-1 text-[11px] text-white/45">本段没有剧情镜头（可能是已剔除的广告区间）。</p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-violet-100">
          视觉基因
          {genes.data?.text ? <CopyButton text={genes.data.text} label="一键复制" /> : null}
        </div>
        <div className="mb-2 space-y-0.5 rounded border border-white/10 bg-black/20 p-2">
          <Counts title="景别" rows={stats.framing} missing={stats.missing.framing} />
          <Counts title="机位" rows={stats.angle} missing={stats.missing.angle} />
          <Counts title="运镜" rows={stats.cameraMove} missing={stats.missing.cameraMove} />
          <Counts title="转场" rows={stats.transitionIn} missing={stats.missing.transitionIn} />
        </div>
        {g ? (
          <div className="space-y-1.5 text-[11px] leading-5 text-white/80">
            {MANHUA_TEMPLATE_LAPIAN_GENE_LABELS.map(([key, label]) => (
              <div key={key}><span className="text-violet-100">{label}：</span>{g.visualGenes[key]}</div>
            ))}
            <div><span className="text-violet-100">反复出现的元素：</span>{g.recurringElements.join("；")}</div>
            <div>
              <span className="text-violet-100">复刻时要保留的要点：</span>
              <ol className="ml-4 list-decimal">{g.mustKeep.map((m, i) => <li key={i}>{m}</li>)}</ol>
            </div>
          </div>
        ) : genes.isPending ? (
          <p className="text-[11px] text-white/45">{genes.variables?.generate ? "正在汇总全片视觉基因…" : "读取中…"}</p>
        ) : (
          <div className="text-[11px] text-white/55">
            {genes.error ? <span className="text-rose-200">{errText(genes.error)} </span> : null}
            <button
              type="button"
              onClick={() => genes.mutate({ templateId: card.id, generate: true })}
              className="rounded border border-violet-300/30 px-2 py-1 text-violet-100 hover:bg-violet-400/10"
            >
              汇总视觉基因（读全片证据，一次文字模型调用）
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
