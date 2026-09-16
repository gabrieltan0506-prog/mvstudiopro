/**
 * 场景 3D 世界工作台（PR-8）：每个已锁场景一行——生成 Marble 3DGS 世界 → 预览（全景/缩略图）→ 产物链接（Fly 桥稳定地址）。
 * UX 四问：零位移（不进场景卡）；一步达（每行固定动作）；可批量（勾选一键生成，逐单扣费确认）；可撤销（删除只删上游世界，产物归档保留）。
 * 付费动作只发回调；确认在页面统一做。
 */
import { useMemo, useState } from "react";
import {
  MANHUA_WORLD_3D_MODEL_LABEL_ZH,
  MANHUA_WORLD_3D_MODELS,
  type ManhuaWorld3dEligibility,
  type ManhuaWorld3dModel,
} from "@shared/manhuaWorld3d";

export type ManhuaWorldStudioScene = {
  id: string;
  labelZh: string;
  thumbUrl?: string;
  /** 场景表氛围句，作默认提示词 */
  hintZh?: string;
  eligibility: ManhuaWorld3dEligibility;
};

export type ManhuaWorldGenerateOptions = { model: ManhuaWorld3dModel; textPrompt: string };

type Props = {
  scenes: ManhuaWorldStudioScene[];
  busyIds: readonly string[];
  disabled?: boolean;
  onGenerate?: (id: string, options: ManhuaWorldGenerateOptions) => void | Promise<void>;
  onRetry?: (id: string) => void | Promise<void>;
  onRemove?: (id: string) => void | Promise<void>;
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

export function ManhuaWorldStudio(props: Props) {
  const { scenes, busyIds, disabled, onGenerate, onRetry, onRemove } = props;
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
                </div>
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
