/**
 * 场景 3D 世界工作台（PR-8）：每个已锁场景一行——生成 Marble 3DGS 世界 → 预览（全景/缩略图）→ 产物链接（Fly 桥稳定地址）。
 * UX 四问：零位移（不进场景卡）；一步达（每行固定动作）；可批量（勾选一键生成，逐单扣费确认）；可撤销（删除只删上游世界，产物归档保留）。
 * 付费动作只发回调；确认在页面统一做。
 * 0929 简化：主路径只留「选场景 → 查看场景 → 选机位 → 保存视角图 → 采用到镜头」；生成世界、场景质量、粗略地面布局（深度全景）、
 * 删除世界收进默认收起的「生成 3D 世界（可选）」折叠区。只搬位置与文案，生成与计费回调不变。
 */
import { useMemo, useState } from "react";
import {
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
  /** 本段白模采用状态与返回入口；3D 场景只使用演员起点站位，不播放白模动作。 */
  previsStatusZh?: string;
  onOpenPrevis?: () => void;
  savedFrameCount?: number;
  adoptedFrameCount?: number;
};

type Stage = "blocked" | "none" | "building" | "review" | "failed" | "ready";

const btn = "rounded border border-cyan-300/30 px-2 py-1 text-[11px] text-cyan-50 disabled:opacity-40";
const btnPrimary = "rounded border border-cyan-300/60 bg-cyan-500/20 px-2 py-1 text-[11px] text-cyan-50 disabled:opacity-40";
const MODEL_LABEL_ZH: Record<ManhuaWorld3dModel, string> = {
  "marble-1.1-plus": "大场景",
  "marble-1.1": "标准场景",
  "marble-1.0": "经典场景",
  "marble-1.0-draft": "快速草稿",
};

function hasStagePreviewUrl(s: ManhuaWorldStudioScene): boolean {
  try {
    return new URL(s.eligibility.currentWorld3d?.assets?.spz500kUrl || "").protocol === "https:";
  } catch {
    return false;
  }
}

export function manhuaWorldStageOf(s: ManhuaWorldStudioScene): { stage: Stage; labelZh: string; reasonZh?: string } {
  if (!s.eligibility.eligible) return { stage: "blocked", labelZh: "还不能生成", reasonZh: s.eligibility.reasonZh };
  const w = s.eligibility.currentWorld3d;
  if (!w) return { stage: "none", labelZh: "未生成" };
  switch (w.status) {
    case "queued":
    case "running":
      return { stage: "building", labelZh: "生成中…（约 1–5 分钟）" };
    case "reconcile_manual":
      return { stage: "review", labelZh: "结果待核对", reasonZh: "请稍后查看结果，暂勿重复生成" };
    case "failed":
      return { stage: "failed", labelZh: "生成失败", reasonZh: "可重试生成" };
    case "succeeded":
      return hasStagePreviewUrl(s)
        ? { stage: "ready", labelZh: "世界任务完成 · 可检查画面" }
        : { stage: "review", labelZh: "世界任务完成 · 预览文件未就绪", reasonZh: `暂不能查看或保存视角图；刷新后若仍无链接，请保留任务号 ${w.taskId} 核查，不要重新付费生成。` };
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
      setErrorZh("布局预览生成失败，请调整站位后重试");
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
            布局预览已准备。生成场景会产生费用，实际用量以生成记录为准。
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
  const { scenes, busyIds, disabled, onGenerate, onRetry, onRemove, stageCharacters = [], onExportStageFrame, layoutActors, onSubmitLayoutWorld, previsStatusZh, onOpenPrevis, savedFrameCount = 0, adoptedFrameCount = 0 } = props;
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
        <span className="text-cyan-100">3D 场景</span>
        <span className="rounded bg-white/10 px-1.5 py-0.5">可尝试载入 {counts.ready}/{counts.total}</span>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-cyan-300/20 bg-cyan-500/5 p-2 text-[11px] text-white/75" data-world-previs-link>
        <span>本段白模：{previsStatusZh || "尚无可用白模"}。3D 场景读取白模人物的起点站位，逐秒动作与切镜请回白模预演查看。</span>
        {onOpenPrevis ? <button type="button" className={btn} onClick={onOpenPrevis}>查看本段白模预演</button> : null}
      </div>
      {/* 主路径只有五步；生成世界、深度全景、粗略地面布局、删除等都在下方折叠区 */}
      <ol className="mb-2 flex flex-wrap items-center gap-1 text-[11px] text-cyan-50" data-world-steps aria-label="3D 场景使用步骤">
        {["选场景", "查看场景", "选机位", "保存视角图", "采用到镜头"].map((step, i) => (
          <li key={step} className="flex items-center gap-1">
            {i ? <span aria-hidden="true" className="text-white/35">→</span> : null}
            <span className="rounded bg-cyan-500/10 px-1.5 py-0.5">{i + 1}. {step}</span>
          </li>
        ))}
      </ol>
      <p className="mb-2 text-[11px] text-white/50">场景只提供空间与机位参考；人物动作、对白和成片仍在后续步骤制作。还没有世界的场景，到最下面「生成 3D 世界（可选）」里生成。</p>
      <p className="mb-2 text-[11px] text-white/60" data-world-frame-progress>本段视角图：已保存候选 {savedFrameCount} 张，已采用到镜头 {adoptedFrameCount} 处。保存只建立候选，须在下方逐镜采用后才可进入视频输入。</p>
      {!scenes.length ? <p className="text-[11px] text-amber-100">本剧还没有锁定的场景资产，先在资产区出场景空镜并确认。</p> : null}
      <ul className="flex flex-col gap-1" data-world-main-list>
        {rows.map(({ s, stage, labelZh, reasonZh }) => {
          const busy = busyIds.includes(s.id);
          const world = s.eligibility.currentWorld3d;
          const assets = world?.assets;
          const canView = stage === "ready" && Boolean(assets);
          return (
            <li key={s.id} className={`flex flex-wrap items-center gap-2 rounded px-2 py-1 text-[11px] ${canView ? "bg-white/5" : "bg-white/[0.02] text-white/55"}`} data-scene-id={s.id} data-stage={stage}>
              {s.thumbUrl ? <img src={s.thumbUrl} alt={s.labelZh} className="h-8 w-12 rounded object-cover" /> : <span className="h-8 w-12 rounded bg-white/10" />}
              <span className="min-w-[4rem] font-medium">{s.labelZh}</span>
              <span className={`rounded px-1.5 py-0.5 ${STAGE_CLASS[stage]}`}>{busy ? "处理中…" : labelZh}</span>
              {reasonZh ? <span className="text-amber-100">{reasonZh}</span> : null}
              <span className="ml-auto flex gap-1">
                {canView ? (
                  <button type="button" className={btnPrimary} disabled={disabled} data-world-primary="view" onClick={() => setOpenPreviewId((prev) => (prev === s.id ? null : s.id))}>
                    {openPreviewId === s.id ? "收起" : "查看场景"}
                  </button>
                ) : null}
              </span>
              {openPreviewId === s.id && canView && assets ? (
                <div className="mt-1 w-full rounded border border-cyan-300/20 bg-black/30 p-2" data-manhua-world-preview>
                  <div className="flex flex-wrap gap-2">
                    {assets.panoUrl ? <img src={assets.panoUrl} alt={`${s.labelZh} 全景`} className="h-32 rounded object-cover" /> : null}
                    {!assets.panoUrl && assets.thumbnailUrl ? <img src={assets.thumbnailUrl} alt={`${s.labelZh} 缩略图`} className="h-32 rounded object-cover" /> : null}
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
            </li>
          );
        })}
      </ul>
      {scenes.length && (onGenerate || onRemove || onSubmitLayoutWorld) ? (
        <details className="mt-2 rounded border border-white/10 bg-white/[0.02] p-2" data-world-manage>
          <summary className="min-h-9 cursor-pointer py-1 text-[11px] font-semibold text-white/70">生成 3D 世界（可选）· 生成与重试、场景质量、粗略地面布局、删除世界</summary>
          <div className="mt-2 flex flex-col gap-2">
            <label className="flex items-center gap-1 text-[11px] text-white/70">
              场景质量
              <select aria-label="3D 场景质量" className="rounded border border-white/20 bg-black/40 px-1 py-0.5 text-[11px] text-white" value={model} disabled={disabled} onChange={(e) => setModel(e.target.value as ManhuaWorld3dModel)}>
                {MANHUA_WORLD_3D_MODELS.map((m) => (
                  <option key={m} value={m}>{MODEL_LABEL_ZH[m]}</option>
                ))}
              </select>
              <span className="text-white/45">生成世界会逐单计费；已生成的世界在上面查看与出视角图。</span>
            </label>
            <ul className="flex flex-col gap-1">
              {rows.map(({ s, stage, labelZh }) => {
                const busy = busyIds.includes(s.id);
                const canBuild = (stage === "none" || stage === "failed") && !busy && Boolean(onGenerate);
                const canRemove = (stage === "ready" || stage === "failed" || stage === "review") && Boolean(onRemove);
                const showLayout = (stage === "none" || stage === "failed") && !busy && Boolean(layoutActors && onSubmitLayoutWorld);
                if (!canBuild && !canRemove && !showLayout) return null;
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 rounded bg-white/5 px-2 py-1 text-[11px]" data-manage-scene-id={s.id}>
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
                    <span className="min-w-[4rem] font-medium">{s.labelZh}</span>
                    <span className={`rounded px-1.5 py-0.5 ${STAGE_CLASS[stage]}`}>{busy ? "处理中…" : labelZh}</span>
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
                      {canRemove ? (
                        <button type="button" className={btn} disabled={disabled || busy} title="删除这个场景的 3D 世界" onClick={() => void onRemove?.(s.id)}>
                          删除世界
                        </button>
                      ) : null}
                    </span>
                    {showLayout && layoutActors && onSubmitLayoutWorld ? (
                      <LayoutPanel scene={s} model={model} textPrompt={promptFor(s)} actors={layoutActors} disabled={disabled} onSubmit={(options) => onSubmitLayoutWorld(s.id, options)} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {onGenerate && buildable.length ? (
              <div className="flex flex-wrap items-center gap-2 text-[11px]" data-batch-bar>
                <button type="button" className={btn} disabled={disabled} onClick={() => setSelected(new Set(buildable.map((r) => r.s.id)))}>
                  全选未生成（{buildable.length}）
                </button>
                {!confirmBatch ? (
                  <button type="button" className={btnPrimary} disabled={disabled || batchBusy || !selectedBuildable.length} onClick={() => setConfirmBatch(true)}>
                    为选中 {selectedBuildable.length} 个场景生成世界
                  </button>
                ) : (
                  <span className="flex items-center gap-1 rounded bg-amber-500/20 px-2 py-1">
                    将为 {selectedBuildable.length} 个场景分别生成（{MODEL_LABEL_ZH[model]}，逐单计费；失败的留在勾选里）
                    <button type="button" className={btnPrimary} disabled={batchBusy} onClick={() => void runBatch()}>确认</button>
                    <button type="button" className={btn} onClick={() => setConfirmBatch(false)}>取消</button>
                  </span>
                )}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}
