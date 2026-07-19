/**
 * 剧本工作台：左=本集资产 · 中=片段脚本+多镜 · 右=预览 · 底=集/分镜时间线
 * 数据接工厂节点；反推后按镜展开多张静帧。
 */
import { useMemo, useState } from "react";
import { Clapperboard, Focus, Loader2, Play, Sparkles } from "lucide-react";
import type { CanvasBlock } from "@/lib/canvasTypes";
import {
  getBlockEpisodeIndex,
  MANHUA_FACTORY_STAGE_LABEL_ZH,
  stageKeyFromBlockId,
} from "@/lib/canvasDramaStudio";
import { getManhuaCharacterById, getManhuaCharacterPreviewUrl } from "@shared/manhuaCharacterAssetLibrary";
import {
  getAncientArchetypeById,
  getAncientArchetypePreviewUrl,
} from "@shared/manhuaAncientArchetypeLibrary";
import { getManhuaSceneTemplate } from "@shared/manhuaSceneAssetLibrary";
import {
  getManhuaDemoAsset,
  getManhuaDemoAssetPublicUrl,
  listManhuaDemoAssetsForSceneTemplate,
} from "@shared/manhuaScenePropDemoCatalog";
import {
  parseWorkbenchShotsFromText,
  resolveKeyartShotIndex,
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
  /** 蓝/红轨 + 叙事灯光状态行 */
  pathTrackLabelZh?: string;
  narrativeLightingLabelZh?: string;
  /** 合成长片预览（成片坞合成后） */
  finalVideoUrl?: string | null;
  factoryBusy?: boolean;
  /** 工厂进度一行（如「第2集 · 静帧」） */
  factoryProgress?: string;
  canRun?: boolean;
  onOpenCharacterCard?: () => void;
  onOpenAssetWall?: () => void;
  onSpawnAndRunClip?: () => void;
  /** 成片坞已勾选集：静帧+成片连跑 */
  onRunFullAuto?: () => void;
  onResumeFromFailure?: () => void;
  onFocusBlock?: (blockId: string) => void;
};

function blockByStage(blocks: CanvasBlock[], episode: number, stage: string): CanvasBlock | undefined {
  return blocks.find((b) => stageKeyFromBlockId(b.id) === stage && (getBlockEpisodeIndex(b) ?? 1) === episode);
}

function keyartsForEpisode(blocks: CanvasBlock[], episode: number): CanvasBlock[] {
  return blocks
    .filter((b) => b.id.startsWith("keyart-") && (getBlockEpisodeIndex(b) ?? 1) === episode)
    .sort(
      (a, b) =>
        resolveKeyartShotIndex(a.id, a.prompt) - resolveKeyartShotIndex(b.id, b.prompt) ||
        a.id.localeCompare(b.id),
    );
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
  pathTrackLabelZh,
  narrativeLightingLabelZh,
  finalVideoUrl,
  factoryBusy,
  factoryProgress,
  canRun,
  onOpenCharacterCard,
  onOpenAssetWall,
  onSpawnAndRunClip,
  onRunFullAuto,
  onResumeFromFailure,
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
  const episodeKeyarts = useMemo(
    () => keyartsForEpisode(blocks, focusEpisode),
    [blocks, focusEpisode],
  );
  const keyart = episodeKeyarts[0];
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
  const activeKeyart =
    episodeKeyarts.find(
      (b) => resolveKeyartShotIndex(b.id, b.prompt) === (activeShot?.index ?? 1),
    ) ||
    episodeKeyarts[Math.min(shotIndex, Math.max(0, episodeKeyarts.length - 1))] ||
    keyart;
  const anyKeyartUrl = episodeKeyarts.map(mediaUrl).find(Boolean);
  const previewUrl = mediaUrl(clip) || mediaUrl(activeKeyart) || anyKeyartUrl;
  const previewIsVideo = Boolean(mediaUrl(clip));

  const characters = characterIds
    .map((id) => getManhuaCharacterById(id))
    .filter(Boolean);
  const archetypes = ancientArchetypeIds
    .map((id) => getAncientArchetypeById(id))
    .filter(Boolean);
  const scene = sceneId ? getManhuaSceneTemplate(sceneId) : null;
  const sceneDemos = useMemo(
    () => listManhuaDemoAssetsForSceneTemplate(sceneId).slice(0, 4),
    [sceneId],
  );
  const props = propIds.map((id) => getManhuaDemoAsset(id)).filter(Boolean);

  const stageStrip = useMemo(() => {
    const stages = ["story", "bible", "beats", "reverse", "keyart", "clip"] as const;
    return stages.map((stage) => {
      if (stage === "keyart") {
        const has = episodeKeyarts.some((b) => Boolean(mediaUrl(b)));
        return {
          stage,
          label: MANHUA_FACTORY_STAGE_LABEL_ZH[stage],
          has,
          blockId: activeKeyart?.id || episodeKeyarts[0]?.id,
        };
      }
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
  }, [blocks, focusEpisode, episodeKeyarts, activeKeyart?.id]);

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-white/12 bg-[#0a0d14] shadow-[0_12px_48px_rgba(0,0,0,0.45)]">
      {/* 顶栏：对标竞品工作台条，路径轨由页顶引导条负责，此处不再重复 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5 md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Clapperboard className="h-4 w-4 shrink-0 text-cyan-300" />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-white/95">剧本工作台</div>
            <p className="truncate text-[11px] text-white/40">
              {seriesTitle || topic || "未填题材"}
              {artStyleLabelZh ? ` · ${artStyleLabelZh}` : ""}
              {" · "}
              第{focusEpisode}集 · 约 {totalSec}s · {shots.length} 镜
            </p>
          </div>
        </div>
        {projectBibleSummary ? (
          <p className="max-w-md truncate text-[10px] text-emerald-100/70" title={projectBibleSummary}>
            专案设定：{projectBibleSummary}
          </p>
        ) : (
          <p className="text-[10px] text-white/35">确认编剧后绑定角色 / 画风至各集</p>
        )}
      </div>

      {/* 主 CTA 区：生成本集为主，全自动/续跑为次 */}
      {!canRun ? (
        <div className="border-b border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-50/90 md:px-4">
          工作台出片尚未解锁 · 请先在上方编剧室扩写并点「确认并进入工作台」
        </div>
      ) : null}
      {canRun && factoryBusy ? (
        <div className="border-b border-cyan-400/20 bg-cyan-500/10 px-3 py-2 md:px-4">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-cyan-50">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {factoryProgress?.trim() ? factoryProgress : "本集工厂链路生成中…"}
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-cyan-400/80 to-teal-300/80" />
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5 md:px-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canRun || factoryBusy}
            onClick={() => onSpawnAndRunClip?.()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-300/45 bg-gradient-to-b from-cyan-400/30 to-cyan-600/25 px-3.5 py-2 text-[12px] font-semibold text-cyan-50 shadow-[0_0_20px_rgba(34,211,238,0.1)] disabled:opacity-45"
          >
            <Play className="h-3.5 w-3.5" />
            {factoryBusy ? "生成中…" : "生成本集成片"}
          </button>
          {onRunFullAuto ? (
            <button
              type="button"
              disabled={!canRun || factoryBusy}
              onClick={() => onRunFullAuto()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 px-2.5 py-1.5 text-[11px] font-medium text-white/60 hover:bg-white/[0.06] disabled:opacity-45"
            >
              勾选集全自动
            </button>
          ) : null}
          {onResumeFromFailure ? (
            <button
              type="button"
              disabled={!canRun || factoryBusy}
              onClick={() => onResumeFromFailure()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 px-2.5 py-1.5 text-[11px] font-medium text-white/60 hover:bg-white/[0.06] disabled:opacity-45"
            >
              从失败处续跑
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onOpenCharacterCard?.()}
            className="rounded-lg border border-white/12 bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-white/65 hover:bg-white/[0.07]"
          >
            角色库
          </button>
          <button
            type="button"
            onClick={() => onOpenAssetWall?.()}
            className="rounded-lg border border-white/12 bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-white/65 hover:bg-white/[0.07]"
          >
            资产墙
          </button>
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[280px_minmax(0,1fr)_minmax(420px,46vw)] lg:grid-cols-[240px_minmax(0,1fr)_minmax(340px,40vw)]">
        {/* 左：本案资产（角色缩略 + 场景墙 + 道具墙） */}
        <aside className="max-h-[min(78vh,860px)] overflow-y-auto border-b border-white/10 p-3 lg:border-b-0 lg:border-r">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[12px] font-semibold text-white/85">本案资产</div>
            <button
              type="button"
              onClick={() => onOpenCharacterCard?.()}
              className="text-[10px] text-cyan-200/80 underline-offset-2 hover:underline"
            >
              换造型
            </button>
          </div>

          <div className="text-[10px] font-semibold tracking-wide text-white/40">
            角色 · {(characters.length || 0) + (archetypes.length || 0)}
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {characters.map((c) => (
              <button
                key={c!.id}
                type="button"
                onClick={() => onOpenCharacterCard?.()}
                className="overflow-hidden rounded-lg border border-white/12 bg-black/40 text-left"
              >
                <img
                  src={getManhuaCharacterPreviewUrl(c!.id)}
                  alt=""
                  className="aspect-square w-full object-cover object-top"
                  loading="lazy"
                />
                <div className="truncate px-1 py-0.5 text-[9px] text-white/80">{c!.nameZh}</div>
              </button>
            ))}
            {archetypes.map((a) => (
              <button
                key={a!.id}
                type="button"
                onClick={() => onOpenCharacterCard?.()}
                className="overflow-hidden rounded-lg border border-amber-400/30 bg-amber-500/10 text-left"
                title={a!.nameZh}
              >
                <div className="relative aspect-square w-full bg-black/50">
                  <img
                    src={getAncientArchetypePreviewUrl(a!.id)}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover object-top"
                    loading="lazy"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                  <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/80 to-transparent px-1 pb-1 text-[9px] text-amber-50/95">
                    {a!.nameZh}
                  </div>
                </div>
              </button>
            ))}
            {!characters.length && !archetypes.length ? (
              <button
                type="button"
                onClick={() => onOpenCharacterCard?.()}
                className="col-span-3 rounded-lg border border-dashed border-white/15 px-2 py-5 text-center text-[10px] text-white/40"
              >
                尚未套用角色 · 打开角色卡
              </button>
            ) : null}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div className="text-[10px] font-semibold tracking-wide text-white/40">
              场景 · {sceneDemos.length || (scene ? 1 : 0)}
            </div>
            <button
              type="button"
              onClick={() => onOpenAssetWall?.()}
              className="text-[10px] text-cyan-200/80 underline-offset-2 hover:underline"
            >
              资产墙
            </button>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            {sceneDemos.map((d) => {
              const url = getManhuaDemoAssetPublicUrl(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onOpenAssetWall?.()}
                  className="overflow-hidden rounded-lg border border-white/12 bg-black/40 text-left"
                  title={d.nameZh}
                >
                  {url ? (
                    <img src={url} alt="" className="aspect-video w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex aspect-video items-center justify-center text-[9px] text-white/30">
                      待生成
                    </div>
                  )}
                  <div className="truncate px-1 py-0.5 text-[9px] text-white/70">{d.nameZh}</div>
                </button>
              );
            })}
            {!sceneDemos.length ? (
              <div className="col-span-2 rounded-lg border border-white/10 bg-black/35 px-2 py-3 text-[11px] text-white/55">
                {scene ? scene.nameZh : "未选场景（铺板时按题材推荐）"}
              </div>
            ) : null}
          </div>

          <div className="mt-3 text-[10px] font-semibold tracking-wide text-white/40">
            道具 · {props.length}
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {props.map((p) => (
              <button
                key={p!.id}
                type="button"
                onClick={() => onOpenAssetWall?.()}
                className="overflow-hidden rounded-md border border-white/12 bg-black/40 text-left"
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
              </button>
            ))}
            {!props.length ? (
              <button
                type="button"
                onClick={() => onOpenAssetWall?.()}
                className="col-span-3 rounded-lg border border-dashed border-white/15 px-2 py-4 text-center text-[10px] text-white/40"
              >
                未点选道具 · 打开资产墙
              </button>
            ) : null}
          </div>

          <div className="mt-3 rounded-xl border border-cyan-400/15 bg-cyan-500/[0.06] px-2.5 py-2 text-[10px] leading-relaxed text-white/60">
            <div className="mb-1 text-[10px] font-semibold text-cyan-100/80">运镜 · 灯光（本集）</div>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-md border border-sky-400/30 bg-sky-500/15 px-1.5 py-0.5 text-sky-100/85">
                蓝轨
              </span>
              <span className="rounded-md border border-rose-400/30 bg-rose-500/15 px-1.5 py-0.5 text-rose-100/85">
                红轨
              </span>
            </div>
            <div className="mt-1.5 text-white/55">{pathTrackLabelZh || "运镜标注：蓝轨— · 动作红轨—"}</div>
            <div className="mt-0.5 text-white/55">
              叙事灯光：{narrativeLightingLabelZh || "未选（节拍/静帧可注入）"}
            </div>
            <p className="mt-1 text-[9px] text-white/35">
              蓝线=运镜轨迹，红线=动作轨迹；成片跟轨，画面不显示参考线。
            </p>
          </div>
        </aside>

        {/* 中：脚本 + 多镜（对标竞品「片段」编辑区） */}
        <section className="min-w-0 border-b border-white/10 p-3 lg:max-h-[min(78vh,860px)] lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[12px] font-semibold text-white/85">
              片段 {String(focusEpisode).padStart(2, "0")}
              {story?.episodeTitle ? ` · ${story.episodeTitle}` : ""}
              <span className="ml-2 font-normal text-white/40">
                镜 {activeShot?.index ?? "—"}/{shots.length}
              </span>
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
          <div className="mt-1.5 max-h-[min(52vh,480px)] space-y-1.5 overflow-y-auto pr-1">
            {shots.map((shot, i) => {
              const on = i === Math.min(shotIndex, shots.length - 1);
              const shotKey =
                episodeKeyarts.find((b) => resolveKeyartShotIndex(b.id, b.prompt) === shot.index) ||
                episodeKeyarts[i];
              const thumb = mediaUrl(shotKey);
              return (
                <button
                  key={shot.index}
                  type="button"
                  onClick={() => setShotIndex(i)}
                  className={`flex w-full gap-2 rounded-lg border px-2 py-2 text-left transition ${
                    on
                      ? "border-cyan-400/50 bg-cyan-500/15"
                      : "border-white/10 bg-white/[0.03] hover:border-white/20"
                  }`}
                >
                  <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black/50">
                    {thumb ? (
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[9px] text-white/30">
                        {String(shot.index).padStart(2, "0")}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-white/90">
                        分镜 {shot.index}
                        <span className="ml-2 font-normal text-white/45">{shot.durationSec}s</span>
                      </span>
                      {on ? <Sparkles className="h-3.5 w-3.5 shrink-0 text-cyan-200" /> : null}
                    </div>
                    <div className="mt-0.5 text-[10px] text-cyan-100/70">{shot.cameraZh}</div>
                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-white/70">
                      {shot.actionZh}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] leading-snug text-white/35">
            点分镜切换右栏预览；静帧按镜生成（最多 {Math.min(shots.length, 4)} 张），成片以第 1 镜为底图。
          </p>
        </section>

        {/* 右：视频结果（主视觉，对标竞品大预览） */}
        <aside className="flex flex-col p-3 lg:min-h-[min(78vh,860px)]">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[13px] font-semibold text-white/90">视频结果</div>
            {factoryBusy ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-[9px] font-semibold text-amber-50">
                <Loader2 className="h-3 w-3 animate-spin" />
                生成中
              </span>
            ) : finalVideoUrl ? (
              <span className="rounded-full border border-cyan-400/40 bg-cyan-500/15 px-2 py-0.5 text-[9px] font-semibold text-cyan-100">
                长片已合成
              </span>
            ) : previewIsVideo ? (
              <span className="rounded-full border border-emerald-400/35 bg-emerald-500/12 px-2 py-0.5 text-[9px] font-medium text-emerald-100/85">
                本集成片
              </span>
            ) : previewUrl ? (
              <span className="rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[9px] text-white/50">
                静帧
              </span>
            ) : (
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] text-white/35">
                待生成
              </span>
            )}
          </div>
          <div
            className={`flex min-h-[420px] w-full flex-1 items-center justify-center overflow-hidden rounded-xl border bg-black/70 ${
              finalVideoUrl || previewIsVideo
                ? "border-cyan-400/45"
                : factoryBusy
                  ? "border-amber-400/35"
                  : "border-white/12"
            } aspect-[9/16] max-h-[min(78vh,820px)]`}
          >
            {finalVideoUrl ? (
              <video src={finalVideoUrl} controls className="h-full w-full object-contain" />
            ) : previewUrl ? (
              previewIsVideo ? (
                <video src={previewUrl} controls className="h-full w-full object-contain" />
              ) : (
                <img src={previewUrl} alt="" className="h-full w-full object-contain" />
              )
            ) : (
              <div className="px-4 text-center text-[11px] leading-relaxed text-white/40">
                {factoryBusy
                  ? "正在生成，推进状态见上方「生成推进」条…"
                  : "生成后在此即时预览本集静帧 / 成片（对标工作台右栏「视频结果」）。"}
                <br />
                {!factoryBusy ? "主按钮：「生成本集成片」。" : null}
              </div>
            )}
          </div>
          {finalVideoUrl ? (
            <p className="mt-1.5 text-[10px] text-cyan-100/75">
              当前预览：多集合成长片（含配乐）·{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-cyan-50"
                onClick={() =>
                  document.querySelector("#manhua-clip-dock-zone")?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  })
                }
              >
                打开成片坞
              </button>
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {activeKeyart?.id ? (
              <button
                type="button"
                onClick={() => onFocusBlock?.(activeKeyart.id)}
                className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[10px] text-white/65 hover:bg-white/5"
              >
                <Focus className="h-3 w-3" /> 聚焦本镜静帧
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

      {/* 底：本集分镜胶片 + 集时间线 */}
      <div className="border-t border-white/10 px-3 py-2.5 md:px-4">
        <div className="mb-2.5">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] font-semibold text-white/70">
              片段时间线 · 第{focusEpisode}集
            </div>
            <span className="text-[9px] text-white/35">
              静帧 {episodeKeyarts.filter((b) => mediaUrl(b)).length}/
              {Math.max(episodeKeyarts.length, shots.length, 1)} · 点选切换预览
            </span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {shots.map((shot, i) => {
              const shotKey =
                episodeKeyarts.find((b) => resolveKeyartShotIndex(b.id, b.prompt) === shot.index) ||
                episodeKeyarts[i];
              const thumb = mediaUrl(shotKey);
              const on = i === Math.min(shotIndex, shots.length - 1);
              return (
                <button
                  key={`shot-${shot.index}`}
                  type="button"
                  onClick={() => setShotIndex(i)}
                  className={`relative w-[88px] shrink-0 overflow-hidden rounded-lg border text-left ${
                    on ? "border-cyan-400/60 ring-1 ring-cyan-400/35" : "border-white/12"
                  }`}
                >
                  <div className="aspect-[9/16] bg-black/55">
                    {thumb ? (
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-0.5 text-white/30">
                        <span className="text-[12px] font-semibold">
                          {String(shot.index).padStart(2, "0")}
                        </span>
                        <span className="text-[8px]">待出</span>
                      </div>
                    )}
                  </div>
                  <div className="truncate px-1 py-0.5 text-[9px] text-white/60">
                    片段{String(shot.index).padStart(2, "0")}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
            集时间线
            {bibleBoundEpisodes.length ? " · 绿点=设定已绑定" : ""}
          </div>
          <span className="text-[9px] text-white/30">点选切换焦点集 · 合成长片见成片坞</span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {episodeIndexes.map((ep) => {
            const epKeys = keyartsForEpisode(blocks, ep);
            const epKeyart = epKeys[0];
            const epClip = blockByStage(blocks, ep, "clip");
            const thumb = mediaUrl(epClip) || epKeys.map(mediaUrl).find(Boolean);
            const clipReady = Boolean(mediaUrl(epClip));
            const stillReady = epKeys.some((b) => Boolean(mediaUrl(b)));
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
                className={`w-[96px] shrink-0 overflow-hidden rounded-xl border text-left transition ${
                  on
                    ? "border-cyan-400/55 bg-cyan-500/15 shadow-[0_0_16px_rgba(34,211,238,0.12)]"
                    : clipReady
                      ? "border-emerald-400/30 bg-emerald-500/8 hover:border-emerald-400/45"
                      : "border-white/10 bg-black/35 hover:border-white/25"
                }`}
              >
                <div className="relative aspect-[9/12] bg-black/60">
                  {thumb ? (
                    <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[10px] text-white/30">
                      待生成
                    </div>
                  )}
                  <span
                    className={`absolute right-1 top-1 rounded px-1 py-0.5 text-[9px] font-semibold ${
                      clipReady
                        ? "bg-emerald-500/90 text-white"
                        : stillReady
                          ? "bg-amber-500/85 text-black"
                          : "bg-black/65 text-white/60"
                    }`}
                  >
                    {clipReady ? "成片" : stillReady ? "静帧" : "待跑"}
                  </span>
                  {bound ? (
                    <span
                      className="absolute left-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
                      title="专案设定已绑定本集"
                    />
                  ) : null}
                </div>
                <div className="px-1.5 py-1 text-[10px] font-semibold text-white/80">
                  第{ep}集
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
