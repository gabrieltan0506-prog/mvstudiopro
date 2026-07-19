/**
 * 剧本工作台（逼近 AI-CanvasPro 信息架构）：
 * 左=本集资产 · 中=片段脚本+多镜 · 右=预览 · 底=片段/集时间线
 * 数据接工厂节点；多镜先由节拍/反推解析，便于实测再接批量静帧。
 */
import { useMemo, useState } from "react";
import { Clapperboard, Focus, Play, Sparkles } from "lucide-react";
import type { CanvasBlock } from "@/lib/canvasTypes";
import {
  getBlockEpisodeIndex,
  MANHUA_FACTORY_STAGE_LABEL_ZH,
  stageKeyFromBlockId,
} from "@/lib/canvasDramaStudio";
import { getManhuaCharacterById, getManhuaCharacterPreviewUrl } from "@shared/manhuaCharacterAssetLibrary";
import { getAncientArchetypeById } from "@shared/manhuaAncientArchetypeLibrary";
import { getManhuaSceneTemplate } from "@shared/manhuaSceneAssetLibrary";
import {
  getManhuaDemoAsset,
  getManhuaDemoAssetPublicUrl,
} from "@shared/manhuaScenePropDemoCatalog";
import {
  parseWorkbenchShotsFromText,
  workbenchShotTotalSec,
  type ManhuaWorkbenchShot,
} from "@shared/manhuaScriptWorkbench";

type Props = {
  blocks: CanvasBlock[];
  topic: string;
  seriesTitle?: string;
  episodeCount: number;
  focusEpisode: number;
  onFocusEpisode: (ep: number) => void;
  characterIds: string[];
  ancientArchetypeIds?: string[];
  sceneId?: string;
  propIds: string[];
  artStyleLabelZh?: string;
  /** 专案 Bible 一行摘要（确认编剧后） */
  projectBibleSummary?: string;
  /** Bible 已绑定造型的集号（1-based） */
  bibleBoundEpisodes?: number[];
  factoryBusy?: boolean;
  canRun?: boolean;
  onOpenCharacterCard?: () => void;
  onOpenAssetWall?: () => void;
  onSpawnAndRunClip?: () => void;
  onFocusBlock?: (blockId: string) => void;
};

function blockByStage(blocks: CanvasBlock[], episode: number, stage: string): CanvasBlock | undefined {
  return blocks.find((b) => stageKeyFromBlockId(b.id) === stage && (getBlockEpisodeIndex(b) ?? 1) === episode);
}

function mediaUrl(b?: CanvasBlock): string | undefined {
  if (!b) return undefined;
  return b.outputUrl || b.outputUrls?.[0] || undefined;
}

export default function ManhuaScriptWorkbench({
  blocks,
  topic,
  seriesTitle,
  episodeCount,
  focusEpisode,
  onFocusEpisode,
  characterIds,
  ancientArchetypeIds = [],
  sceneId,
  propIds,
  artStyleLabelZh,
  projectBibleSummary,
  bibleBoundEpisodes = [],
  factoryBusy,
  canRun,
  onOpenCharacterCard,
  onOpenAssetWall,
  onSpawnAndRunClip,
  onFocusBlock,
}: Props) {
  const [shotIndex, setShotIndex] = useState(0);

  const episodeIndexes = useMemo(() => {
    const fromBlocks = new Set<number>();
    for (const b of blocks) {
      const ep = getBlockEpisodeIndex(b);
      if (ep) fromBlocks.add(ep);
    }
    const max = Math.max(episodeCount || 1, ...Array.from(fromBlocks), focusEpisode || 1);
    return Array.from({ length: Math.min(Math.max(max, 1), 12) }, (_, i) => i + 1);
  }, [blocks, episodeCount, focusEpisode]);

  const beats = blockByStage(blocks, focusEpisode, "beats");
  const reverse = blockByStage(blocks, focusEpisode, "reverse");
  const keyart = blockByStage(blocks, focusEpisode, "keyart");
  const clip = blockByStage(blocks, focusEpisode, "clip");
  const story = blockByStage(blocks, focusEpisode, "story");

  const shots: ManhuaWorkbenchShot[] = useMemo(() => {
    const fromBeats = parseWorkbenchShotsFromText(beats?.outputText || beats?.prompt);
    if (fromBeats.length >= 2 && (beats?.outputText || "").trim()) return fromBeats;
    const fromReverse = parseWorkbenchShotsFromText(reverse?.outputText || reverse?.prompt);
    if ((reverse?.outputText || "").trim()) return fromReverse;
    return fromBeats;
  }, [beats?.outputText, beats?.prompt, reverse?.outputText, reverse?.prompt]);

  const totalSec = workbenchShotTotalSec(shots);
  const activeShot = shots[Math.min(shotIndex, Math.max(0, shots.length - 1))] || shots[0];
  const previewUrl = mediaUrl(clip) || mediaUrl(keyart);
  const previewIsVideo = Boolean(mediaUrl(clip));

  const characters = characterIds
    .map((id) => getManhuaCharacterById(id))
    .filter(Boolean);
  const archetypes = ancientArchetypeIds
    .map((id) => getAncientArchetypeById(id))
    .filter(Boolean);
  const scene = sceneId ? getManhuaSceneTemplate(sceneId) : null;
  const props = propIds.map((id) => getManhuaDemoAsset(id)).filter(Boolean);

  const stageStrip = useMemo(() => {
    const stages = ["story", "bible", "beats", "reverse", "keyart", "clip"] as const;
    return stages.map((stage) => {
      const b = blockByStage(blocks, focusEpisode, stage);
      const has =
        Boolean(b && (b.outputUrl || b.outputUrls?.[0] || (b.outputText || "").trim()));
      return {
        stage,
        label: MANHUA_FACTORY_STAGE_LABEL_ZH[stage],
        has,
        blockId: b?.id,
      };
    });
  }, [blocks, focusEpisode]);

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-white/12 bg-[#0a0912]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5 md:px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-white/90">
            <Clapperboard className="h-4 w-4 text-emerald-300/90" />
            剧本工作台
            <span className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-100/90">
              实测版
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-white/45">
            {seriesTitle || topic || "未填题材"}
            {artStyleLabelZh ? ` · ${artStyleLabelZh}` : ""}
            {" · "}
            第{focusEpisode}集 · 片段约 {totalSec}s · {shots.length} 镜
          </p>
          {projectBibleSummary ? (
            <p className="mt-1 truncate text-[10px] text-emerald-100/70" title={projectBibleSummary}>
              专案设定：{projectBibleSummary}
            </p>
          ) : (
            <p className="mt-1 text-[10px] text-white/35">确认编剧后生成专案设定（绑定角色/画风至各集）</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onOpenCharacterCard?.()}
            className="rounded-lg border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-white/75 hover:bg-white/[0.08]"
          >
            角色库
          </button>
          <button
            type="button"
            onClick={() => onOpenAssetWall?.()}
            className="rounded-lg border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-white/75 hover:bg-white/[0.08]"
          >
            资产墙
          </button>
          <button
            type="button"
            disabled={!canRun || factoryBusy}
            onClick={() => onSpawnAndRunClip?.()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-3 py-1.5 text-[11px] font-semibold text-emerald-50 disabled:opacity-45"
          >
            <Play className="h-3.5 w-3.5" />
            {factoryBusy ? "生成中…" : "生成本集成片"}
          </button>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[220px_minmax(0,1fr)_minmax(240px,320px)]">
        {/* 左：本集资产 */}
        <aside className="border-b border-white/10 p-3 lg:border-b-0 lg:border-r">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-semibold text-white/75">本集资产</div>
            <button
              type="button"
              onClick={() => onOpenCharacterCard?.()}
              className="text-[10px] text-cyan-200/80 underline-offset-2 hover:underline"
            >
              换人
            </button>
          </div>

          <div className="text-[10px] font-semibold uppercase tracking-wide text-white/35">角色</div>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            {characters.map((c) => (
              <button
                key={c!.id}
                type="button"
                onClick={() => onOpenCharacterCard?.()}
                className="overflow-hidden rounded-lg border border-white/10 bg-black/35 text-left"
              >
                <img
                  src={getManhuaCharacterPreviewUrl(c!.id)}
                  alt=""
                  className="aspect-[3/4] w-full object-cover object-top"
                  loading="lazy"
                />
                <div className="truncate px-1.5 py-1 text-[10px] text-white/80">{c!.nameZh}</div>
              </button>
            ))}
            {archetypes.map((a) => (
              <div
                key={a!.id}
                className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-1.5 py-2 text-[10px] text-amber-50/90"
              >
                古风·{a!.nameZh}
              </div>
            ))}
            {!characters.length && !archetypes.length ? (
              <button
                type="button"
                onClick={() => onOpenCharacterCard?.()}
                className="col-span-2 rounded-lg border border-dashed border-white/15 px-2 py-4 text-center text-[10px] text-white/40"
              >
                尚未套用角色 · 点此打开角色卡
              </button>
            ) : null}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-white/35">场景</div>
            <button
              type="button"
              onClick={() => onOpenAssetWall?.()}
              className="text-[10px] text-cyan-200/80 underline-offset-2 hover:underline"
            >
              资产墙
            </button>
          </div>
          <div className="mt-1.5 rounded-lg border border-white/10 bg-black/35 px-2 py-2 text-[11px] text-white/75">
            {scene ? scene.nameZh : "未选场景（铺板时按题材推荐）"}
          </div>

          <div className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-white/35">道具</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {props.map((p) => (
              <div
                key={p!.id}
                className="w-[72px] overflow-hidden rounded-md border border-white/10 bg-black/35"
                title={p!.nameZh}
              >
                <img
                  src={getManhuaDemoAssetPublicUrl(p!.id)}
                  alt=""
                  className="aspect-square w-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.opacity = "0.2";
                  }}
                />
                <div className="truncate px-1 py-0.5 text-[9px] text-white/65">{p!.nameZh}</div>
              </div>
            ))}
            {!props.length ? (
              <span className="text-[10px] text-white/35">未点选道具</span>
            ) : null}
          </div>
        </aside>

        {/* 中：脚本 + 多镜 */}
        <section className="min-w-0 border-b border-white/10 p-3 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[12px] font-semibold text-white/85">
              片段 · 第{focusEpisode}集
              {story?.episodeTitle ? ` · ${story.episodeTitle}` : ""}
            </div>
            <div className="flex flex-wrap gap-1">
              {stageStrip.map((s) => (
                <button
                  key={s.stage}
                  type="button"
                  disabled={!s.blockId}
                  onClick={() => s.blockId && onFocusBlock?.(s.blockId)}
                  className={`rounded-md border px-1.5 py-0.5 text-[9px] ${
                    s.has
                      ? "border-emerald-400/35 bg-emerald-500/12 text-emerald-100"
                      : "border-white/10 text-white/35"
                  } disabled:opacity-40`}
                  title={s.label}
                >
                  {s.label.slice(0, 2)}
                </button>
              ))}
            </div>
          </div>

          <p className="mt-2 max-h-16 overflow-y-auto rounded-lg border border-white/8 bg-black/30 px-2.5 py-2 text-[11px] leading-relaxed text-white/55">
            {(story?.outputText || story?.prompt || topic || "铺板并跑过故事节点后，此处显示本集摘要。").slice(
              0,
              360,
            )}
          </p>

          <div className="mt-3 text-[11px] font-semibold text-white/70">
            分镜（{shots.length}）· 当前第 {activeShot?.index ?? "—"} 镜
          </div>
          <div className="mt-1.5 max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
            {shots.map((shot, i) => {
              const on = i === Math.min(shotIndex, shots.length - 1);
              return (
                <button
                  key={shot.index}
                  type="button"
                  onClick={() => setShotIndex(i)}
                  className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${
                    on
                      ? "border-sky-400/45 bg-sky-500/15"
                      : "border-white/10 bg-white/[0.03] hover:border-white/20"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-white/90">
                      分镜 {shot.index}
                      <span className="ml-2 font-normal text-white/45">{shot.durationSec}s</span>
                    </span>
                    {on ? <Sparkles className="h-3.5 w-3.5 text-sky-200" /> : null}
                  </div>
                  <div className="mt-0.5 text-[10px] text-cyan-100/70">{shot.cameraZh}</div>
                  <div className="mt-0.5 text-[11px] leading-snug text-white/70">{shot.actionZh}</div>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] leading-snug text-white/35">
            多镜列表由节拍/反推文本解析；成片仍是每集一条微动（下一步再接按镜静帧批量）。点阶段 chip 可聚焦对应画布节点。
          </p>
        </section>

        {/* 右：预览 */}
        <aside className="p-3">
          <div className="mb-2 text-[11px] font-semibold text-white/75">视频 / 静帧结果</div>
          <div className="flex aspect-[9/16] max-h-[420px] w-full items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/50">
            {previewUrl ? (
              previewIsVideo ? (
                <video src={previewUrl} controls className="h-full w-full object-contain" />
              ) : (
                <img src={previewUrl} alt="" className="h-full w-full object-contain" />
              )
            ) : (
              <div className="px-4 text-center text-[11px] leading-relaxed text-white/40">
                生成后将在此查看本集静帧或成片。
                <br />
                先点「生成本集成片」（需已确认编剧 / 编导）。
              </div>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {keyart?.id ? (
              <button
                type="button"
                onClick={() => onFocusBlock?.(keyart.id)}
                className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[10px] text-white/65 hover:bg-white/5"
              >
                <Focus className="h-3 w-3" /> 聚焦静帧节点
              </button>
            ) : null}
            {clip?.id ? (
              <button
                type="button"
                onClick={() => onFocusBlock?.(clip.id)}
                className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[10px] text-white/65 hover:bg-white/5"
              >
                <Focus className="h-3 w-3" /> 聚焦成片节点
              </button>
            ) : null}
          </div>
        </aside>
      </div>

      {/* 底：集时间线 */}
      <div className="border-t border-white/10 px-3 py-2.5 md:px-4">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/35">
          集时间线（点选切换焦点集
          {bibleBoundEpisodes.length ? " · 绿点=专案设定已绑定" : ""}）
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {episodeIndexes.map((ep) => {
            const epKeyart = blockByStage(blocks, ep, "keyart");
            const epClip = blockByStage(blocks, ep, "clip");
            const thumb = mediaUrl(epKeyart) || mediaUrl(epClip);
            const ready = Boolean(mediaUrl(epClip) || mediaUrl(epKeyart));
            const bound = bibleBoundEpisodes.includes(ep);
            const on = ep === focusEpisode;
            return (
              <button
                key={ep}
                type="button"
                onClick={() => {
                  onFocusEpisode(ep);
                  setShotIndex(0);
                }}
                className={`w-[88px] shrink-0 overflow-hidden rounded-lg border text-left ${
                  on
                    ? "border-sky-400/55 bg-sky-500/15 shadow-[0_0_0_1px_rgba(56,189,248,0.25)]"
                    : "border-white/10 bg-black/35 hover:border-white/25"
                }`}
              >
                <div className="relative aspect-video bg-black/60">
                  {thumb ? (
                    <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[10px] text-white/30">
                      待生成
                    </div>
                  )}
                  {ready ? (
                    <span className="absolute right-1 top-1 rounded bg-emerald-500/90 px-1 text-[9px] font-bold text-black">
                      有产出
                    </span>
                  ) : null}
                  {bound ? (
                    <span
                      className="absolute left-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
                      title="专案设定已绑定本集"
                    />
                  ) : null}
                </div>
                <div className="px-1.5 py-1 text-[10px] font-semibold text-white/80">
                  片段 {String(ep).padStart(2, "0")}
                  {bound ? <span className="ml-1 font-normal text-emerald-200/70">绑</span> : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
