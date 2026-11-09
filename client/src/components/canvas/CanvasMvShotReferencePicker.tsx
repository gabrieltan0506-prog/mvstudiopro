/**
 * MV 工作区第 4 步前：「为镜头选参考素材」（1109）。
 *
 * - 全片主锚图（@图片1，所有镜头共用）→ 一键套到全部镜头；
 * - 每镜：场景图 2–4（@图片2…）、动作/运镜参考片 1–2（@视频，白模产物优先，否则图库片段）、歌曲切片（@音频1）；
 * - 显示每镜已选数与缺失提示；缺项时「生成缺失镜头」整批拦下（见 CanvasMusicMvStudio.render）。
 * 素材一律走共用抽屉（purpose=mvShot，usage=reference），只存 gcsUri/assetId，签名链出片前现签。
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { createJobSameOrigin, pollJobUntilTerminal } from "@/lib/jobs";
import { buildCanvasGptImage2JobInput } from "@shared/canvasGptImage2JobInput";
import { assetImageGcsUri } from "@/lib/manhuaAssetImageSource";
import { mvShotNeedsStagingReference, type CanvasMusicMvPlan } from "@shared/canvasMusicMv";
import {
  EMPTY_MV_SHOT_REFERENCES,
  MV_SHOT_MOTION_VIDEO_MAX,
  MV_SHOT_SCENE_IMAGE_MAX,
  applyAnchorImageToAll,
  countMvShotReferences,
  mvShotReferenceGaps,
  mvShotReferencesSchema,
  mvAnchorKeyframePrompt,
  mvShotReferenceLimits,
  type MvShotReferenceImage,
  type MvShotReferences,
} from "@shared/canvasMusicMvReferences";
import { stockAttributionText } from "@shared/stockFootage";
import { StockFootageDrawer, type StockFootagePick } from "@/components/stockFootage/StockFootageDrawer";

type Shot = CanvasMusicMvPlan["shots"][number];
type Target =
  | { kind: "anchor" }
  | { kind: "scene"; shot: Shot }
  | { kind: "motion"; shot: Shot }
  | { kind: "fill"; shot: Shot; windowIndex: number; media: "video" | "photo"; query: string; cameraZh: string };

export type CanvasMvShotReferencePickerProps = {
  projectId?: string;
  planRequestId?: string;
  shots: Shot[];
  anchorImage?: MvShotReferenceImage;
  shotReferences?: Record<string, MvShotReferences>;
  /**
   * 画布上已铺的镜头块：白模产物取该镜头块「采用为本段参考」的白模（manhuaSegmentRefs.previs），
   * 未采用时取白模工作台最近一次成片（previsStudio.history 末条）。
   */
  shotBlocks: Array<{ shotId: string; blockId: string; previs?: { gcsUri: string; durationSec: number; requestId?: string } }>;
  orientation: "landscape" | "portrait";
  /** 镜头创意摘要（Cinema 参数中文），拼进关键词来源。 */
  cinemaHintZh?: string;
  /** 镜头成片模型（参考片裁切长度按其单条上限）。 */
  videoModel?: string;
  /** 1109 吟唱镜素材填充合成完成：镜头片段（与镜头等长）。 */
  onFillComposed?: (shotId: string, clip: { gcsUri: string; durationSec: number }) => void | Promise<void>;
  disabled?: boolean;
  onChange: (next: { anchorImage?: MvShotReferenceImage; shotReferences: Record<string, MvShotReferences> }) => void;
};

const button = "rounded border border-white/20 px-2 py-1 text-xs disabled:opacity-40";

function imageFromPick(pick: StockFootagePick, realPerson: boolean): MvShotReferenceImage {
  return {
    assetId: pick.asset.assetId,
    gcsUri: pick.asset.gcsUri,
    width: pick.asset.width,
    height: pick.asset.height,
    label: stockAttributionText(pick.asset.source),
    ...(realPerson ? { hasRealPerson: true } : {}),
  };
}

export function CanvasMvShotReferencePicker(props: CanvasMvShotReferencePickerProps) {
  const { shots, disabled } = props;
  const [target, setTarget] = useState<Target | null>(null);
  const [realPerson, setRealPerson] = useState(false);
  const [error, setError] = useState("");
  const prepareSlice = trpc.canvasMusicMv.prepareShotSongSlice.useMutation({ retry: false });
  const trimMotion = trpc.canvasMusicMv.trimShotMotionClip.useMutation({ retry: false });
  /** 改入点重裁：用户在 UI 调整参考片入点（出点 = 入点 + 自动长度）。 */
  const retrim = async (shot: Shot, index: number, inSec: number) => {
    const now = refsOf(shot.id);
    const v = now.motionVideos[index];
    if (!v?.trimmedFrom) return;
    setError("");
    const trimmed = await trimMotion.mutateAsync({ sourceGcsUri: v.trimmedFrom.gcsUri, shotSec: shot.endSec - shot.startSec, maxSec: mvShotReferenceLimits(props.videoModel).maxVideoItemSec, inSec });
    commit(shot.id, { ...now, motionVideos: now.motionVideos.map((m, i) => i === index ? { ...m, gcsUri: trimmed.gcsUri, inSec: 0, outSec: trimmed.durationSec, durationSec: trimmed.durationSec, trimmedFrom: { ...m.trimmedFrom!, inSec: trimmed.inSec, outSec: trimmed.outSec, auto: false } } : m) });
  };
  const utils = trpc.useUtils();
  const refsOf = (shotId: string): MvShotReferences =>
    mvShotReferencesSchema.parse({
      ...EMPTY_MV_SHOT_REFERENCES,
      ...(props.shotReferences?.[shotId] || {}),
      ...(props.anchorImage && !props.shotReferences?.[shotId]?.anchorImage ? { anchorImage: props.anchorImage } : {}),
    });
  const commit = (shotId: string, next: MvShotReferences) =>
    props.onChange({
      anchorImage: props.anchorImage,
      shotReferences: { ...(props.shotReferences || {}), [shotId]: mvShotReferencesSchema.parse(next) },
    });

  const { user } = useAuth();
  const [generating, setGenerating] = useState(false);
  /** 主锚图 = 生成的角色定妆帧（与漫剧定妆同链，Sunburst），不再从图库硬找有人物的图。 */
  const generateAnchor = async () => {
    setError("");
    setGenerating(true);
    try {
      const aspect = props.orientation === "landscape" ? "16:9" : "9:16";
      const receipt = await createJobSameOrigin({
        type: "image",
        userId: String(user?.id || ""),
        input: buildCanvasGptImage2JobInput({
          prompt: mvAnchorKeyframePrompt(props.cinemaHintZh, aspect),
          aspectRatio: aspect,
          openaiImageVariant: "sunburst",
          requireImageVariant: true,
          imageLane: "asset",
        }),
      });
      const job = await pollJobUntilTerminal(receipt.jobId, { intervalMs: 2500, maxWaitMs: 20 * 60 * 1000 });
      const url = String(job.output?.imageUrl || job.output?.imageUrls?.[0] || "");
      const gcsUri = job.status === "succeeded" ? assetImageGcsUri(url) : undefined;
      if (!gcsUri) throw new Error(job.error || "定妆帧尚未取得，任务编号已保留，请稍后重试查询");
      props.onChange({
        anchorImage: { gcsUri, label: "生成的主角定妆帧", hasRealPerson: false },
        shotReferences: { ...(props.shotReferences || {}) },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "定妆帧生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const composeFill = trpc.canvasMusicMv.composeFillShot.useMutation({ retry: false });
  /** 吟唱镜每窗选定的图库素材（视频直接剪入 / 照片推拉）。 */
  const [fillPicks, setFillPicks] = useState<Record<string, Record<number, { kind: "video" | "photo"; gcsUri: string; cameraZh: string; label: string }>>>({});
  const composeFillShot = async (shot: Shot) => {
    const picks = fillPicks[shot.id] || {};
    const windows = (shot.fill || []).map((w, i) => {
      const p = picks[i];
      if (!p) throw new Error(`第 ${i + 1} 窗还没选素材`);
      return { startSec: w.startSec, endSec: w.endSec, kind: p.kind, gcsUri: p.gcsUri, cameraZh: p.cameraZh };
    });
    const built = await composeFill.mutateAsync({ shotId: shot.id, aspect: props.orientation === "portrait" ? "9:16" : "16:9", windows });
    await props.onFillComposed?.(shot.id, { gcsUri: built.gcsUri, durationSec: built.durationSec });
  };

  const onPick = async (pick: StockFootagePick) => {
    if (!target) return;
    setError("");
    if (target.kind === "fill") {
      const t = target;
      setFillPicks(prev => ({ ...prev, [t.shot.id]: { ...(prev[t.shot.id] || {}), [t.windowIndex]: { kind: t.media, gcsUri: pick.asset.gcsUri, cameraZh: t.cameraZh, label: stockAttributionText(pick.asset.source) } } }));
      setTarget(null);
      return;
    }
    if (target.kind === "anchor") {
      const anchor = imageFromPick(pick, realPerson);
      props.onChange({ anchorImage: anchor, shotReferences: { ...(props.shotReferences || {}) } });
    } else if (target.kind === "scene") {
      const now = refsOf(target.shot.id);
      if (now.sceneImages.length >= MV_SHOT_SCENE_IMAGE_MAX)
        throw new Error(`本镜场景图最多 ${MV_SHOT_SCENE_IMAGE_MAX} 张`);
      if (now.sceneImages.some(i => i.gcsUri === pick.asset.gcsUri)) throw new Error("这张图已选过");
      commit(target.shot.id, { ...now, sceneImages: [...now.sceneImages, imageFromPick(pick, realPerson)] });
    } else {
      const now = refsOf(target.shot.id);
      if (now.motionVideos.length >= MV_SHOT_MOTION_VIDEO_MAX)
        throw new Error(`本镜参考片最多 ${MV_SHOT_MOTION_VIDEO_MAX} 段`);
      // 参考片整条送给模型：先自动裁成 min(本镜时长, 所选模型单条上限)；入点用抽屉里选的，没选（0）就取运动最强段
      const shotSec = target.shot.endSec - target.shot.startSec;
      const trimmed = await trimMotion.mutateAsync({
        sourceGcsUri: pick.asset.gcsUri,
        shotSec,
        maxSec: mvShotReferenceLimits(props.videoModel).maxVideoItemSec,
        ...(pick.inSec > 0 ? { inSec: pick.inSec } : {}),
      });
      commit(target.shot.id, {
        ...now,
        motionVideos: [
          ...now.motionVideos,
          {
            source: "stock",
            assetId: pick.asset.assetId,
            gcsUri: trimmed.gcsUri,
            inSec: 0,
            outSec: trimmed.durationSec,
            durationSec: trimmed.durationSec,
            label: stockAttributionText(pick.asset.source),
            trimmedFrom: { gcsUri: pick.asset.gcsUri, inSec: trimmed.inSec, outSec: trimmed.outSec, sourceSec: trimmed.sourceSec, auto: trimmed.auto },
            ...(realPerson ? { hasRealPerson: true } : {}),
          },
        ],
      });
    }
    setTarget(null);
  };

  /** 白模产物：本镜头块已采用/最近一次的白模，整段作 @视频1（排在图库片之前）。 */
  const usePrevis = (shot: Shot) => {
    setError("");
    const previs = props.shotBlocks.find(row => row.shotId === shot.id)?.previs;
    if (!previs) {
      setError("本镜还没有白模站位片：先铺镜头，在镜头节点打开白模工作台生成并采用；或改用图库运镜参考片");
      return;
    }
    const now = refsOf(shot.id);
    const others = now.motionVideos.filter(v => v.source !== "previs");
    commit(shot.id, {
      ...now,
      motionVideos: [
        { source: "previs" as const, ...(previs.requestId ? { previsRequestId: previs.requestId } : {}), gcsUri: previs.gcsUri, inSec: 0, outSec: previs.durationSec, durationSec: previs.durationSec, label: "白模站位片" },
        ...others,
      ].slice(0, MV_SHOT_MOTION_VIDEO_MAX),
    });
  };

  /** 歌曲切片：服务端按分镜秒位裁出，任务成功后回填 gcsUri。 */
  const sliceSong = async (shot: Shot) => {
    if (!props.planRequestId) return;
    setError("");
    try {
      const requestId = crypto.randomUUID();
      const started = await prepareSlice.mutateAsync({ requestId, planRequestId: props.planRequestId, shotId: shot.id });
      for (let i = 0; i < 60; i++) {
        const job = await utils.mvAnalysis.getPostProdJob.fetch({ jobId: started.jobId });
        if (job?.status === "failed" || job?.status === "cancelled") throw new Error(job.error || "歌曲切片失败，原任务保留");
        const out = job?.output as { gcsUri?: string; sourceStartSec?: number; sourceEndSec?: number } | undefined;
        if (job?.status === "succeeded" && out?.gcsUri) {
          if (out.sourceStartSec !== shot.startSec || out.sourceEndSec !== shot.endSec)
            throw new Error("切片回执与镜头秒位不一致，未绑定");
          commit(shot.id, { ...refsOf(shot.id), songSlice: { jobId: started.jobId, gcsUri: out.gcsUri, startSec: shot.startSec, endSec: shot.endSec } });
          return;
        }
        await new Promise(r => setTimeout(r, 3000));
      }
      throw new Error("歌曲切片仍在处理，请稍后再点一次（原任务保留）");
    } catch (e) {
      setError(e instanceof Error ? e.message : "歌曲切片未确认");
    }
  };

  const removeAt = (shotId: string, kind: "scene" | "motion", index: number) => {
    const now = refsOf(shotId);
    commit(shotId, kind === "scene"
      ? { ...now, sceneImages: now.sceneImages.filter((_, i) => i !== index) }
      : { ...now, motionVideos: now.motionVideos.filter((_, i) => i !== index) });
  };

  const totalBlocking = shots.reduce((n, shot) => n + (shot.kind === "footage" || shot.fillRequested ? 0 : mvShotReferenceGaps(refsOf(shot.id), undefined, { requiresStaging: mvShotNeedsStagingReference(shot.complexity) }).blocking.length ? 1 : 0), 0);

  return (
    <section data-mv-step="references" aria-label="为镜头选参考素材" className="space-y-2">
      <h3 className="border-t border-white/15 pt-5 text-base font-semibold">为镜头选参考素材</h3>
      <p className="text-[11px] text-white/60">
        每个镜头都按参考素材生成：主锚图保证人物和场景前后一致，场景图定光线色调，参考片定站位与运镜，歌曲切片定节奏。每镜最多 9 项。
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span>全片主锚图：{props.anchorImage ? props.anchorImage.label || "已选" : "未选"}</span>
        <button className={button} disabled={disabled || generating} onClick={() => void generateAnchor()}>
          {generating ? "正在生成定妆帧…" : props.anchorImage ? "重新生成主角定妆帧" : "按主角描述生成主锚图"}
        </button>
        <button className={button} disabled={disabled} onClick={() => setTarget({ kind: "anchor" })}>
          {props.anchorImage ? "从图库更换主锚图" : "从图库选主锚图"}
        </button>
        <button
          className={button}
          disabled={disabled || !props.anchorImage}
          onClick={() =>
            props.onChange({
              anchorImage: props.anchorImage,
              shotReferences: applyAnchorImageToAll(props.shotReferences || {}, shots.map(s => s.id), props.anchorImage!),
            })
          }
        >
          一键套到全部镜头
        </button>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={realPerson} onChange={e => setRealPerson(e.target.checked)} />
          接下来选的素材含真人
        </label>
      </div>
      {shots.map((shot, index) => {
        if (shot.kind === "footage")
          return <p key={shot.id} className="text-xs text-white/50">{index + 1}. 已有素材切片，无需参考</p>;
        if (shot.fillRequested) {
          const picks = fillPicks[shot.id] || {};
          return (
            <div key={shot.id} className="space-y-1 rounded border border-white/10 p-2 text-xs" data-mv-shot-fill={shot.id}>
              <p><strong>{index + 1}.</strong> {shot.startSec.toFixed(1)}–{shot.endSec.toFixed(1)} 秒 · 吟唱段：不对口型，按顾问建议用素材填充</p>
              {!shot.fill?.length && <p className="text-amber-200">还没有素材填充建议：请先「按确认版歌词重排镜头」。</p>}
              {shot.fill?.map((w, wi) => (
                <div key={wi} className="rounded border border-white/10 p-1">
                  <p>{w.startSec.toFixed(1)}–{w.endSec.toFixed(1)} 秒 · {w.moodZh}{picks[wi] ? ` · 已选：${picks[wi]!.label}` : ""}</p>
                  {w.candidates.map((c, ci) => (
                    <p key={ci} className="flex flex-wrap items-center gap-1 text-white/70">
                      <span>{c.mode === "stock_video" ? "实拍视频剪入" : c.mode === "stock_photo" ? "照片推拉" : "参考生视频"}：{c.queryZh || c.queryEn}（{c.cameraZh}）— {c.reasonZh}</span>
                      {c.mode !== "generated" && (
                        <button className={button} disabled={disabled} onClick={() => setTarget({ kind: "fill", shot, windowIndex: wi, media: c.mode === "stock_video" ? "video" : "photo", query: c.queryEn, cameraZh: c.cameraZh })}>一键搜</button>
                      )}
                    </p>
                  ))}
                </div>
              ))}
              {!!shot.fill?.length && (
                <button className={button} disabled={disabled || composeFill.isPending || shot.fill.some((_, wi) => !picks[wi])} onClick={() => void composeFillShot(shot).catch(e => setError(e instanceof Error ? e.message : "素材填充合成失败"))}>
                  {composeFill.isPending ? "正在合成…" : "合成本镜素材填充"}
                </button>
              )}
            </div>
          );
        }
        const refs = refsOf(shot.id);
        const counts = countMvShotReferences(refs);
        const staging = mvShotNeedsStagingReference(shot.complexity);
        const gaps = mvShotReferenceGaps(refs, undefined, { requiresStaging: staging });
        return (
          <div key={shot.id} className="space-y-1 rounded border border-white/10 p-2 text-xs" data-mv-shot-refs={shot.id}>
            <p>
              <strong>{index + 1}.</strong> {shot.startSec.toFixed(1)}–{shot.endSec.toFixed(1)} 秒 · 图 {counts.image} / 片 {counts.video} / 歌 {counts.audio} · 共 {counts.total}/9
              {staging && <span className="ml-1 text-amber-200">· 多人/动作/多机位镜头：站位参考必填（白模站位片或图库运镜片）</span>}
            </p>
            {refs.sceneImages.map((img, i) => (
              <span key={img.gcsUri} className="mr-2 inline-flex items-center gap-1">
                场景图{i + 1}：{img.label || "已选"}
                <button className="text-white/50" disabled={disabled} onClick={() => removeAt(shot.id, "scene", i)} aria-label="移除场景图">×</button>
              </span>
            ))}
            {refs.motionVideos.map((v, i) => (
              <span key={v.gcsUri} className="mr-2 inline-flex items-center gap-1">
                参考片{i + 1}：{v.label || (v.source === "previs" ? "白模站位片" : "运镜参考")}（{v.trimmedFrom ? `原片 ${v.trimmedFrom.inSec.toFixed(1)}–${v.trimmedFrom.outSec.toFixed(1)} 秒${v.trimmedFrom.auto ? "，自动取运动最强段" : ""}` : `${v.inSec.toFixed(1)}–${v.outSec.toFixed(1)}秒`}）
                {v.trimmedFrom && <input aria-label={`参考片${i + 1}入点`} className="ml-1 w-16 rounded border border-white/20 bg-black/30 px-1" type="number" step="0.1" min="0" max={Math.max(0, v.trimmedFrom.sourceSec - v.durationSec)} defaultValue={v.trimmedFrom.inSec} disabled={disabled || trimMotion.isPending} onBlur={e => { const n = Number(e.currentTarget.value); if (Number.isFinite(n) && Math.abs(n - v.trimmedFrom!.inSec) > 0.05) void retrim(shot, i, n).catch(err => setError(err instanceof Error ? err.message : "重裁失败")); }} />}
                <button className="text-white/50" disabled={disabled} onClick={() => removeAt(shot.id, "motion", i)} aria-label="移除参考片">×</button>
              </span>
            ))}
            <div className="flex flex-wrap gap-2">
              <button className={button} disabled={disabled || refs.sceneImages.length >= MV_SHOT_SCENE_IMAGE_MAX} onClick={() => setTarget({ kind: "scene", shot })}>找场景图</button>
              <button className={button} disabled={disabled || refs.motionVideos.length >= MV_SHOT_MOTION_VIDEO_MAX} onClick={() => setTarget({ kind: "motion", shot })}>从图库找运镜视频</button>
              <button className={button} disabled={disabled} onClick={() => usePrevis(shot)}>用白模站位片（去白模工作台排站位）</button>
              <button className={button} disabled={disabled || prepareSlice.isPending || !props.planRequestId} onClick={() => void sliceSong(shot)}>
                {refs.songSlice ? "重新裁歌曲切片" : "裁本镜歌曲切片"}
              </button>
            </div>
            {gaps.blocking.length > 0 && <p className="text-amber-200">缺：{gaps.blocking.map(g => g.messageZh).join("；")}</p>}
            {!gaps.blocking.length && gaps.advisory.length > 0 && <p className="text-white/50">建议：{gaps.advisory.map(g => g.messageZh).join("；")}</p>}
          </div>
        );
      })}
      {totalBlocking > 0 && <p className="text-xs text-amber-200">还有 {totalBlocking} 个镜头参考不完整，补齐后才能生成。</p>}
      {error && <p role="alert" className="text-xs text-amber-200">{error}</p>}
      {target && (
        <StockFootageDrawer
          open
          onClose={() => setTarget(null)}
          title={target.kind === "anchor" ? "选全片主锚图" : target.kind === "scene" ? `为镜头 ${shots.indexOf(target.shot) + 1} 找场景图` : target.kind === "fill" ? `为吟唱镜 ${shots.indexOf(target.shot) + 1} 第 ${target.windowIndex + 1} 窗找素材` : `为镜头 ${shots.indexOf(target.shot) + 1} 找运镜参考片`}
          purpose="mvShot"
          usage="reference"
          kind={target.kind === "motion" ? "video" : target.kind === "fill" ? target.media : "photo"}
          {...(target.kind === "fill" ? { initialQuery: target.query } : {})}
          orientation={props.orientation}
          targetDurationSec={target.kind === "motion" ? Math.max(1, target.shot.endSec - target.shot.startSec) : target.kind === "fill" && target.shot.fill ? Math.max(1, target.shot.fill[target.windowIndex]!.endSec - target.shot.fill[target.windowIndex]!.startSec) : undefined}
          sourceText={
            target.kind === "anchor"
              ? [shots.map(s => s.visualPrompt).join("；"), props.cinemaHintZh].filter(Boolean).join("；")
              : [target.shot.visualPrompt, target.shot.cameraPrompt, props.cinemaHintZh].filter(Boolean).join("；")
          }
          context={{ projectId: props.projectId, ...(target.kind !== "anchor" ? { shotId: target.shot.id } : {}) }}
          confirmLabel="采用为参考"
          onPick={onPick}
        />
      )}
    </section>
  );
}
