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
import {
  MANHUA_MULTIVIEW_VIEWS,
  MANHUA_MULTIVIEW_VIEW_LABEL_ZH,
  evaluateManhuaMultiviewReadiness,
  orderManhuaMultiviewViews,
  type ManhuaMultiviewDraft,
  type ManhuaMultiviewView,
} from "@shared/manhuaMultiview";

export type Manhua3dModelStudioCharacter = {
  id: string;
  labelZh: string;
  thumbUrl?: string;
  eligibility: ManhuaAsset3dEligibility;
  /**
   * 0916 绑骨模型来源：锁脸图没就绪模型时可用同人物候选图（如 A-pose 定妆）的模型；
   * 绑骨/白模/场景预览都按它取模型，绑骨编辑器按 refId 开（服务端绑骨任务挂在该 ref 上）。
   */
  rigSource?: import("@shared/manhuaRigSource").ManhuaRigSource;
  rigOptions?: import("@shared/manhuaRigSource").ManhuaRigSource[];
};

type Props = {
  characters: Manhua3dModelStudioCharacter[];
  busyIds: readonly string[];
  disabled?: boolean;
  onGenerate?: (id: string) => void | Promise<void>;
  onImport?: (id: string, file: File) => void | Promise<void>;
  onPreview?: (id: string, glbUrl: string, labelZh: string) => void;
  /** 打开绑骨编辑器：sourceRefId = 模型所在 ref（可能是候选图）；characterId = 人物锁脸 ref（用于钉选来源） */
  onRig?: (sourceRefId: string, characterId: string) => void;
  /** 有绑骨成品（白模可直接用）的角色 id */
  riggedIds?: readonly string[];
  /** 0916 多视角：每人的四视角草稿（按 ref.id） */
  multiviewDrafts?: Record<string, ManhuaMultiviewDraft | undefined>;
  /** 出四视角图（缺哪几张出哪几张；不传 views = 全部四张）；付费出图，确认在回调里做 */
  onGenerateMultiview?: (id: string, views?: ManhuaMultiviewView[]) => void | Promise<void>;
  /** 用四视角草稿提交 Tripo multiview-to-3d */
  onSubmitMultiview?: (id: string) => void | Promise<void>;
};

type Stage = "blocked" | "none" | "building" | "review" | "failed" | "ready" | "rigged";

const btn = "rounded border border-cyan-300/30 px-2 py-1 text-[11px] text-cyan-50 disabled:opacity-40";
const btnPrimary = "rounded border border-cyan-300/60 bg-cyan-500/20 px-2 py-1 text-[11px] text-cyan-50 disabled:opacity-40";

export function manhua3dModelStageOf(c: Manhua3dModelStudioCharacter, rigged: boolean): { stage: Stage; labelZh: string; reasonZh?: string } {
  if (!c.eligibility.eligible) return { stage: "blocked", labelZh: "还不能建模", reasonZh: c.eligibility.reasonZh };
  const m = c.eligibility.currentModel3d;
  if (rigged) return { stage: "rigged", labelZh: "已绑骨 · 白模可用" };
  // 锁脸图没模型但候选图（A-pose）有就绪模型：按候选图算就绪，绑骨用它
  if (!m && c.rigSource?.isCandidate) return { stage: "ready", labelZh: `候选图模型就绪 · 待绑骨（${c.rigSource.labelZh}）` };
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

/**
 * 给 collectPreparedRigProfiles 用的人物表（1468 R2）：**必须带 model.taskId**，
 * 否则它的 `!character?.model` 直接跳过，riggedIds 永远为空、「已绑骨」阶段从不出现。
 */
export function manhua3dRigLookupCharacters(
  characters: Manhua3dModelStudioCharacter[],
): Array<{ id: string; label: string; model?: { taskId: string } }> {
  return characters.map((c) => {
    // 0916：模型来源统一走 rigSource（锁脸图优先，否则同人物候选图）
    const m = c.rigSource?.model ?? (c.eligibility.eligible ? c.eligibility.currentModel3d : undefined);
    return { id: c.id, label: c.labelZh, ...(m?.status === "succeeded" ? { model: { taskId: m.taskId } } : {}) };
  });
}

/** 按钮与面板共用的计数口径（1468 R1）：就绪 = ready 或 rigged（阶段判定后，blocked 的人即使有旧模型也不算） */
export function manhua3dModelCounts(characters: Manhua3dModelStudioCharacter[], riggedIds: readonly string[]): { total: number; ready: number; rigged: number } {
  const stages = characters.map((c) => manhua3dModelStageOf(c, riggedIds.includes(c.id)).stage);
  return {
    total: characters.length,
    ready: stages.filter((st) => st === "ready" || st === "rigged").length,
    rigged: stages.filter((st) => st === "rigged").length,
  };
}

/**
 * 批量建模：串行提交，**任一失败不中断其余**（1468 R1：原先 for-await 里一人抛错整批停）。
 * 返回失败名单让 UI 留着勾选供重试；成功的从勾选里去掉。
 */
export async function runManhua3dBatch(
  ids: readonly string[],
  onGenerate: (id: string) => void | Promise<void>,
): Promise<{ succeeded: string[]; failed: Array<{ id: string; messageZh: string }> }> {
  const succeeded: string[] = [];
  const failed: Array<{ id: string; messageZh: string }> = [];
  for (const id of ids) {
    try {
      await onGenerate(id);
      succeeded.push(id);
    } catch (error) {
      failed.push({ id, messageZh: error instanceof Error ? error.message : String(error) });
    }
  }
  return { succeeded, failed };
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
  const { characters, busyIds, disabled, onGenerate, onImport, onPreview, onRig, onGenerateMultiview, onSubmitMultiview } = props;
  const riggedIds = props.riggedIds ?? [];
  const multiviewDrafts = props.multiviewDrafts ?? {};
  const [multiviewOpenId, setMultiviewOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchFailures, setBatchFailures] = useState<Array<{ id: string; messageZh: string }>>([]);

  const rows = useMemo(
    () => characters.map((c) => ({ c, ...manhua3dModelStageOf(c, riggedIds.includes(c.id)) })),
    [characters, riggedIds],
  );
  const counts = useMemo(() => manhua3dModelCounts(characters, riggedIds), [characters, riggedIds]);
  const buildable = rows.filter((r) => (r.stage === "none" || r.stage === "failed") && !busyIds.includes(r.c.id));
  const selectedBuildable = buildable.filter((r) => selected.has(r.c.id));

  async function runBatch() {
    if (!onGenerate || !selectedBuildable.length) return;
    setBatchBusy(true);
    setConfirmBatch(false);
    try {
      // 串行提交：每人一单，任一失败不影响其余；失败的留在勾选里供重试
      const result = await runManhua3dBatch(selectedBuildable.map((r) => r.c.id), onGenerate);
      setBatchFailures(result.failed);
      setSelected(new Set(result.failed.map((f) => f.id)));
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
          const rigSource = c.rigSource;
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
                  <label className={`${btn} cursor-pointer`} title="上传本机 GLB 作为这个人物的模型（替代 Tripo 建模，不扣积分）；与人物卡里「导入 GLB 校验」不同：那是校验已建好的模型">
                    上传 GLB 替代建模
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
                {rigSource && onRig ? (
                  <button
                    type="button"
                    className={stage === "rigged" ? btn : btnPrimary}
                    disabled={disabled || busy}
                    data-rig-source-ref={rigSource.refId}
                    title={rigSource.isCandidate ? `绑骨用候选图「${rigSource.labelZh}」的模型（原定妆与高模保留，A-pose 只作绑骨生产资产）` : undefined}
                    onClick={() => onRig(rigSource.refId, c.id)}
                  >
                    {stage === "rigged" ? "重新绑骨" : rigSource.isCandidate ? `绑骨（用「${rigSource.labelZh}」）` : "绑骨"}
                  </button>
                ) : null}
                {(c.rigOptions?.length ?? 0) > 1 && onRig
                  ? c.rigOptions!
                      .filter((o) => o.refId !== rigSource?.refId)
                      .map((o) => (
                        <button key={o.refId} type="button" className={btn} disabled={disabled || busy} data-rig-source-ref={o.refId} onClick={() => onRig(o.refId, c.id)}>
                          改用「{o.labelZh}」绑骨
                        </button>
                      ))
                  : null}
                {c.eligibility.eligible && onGenerateMultiview && onSubmitMultiview ? (
                  <button
                    type="button"
                    className={btn}
                    disabled={disabled}
                    data-manhua-action="toggle-multiview"
                    title="用定妆图改出前/左/后/右四张白底视角图，过目后再提交 Tripo 多视角建模；比单图更保侧面与背面细节"
                    onClick={() => setMultiviewOpenId((prev) => (prev === c.id ? null : c.id))}
                  >
                    {multiviewOpenId === c.id ? "收起四视角" : multiviewDrafts[c.id] ? "查看四视角" : "四视角建模"}
                  </button>
                ) : null}
              </span>
              {multiviewOpenId === c.id && onGenerateMultiview && onSubmitMultiview ? (
                <ManhuaMultiviewPanel
                  labelZh={c.labelZh}
                  draft={multiviewDrafts[c.id]}
                  sourceVersion={c.eligibility.sourceVersion}
                  busy={busy}
                  disabled={Boolean(disabled)}
                  canSubmit={!busy && (stage === "none" || stage === "failed" || stage === "ready" || stage === "rigged")}
                  rebuild={stage === "ready" || stage === "rigged"}
                  onGenerate={(views) => void onGenerateMultiview(c.id, views)}
                  onSubmit={() => void onSubmitMultiview(c.id)}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {batchFailures.length ? (
        <p className="mt-2 text-[11px] text-amber-100" data-batch-failures>
          上一批 {batchFailures.length} 人提交失败（其余已提交）：{batchFailures.map((f) => `${characters.find((c) => c.id === f.id)?.labelZh ?? f.id}：${f.messageZh}`).join("；")}
        </p>
      ) : null}
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

/**
 * 四视角面板（PR-7）：出图 → 逐张过目/重出 → 提交多视角建模。
 * 付费动作只发回调；确认与扣费提示由页面统一做，这里不弹 confirm。
 */
export function ManhuaMultiviewPanel(props: {
  labelZh: string;
  draft?: ManhuaMultiviewDraft;
  sourceVersion: string;
  busy: boolean;
  disabled: boolean;
  /** 当前人物能否提交建模（建模中/待核对不可；已有模型可重建） */
  canSubmit: boolean;
  /** 已有模型：提交=替换重建 */
  rebuild?: boolean;
  onGenerate: (views?: ManhuaMultiviewView[]) => void;
  onSubmit: () => void;
}) {
  const { labelZh, draft, sourceVersion, busy, disabled, canSubmit, rebuild, onGenerate, onSubmit } = props;
  const readiness = evaluateManhuaMultiviewReadiness(draft, sourceVersion);
  const stale = Boolean(draft && draft.sourceVersion !== sourceVersion);
  const views = draft && !stale ? orderManhuaMultiviewViews(draft.views) : [];
  const byView = new Map(views.map((v) => [v.view, v] as const));
  const missing = MANHUA_MULTIVIEW_VIEWS.filter((v) => !byView.has(v));
  return (
    <div className="mt-1 w-full rounded border border-cyan-300/20 bg-black/30 p-2" data-manhua-multiview-panel>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-cyan-100">{labelZh} · 四视角</span>
        <span className="text-white/50">顺序固定 正面/左侧/背面/右侧；正面必有，至少 2 张即可提交</span>
        {stale ? <span className="text-amber-100">定妆图已换，旧视角图不能用，请重出</span> : null}
      </div>
      <div className="grid grid-cols-4 gap-1">
        {MANHUA_MULTIVIEW_VIEWS.map((view) => {
          const hit = byView.get(view);
          return (
            <div key={view} className="flex flex-col items-center gap-1 rounded bg-white/5 p-1 text-[10px]" data-multiview-slot={view} data-filled={hit ? "1" : "0"}>
              <span>{MANHUA_MULTIVIEW_VIEW_LABEL_ZH[view]}</span>
              {hit ? (
                <img src={hit.url} alt={`${labelZh} ${MANHUA_MULTIVIEW_VIEW_LABEL_ZH[view]}`} className="h-24 w-full rounded object-contain bg-white" />
              ) : (
                <span className="flex h-24 w-full items-center justify-center rounded border border-dashed border-white/20 text-white/40">未出</span>
              )}
              <button type="button" className={btn} disabled={disabled || busy} onClick={() => onGenerate([view])}>
                {hit ? "重出这张" : "补出这张"}
              </button>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        {missing.length === MANHUA_MULTIVIEW_VIEWS.length ? (
          <button type="button" className={btnPrimary} disabled={disabled || busy} onClick={() => onGenerate()}>
            出四视角图（4 张改图，逐张扣积分）
          </button>
        ) : missing.length ? (
          <button type="button" className={btn} disabled={disabled || busy} onClick={() => onGenerate(missing)}>
            补齐缺的 {missing.length} 张
          </button>
        ) : null}
        <button
          type="button"
          className={btnPrimary}
          disabled={disabled || busy || !readiness.ready || !canSubmit}
          data-manhua-action="submit-multiview"
          title={!readiness.ready ? readiness.reasonZh : !canSubmit ? "建模中或结果待核对，先等它结束" : rebuild ? "用四视角重建并替换现有模型（扣积分；旧 GLB 保留在任务记录）" : "提交 Tripo H3.1 多视角建模（扣积分）"}
          onClick={onSubmit}
        >
          {rebuild ? "用四视角重建模型" : "提交多视角建模"}
        </button>
        {busy ? <span className="text-cyan-100">出图/提交进行中，逐张落稿，可稍后回来</span> : null}
        {!readiness.ready ? <span className="text-amber-100">{readiness.reasonZh}</span> : null}
      </div>
    </div>
  );
}
