/**
 * 剪辑阶段 · 多轨：细剪 / 字幕 / 包装 / 质检返工 / 导出勾选。
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { copyText } from "@/lib/copyText";
import {
  AlertTriangle,
  CheckCircle2,
  Flame,
  Package,
  RefreshCw,
  Scissors,
  ShieldCheck,
  Sparkles,
  Subtitles,
} from "lucide-react";
import {
  buildManhuaEditMultitrack,
  type ManhuaEditTrack,
} from "@shared/manhuaEditMultitrack";
import type { ManhuaRoughCutClip } from "@shared/manhuaEditWorkflowBank";
import type { ManhuaWorkbenchShot } from "@shared/manhuaScriptWorkbench";
import { listRoughTimelineStages } from "@shared/manhuaEditWorkflowBank";
import {
  clampFineCut,
  defaultFineCut,
  type ManhuaFineCutByShot,
  type ManhuaFineCutTrim,
} from "@shared/manhuaEditFineCut";
import {
  buildManhuaSubtitleBurnSrt,
  buildManhuaSubtitleCues,
  formatManhuaSubtitleSrt,
} from "@shared/manhuaEditSubtitle";
import {
  MANHUA_EDIT_QC_ROWS,
  buildManhuaEditShotQcBoard,
  manhuaEditExportableClipIds,
  manhuaEditQcSuggestsReworkStill,
  summarizeManhuaEditQcBoard,
  type ManhuaEditShotMedia,
} from "@shared/manhuaEditQcExport";
import type { ManhuaDeliveryPackage } from "@shared/manhuaDeliveryPackage";
import type { ManhuaCineVocabLocale } from "@shared/manhuaCineVocabBank";
import type { ManhuaRetakeVariable } from "@shared/manhuaDirectingWorkflow";
import {
  formatManhuaRetakeHintZh,
  suggestManhuaRetakeVariable,
  MANHUA_RETAKE_VARIABLE_LABEL_ZH,
} from "@shared/manhuaDirectingWorkflow";
import ManhuaDeliveryEditSection from "@/components/ManhuaDeliveryEditSection";

type Props = {
  roughClips: ManhuaRoughCutClip[];
  shots: ManhuaWorkbenchShot[];
  stillIndexes: Set<number>;
  clipIndexes: Set<number>;
  activeShotIndex?: number;
  onSelectShot?: (shotIndex: number) => void;
  onReorder?: (orderedShotIndexes: number[]) => void;
  fineCutByShot: ManhuaFineCutByShot;
  onFineCutChange: (shotIndex: number, trim: ManhuaFineCutTrim) => void;
  /** 一键气口建议切点（本集有成片的镜） */
  onSuggestAutoCuts?: () => void | Promise<void>;
  suggestAutoCutsBusy?: boolean;
  subtitleEnabled?: boolean;
  onSubtitleEnabledChange?: (next: boolean) => void;
  /**
   * 烧字进片:父级把 SRT 送进后期工坊同款任务提交通道
   * (queuePostProd action=burn_subtitle,与 bgm_mount/concat 一个口)。
   * 未接线时按钮按反空壳约定灰禁用,不冒充可用。
   */
  onBurnSubtitle?: (subtitleSrt: string) => void | Promise<void>;
  finalSubtitleTimeline?: import("@shared/manhuaRenderedSubtitle").ManhuaRenderedSubtitle;
  burnSubtitleBusy?: boolean;
  /** 最近一次烧字成片读链(父级从任务产出回填);有值即展示新视频入口 */
  burnSubtitleResultUrl?: string | null;
  burnSubtitleRecoveryError?: string | null;
  finalVideoVersions?: { activeUrl?: string; urls: string[] };
  onSelectFinalVideoVersion?: (url: string) => void;
  /** 本集各镜成片/静帧质检原料 */
  shotMedia: ManhuaEditShotMedia[];
  factoryBusy?: boolean;
  dockSelectedIds?: Set<string>;
  onToggleDockClip?: (clipBlockId: string, selected: boolean) => void;
  onSelectExportableClips?: (clipBlockIds: string[]) => void;
  onReworkClip?: (shotIndex: number) => void;
  /** 批量返工未过/缺片镜 */
  onReworkFailedClips?: (shotIndexes: number[]) => void;
  onReworkStill?: (shotIndex: number) => void;
  onAcceptDespiteQc?: (clipBlockId: string) => void;
  /** 质检失败：单变量轻量重拍（真返工） */
  onRetakeClip?: (clipBlockId: string, variable: ManhuaRetakeVariable) => void;
  /** Seedance 2.5 局部视频编辑；原片必须保留为可回退版本。 */
  onVideoEditClip?: (clipBlockId: string, instructionZh: string) => void;
  clipVersionsByBlockId?: Record<string, { activeUrl?: string; urls: string[] }>;
  onSelectClipVersion?: (clipBlockId: string, url: string) => void;
  onOpenClipDock?: () => void;
  deliveryPackage?: ManhuaDeliveryPackage | null;
  onDeliveryPackageChange?: (next: ManhuaDeliveryPackage) => void;
  cineVocabLocale?: ManhuaCineVocabLocale;
  onCineVocabLocaleChange?: (locale: ManhuaCineVocabLocale) => void;
};

function TrackRow({
  track,
  activeShotIndex,
  onSelectShot,
}: {
  track: ManhuaEditTrack;
  activeShotIndex?: number;
  onSelectShot?: (shotIndex: number) => void;
}) {
  return (
    <div className="flex gap-2" data-manhua-edit-track={track.kind}>
      <div className="w-16 shrink-0 pt-1">
        <div className="text-[10px] font-semibold text-white/75">{track.nameZh}</div>
        <div className="mt-0.5 text-[8px] leading-snug text-white/35">{track.hintZh}</div>
      </div>
      <div className="relative min-h-[36px] flex-1 overflow-hidden rounded-md border border-white/10 bg-black/50">
        {track.segments.map((seg) => {
          const on = seg.shotIndex === activeShotIndex;
          return (
            <button
              key={`${track.kind}-${seg.shotIndex}-${seg.order}`}
              type="button"
              title={`${seg.labelZh} · ${seg.durationSec}s`}
              onClick={() => onSelectShot?.(seg.shotIndex)}
              style={{
                left: `${seg.startRatio * 100}%`,
                width: `${seg.widthRatio * 100}%`,
              }}
              className={`absolute top-1 bottom-1 overflow-hidden rounded border px-1 text-left ${
                on
                  ? "border-violet-400/55 bg-violet-500/25"
                  : seg.hasMedia
                    ? "border-cyan-400/30 bg-cyan-500/15"
                    : "border-white/10 bg-white/[0.04]"
              }`}
            >
              <div className="truncate text-[9px] font-medium text-white/85">{seg.labelZh}</div>
              <div className="text-[8px] text-white/40">{seg.durationSec}s</div>
            </button>
          );
        })}
        {!track.segments.length ? (
          <div className="flex h-9 items-center px-2 text-[10px] text-white/30">暂无片段</div>
        ) : null}
      </div>
    </div>
  );
}

export default function ManhuaEditMultitrackPanel({
  roughClips,
  shots,
  stillIndexes,
  clipIndexes,
  activeShotIndex,
  onSelectShot,
  onReorder,
  fineCutByShot,
  onFineCutChange,
  onSuggestAutoCuts,
  suggestAutoCutsBusy = false,
  subtitleEnabled = false,
  onSubtitleEnabledChange,
  onBurnSubtitle,
  finalSubtitleTimeline,
  burnSubtitleBusy = false,
  burnSubtitleResultUrl,
  burnSubtitleRecoveryError,
  finalVideoVersions,
  onSelectFinalVideoVersion,
  shotMedia,
  factoryBusy,
  dockSelectedIds,
  onToggleDockClip,
  onSelectExportableClips,
  onReworkClip,
  onReworkFailedClips,
  onReworkStill,
  onAcceptDespiteQc,
  onRetakeClip,
  onVideoEditClip,
  clipVersionsByBlockId,
  onSelectClipVersion,
  onOpenClipDock,
  deliveryPackage,
  onDeliveryPackageChange,
  cineVocabLocale,
  onCineVocabLocaleChange,
}: Props) {
  const { totalSec, tracks } = buildManhuaEditMultitrack({
    roughClips,
    shots,
    stillIndexes,
    clipIndexes,
    fineCutByShot,
    subtitleEnabled,
  });
  const stages = listRoughTimelineStages();
  const plannedCues = useMemo(
    () =>
      buildManhuaSubtitleCues({
        roughClips,
        shots,
        fineCutByShot,
        enabled: subtitleEnabled,
      }),
    [roughClips, shots, fineCutByShot, subtitleEnabled],
  );
  const cues = finalSubtitleTimeline?.cues || plannedCues;
  const burnCues = finalSubtitleTimeline?.cues || [];
  const srtPreview = useMemo(() => formatManhuaSubtitleSrt(finalSubtitleTimeline?.cues || cues), [finalSubtitleTimeline, cues]);
  // 烧字要整片重编码,单独一道确认开关;提交前随时可关,不跟「字幕轨」开关混用
  const burnConsentKey = JSON.stringify([finalVideoVersions?.activeUrl, finalSubtitleTimeline]);
  const [burnConfirmedKey, setBurnConfirmedKey] = useState<string | null>(null);
  const burnArmed = burnConfirmedKey === burnConsentKey;
  const [videoEditInstruction, setVideoEditInstruction] = useState("");
  const submitBurn = () => {
    if (!onBurnSubtitle || burnSubtitleBusy) return;
    try {
      // 空轨/坏时间码在这里就报错,不入队白跑一轮转码
      if (!finalSubtitleTimeline) throw new Error("当前成片缺少字幕时间表，请重新合成后再烧字；原片保留");
      const srt = buildManhuaSubtitleBurnSrt(burnCues);
      void onBurnSubtitle(srt);
    } catch (e) {
      toast.error("无法生成烧字字幕", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };
  const qcRows = useMemo(() => buildManhuaEditShotQcBoard(shotMedia), [shotMedia]);
  const qcSummary = useMemo(() => summarizeManhuaEditQcBoard(qcRows), [qcRows]);
  const exportableIds = useMemo(() => manhuaEditExportableClipIds(qcRows), [qcRows]);
  const activeQc = qcRows.find((r) => r.shotIndex === activeShotIndex);
  const activeVersions = activeQc?.clipBlockId
    ? clipVersionsByBlockId?.[activeQc.clipBlockId]
    : undefined;

  const activeClip = roughClips.find((c) => c.shotIndex === activeShotIndex);
  const activeTrim = activeClip
    ? clampFineCut(
        activeClip.durationSec,
        fineCutByShot[activeClip.shotIndex] ?? defaultFineCut(activeClip.durationSec),
      )
    : null;

  const nudgeTrim = (field: "inSec" | "outSec", delta: number) => {
    if (!activeClip || !activeTrim) return;
    onFineCutChange(
      activeClip.shotIndex,
      clampFineCut(activeClip.durationSec, {
        ...activeTrim,
        [field]: activeTrim[field] + delta,
      }),
    );
  };

  const resetTrim = () => {
    if (!activeClip) return;
    onFineCutChange(activeClip.shotIndex, defaultFineCut(activeClip.durationSec));
  };

  const move = (from: number, dir: -1 | 1) => {
    const to = from + dir;
    if (to < 0 || to >= roughClips.length) return;
    const next = roughClips.map((c) => c.shotIndex);
    const tmp = next[from]!;
    next[from] = next[to]!;
    next[to] = tmp;
    onReorder?.(next);
  };

  return (
    <section
      data-manhua-panel="edit-multitrack"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-white/90">
            <Scissors className="h-4 w-4 text-violet-200" />
            剪辑台
            <span className="text-[11px] font-normal text-white/40">
              约 {totalSec}s · 粗剪序 + 细剪
            </span>
          </div>
          <p className="mt-1 max-w-xl text-[10px] leading-relaxed text-white/40">
            多轨预览：静帧 / 成片 / 对白 / 字幕。可调进出点；字幕默认只生成轨数据，
            勾选下方「烧字进片」提交后才真正烧进成片。
            建议切点：气口 + 导戏秒轴对齐，写入成片后合成会真裁切。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {onSuggestAutoCuts ? (
            <button
              type="button"
              disabled={suggestAutoCutsBusy || factoryBusy}
              onClick={() => void onSuggestAutoCuts()}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-400/35 bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-50/95 hover:bg-emerald-500/25 disabled:opacity-40"
              title="分析成片气口，自动建议各镜进出点"
            >
              <Sparkles className="h-3 w-3" />
              {suggestAutoCutsBusy ? "分析气口…" : "建议切点"}
            </button>
          ) : null}
          {stages.map((s) => (
            <span
              key={s.id}
              className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[8px] text-white/45"
              title={s.jobZh}
            >
              {s.nameZh}
            </span>
          ))}
          <label className="ml-1 inline-flex items-center gap-1 rounded border border-white/10 bg-black/40 px-2 py-1 text-[9px] text-white/55">
            <input
              type="checkbox"
              checked={subtitleEnabled}
              onChange={(e) => onSubtitleEnabledChange?.(e.target.checked)}
              className="accent-violet-400"
            />
            <Subtitles className="h-3 w-3" />
            字幕轨
          </label>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-white/10 bg-black/35 p-2.5">
        {tracks.map((t) => (
          <TrackRow
            key={t.kind}
            track={t}
            activeShotIndex={activeShotIndex}
            onSelectShot={onSelectShot}
          />
        ))}
        <div className="relative mt-1 h-3 border-t border-dashed border-white/15">
          <div
            className="absolute top-0 bottom-0 w-px bg-rose-400/80"
            style={{ left: "0%" }}
            title="播放头"
          />
          <div className="absolute inset-x-0 top-0.5 flex justify-between px-0.5 text-[8px] text-white/30">
            <span>0s</span>
            <span>{Math.round(totalSec / 2)}s</span>
            <span>{totalSec}s</span>
          </div>
        </div>
      </div>

      {/* 细剪 */}
      <div
        data-manhua-edit-section="fine-cut"
        className="rounded-lg border border-violet-400/20 bg-violet-500/[0.06] p-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] font-semibold text-violet-100/90">细剪 · 进出点</div>
          {onSuggestAutoCuts ? (
            <button
              type="button"
              disabled={suggestAutoCutsBusy || factoryBusy}
              onClick={() => void onSuggestAutoCuts()}
              className="text-[9px] text-emerald-200/80 underline-offset-2 hover:underline disabled:opacity-40"
            >
              {suggestAutoCutsBusy ? "正在按气口分析…" : "按气口重算建议"}
            </button>
          ) : null}
        </div>
        {activeClip && activeTrim ? (
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <div>
              <div className="text-[9px] text-white/40">
                镜 {String(activeClip.shotIndex).padStart(2, "0")} · 源长{" "}
                {activeClip.durationSec}s
              </div>
              <div className="mt-1 flex items-center gap-2">
                <label className="flex items-center gap-1 text-[10px] text-white/70">
                  入点
                  <button
                    type="button"
                    className="rounded border border-white/15 px-1.5 py-0.5 text-white/50 hover:bg-white/10"
                    onClick={() => nudgeTrim("inSec", -0.5)}
                  >
                    −
                  </button>
                  <span className="min-w-[2.5rem] text-center font-mono text-white/90">
                    {activeTrim.inSec}
                  </span>
                  <button
                    type="button"
                    className="rounded border border-white/15 px-1.5 py-0.5 text-white/50 hover:bg-white/10"
                    onClick={() => nudgeTrim("inSec", 0.5)}
                  >
                    +
                  </button>
                </label>
                <label className="flex items-center gap-1 text-[10px] text-white/70">
                  出点
                  <button
                    type="button"
                    className="rounded border border-white/15 px-1.5 py-0.5 text-white/50 hover:bg-white/10"
                    onClick={() => nudgeTrim("outSec", -0.5)}
                  >
                    −
                  </button>
                  <span className="min-w-[2.5rem] text-center font-mono text-white/90">
                    {activeTrim.outSec}
                  </span>
                  <button
                    type="button"
                    className="rounded border border-white/15 px-1.5 py-0.5 text-white/50 hover:bg-white/10"
                    onClick={() => nudgeTrim("outSec", 0.5)}
                  >
                    +
                  </button>
                </label>
                <span className="text-[9px] text-cyan-200/70">
                  有效 {(activeTrim.outSec - activeTrim.inSec).toFixed(1)}s
                </span>
                <button
                  type="button"
                  onClick={resetTrim}
                  className="text-[9px] text-white/40 underline-offset-2 hover:underline"
                >
                  重置
                </button>
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-[10px] text-white/35">点选时间线上的片段以调节进出点</p>
        )}
      </div>

      {/* 字幕轨数据 */}
      {subtitleEnabled ? (
        <div
          data-manhua-edit-section="subtitle"
          className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold text-white/70">
              {finalSubtitleTimeline ? "当前成片字幕" : "计划字幕预览"} · {cues.length} 条（默认不烧）
            </div>
            {srtPreview ? (
              <button
                type="button"
                className="text-[9px] text-cyan-200/80 underline-offset-2 hover:underline"
                onClick={() => {
                  void copyText(srtPreview).then((ok) => {
                    if (ok) toast.success("已复制 SRT");
                    else toast.error("复制没成功", { description: "请手动选中下方字幕文本复制。" });
                  });
                }}
              >
                复制 SRT
              </button>
            ) : null}
          </div>
          {cues.length ? (
            <ul className="mt-1.5 max-h-28 space-y-1 overflow-y-auto">
              {cues.map((c) => (
                <li
                  key={`cue-${c.shotIndex}-${c.order}`}
                  className="truncate text-[10px] text-white/55"
                >
                  <span className="font-mono text-white/35">
                    {c.startSec}–{c.endSec}s
                  </span>{" "}
                  镜{c.shotIndex} 「{c.textZh}」
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[10px] text-white/35">当前粗剪序无对白可铺字幕</p>
          )}

          {/* 烧字进片:与 bgm_mount/concat 同一条后期任务通道(父级接线) */}
          <div
            data-manhua-edit-section="subtitle-burn"
            className="mt-2 rounded-md border border-amber-400/25 bg-amber-500/[0.05] p-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-1.5 text-[10px] text-amber-50/90">
                <input
                  type="checkbox"
                  checked={burnArmed}
                  onChange={(e) => setBurnConfirmedKey(e.target.checked ? burnConsentKey : null)}
                  className="accent-amber-400"
                />
                <Flame className="h-3 w-3 text-amber-200/90" />
                已核对对白与成片一致，烧字进片
                <span className="text-[9px] font-normal text-white/40">
                  使用该版合成时冻结的 {burnCues.length} 条对白（按实际镜窗对齐，未经语音识别；原片保留）
                </span>
              </label>
              <button
                type="button"
                data-manhua-action="burn-subtitle"
                disabled={
                  !onBurnSubtitle || !burnArmed || !burnCues.length || !finalSubtitleTimeline || burnSubtitleBusy || factoryBusy
                }
                onClick={submitBurn}
                className="inline-flex items-center gap-1 rounded border border-amber-400/40 bg-amber-500/20 px-2 py-0.5 text-[9px] font-semibold text-amber-50 hover:bg-amber-500/30 disabled:opacity-40"
                title={
                  !onBurnSubtitle
                    ? "先在成片坞合成本集长片，再回来烧字"
                    : !finalSubtitleTimeline
                      ? "当前版本缺少字幕时间表，请重新合成后再烧字"
                    : !burnCues.length
                      ? "当前无字幕可烧"
                      : !burnArmed
                        ? "先勾选左侧确认烧字"
                        : "提交烧字任务，产出带字幕的新成片"
                }
              >
                <Flame className="h-3 w-3" />
                {burnSubtitleBusy ? "烧字处理中…" : "提交烧字任务"}
              </button>
            </div>
            {!finalSubtitleTimeline && onBurnSubtitle ? (
              <p className="mt-1 text-[10px] text-amber-100/80">当前版本没有可核对的字幕时间表，不能套用新稿字幕。重新合成后可用，原片保留。</p>
            ) : null}
            {burnSubtitleResultUrl ? (
              <a
                href={burnSubtitleResultUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-block text-[10px] text-emerald-200/90 underline-offset-2 hover:underline"
              >
                查看烧字成片（新视频）
              </a>
            ) : null}
            {burnSubtitleRecoveryError ? (
              <p className="mt-1.5 text-[9px] text-amber-100/80">
                {burnSubtitleRecoveryError}
              </p>
            ) : null}
            {finalVideoVersions && finalVideoVersions.urls.length > 1 ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[8px] text-white/35">整集成片版本</span>
                {finalVideoVersions.urls.map((url, index) => (
                  <button
                    key={url}
                    type="button"
                    disabled={factoryBusy || burnSubtitleBusy || !onSelectFinalVideoVersion}
                    onClick={() => onSelectFinalVideoVersion?.(url)}
                    className={`rounded border px-1.5 py-0.5 text-[8px] ${
                      finalVideoVersions.activeUrl === url
                        ? "border-emerald-300/40 bg-emerald-500/20 text-emerald-50"
                        : "border-white/12 bg-white/[0.04] text-white/55"
                    }`}
                  >
                    {finalVideoVersions.activeUrl === url
                      ? "当前下载版"
                      : index === 0
                        ? "字幕版"
                        : `保留版 ${index}`}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* 质检 + 返工 */}
      <div
        data-manhua-edit-section="qc"
        className={`rounded-lg border p-2.5 ${
          qcSummary.failed > 0
            ? "border-amber-400/30 bg-amber-500/[0.06]"
            : "border-emerald-400/20 bg-emerald-500/[0.05]"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-white/80">
            <ShieldCheck className="h-3.5 w-3.5 text-cyan-200/80" />
            智能质检
            <span className="font-normal text-white/40">
              过 {qcSummary.passed} · 未过 {qcSummary.failed} · 缺片 {qcSummary.missing}
              {qcSummary.accepted ? ` · 已采用 ${qcSummary.accepted}` : ""}
            </span>
          </div>
          {qcSummary.reworkIndexes.length && onReworkFailedClips ? (
            <button
              type="button"
              disabled={factoryBusy}
              data-manhua-action="rework-all-failed"
              onClick={() => onReworkFailedClips(qcSummary.reworkIndexes)}
              className="inline-flex items-center gap-1 rounded border border-amber-400/40 bg-amber-500/20 px-2 py-0.5 text-[9px] text-amber-50 disabled:opacity-45"
            >
              <RefreshCw className="h-3 w-3" />
              返工未过镜
            </button>
          ) : null}
        </div>

        {activeQc ? (
          <div className="mt-2 rounded-md border border-white/10 bg-black/30 p-2">
            <div className="flex items-center justify-between gap-2 text-[10px]">
              <span className="font-semibold text-white/75">
                镜 {String(activeQc.shotIndex).padStart(2, "0")}
              </span>
              <span className="text-[9px] text-white/40">
                {activeQc.gate === "passed"
                  ? "可进成片坞"
                  : activeQc.gate === "accepted"
                    ? "已采用（质检未过）"
                    : activeQc.gate === "failed"
                      ? "提醒·默认不进坞"
                      : activeQc.gate === "missing"
                        ? "缺成片"
                        : "等待检查"}
                {activeQc.quality?.attempts
                  ? ` · 第 ${activeQc.quality.attempts} 次`
                  : ""}
              </span>
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-1">
              {MANHUA_EDIT_QC_ROWS.map(([key, label]) => {
                const passed = activeQc.quality?.checks?.[key] === true;
                const failed = activeQc.gate === "failed" && !passed;
                return (
                  <div
                    key={key}
                    className={`flex items-center gap-1 rounded px-1.5 py-1 text-[9px] ${
                      passed
                        ? "bg-emerald-500/12 text-emerald-100"
                        : failed
                          ? "bg-amber-500/12 text-amber-50"
                          : "bg-white/[0.035] text-white/35"
                    }`}
                  >
                    {passed ? (
                      <CheckCircle2 className="h-2.5 w-2.5" />
                    ) : failed ? (
                      <AlertTriangle className="h-2.5 w-2.5" />
                    ) : (
                      <span className="h-2.5 w-2.5 rounded-full border border-white/20" />
                    )}
                    {label}
                  </div>
                );
              })}
            </div>
            {activeQc.quality?.status === "failed" && activeQc.quality.summary ? (
              <p className="mt-1.5 line-clamp-3 text-[9px] leading-relaxed text-amber-50/85">
                {activeQc.quality.summary}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {activeQc.needsRework && onReworkClip ? (
                <button
                  type="button"
                  disabled={factoryBusy}
                  data-manhua-action="rework-clip"
                  onClick={() => onReworkClip(activeQc.shotIndex)}
                  className="rounded border border-cyan-400/35 bg-cyan-500/15 px-2 py-0.5 text-[9px] text-cyan-50 disabled:opacity-45"
                >
                  重出本镜成片
                </button>
              ) : null}
              {(manhuaEditQcSuggestsReworkStill(activeQc.quality?.summary) ||
                activeQc.gate === "missing") &&
              onReworkStill ? (
                <button
                  type="button"
                  disabled={factoryBusy || !activeQc.keyartBlockId}
                  data-manhua-action="rework-still"
                  onClick={() => onReworkStill(activeQc.shotIndex)}
                  className="rounded border border-amber-400/35 bg-amber-500/15 px-2 py-0.5 text-[9px] text-amber-50 disabled:opacity-45"
                >
                  重出本镜静帧
                </button>
              ) : null}
              {activeQc.gate === "failed" &&
              activeQc.clipBlockId &&
              onRetakeClip &&
              activeQc.quality?.summary ? (
                <button
                  type="button"
                  disabled={factoryBusy}
                  data-manhua-action="retake-single-variable"
                  onClick={() => {
                    const variable = suggestManhuaRetakeVariable(activeQc.quality!.summary);
                    onRetakeClip(activeQc.clipBlockId!, variable);
                  }}
                  className="rounded border border-fuchsia-400/40 bg-fuchsia-500/15 px-2 py-0.5 text-[9px] font-semibold text-fuchsia-50 disabled:opacity-45"
                  title={formatManhuaRetakeHintZh(
                    suggestManhuaRetakeVariable(activeQc.quality.summary),
                    1,
                    3,
                  )}
                >
                  按建议只改「
                  {
                    MANHUA_RETAKE_VARIABLE_LABEL_ZH[
                      suggestManhuaRetakeVariable(activeQc.quality.summary)
                    ]
                  }
                  」重拍
                </button>
              ) : null}
              {activeQc.gate === "failed" &&
              activeQc.clipBlockId &&
              onAcceptDespiteQc &&
              !activeQc.quality?.userAcceptedDespiteQc ? (
                <button
                  type="button"
                  data-manhua-action="accept-clip-despite-qc"
                  onClick={() => onAcceptDespiteQc(activeQc.clipBlockId!)}
                  className="rounded border border-amber-400/45 bg-amber-500/20 px-2 py-0.5 text-[9px] font-semibold text-amber-50"
                >
                  仍采用此片
                </button>
              ) : null}
            </div>
            {activeQc.clipBlockId && activeQc.gate !== "missing" && onVideoEditClip ? (
              <div className="mt-2 rounded-md border border-cyan-400/20 bg-cyan-500/[0.06] p-2">
                <label className="block text-[9px] font-semibold text-cyan-50/85">
                  局部改画面 · 原片保留可切回
                </label>
                <div className="mt-1 flex gap-1.5">
                  <input
                    value={videoEditInstruction}
                    maxLength={240}
                    onChange={(e) => setVideoEditInstruction(e.target.value)}
                    placeholder="例如：移除背景路人，主体动作、构图与时长不变"
                    className="min-w-0 flex-1 rounded border border-white/12 bg-black/45 px-2 py-1 text-[9px] text-white/85 outline-none focus:border-cyan-400/45"
                  />
                  <button
                    type="button"
                    disabled={factoryBusy || !videoEditInstruction.trim()}
                    data-manhua-action="video-edit-clip"
                    onClick={() => {
                      onVideoEditClip(activeQc.clipBlockId!, videoEditInstruction);
                      setVideoEditInstruction("");
                    }}
                    className="rounded border border-cyan-400/35 bg-cyan-500/15 px-2 py-1 text-[9px] font-semibold text-cyan-50 disabled:opacity-40"
                  >
                    提交编辑
                  </button>
                </div>
                <p className="mt-1 text-[8px] leading-snug text-white/35">
                  位于单镜质检之后、最终拼接之前；编辑版需重新质检。
                </p>
              </div>
            ) : null}
            {activeQc.clipBlockId && activeVersions && activeVersions.urls.length > 1 ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[8px] text-white/35">成片版本</span>
                {activeVersions.urls.map((url, index) => (
                  <button
                    key={url}
                    type="button"
                    disabled={factoryBusy || !onSelectClipVersion}
                    onClick={() => onSelectClipVersion?.(activeQc.clipBlockId!, url)}
                    className={`rounded border px-1.5 py-0.5 text-[8px] ${
                      activeVersions.activeUrl === url
                        ? "border-emerald-300/40 bg-emerald-500/20 text-emerald-50"
                        : "border-white/12 bg-white/[0.04] text-white/55"
                    }`}
                  >
                    {index === 0 ? "最新版" : `旧版 ${index}`}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-1.5 text-[10px] text-white/35">点选片段查看该镜质检</p>
        )}
      </div>

      {deliveryPackage && onDeliveryPackageChange ? (
        <ManhuaDeliveryEditSection
          deliveryPackage={deliveryPackage}
          onChange={onDeliveryPackageChange}
          cineVocabLocale={cineVocabLocale}
          onCineVocabLocaleChange={onCineVocabLocaleChange}
        />
      ) : null}

      {/* 导出 → 成片坞 */}
      <div
        data-manhua-edit-section="export"
        className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-white/75">
            <Package className="h-3.5 w-3.5 text-violet-200/80" />
            导出 · 成片坞勾选
            <span className="font-normal text-white/35">
              可勾 {exportableIds.length}/{qcRows.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {onSelectExportableClips ? (
              <button
                type="button"
                data-manhua-action="select-exportable-clips"
                disabled={!exportableIds.length}
                onClick={() => onSelectExportableClips(exportableIds)}
                className="rounded border border-violet-400/35 bg-violet-500/15 px-2 py-0.5 text-[9px] text-violet-50 disabled:opacity-40"
              >
                勾选本集可导出
              </button>
            ) : null}
            {onOpenClipDock ? (
              <button
                type="button"
                onClick={onOpenClipDock}
                className="text-[9px] text-cyan-200/80 underline-offset-2 hover:underline"
              >
                打开成片坞
              </button>
            ) : null}
          </div>
        </div>
        <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto">
          {qcRows.map((row) => {
            const checked = Boolean(
              row.clipBlockId && dockSelectedIds?.has(row.clipBlockId),
            );
            const canToggle = row.allowsExport && Boolean(row.clipBlockId);
            return (
              <li
                key={`exp-${row.shotIndex}`}
                className="flex items-center gap-2 rounded border border-white/8 bg-black/30 px-2 py-1"
              >
                <input
                  type="checkbox"
                  disabled={!canToggle || !onToggleDockClip}
                  checked={checked}
                  onChange={(e) => {
                    if (!row.clipBlockId || !onToggleDockClip) return;
                    onToggleDockClip(row.clipBlockId, e.target.checked);
                  }}
                  className="accent-violet-400 disabled:opacity-30"
                  title={
                    canToggle
                      ? "勾选进成片坞合成"
                      : row.gate === "failed"
                        ? "质检未过，请返工或仍采用"
                        : "暂不可导出"
                  }
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left text-[10px] text-white/70"
                  onClick={() => onSelectShot?.(row.shotIndex)}
                >
                  镜 {String(row.shotIndex).padStart(2, "0")}
                  <span className="ml-1.5 text-[9px] text-white/35">
                    {row.gate === "passed"
                      ? "质检通过"
                      : row.gate === "accepted"
                        ? "已采用"
                        : row.gate === "failed"
                          ? "未过"
                          : row.gate === "missing"
                            ? "缺片"
                            : "待检"}
                  </span>
                </button>
              </li>
            );
          })}
          {!qcRows.length ? (
            <li className="text-[10px] text-white/35">暂无片段可导出</li>
          ) : null}
        </ul>
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
        <div className="text-[10px] font-semibold text-white/60">粗剪顺序</div>
        <div className="mt-1.5 flex gap-1 overflow-x-auto pb-0.5">
          {roughClips.map((c, i) => (
            <div
              key={`ord-${c.shotIndex}`}
              className={`flex min-w-[96px] shrink-0 items-center gap-1 rounded-md border px-1.5 py-1 ${
                c.shotIndex === activeShotIndex
                  ? "border-violet-400/45 bg-violet-500/15"
                  : "border-white/10 bg-black/40"
              }`}
            >
              <div className="flex flex-col">
                <button
                  type="button"
                  className="text-[9px] text-white/35 hover:text-white/70"
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="text-[9px] text-white/35 hover:text-white/70"
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
              </div>
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => onSelectShot?.(c.shotIndex)}
              >
                <div className="text-[10px] font-semibold text-white/85">
                  {String(c.order).padStart(2, "0")}·镜{c.shotIndex}
                </div>
                <div className="truncate text-[8px] text-white/40">{c.labelZh}</div>
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
