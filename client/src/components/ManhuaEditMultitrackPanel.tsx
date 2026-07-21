/**
 * 剪辑阶段 · 多轨：细剪 / 字幕 / 包装 / 质检返工 / 导出勾选。
 */
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
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
  buildManhuaSubtitleCues,
  formatManhuaSubtitleSrt,
} from "@shared/manhuaEditSubtitle";
import {
  MANHUA_EDIT_MOTION_CATEGORIES,
  MANHUA_EDIT_MOTION_MAX,
  listManhuaEditMotionEntries,
  manhuaEditMotionCategoryLabel,
  manhuaEditMotionInjectPreview,
  toggleManhuaEditMotionId,
} from "@shared/manhuaEditMotionPick";
import type { MotionPromptCategory } from "@shared/motionPromptBank";
import {
  MANHUA_EDIT_QC_ROWS,
  buildManhuaEditShotQcBoard,
  manhuaEditExportableClipIds,
  manhuaEditQcSuggestsReworkStill,
  summarizeManhuaEditQcBoard,
  type ManhuaEditShotMedia,
} from "@shared/manhuaEditQcExport";

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
  subtitleEnabled?: boolean;
  onSubtitleEnabledChange?: (next: boolean) => void;
  motionPromptIds: string[];
  onMotionPromptIdsChange: (ids: string[]) => void;
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
  onOpenClipDock?: () => void;
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
  subtitleEnabled = false,
  onSubtitleEnabledChange,
  motionPromptIds,
  onMotionPromptIdsChange,
  shotMedia,
  factoryBusy,
  dockSelectedIds,
  onToggleDockClip,
  onSelectExportableClips,
  onReworkClip,
  onReworkFailedClips,
  onReworkStill,
  onAcceptDespiteQc,
  onOpenClipDock,
}: Props) {
  const [motionCat, setMotionCat] = useState<MotionPromptCategory>("logo");
  const { totalSec, tracks } = buildManhuaEditMultitrack({
    roughClips,
    shots,
    stillIndexes,
    clipIndexes,
    fineCutByShot,
    subtitleEnabled,
  });
  const stages = listRoughTimelineStages();
  const cues = useMemo(
    () =>
      buildManhuaSubtitleCues({
        roughClips,
        shots,
        fineCutByShot,
        enabled: subtitleEnabled,
      }),
    [roughClips, shots, fineCutByShot, subtitleEnabled],
  );
  const srtPreview = useMemo(() => formatManhuaSubtitleSrt(cues), [cues]);
  const motionEntries = listManhuaEditMotionEntries(motionCat);
  const motionInject = manhuaEditMotionInjectPreview(motionPromptIds);
  const qcRows = useMemo(() => buildManhuaEditShotQcBoard(shotMedia), [shotMedia]);
  const qcSummary = useMemo(() => summarizeManhuaEditQcBoard(qcRows), [qcRows]);
  const exportableIds = useMemo(() => manhuaEditExportableClipIds(qcRows), [qcRows]);
  const activeQc = qcRows.find((r) => r.shotIndex === activeShotIndex);

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
            多轨预览：静帧 / 成片 / 对白 / 字幕。可调进出点；字幕只生成轨数据，默认不烧进成片。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
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
        <div className="text-[10px] font-semibold text-violet-100/90">细剪 · 进出点</div>
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
              字幕轨数据 · {cues.length} 条（不烧字）
            </div>
            {srtPreview ? (
              <button
                type="button"
                className="text-[9px] text-cyan-200/80 underline-offset-2 hover:underline"
                onClick={() => {
                  void navigator.clipboard?.writeText(srtPreview);
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
        </div>
      ) : null}

      {/* 包装动效 */}
      <div
        data-manhua-edit-section="motion"
        className="rounded-lg border border-amber-400/15 bg-amber-500/[0.04] p-2.5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-100/90">
            <Sparkles className="h-3.5 w-3.5" />
            包装动效
            <span className="font-normal text-white/35">
              可选 · 最多 {MANHUA_EDIT_MOTION_MAX} 条
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {MANHUA_EDIT_MOTION_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setMotionCat(cat)}
                className={`rounded border px-1.5 py-0.5 text-[8px] ${
                  motionCat === cat
                    ? "border-amber-400/40 bg-amber-500/20 text-amber-50"
                    : "border-white/10 bg-black/30 text-white/45"
                }`}
              >
                {manhuaEditMotionCategoryLabel(cat)}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {motionEntries.map((e) => {
            const on = motionPromptIds.includes(e.id);
            return (
              <button
                key={e.id}
                type="button"
                title={`${e.effectZh}\n${e.whenToUseZh}`}
                onClick={() =>
                  onMotionPromptIdsChange(toggleManhuaEditMotionId(motionPromptIds, e.id))
                }
                className={`rounded border px-1.5 py-0.5 text-[9px] ${
                  on
                    ? "border-amber-400/45 bg-amber-500/25 text-amber-50"
                    : "border-white/10 bg-black/40 text-white/55 hover:border-white/25"
                }`}
              >
                {e.nameZh}
              </button>
            );
          })}
        </div>
        {motionInject ? (
          <pre className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap rounded border border-white/10 bg-black/40 p-2 text-[9px] leading-relaxed text-white/45">
            {motionInject}
          </pre>
        ) : (
          <p className="mt-1.5 text-[10px] text-white/35">未选包装；成片可按题材自动建议</p>
        )}
      </div>

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
          </div>
        ) : (
          <p className="mt-1.5 text-[10px] text-white/35">点选片段查看该镜质检</p>
        )}
      </div>

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
