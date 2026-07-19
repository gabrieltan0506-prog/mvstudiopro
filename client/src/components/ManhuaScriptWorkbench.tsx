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
import { getAncientArchetypeById } from "@shared/manhuaAncientArchetypeLibrary";
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
  /** 从编导反推强制重跑本集静帧（覆盖旧图；工作台主路径入口） */
  onRerunKeyartsFromReverse?: () => void;
  onFocusBlock?: (blockId: string) => void;
  /** 确认编剧后：整屏编辑器壳（无圆角卡片、三栏占满视口） */
  immersive?: boolean;
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
  onRerunKeyartsFromReverse,
  onFocusBlock,
  immersive = false,
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
    <div
      id="manhua-workbench-shell"
      data-manhua-layout={immersive ? "immersive-3col" : "card-3col"}
      className={
        immersive
          ? "flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#0a0d14]"
          : "mt-1 flex h-[calc(100dvh-5.75rem)] min-h-[620px] w-full min-w-[1180px] flex-col overflow-hidden rounded-xl border border-white/12 bg-[#0a0d14] shadow-[0_12px_48px_rgba(0,0,0,0.45)]"
      }
    >
      {/* 顶栏 */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-1.5 md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Clapperboard className="h-4 w-4 shrink-0 text-cyan-300" />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-white/95">
              {seriesTitle || topic || "剧本工作室"}
              <span className="ml-2 text-[11px] font-normal text-white/40">
                第{focusEpisode}集 · {shots.length} 片段 · 约 {totalSec}s
                {artStyleLabelZh ? ` · ${artStyleLabelZh}` : ""}
              </span>
            </div>
            {immersive ? (
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-white/35">
                <span className="text-white/50">本集资产</span>
                <span aria-hidden>｜</span>
                <span className="text-white/50">片段脚本</span>
                <span aria-hidden>｜</span>
                <span className="text-white/50">视频结果</span>
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={!canRun || factoryBusy}
            onClick={() => onSpawnAndRunClip?.()}
            className="inline-flex items-center gap-1 rounded-lg border border-cyan-300/45 bg-gradient-to-b from-cyan-400/30 to-cyan-600/25 px-3 py-1.5 text-[11px] font-semibold text-cyan-50 disabled:opacity-45"
          >
            <Play className="h-3.5 w-3.5" />
            {factoryBusy ? "生成中…" : "生成"}
          </button>
          {onRerunKeyartsFromReverse ? (
            <button
              type="button"
              disabled={!canRun || factoryBusy}
              onClick={() => onRerunKeyartsFromReverse()}
              title="从编导反推重跑本集多镜静帧，覆盖右栏旧图"
              className="rounded-lg border border-amber-400/40 bg-amber-500/15 px-2.5 py-1.5 text-[10px] font-semibold text-amber-50 hover:bg-amber-500/25 disabled:opacity-45"
            >
              重出静帧
            </button>
          ) : null}
          {onRunFullAuto ? (
            <button
              type="button"
              disabled={!canRun || factoryBusy}
              onClick={() => onRunFullAuto()}
              className="rounded-lg border border-white/12 px-2 py-1.5 text-[10px] text-white/55 hover:bg-white/[0.06] disabled:opacity-45"
            >
              全自动
            </button>
          ) : null}
          {onResumeFromFailure ? (
            <button
              type="button"
              disabled={!canRun || factoryBusy}
              onClick={() => onResumeFromFailure()}
              title="仅从失败/未完成节点接着跑；已出的错图不会重做"
              className="rounded-lg border border-white/12 px-2 py-1.5 text-[10px] text-white/55 hover:bg-white/[0.06] disabled:opacity-45"
            >
              续跑
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onOpenCharacterCard?.()}
            className="rounded-lg border border-white/12 px-2 py-1.5 text-[10px] text-white/55 hover:bg-white/[0.06]"
          >
            角色库
          </button>
          <button
            type="button"
            onClick={() => onOpenAssetWall?.()}
            className="rounded-lg border border-white/12 px-2 py-1.5 text-[10px] text-white/55 hover:bg-white/[0.06]"
          >
            资产墙
          </button>
        </div>
      </div>

      {!canRun ? (
        <div className="shrink-0 border-b border-amber-400/20 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-50/90">
          请先确认编剧，再出片
        </div>
      ) : null}
      {canRun && factoryBusy ? (
        <div className="shrink-0 border-b border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-cyan-50">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {factoryProgress?.trim() ? factoryProgress : "生成中…"}
          </div>
        </div>
      ) : null}

      {/* 左资产｜中脚本｜右预览：沉浸用固定三栏 grid，禁止竖叠 */}
      <div
        className={
          immersive
            ? "grid min-h-0 min-w-[1040px] flex-1 grid-cols-[240px_minmax(360px,1fr)_420px] overflow-x-auto overflow-y-hidden"
            : "flex min-h-0 flex-1 overflow-hidden"
        }
      >
        {/* 左：本集资产 */}
        <aside
          className={
            immersive
              ? "min-h-0 overflow-y-auto border-r border-white/10 p-2.5"
              : "min-h-0 w-[240px] shrink-0 overflow-y-auto border-r border-white/10 p-2.5"
          }
        >
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[12px] font-semibold text-white/85">本集资产</div>
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
                className="overflow-hidden rounded-lg border border-amber-400/35 bg-gradient-to-b from-amber-500/20 to-black/50 text-left"
                title={`${a!.nameZh} · 定妆图未入库，造型按文案硬锁`}
              >
                <div className="flex aspect-square w-full flex-col justify-between p-1.5">
                  <span className="rounded bg-black/45 px-1 py-0.5 text-[8px] text-amber-100/80">
                    古风·文案造型
                  </span>
                  <div>
                    <div className="line-clamp-2 text-[10px] font-semibold leading-tight text-amber-50">
                      {a!.nameZh}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[8px] leading-snug text-white/45">
                      {(a!.wardrobeLayers || []).slice(0, 2).join("·") || "古装层次"}
                    </div>
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

        {/* 中：片段脚本 */}
        <section
          className={
            immersive
              ? "flex min-h-0 flex-col overflow-hidden border-r border-white/10 p-2.5 md:p-3"
              : "flex min-h-0 min-w-[360px] flex-1 flex-col overflow-hidden border-r border-white/10 p-2.5 md:p-3"
          }
        >
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <div className="text-[12px] font-semibold text-white/85">
              片段 {String(Math.min(shotIndex + 1, Math.max(shots.length, 1))).padStart(2, "0")}
              {story?.episodeTitle ? ` · ${story.episodeTitle}` : ""}
              <span className="ml-2 font-normal text-white/40">
                {activeShot?.durationSec ?? 5}s · 镜 {activeShot?.index ?? "—"}/{shots.length || 1}
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

          <p className="mt-2 max-h-14 shrink-0 overflow-y-auto rounded-lg border border-white/8 bg-black/30 px-2.5 py-2 text-[11px] leading-relaxed text-white/55">
            {(story?.outputText || story?.prompt || topic || "铺板并跑过故事节点后，此处显示本集摘要。").slice(
              0,
              360,
            )}
          </p>

          <div className="mt-2 shrink-0 text-[11px] font-semibold text-white/70">
            分镜（{shots.length}）· 当前第 {activeShot?.index ?? "—"} 镜
          </div>
          <div className="mt-1.5 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
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

        {/* 右：视频结果 */}
        <aside
          className={
            immersive
              ? "flex min-h-0 flex-col p-2.5 md:p-3"
              : "flex min-h-0 w-[440px] shrink-0 flex-col p-2.5 md:p-3"
          }
        >
          <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
            <div className="text-[12px] font-semibold text-white/90">视频结果</div>
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
            className={`flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden rounded-lg border bg-black ${
              finalVideoUrl || previewIsVideo
                ? "border-cyan-400/45"
                : factoryBusy
                  ? "border-amber-400/35"
                  : "border-white/12"
            }`}
          >
            {finalVideoUrl ? (
              <video src={finalVideoUrl} controls className="h-full max-h-full w-full object-contain" />
            ) : previewUrl ? (
              previewIsVideo ? (
                <video src={previewUrl} controls className="h-full max-h-full w-full object-contain" />
              ) : (
                <img src={previewUrl} alt="" className="h-full max-h-full w-full object-contain" />
              )
            ) : (
              <div className="px-4 text-center text-[11px] leading-relaxed text-white/40">
                {factoryBusy ? "正在生成…" : "点「生成」后，静帧 / 成片在此预览"}
              </div>
            )}
          </div>
          {previewUrl && !previewIsVideo && onRerunKeyartsFromReverse ? (
            <p className="mt-1.5 shrink-0 text-[10px] leading-snug text-white/40">
              静帧不对（穿错时代/没进场景）→ 顶栏点
              <button
                type="button"
                disabled={!canRun || factoryBusy}
                onClick={() => onRerunKeyartsFromReverse()}
                className="mx-0.5 font-semibold text-amber-100/90 underline underline-offset-2 disabled:opacity-45"
              >
                重出静帧
              </button>
              （从反推重跑，覆盖旧图）。「续跑」不会重做已出图。
            </p>
          ) : null}
          <div className="mt-1.5 flex shrink-0 flex-wrap gap-1.5">
            {finalVideoUrl ? (
              <button
                type="button"
                className="text-[10px] text-cyan-100/75 underline underline-offset-2 hover:text-cyan-50"
                onClick={() =>
                  document.querySelector("#manhua-clip-dock-zone")?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  })
                }
              >
                打开成片坞
              </button>
            ) : null}
            {activeKeyart?.id ? (
              <button
                type="button"
                onClick={() => onFocusBlock?.(activeKeyart.id)}
                className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-0.5 text-[10px] text-white/65 hover:bg-white/5"
              >
                <Focus className="h-3 w-3" /> 静帧节点
              </button>
            ) : null}
            {clip?.id ? (
              <button
                type="button"
                onClick={() => onFocusBlock?.(clip.id)}
                className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-0.5 text-[10px] text-white/65 hover:bg-white/5"
              >
                <Focus className="h-3 w-3" /> 成片节点
              </button>
            ) : null}
          </div>
        </aside>
      </div>

      {/* 底胶片：片段条为主（对标阿硕），集切换为次 */}
      <div className="shrink-0 border-t border-white/10 bg-[#080b12] px-2.5 py-2 md:px-3">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-semibold text-white/75">片段</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[9px] text-white/35">
              已出静帧 {episodeKeyarts.filter((b) => mediaUrl(b)).length}/
              {Math.max(episodeKeyarts.length, shots.length, 1)}
            </span>
            <div className="flex gap-1 overflow-x-auto">
              {episodeIndexes.map((ep) => {
                const bound = bibleBoundEpisodes.includes(ep);
                const on = ep === focusEpisode;
                return (
                  <button
                    key={`ep-chip-${ep}`}
                    type="button"
                    onClick={() => onFocusEpisode(ep)}
                    className={`rounded-md border px-1.5 py-0.5 text-[9px] ${
                      on
                        ? "border-cyan-400/50 bg-cyan-500/20 text-cyan-50"
                        : "border-white/10 text-white/40 hover:text-white/65"
                    }`}
                    title={bound ? "设定已绑定" : undefined}
                  >
                    第{ep}集{bound ? "·" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {(shots.length ? shots : [{ index: 1, durationSec: 5, cameraZh: "", actionZh: "" } as ManhuaWorkbenchShot]).map(
            (shot, i) => {
              const shotKey =
                episodeKeyarts.find((b) => resolveKeyartShotIndex(b.id, b.prompt) === shot.index) ||
                episodeKeyarts[i];
              const thumb = mediaUrl(shotKey);
              const on = i === Math.min(shotIndex, Math.max(shots.length, 1) - 1);
              const dur = shot.durationSec || 5;
              return (
                <button
                  key={`shot-${shot.index}`}
                  type="button"
                  onClick={() => setShotIndex(i)}
                  className={`relative w-[100px] shrink-0 overflow-hidden rounded-md border text-left ${
                    on ? "border-white/70 ring-1 ring-white/40" : "border-white/12"
                  }`}
                >
                  <div className="aspect-video bg-black/70">
                    {thumb ? (
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-0.5 text-white/30">
                        <span className="text-[11px] font-semibold">
                          {String(shot.index).padStart(2, "0")}
                        </span>
                        <span className="text-[8px]">待出</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between px-1 py-0.5 text-[9px] text-white/65">
                    <span>片段 {String(shot.index).padStart(2, "0")}</span>
                    <span className="text-white/40">{dur.toFixed(1)}s</span>
                  </div>
                </button>
              );
            },
          )}
        </div>
        {/* 集缩略（窄条，不抢片段胶片） */}
        <div className="mt-2 hidden gap-1.5 overflow-x-auto border-t border-white/5 pt-2 sm:flex">
          {episodeIndexes.map((ep) => {
            const epKeys = keyartsForEpisode(blocks, ep);
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
