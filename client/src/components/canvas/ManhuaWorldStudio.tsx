/**
 * 场景 3D 世界工作台（PR-8）：每个已锁场景一行——生成 Marble 3DGS 世界 → 预览（全景/缩略图）→ 产物链接（Fly 桥稳定地址）。
 * UX 四问：零位移（不进场景卡）；一步达（每行固定动作）；可批量（勾选一键生成，逐单扣费确认）；可撤销（删除只删上游世界，产物归档保留）。
 * 付费动作只发回调；确认在页面统一做。
 */
import { useMemo, useState } from "react";
import {
  MANHUA_WORLD_3D_MODEL_CREDITS,
  MANHUA_WORLD_3D_MODEL_LABEL_ZH,
  MANHUA_WORLD_3D_MODELS,
  type ManhuaWorld3dEligibility,
  type ManhuaWorld3dModel,
} from "@shared/manhuaWorld3d";
import {
  DEPTH_PANO_DEFAULT_WIDTH,
  depthPanoSceneFromPrevisActors,
  encodeRgbPngFromGray,
  quantizeDepthForUpload,
  quantizeDepthTo8bit,
  renderLayoutDepthPano,
  type DepthPanoMeta,
} from "@shared/manhuaLayoutDepthPano";
import { ManhuaWorldStagePreview, type ManhuaStageCharacter, type ManhuaStageFrameExport } from "./ManhuaWorldStagePreview";

export type ManhuaWorldStudioScene = {
  id: string;
  labelZh: string;
  thumbUrl?: string;
  /** 场景表氛围句，作默认提示词 */
  hintZh?: string;
  eligibility: ManhuaWorld3dEligibility;
};

export type ManhuaWorldGenerateOptions = { model: ManhuaWorld3dModel; textPrompt: string };

/** 导出视角图的绑定草稿：预览给机位/人物/实例版本，工作台补世界身份；上层再补集/段号 */
export type ManhuaStageFrameBindingDraft = ManhuaStageFrameExport & { worldTaskId: string; worldId?: string; worldSourceVersion: string };

/** PR-11 布局可控：深度全景 PNG + 元数据 + 提示词，由页面上传后以 layout 提示提交 */
export type ManhuaWorldLayoutSubmitOptions = { model: ManhuaWorld3dModel; textPrompt: string; depthPng: Blob; meta: DepthPanoMeta };

/** 当前段白模站位（用于生成深度全景） */
export type ManhuaWorldLayoutActor = { id: string; nameZh?: string; start: readonly [number, number]; shape?: "human" | "horse" };

type Props = {
  scenes: ManhuaWorldStudioScene[];
  busyIds: readonly string[];
  disabled?: boolean;
  onGenerate?: (id: string, options: ManhuaWorldGenerateOptions) => void | Promise<void>;
  onRetry?: (id: string) => void | Promise<void>;
  onRemove?: (id: string) => void | Promise<void>;
  /** PR-10：已就绪人物 GLB + 舞台点，放进就绪世界预览 */
  stageCharacters?: readonly ManhuaStageCharacter[];
  /** PR-10：导出的视角 PNG → 上传 → 作该场景候选参考图 */
  onExportStageFrame?: (sceneRefId: string, blob: Blob, frame: ManhuaStageFrameBindingDraft) => void | Promise<void>;
  /** PR-11：当前段白模站位；有则显示「布局可控」子面板 */
  layoutActors?: readonly ManhuaWorldLayoutActor[];
  onSubmitLayoutWorld?: (sceneRefId: string, options: ManhuaWorldLayoutSubmitOptions) => void | Promise<void>;
};

type Stage = "blocked" | "none" | "building" | "review" | "failed" | "ready";

const btn = "rounded border border-cyan-300/30 px-2 py-1 text-[11px] text-cyan-50 disabled:opacity-40";
const btnPrimary = "rounded border border-cyan-300/60 bg-cyan-500/20 px-2 py-1 text-[11px] text-cyan-50 disabled:opacity-40";

export function manhuaWorldStageOf(s: ManhuaWorldStudioScene): { stage: Stage; labelZh: string; reasonZh?: string } {
  if (!s.eligibility.eligible) return { stage: "blocked", labelZh: "还不能生成", reasonZh: s.eligibility.reasonZh };
  const w = s.eligibility.currentWorld3d;
  if (!w) return { stage: "none", labelZh: "未生成" };
  switch (w.status) {
    case "queued":
    case "running":
      return { stage: "building", labelZh: "生成中…（约 1–5 分钟）" };
    case "reconcile_manual":
      return { stage: "review", labelZh: "结果待核对", reasonZh: w.errorZh };
    case "failed":
      return { stage: "failed", labelZh: "生成失败", reasonZh: w.errorZh };
    case "succeeded":
      return { stage: "ready", labelZh: w.assets?.spz500kGcsUri ? "世界就绪 · 已归档" : "世界就绪 · 归档中" };
  }
}

export function manhuaWorldCounts(scenes: ManhuaWorldStudioScene[]): { total: number; ready: number } {
  return { total: scenes.length, ready: scenes.filter((s) => manhuaWorldStageOf(s).stage === "ready").length };
}

const STAGE_CLASS: Record<Stage, string> = {
  blocked: "bg-white/10 text-white/60",
  none: "bg-white/10",
  building: "bg-cyan-500/25",
  review: "bg-amber-500/25",
  failed: "bg-red-500/25",
  ready: "bg-emerald-500/20",
};

/** 深度全景 → 预览小图（灰度 → RGBA data URL）；无 DOM 时返回空串 */
function depthPreviewDataUrl(gray: Uint8Array, width: number, height: number): string {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  const scale = Math.max(1, Math.round(width / 512));
  canvas.width = Math.floor(width / scale);
  canvas.height = Math.floor(height / scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const v = gray[y * scale * width + x * scale] ?? 0;
      const i = (y * canvas.width + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

type LayoutDraft = { sourceKey: string; previewUrl: string; png: Blob; bytes: number; meta: DepthPanoMeta; actorCount: number };

function LayoutPanel(props: {
  scene: ManhuaWorldStudioScene;
  model: ManhuaWorld3dModel;
  textPrompt: string;
  actors: readonly ManhuaWorldLayoutActor[];
  disabled?: boolean;
  onSubmit: (options: ManhuaWorldLayoutSubmitOptions) => void | Promise<void>;
}) {
  const { scene, model, textPrompt, actors, disabled, onSubmit } = props;
  const [storedDraft, setDraft] = useState<LayoutDraft | null>(null);
  const sourceKey = JSON.stringify([scene.id, actors]);
  const draft = storedDraft?.sourceKey === sourceKey ? storedDraft : null;
  const [busy, setBusy] = useState(false);
  const [errorZh, setErrorZh] = useState("");
  function render() {
    setErrorZh("");
    try {
      const depthScene = depthPanoSceneFromPrevisActors(actors);
      const r = renderLayoutDepthPano(depthScene, { width: DEPTH_PANO_DEFAULT_WIDTH });
      // 上传编码 = 官方对数反相（z_min/z_max 随请求体走）；屏幕预览另用线性近亮，两者分开
      const bytes = encodeRgbPngFromGray(r.width, r.height, quantizeDepthForUpload(r));
      const png = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: "image/png" });
      setDraft({ sourceKey, previewUrl: depthPreviewDataUrl(quantizeDepthTo8bit(r), r.width, r.height), png, bytes: bytes.byteLength, meta: r.meta, actorCount: actors.length });
    } catch (error) {
      setErrorZh(error instanceof Error ? error.message : "深度全景生成失败");
    }
  }
  const prompt = textPrompt.trim();
  return (
    <div className="mt-1 flex w-full flex-wrap items-center gap-2 rounded border border-violet-300/25 bg-violet-500/10 p-2 text-[11px]" data-manhua-world-layout>
      <span className="text-violet-100">粗略地面布局</span>
      <span className="text-white/55">本段 {actors.length} 人的站位仅确定观察点；当前只提供平地深度，未包含建筑、道具或演员，不保证生成后的落点。</span>
      <button type="button" className={btn} disabled={disabled || !actors.length} onClick={render}>
        {draft ? "重新生成深度全景" : "生成深度全景"}
      </button>
      {draft ? (
        <>
          <img src={draft.previewUrl} alt={`${scene.labelZh} 深度全景`} className="h-16 rounded border border-white/10 object-cover" data-depth-preview />
          <span className="text-white/45" data-depth-upload-meta>
            上传 {draft.meta.width}×{draft.meta.height} RGB 8bit PNG（{Math.ceil(draft.bytes / 1024)} KB）· z_min {draft.meta.zMin}m / z_max {draft.meta.zMax}m · 编码 {draft.meta.encoding}（官方对数反相，近亮）
            · 费用：上色一步按上游回执记账 + 建世界 {MANHUA_WORLD_3D_MODEL_CREDITS[model].min === MANHUA_WORLD_3D_MODEL_CREDITS[model].max ? MANHUA_WORLD_3D_MODEL_CREDITS[model].min : `${MANHUA_WORLD_3D_MODEL_CREDITS[model].min}–${MANHUA_WORLD_3D_MODEL_CREDITS[model].max}`} credits
          </span>
          <button
            type="button"
            className={btnPrimary}
            disabled={disabled || busy || prompt.length < 2}
            title={prompt.length < 2 ? "布局提示词必填（描述材质/时间/氛围）" : undefined}
            onClick={() => {
              setBusy(true);
              void Promise.resolve(onSubmit({ model, textPrompt: prompt, depthPng: draft.png, meta: draft.meta })).finally(() => setBusy(false));
            }}
          >
            {busy ? "提交中…" : "按粗略地面生成世界"}
          </button>
        </>
      ) : null}
      {errorZh ? <span className="text-amber-100">{errorZh}</span> : null}
    </div>
  );
}

export function ManhuaWorldStudio(props: Props) {
  const { scenes, busyIds, disabled, onGenerate, onRetry, onRemove, stageCharacters = [], onExportStageFrame, layoutActors, onSubmitLayoutWorld } = props;
  const [model, setModel] = useState<ManhuaWorld3dModel>("marble-1.1");
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [openPreviewId, setOpenPreviewId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  const rows = useMemo(() => scenes.map((s) => ({ s, ...manhuaWorldStageOf(s) })), [scenes]);
  const counts = useMemo(() => manhuaWorldCounts(scenes), [scenes]);
  const buildable = rows.filter((r) => (r.stage === "none" || r.stage === "failed") && !busyIds.includes(r.s.id));
  const selectedBuildable = buildable.filter((r) => selected.has(r.s.id));
  const promptFor = (s: ManhuaWorldStudioScene) => (prompts[s.id] ?? s.hintZh ?? "").trim();

  async function runBatch() {
    if (!onGenerate || !selectedBuildable.length) return;
    setBatchBusy(true);
    setConfirmBatch(false);
    try {
      const left = new Set<string>();
      for (const r of selectedBuildable) {
        try {
          await onGenerate(r.s.id, { model, textPrompt: promptFor(r.s) });
        } catch {
          left.add(r.s.id);
        }
      }
      setSelected(left);
    } finally {
      setBatchBusy(false);
    }
  }

  return (
    <section className="w-full rounded-xl border border-cyan-300/25 bg-[#0c121d] p-3 text-white" data-manhua-world-studio>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-cyan-100">3D 场景 · 全员一览</span>
        <span className="rounded bg-white/10 px-1.5 py-0.5">世界就绪 {counts.ready}/{counts.total}</span>
        <label className="flex items-center gap-1 text-white/70">
          模型档
          <select aria-label="3D 世界模型档" className="rounded border border-white/20 bg-black/40 px-1 py-0.5 text-[11px] text-white" value={model} disabled={disabled} onChange={(e) => setModel(e.target.value as ManhuaWorld3dModel)}>
            {MANHUA_WORLD_3D_MODELS.map((m) => (
              <option key={m} value={m}>{MANHUA_WORLD_3D_MODEL_LABEL_ZH[m]}</option>
            ))}
          </select>
        </label>
        <span className="text-white/50">流程：场景空镜 → 生成世界（Marble，按档扣费）→ 全景/碰撞网格/高斯文件落 Fly，可直接用于角色进场景与多机位关键帧</span>
      </div>
      <div className="mb-3 grid gap-2 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.05] p-2 text-[11px] leading-5 text-cyan-50 sm:grid-cols-3" aria-label="3DGS 场景用途说明">
        <p><b>用在哪：</b>同一场景的不同镜头可复用空间与机位。例如“临水坊市”用于坊市镜头；医馆、后院和河滩需要各自的场景。</p>
        <p><b>怎么用：</b>点“预览与产物”看全景与高斯场景，摆入角色并导出视角图，再作为该镜关键帧的空间参考。</p>
        <p><b>不会自动做：</b>3DGS 是场景空间，不含人物表演、对白或成片；角色模型、白模动作与镜头画面仍需分别检查。</p>
      </div>
      {!scenes.length ? <p className="text-[11px] text-amber-100">本剧还没有锁定的场景资产，先在资产区出场景空镜并确认。</p> : null}
      <ul className="flex flex-col gap-1">
        {rows.map(({ s, stage, labelZh, reasonZh }) => {
          const busy = busyIds.includes(s.id);
          const world = s.eligibility.currentWorld3d;
          const assets = world?.assets;
          const canBuild = (stage === "none" || stage === "failed") && !busy && Boolean(onGenerate);
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-2 rounded bg-white/5 px-2 py-1 text-[11px]" data-scene-id={s.id} data-stage={stage}>
              <input
                type="checkbox"
                aria-label={`选择 ${s.labelZh} 批量生成世界`}
                disabled={disabled || !canBuild}
                checked={selected.has(s.id)}
                onChange={(e) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(s.id);
                    else next.delete(s.id);
                    return next;
                  })
                }
              />
              {s.thumbUrl ? <img src={s.thumbUrl} alt={s.labelZh} className="h-8 w-12 rounded object-cover" /> : <span className="h-8 w-12 rounded bg-white/10" />}
              <span className="min-w-[4rem] font-medium">{s.labelZh}</span>
              <span className={`rounded px-1.5 py-0.5 ${STAGE_CLASS[stage]}`}>{busy ? "处理中…" : labelZh}</span>
              {reasonZh ? <span className="text-amber-100">{reasonZh}</span> : null}
              {stage === "none" || stage === "failed" ? (
                <input
                  aria-label={`${s.labelZh} 世界提示词`}
                  className="min-w-[14rem] flex-1 rounded border border-white/15 bg-black/30 px-2 py-0.5 text-[11px] text-white placeholder:text-white/30"
                  placeholder="氛围/时间/材质（可空，默认用场景表氛围句）"
                  value={prompts[s.id] ?? s.hintZh ?? ""}
                  disabled={disabled || busy}
                  onChange={(e) => setPrompts((prev) => ({ ...prev, [s.id]: e.target.value }))}
                />
              ) : null}
              <span className="ml-auto flex gap-1">
                {canBuild ? (
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={disabled}
                    data-manhua-action="generate-world"
                    onClick={() => void (stage === "failed" && onRetry ? onRetry(s.id) : onGenerate?.(s.id, { model, textPrompt: promptFor(s) }))}
                  >
                    {stage === "failed" ? "重试生成" : "生成 3D 世界"}
                  </button>
                ) : null}
                {stage === "ready" && assets ? (
                  <button type="button" className={btn} disabled={disabled} onClick={() => setOpenPreviewId((prev) => (prev === s.id ? null : s.id))}>
                    {openPreviewId === s.id ? "收起" : "预览与产物"}
                  </button>
                ) : null}
                {(stage === "ready" || stage === "failed" || stage === "review") && onRemove ? (
                  <button type="button" className={btn} disabled={disabled || busy} title="删除上游世界（省存储）；Fly/GCS 产物归档保留" onClick={() => void onRemove(s.id)}>
                    删除世界
                  </button>
                ) : null}
              </span>
              {openPreviewId === s.id && assets ? (
                <div className="mt-1 w-full rounded border border-cyan-300/20 bg-black/30 p-2" data-manhua-world-preview>
                  <div className="flex flex-wrap gap-2">
                    {assets.panoUrl ? <img src={assets.panoUrl} alt={`${s.labelZh} 全景`} className="h-32 rounded object-cover" /> : null}
                    {!assets.panoUrl && assets.thumbnailUrl ? <img src={assets.thumbnailUrl} alt={`${s.labelZh} 缩略图`} className="h-32 rounded object-cover" /> : null}
                    <div className="flex flex-col gap-1 text-[11px]">
                      {assets.caption ? <p className="text-white/70">{assets.caption}</p> : null}
                      <p className="text-white/60">
                        尺度 {assets.metricScaleFactor ?? "未给"} · 地面偏移 {assets.groundPlaneOffset ?? "未给"}
                        {world?.worldId ? ` · world ${world.worldId.slice(0, 8)}` : ""}
                      </p>
                      <p className="flex flex-wrap gap-2">
                        {assets.spz500kUrl ? <a className="underline" href={assets.spz500kUrl} target="_blank" rel="noreferrer">高斯 500k（.spz）</a> : null}
                        {assets.colliderGlbUrl ? <a className="underline" href={assets.colliderGlbUrl} target="_blank" rel="noreferrer">碰撞网格（.glb）</a> : null}
                        {assets.panoUrl ? <a className="underline" href={assets.panoUrl} target="_blank" rel="noreferrer">全景图</a> : null}
                        {assets.worldMarbleUrl ? <a className="underline" href={assets.worldMarbleUrl} target="_blank" rel="noreferrer">在 Marble 打开（需外网）</a> : null}
                      </p>
                      <p className="text-white/45">产物走 Fly 稳定地址，中国可达；归档 {assets.spz500kGcsUri ? "已完成" : "进行中"}。</p>
                    </div>
                  </div>
                  <div className="mt-2">
                    <ManhuaWorldStagePreview
                      sceneLabelZh={s.labelZh}
                      world={assets}
                      characters={stageCharacters}
                      onExportStageFrame={
                        onExportStageFrame && world
                          ? (blob, frame) => onExportStageFrame(s.id, blob, { ...frame, worldTaskId: world.taskId, ...(world.worldId ? { worldId: world.worldId } : {}), worldSourceVersion: world.sourceVersion })
                          : undefined
                      }
                    />
                  </div>
                </div>
              ) : null}
              {(stage === "none" || stage === "failed") && !busy && layoutActors && onSubmitLayoutWorld ? (
                <LayoutPanel scene={s} model={model} textPrompt={promptFor(s)} actors={layoutActors} disabled={disabled} onSubmit={(options) => onSubmitLayoutWorld(s.id, options)} />
              ) : null}
            </li>
          );
        })}
      </ul>
      {onGenerate && buildable.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]" data-batch-bar>
          <button type="button" className={btn} disabled={disabled} onClick={() => setSelected(new Set(buildable.map((r) => r.s.id)))}>
            全选未生成（{buildable.length}）
          </button>
          {!confirmBatch ? (
            <button type="button" className={btnPrimary} disabled={disabled || batchBusy || !selectedBuildable.length} onClick={() => setConfirmBatch(true)}>
              为选中 {selectedBuildable.length} 个场景生成世界
            </button>
          ) : (
            <span className="flex items-center gap-1 rounded bg-amber-500/20 px-2 py-1">
              将提交 {selectedBuildable.length} 单 Marble（{MANHUA_WORLD_3D_MODEL_LABEL_ZH[model]}，逐单扣费；失败的留在勾选里）
              <button type="button" className={btnPrimary} disabled={batchBusy} onClick={() => void runBatch()}>确认</button>
              <button type="button" className={btn} onClick={() => setConfirmBatch(false)}>取消</button>
            </span>
          )}
        </div>
      ) : null}
    </section>
  );
}
