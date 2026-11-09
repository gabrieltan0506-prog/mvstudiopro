/**
 * MV 工作区第 4 步前：「为镜头选参考素材」（1109）。
 *
 * - 全片主锚图（@图片1，所有镜头共用）→ 一键套到全部镜头；
 * - 每镜：场景图 2–4（@图片2…）、动作/运镜参考片 1–2（@视频，白模产物优先，否则图库片段）、歌曲切片（@音频1）；
 * - 显示每镜已选数与缺失提示；缺项时「生成缺失镜头」整批拦下（见 CanvasMusicMvStudio.render）。
 * 素材一律走共用抽屉（purpose=mvShot，usage=reference），只存 gcsUri/assetId，签名链出片前现签。
 */
import { useEffect, useRef, useState } from "react";
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
  mvSingerKeyframePrompt,
  detectPerformerGender,
  type MvShotReferenceImage,
  type MvShotReferences,
} from "@shared/canvasMusicMvReferences";
import { stockAttributionText } from "@shared/stockFootage";
import { mvSceneManualBaseWarning, parseMvSceneLocations, planMvSceneImage } from "@shared/canvasMusicMvSceneLock";
import type { ManhuaPrevisStudio } from "@shared/manhuaPrevis";
import { buildMvShotPrevisStudio, mvPrevisAdoptedSummaryZh, mvPrevisAdvisorQuestion, mvShotNeedsPrevis, nextMvShotAutoPrevis } from "@shared/canvasMusicMvPrevis";
import { StockFootageDrawer, type StockFootagePick } from "@/components/stockFootage/StockFootageDrawer";

type Shot = CanvasMusicMvPlan["shots"][number];

/**
 * 1110 多人互动镜头自动白模：由页面（OmniCanvas）注入，复用漫剧创作顾问白模链路。
 * open 打开顾问白模页并按 clipId（镜头块 id）提问；submit=true 时自动发送（免费额度内直接跑，超额弹原有费用确认）。
 */
export type MvPrevisBridge = {
  open: (clipId: string, question: string, submit: boolean) => void;
  /** 镜头卡上的白模试看播放位（data-clip-id 与顾问目标一致才渲染）。 */
  onPreviewHostChange: (host: HTMLDivElement | null) => void;
  /** 顾问白模页当前处理的镜头块；非空时不自动发起下一镜。 */
  activeClipId?: string | null;
  /** 不能使用时的原因（如账号未开放、正在制作）；有值则不自动发起。 */
  unavailableZh?: string;
};

/** 自动发起记录：同一镜头 + 同一节拍内容只自动发起一次（本机按作品保存）。 */
const AUTO_PREVIS_STORE = "mv-previs-auto:v1";
function autoLaunched(projectId: string | undefined, key: string): boolean {
  try { return Boolean(JSON.parse(localStorage.getItem(`${AUTO_PREVIS_STORE}:${projectId || "local"}`) || "{}")[key]); } catch { return false; }
}
function markAutoLaunched(projectId: string | undefined, key: string) {
  try {
    const k = `${AUTO_PREVIS_STORE}:${projectId || "local"}`;
    const map = JSON.parse(localStorage.getItem(k) || "{}") as Record<string, string>;
    localStorage.setItem(k, JSON.stringify({ ...map, [key]: new Date().toISOString() }));
  } catch { /* 记录失败只会多发起一次顾问咨询，仍走额度确认 */ }
}
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
  shotBlocks: Array<{ shotId: string; blockId: string; previs?: { gcsUri: string; durationSec: number; requestId?: string }; castZh?: string[]; previsStudio?: ManhuaPrevisStudio }>;
  /** 1110 自动白模：写镜头块白模工作台（previsStudio）。 */
  onPatchShotPrevis?: (blockId: string, studio: ManhuaPrevisStudio) => void;
  mvPrevis?: MvPrevisBridge;
  orientation: "landscape" | "portrait";
  /** 1109 场景连续性锁：创作说明（解析地点表，无明确换景默认全片同一地点）。 */
  creativePrompt?: string;
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

  /** 演唱者与叙事主角分开锁：演唱镜的 @图片1 换成按声线生成的演唱者定妆帧。 */
  const [singerGender, setSingerGender] = useState<"男" | "女">(() => detectPerformerGender(props.cinemaHintZh) ?? "男");
  const generateSinger = async () => {
    setError("");
    setGenerating(true);
    try {
      const aspect = props.orientation === "landscape" ? "16:9" : "9:16";
      const receipt = await createJobSameOrigin({ type: "image", userId: String(user?.id || ""), input: buildCanvasGptImage2JobInput({ prompt: mvSingerKeyframePrompt(singerGender, props.cinemaHintZh, aspect), aspectRatio: aspect, openaiImageVariant: "sunburst", requireImageVariant: true, imageLane: "asset" }) });
      const job = await pollJobUntilTerminal(receipt.jobId, { intervalMs: 2500, maxWaitMs: 20 * 60 * 1000 });
      const url = String(job.output?.imageUrl || job.output?.imageUrls?.[0] || "");
      const gcsUri = job.status === "succeeded" ? assetImageGcsUri(url) : undefined;
      if (!gcsUri) throw new Error(job.error || "演唱者定妆帧尚未取得，任务编号已保留，请稍后重试查询");
      const singer = { gcsUri, label: `演唱者定妆帧（${singerGender}声）`, hasRealPerson: false };
      const next = { ...(props.shotReferences || {}) };
      for (const shot of shots.filter(s => s.kind === "singing")) next[shot.id] = mvShotReferencesSchema.parse({ ...refsOf(shot.id), anchorImage: singer });
      props.onChange({ anchorImage: props.anchorImage, shotReferences: next });
    } catch (e) {
      setError(e instanceof Error ? e.message : "演唱者定妆帧生成失败");
    } finally {
      setGenerating(false);
    }
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
      const mismatch = mvSceneManualBaseWarning(target.shot.id, { gcsUri: pick.asset.gcsUri, assetId: pick.asset.assetId }, sceneLock, allRefs());
      if (mismatch && !window.confirm(mismatch)) return;
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

  /** 1109 实拍照放入人物重绘：本镜演唱者/主锚图作男主；重绘结果作本镜场景图。 */
  const scenePersonEdit = (shot: Shot) => {
    const lead = refsOf(shot.id).anchorImage ?? props.anchorImage;
    return {
      aspectRatio: (props.orientation === "landscape" ? "16:9" : "9:16") as "9:16" | "16:9",
      options: lead ? [{ slot: "lead" as const, source: lead.gcsUri, label: lead.label || "主角", identityPhoto: Boolean(lead.hasRealPerson) }] : [],
      onEdited: (result: { imageUrl: string; baseAssetId?: string }) => {
        const gcsUri = assetImageGcsUri(result.imageUrl);
        if (!gcsUri) throw new Error("重绘图地址无效，请稍后重试");
        const p = planMvSceneImage(shot.id, sceneLock, allRefs());
        if (p.mode === "master_edit" && result.baseAssetId && "baseAssetId" in p.base && p.base.baseAssetId !== result.baseAssetId) {
          const mismatch = mvSceneManualBaseWarning(shot.id, { gcsUri: "", assetId: result.baseAssetId }, sceneLock, allRefs());
          if (mismatch && !window.confirm(mismatch)) return;
        }
        const now = refsOf(shot.id);
        if (now.sceneImages.length >= MV_SHOT_SCENE_IMAGE_MAX) throw new Error(`本镜场景图最多 ${MV_SHOT_SCENE_IMAGE_MAX} 张`);
        commit(shot.id, { ...now, sceneImages: [...now.sceneImages, { gcsUri, label: "实拍底图重绘（已放入人物）", ...(lead?.hasRealPerson ? { hasRealPerson: true } : {}) }] });
        setTarget(null);
      },
    };
  };

  /** 1109 场景连续性锁：地点表 + 全部镜头参考（母版 = 该地点首张场景图）。 */
  const sceneLock = parseMvSceneLocations(shots, props.creativePrompt);
  const allRefs = () => Object.fromEntries(shots.map(s => [s.id, refsOf(s.id)]));
  const createPersonEdit = trpc.stockFootage.personEdit.useMutation({ retry: false });
  const [masterEditing, setMasterEditing] = useState<string | null>(null);
  /** 按母版重绘：同地点后续镜一律以母版为底图走改图（只改天气、光线、机位/景别、人物）。 */
  const masterEdit = async (shot: Shot) => {
    const p = planMvSceneImage(shot.id, sceneLock, allRefs());
    if (p.mode !== "master_edit") return;
    const lead = refsOf(shot.id).anchorImage ?? props.anchorImage;
    if (!lead) { setError("先选或生成主锚图，再按母版重绘"); return; }
    setError("");
    setMasterEditing(shot.id);
    try {
      const requestId = crypto.randomUUID();
      const beat = shot.beats?.[0];
      await createPersonEdit.mutateAsync({
        requestId,
        ...p.base,
        sceneLockLocationZh: p.locationZh,
        cast: "lead",
        people: [{ slot: "lead", source: lead.gcsUri, identityPhoto: Boolean(lead.hasRealPerson) }],
        actionText: (beat?.actionZh || shot.visualPrompt).slice(0, 600),
        ...(beat?.lightingZh ? { relightText: beat.lightingZh.slice(0, 400) } : {}),
        aspectRatio: props.orientation === "landscape" ? "16:9" : "9:16",
      });
      for (let i = 0; i < 80; i++) {
        const job = await utils.stockFootage.getPersonEdit.fetch({ requestId });
        if (job?.status === "failed") throw new Error(job.error || "按母版重绘失败，原任务保留");
        if (job?.status === "succeeded" && job.imageUrl) {
          const gcsUri = assetImageGcsUri(job.imageUrl);
          if (!gcsUri) throw new Error("重绘图地址无效，请稍后重试");
          const now = refsOf(shot.id);
          if (now.sceneImages.length >= MV_SHOT_SCENE_IMAGE_MAX) throw new Error(`本镜场景图最多 ${MV_SHOT_SCENE_IMAGE_MAX} 张`);
          commit(shot.id, { ...now, sceneImages: [...now.sceneImages, { gcsUri, label: `按母版重绘（${p.locationZh}）`, ...(lead.hasRealPerson ? { hasRealPerson: true } : {}) }] });
          return;
        }
        await new Promise(r => setTimeout(r, 3000));
      }
      throw new Error("按母版重绘仍在处理，请稍后再点一次（原任务保留）");
    } catch (e) {
      setError(e instanceof Error ? e.message : "按母版重绘未完成");
    } finally {
      setMasterEditing(null);
    }
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
        { source: "previs" as const, ...(previs.requestId ? { previsRequestId: previs.requestId } : {}), gcsUri: previs.gcsUri, inSec: 0, outSec: previs.durationSec, durationSec: previs.durationSec, label: "白模动作参考" },
        ...others,
      ].slice(0, MV_SHOT_MOTION_VIDEO_MAX),
    });
  };

  /** 1110：按逐窗节拍 + 角色表建立白模基线，打开创作顾问白模页（站位/动作由顾问给出，不手填坐标）。 */
  const previsShotOf = (shot: Shot) => {
    const row = props.shotBlocks.find(r => r.shotId === shot.id);
    return { row, input: { shotId: shot.id, startSec: shot.startSec, endSec: shot.endSec, kind: shot.kind, visualPrompt: shot.visualPrompt, cameraPrompt: shot.cameraPrompt, beats: shot.beats, castZh: row?.castZh } };
  };
  const launchPrevis = (shot: Shot, submit: boolean) => {
    const bridge = props.mvPrevis;
    const { row, input } = previsShotOf(shot);
    if (!bridge || !props.onPatchShotPrevis) throw new Error("当前页面不能打开白模顾问");
    if (bridge.unavailableZh) throw new Error(bridge.unavailableZh);
    if (!row) throw new Error("请先确认分镜并铺到画布，再生成白模动作参考");
    const need = mvShotNeedsPrevis(input);
    if (!need.needed && need.reason === "cast_insufficient") throw new Error("角色表不足两人：请在创作说明里写『角色表：…』后重建镜头节点");
    if (!need.needed && need.reason === "no_beats") throw new Error("本镜还没有逐窗节拍，请先出逐窗节拍");
    const studio = buildMvShotPrevisStudio(row.blockId, input, row.previsStudio, props.orientation === "portrait" ? "9:16" : "16:9");
    if (studio !== row.previsStudio) props.onPatchShotPrevis(row.blockId, studio);
    const question = mvPrevisAdvisorQuestion(input, { sceneLabels: refsOf(shot.id).sceneImages.map((img, i) => img.label || `场景图${i + 1}`), cues: need.cues });
    // 块写入落盘前顾问读不到基线：下一帧再打开，基线未就绪时短暂重试（最多约 1 秒），其他错误直接显示
    const attempt = (left: number) => {
      try { bridge.open(row.blockId, question, submit); }
      catch (e) {
        const msg = e instanceof Error ? e.message : "未打开顾问";
        if (left > 0 && /基线尚未保存/.test(msg)) setTimeout(() => attempt(left - 1), 100);
        else setError(msg);
      }
    };
    setTimeout(() => attempt(10), 0);
  };
  /** 自动发起：节拍就绪 + 多人互动 + 角色表 ≥2 + 本镜无白模参考；同内容只发起一次，一次只处理一镜。 */
  const autoBusy = useRef(false);
  const launchedKeys = useRef(new Set<string>());
  useEffect(() => {
    const bridge = props.mvPrevis;
    if (disabled || !bridge || bridge.unavailableZh || bridge.activeClipId || autoBusy.current || !props.onPatchShotPrevis) return;
    const candidates = shots.filter(shot => shot.kind !== "footage" && !shot.fillRequested && previsShotOf(shot).row).map(shot => ({ ...previsShotOf(shot).input, shot }));
    const next = nextMvShotAutoPrevis(candidates, (c, key) =>
      refsOf(c.shotId).motionVideos.some(v => v.source === "previs") || launchedKeys.current.has(key) || autoLaunched(props.projectId, key));
    if (!next) return;
    launchedKeys.current.add(next.key);
    markAutoLaunched(props.projectId, next.key);
    autoBusy.current = true;
    try { launchPrevis(next.shot.shot, true); }
    catch (e) { setError(e instanceof Error ? e.message : "白模动作参考未发起"); }
    finally { setTimeout(() => { autoBusy.current = false; }, 0); }
  });

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
        {shots.some(s => s.kind === "singing") && (
          <span className="flex items-center gap-1">
            <select aria-label="演唱者声线" className="rounded border border-white/20 bg-black/30 p-1" value={singerGender} disabled={disabled || generating} onChange={e => setSingerGender(e.target.value as "男" | "女")}>
              <option value="男">男声</option>
              <option value="女">女声</option>
            </select>
            <button className={button} disabled={disabled || generating} onClick={() => void generateSinger()}>生成演唱者定妆帧（只套演唱镜）</button>
          </span>
        )}
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
        const { row, input: previsInput } = previsShotOf(shot);
        const interaction = mvShotNeedsPrevis(previsInput);
        const hasPrevisRef = refs.motionVideos.some(v => v.source === "previs");
        const studioHistory = row?.previsStudio?.history || [];
        const lastPrevis = studioHistory.find(h => h.jobId === row?.previsStudio?.selectedJobId) || studioHistory[studioHistory.length - 1];
        const adoptedPrevis = row?.previs && lastPrevis ? { url: lastPrevis.url, summaryZh: mvPrevisAdoptedSummaryZh(row.previsStudio) } : undefined;
        return (
          <div key={shot.id} className="space-y-1 rounded border border-white/10 p-2 text-xs" data-mv-shot-refs={shot.id}>
            <p>
              <strong>{index + 1}.</strong> {shot.startSec.toFixed(1)}–{shot.endSec.toFixed(1)} 秒 · 图 {counts.image} / 片 {counts.video} / 歌 {counts.audio} · 共 {counts.total}/9
              {staging && <span className="ml-1 text-amber-200">· 多人/动作/多机位镜头：站位参考必填（白模站位片或图库运镜片）</span>}
              {(() => { const p = planMvSceneImage(shot.id, sceneLock, allRefs()); return <span className="ml-1 text-white/60">· 地点：{p.locationZh}{p.mode === "master_edit" ? `（母版取自镜头 ${shots.findIndex(s => s.id === p.master.shotId) + 1}）` : "（本镜首张场景图即母版）"}</span>; })()}
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
              {planMvSceneImage(shot.id, sceneLock, allRefs()).mode === "master_edit" && (
                <button className={button} disabled={disabled || Boolean(masterEditing) || refs.sceneImages.length >= MV_SHOT_SCENE_IMAGE_MAX} onClick={() => void masterEdit(shot)}>
                  {masterEditing === shot.id ? "正在按母版重绘…" : "按母版重绘（同一地点）"}
                </button>
              )}
              <button className={button} disabled={disabled || refs.sceneImages.length >= MV_SHOT_SCENE_IMAGE_MAX} onClick={() => setTarget({ kind: "scene", shot })}>找场景图</button>
              <button className={button} disabled={disabled || refs.motionVideos.length >= MV_SHOT_MOTION_VIDEO_MAX} onClick={() => setTarget({ kind: "motion", shot })}>从图库找运镜视频</button>
              <button className={button} disabled={disabled} onClick={() => usePrevis(shot)}>用白模站位片（去白模工作台排站位）</button>
              {props.mvPrevis && interaction.needed && (
                <button className={button} disabled={disabled || Boolean(props.mvPrevis.unavailableZh)} onClick={() => { try { setError(""); launchPrevis(shot, true); } catch (e) { setError(e instanceof Error ? e.message : "白模动作参考未发起"); } }}>重新生成白模</button>
              )}
              <button className={button} disabled={disabled || prepareSlice.isPending || !props.planRequestId} onClick={() => void sliceSong(shot)}>
                {refs.songSlice ? "重新裁歌曲切片" : "裁本镜歌曲切片"}
              </button>
            </div>
            {interaction.needed && !hasPrevisRef && <p className="text-amber-200" data-mv-previs-hint>检测到多人互动（{interaction.cues.join("；")}）：多人互动镜头建议先生成白模动作参考{props.mvPrevis?.unavailableZh ? `（${props.mvPrevis.unavailableZh}）` : "，已交创作顾问按逐窗节拍排站位与动作"}</p>}
            {row?.blockId && props.mvPrevis?.activeClipId === row.blockId && (
              <div className="rounded border border-cyan-300/30 p-1">
                <p className="text-cyan-100">白模试看（创作顾问按本镜节拍与角色表排的站位与动作）：在顾问面板里用一句话修改，如「她站到他左侧、耳光用右手」；满意后点「应用」，再点下方「采用为动作参考」。</p>
                <div ref={props.mvPrevis.onPreviewHostChange} data-clip-id={row.blockId} data-mv-previs-host="1" />
              </div>
            )}
            {adoptedPrevis && (
              <div className="space-y-1 rounded border border-white/10 p-1" data-mv-previs-adopted={shot.id}>
                {adoptedPrevis.url && <video src={adoptedPrevis.url} controls muted playsInline className="max-h-40 rounded" />}
                {adoptedPrevis.summaryZh && <p className="whitespace-pre-wrap text-white/70">顾问站位与动作说明：{adoptedPrevis.summaryZh}</p>}
                <div className="flex flex-wrap gap-2">
                  <button className={button} disabled={disabled || hasPrevisRef} onClick={() => usePrevis(shot)}>{hasPrevisRef ? "已采用为动作参考" : "采用为动作参考"}</button>
                  {props.mvPrevis && row && <button className={button} disabled={disabled || Boolean(props.mvPrevis.unavailableZh)} onClick={() => { try { props.mvPrevis!.open(row.blockId, "保留这版其他安排，我想调整：", false); } catch (e) { setError(e instanceof Error ? e.message : "未打开顾问"); } }}>让顾问修改站位与动作</button>}
                </div>
              </div>
            )}
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
          {...(target.kind === "scene" ? { personEdit: scenePersonEdit(target.shot) } : {})}
        />
      )}
    </section>
  );
}
