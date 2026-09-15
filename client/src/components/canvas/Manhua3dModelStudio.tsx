/**
 * 3D 模型工作台（PR-4）：把散落在人物卡上的「建立 3D 参考 / 导入 GLB / 预览 / 绑骨」
 * 收成一张全员一览表，按 UX 四问重做：
 *   零位移——不用逐张展开人物卡找按钮；一步达——每人一行、动作固定顺序；
 *   可批量——勾选后一键为多人建模；可撤销——建模不覆盖原图，失败可重试，采用前先预览。
 *
 * 不新造后端：全部走既有 onGenerateAsset3d / onImportAsset3d / 预览 / 绑骨回调。
 * 建模走 WaveSpeed Tripo（扣积分）：批量前先显示人数并确认。
 */
import { useMemo, useState } from "react";
import type { ManhuaAsset3dEligibility } from "@shared/manhuaAsset3d";

export type Manhua3dModelStudioCharacter = {
  id: string;
  labelZh: string;
  thumbUrl?: string;
  eligibility: ManhuaAsset3dEligibility;
};

type Props = {
  characters: Manhua3dModelStudioCharacter[];
  busyIds: readonly string[];
  disabled?: boolean;
  onGenerate?: (id: string) => void | Promise<void>;
  onImport?: (id: string, file: File) => void | Promise<void>;
  onPreview?: (id: string, glbUrl: string, labelZh: string) => void;
  onRig?: (id: string) => void;
  /** 有绑骨成品（白模可直接用）的角色 id */
  riggedIds?: readonly string[];
};

type Stage = "blocked" | "none" | "building" | "review" | "failed" | "ready" | "rigged";

const btn = "rounded border border-cyan-300/30 px-2 py-1 text-[11px] text-cyan-50 disabled:opacity-40";
const btnPrimary = "rounded border border-cyan-300/60 bg-cyan-500/20 px-2 py-1 text-[11px] text-cyan-50 disabled:opacity-40";

export function manhua3dModelStageOf(c: Manhua3dModelStudioCharacter, rigged: boolean): { stage: Stage; labelZh: string; reasonZh?: string } {
  if (!c.eligibility.eligible) return { stage: "blocked", labelZh: "还不能建模", reasonZh: c.eligibility.reasonZh };
  const m = c.eligibility.currentModel3d;
  if (rigged) return { stage: "rigged", labelZh: "已绑骨 · 白模可用" };
  if (!m) return { stage: "none", labelZh: "未建模" };
  switch (m.status) {
    case "queued":
    case "running":
      return { stage: "building", labelZh: "建模中…" };
    case "reconcile_manual":
      return { stage: "review", labelZh: "结果待核对", reasonZh: m.errorZh };
    case "failed":
      return { stage: "failed", labelZh: "建模失败", reasonZh: m.errorZh };
    case "succeeded":
      return { stage: "ready", labelZh: "模型就绪 · 待绑骨" };
  }
}

const STAGE_CLASS: Record<Stage, string> = {
  blocked: "bg-white/10 text-white/60",
  none: "bg-white/10",
  building: "bg-cyan-500/25",
  review: "bg-amber-500/25",
  failed: "bg-red-500/25",
  ready: "bg-emerald-500/20",
  rigged: "bg-emerald-500/35",
};

export function Manhua3dModelStudio(props: Props) {
  const { characters, busyIds, disabled, onGenerate, onImport, onPreview, onRig } = props;
  const riggedIds = props.riggedIds ?? [];
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  const rows = useMemo(
    () => characters.map((c) => ({ c, ...manhua3dModelStageOf(c, riggedIds.includes(c.id)) })),
    [characters, riggedIds],
  );
  const counts = useMemo(() => {
    const total = rows.length;
    const ready = rows.filter((r) => r.stage === "ready" || r.stage === "rigged").length;
    const rigged = rows.filter((r) => r.stage === "rigged").length;
    return { total, ready, rigged };
  }, [rows]);
  const buildable = rows.filter((r) => (r.stage === "none" || r.stage === "failed") && !busyIds.includes(r.c.id));
  const selectedBuildable = buildable.filter((r) => selected.has(r.c.id));

  async function runBatch() {
    if (!onGenerate || !selectedBuildable.length) return;
    setBatchBusy(true);
    setConfirmBatch(false);
    try {
      // 串行提交：每人一单，任一失败不影响其余；不重复提交已在跑的
      for (const r of selectedBuildable) {
        await onGenerate(r.c.id);
      }
      setSelected(new Set());
    } finally {
      setBatchBusy(false);
    }
  }

  return (
    <section className="w-full rounded-xl border border-cyan-300/25 bg-[#0c121d] p-3 text-white" data-manhua-3d-model-studio>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-cyan-100">3D 模型 · 全员一览</span>
        <span className="rounded bg-white/10 px-1.5 py-0.5">模型就绪 {counts.ready}/{counts.total}</span>
        <span className="rounded bg-white/10 px-1.5 py-0.5">已绑骨 {counts.rigged}/{counts.total}</span>
        <span className="text-white/50">流程：人物图 → 建模（Tripo，扣积分）→ 预览核对 → 绑骨 → 白模可用；导入自己的 GLB 可跳过建模</span>
      </div>
      {!characters.length ? <p className="text-[11px] text-amber-100">本剧还没有锁定的人物资产，先在资产区锁角色。</p> : null}
      <ul className="flex flex-col gap-1">
        {rows.map(({ c, stage, labelZh, reasonZh }) => {
          const busy = busyIds.includes(c.id);
          const model = c.eligibility.currentModel3d;
          const canBuild = (stage === "none" || stage === "failed") && !busy && Boolean(onGenerate);
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-2 rounded bg-white/5 px-2 py-1 text-[11px]" data-character-id={c.id} data-stage={stage}>
              <input
                type="checkbox"
                aria-label={`选择 ${c.labelZh} 批量建模`}
                disabled={disabled || !canBuild}
                checked={selected.has(c.id)}
                onChange={(e) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(c.id);
                    else next.delete(c.id);
                    return next;
                  })
                }
              />
              {c.thumbUrl ? <img src={c.thumbUrl} alt={c.labelZh} className="h-8 w-8 rounded object-cover" /> : <span className="h-8 w-8 rounded bg-white/10" />}
              <span className="min-w-[4rem] font-medium">{c.labelZh}</span>
              <span className={`rounded px-1.5 py-0.5 ${STAGE_CLASS[stage]}`}>{busy ? "处理中…" : labelZh}</span>
              {reasonZh ? <span className="text-amber-100">{reasonZh}</span> : null}
              <span className="ml-auto flex gap-1">
                {canBuild ? (
                  <button type="button" className={btnPrimary} disabled={disabled} onClick={() => void onGenerate?.(c.id)}>
                    {stage === "failed" ? "重试建模" : "建模"}
                  </button>
                ) : null}
                {c.eligibility.eligible && onImport && !busy ? (
                  <label className={`${btn} cursor-pointer`}>
                    导入 GLB
                    <input
                      type="file"
                      accept=".glb,model/gltf-binary"
                      className="hidden"
                      disabled={disabled}
                      onChange={(e) => {
                        const file = e.currentTarget.files?.[0];
                        e.currentTarget.value = "";
                        if (file) void onImport(c.id, file);
                      }}
                    />
                  </label>
                ) : null}
                {model?.status === "succeeded" && model.glbUrl && onPreview ? (
                  <button type="button" className={btn} disabled={disabled} onClick={() => onPreview(c.id, model.glbUrl!, c.labelZh)}>
                    预览
                  </button>
                ) : null}
                {model?.status === "succeeded" && onRig ? (
                  <button type="button" className={stage === "rigged" ? btn : btnPrimary} disabled={disabled || busy} onClick={() => onRig(c.id)}>
                    {stage === "rigged" ? "重新绑骨" : "绑骨"}
                  </button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {onGenerate && buildable.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]" data-batch-bar>
          <button type="button" className={btn} disabled={disabled} onClick={() => setSelected(new Set(buildable.map((r) => r.c.id)))}>
            全选未建模（{buildable.length}）
          </button>
          {!confirmBatch ? (
            <button type="button" className={btnPrimary} disabled={disabled || batchBusy || !selectedBuildable.length} onClick={() => setConfirmBatch(true)}>
              为选中 {selectedBuildable.length} 人建模
            </button>
          ) : (
            <span className="flex items-center gap-1 rounded bg-amber-500/20 px-2 py-1">
              将提交 {selectedBuildable.length} 单 Tripo 建模（逐人扣积分，原图不会被替换）
              <button type="button" className={btnPrimary} disabled={batchBusy} onClick={() => void runBatch()}>确认</button>
              <button type="button" className={btn} onClick={() => setConfirmBatch(false)}>取消</button>
            </span>
          )}
        </div>
      ) : null}
    </section>
  );
}
