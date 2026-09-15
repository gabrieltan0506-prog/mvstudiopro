/**
 * PR-3 · Lux3D 资产链最小入口：在人物卡的 3D 行里显示 Lux3D 可用态、
 * 对已完成的 m3d_* 任务发起「导入 GLB 校验」（显式单位/轴向），展示校验结果并允许采用。
 *
 * 不做 3D 建模 UI，不提交任何生成任务；不可用态是真实状态，带原因。
 * TODO(PR-2 对接)：采用后的 assetId 应写回 customAssetRefs / cloud draft，由 OmniCanvas 持有状态源；本 PR 不碰那两处。
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { Manhua3dAssetAxis, Manhua3dAssetRecord, Manhua3dAssetUnits } from "@shared/manhua3dAsset";

type Props = {
  /** 已完成的既有 3D 任务（生成或导入），是资产的来源身份。 */
  sourceJobId: string;
  assetRef: string;
  disabled?: boolean;
};

function verificationLabelZh(asset: Manhua3dAssetRecord): { text: string; tone: string } {
  if (asset.adoptedAt) return { text: `已采用 · r${asset.revision}`, tone: "text-emerald-200/90" };
  switch (asset.verification.status) {
    case "verified":
      return { text: "已校验，可采用", tone: "text-cyan-100" };
    case "rejected":
      return { text: `被拒：${asset.verification.reasonZh || "未说明原因"}`, tone: "text-rose-200/80" };
    default:
      return { text: `待补：${asset.verification.reasonZh || "未验证"}`, tone: "text-amber-100/80" };
  }
}

export default function Manhua3dAssetImportPanel({ sourceJobId, assetRef, disabled }: Props) {
  const [units, setUnits] = useState<Manhua3dAssetUnits | "">("");
  const [axis, setAxis] = useState<Manhua3dAssetAxis | "">("");
  const utils = trpc.useUtils();
  const capability = trpc.manhua3dAsset.capability.useQuery(undefined, { staleTime: 60_000 });
  const assets = trpc.manhua3dAsset.listByJob.useQuery({ sourceJobId }, { enabled: Boolean(sourceJobId) });
  const importMutation = trpc.manhua3dAsset.import.useMutation({
    onSuccess: () => void utils.manhua3dAsset.listByJob.invalidate({ sourceJobId }),
    onError: error => toast.error(error.message || "导入校验失败"),
  });
  const adoptMutation = trpc.manhua3dAsset.adopt.useMutation({
    onSuccess: () => void utils.manhua3dAsset.listByJob.invalidate({ sourceJobId }),
    onError: error => toast.error(error.message || "采用失败"),
  });

  const latest = useMemo(() => {
    const list = assets.data ?? [];
    return list.find(a => a.adoptedAt) ?? list[list.length - 1];
  }, [assets.data]);
  const busy = importMutation.isPending || adoptMutation.isPending;
  const ready = Boolean(units && axis);

  return (
    <div data-manhua-3d-asset-panel className="mt-1 space-y-1 rounded border border-white/10 bg-white/[0.03] p-1.5">
      <p className="text-[9px] leading-3 text-white/55">
        {capability.data?.available
          ? "Lux3D 服务端可续查任务（不含新生成）"
          : `Lux3D 不可用：${capability.data?.reasonZh || "查询中…"}`}
      </p>
      <div className="flex gap-1">
        <select
          aria-label="模型单位"
          className="flex-1 rounded border border-white/15 bg-black/30 px-1 py-0.5 text-[9px] text-white/80"
          value={units}
          disabled={disabled || busy}
          onChange={event => setUnits(event.currentTarget.value as Manhua3dAssetUnits | "")}
        >
          <option value="">单位（必选）</option>
          <option value="m">米 m</option>
          <option value="cm">厘米 cm</option>
        </select>
        <select
          aria-label="模型轴向"
          className="flex-1 rounded border border-white/15 bg-black/30 px-1 py-0.5 text-[9px] text-white/80"
          value={axis}
          disabled={disabled || busy}
          onChange={event => setAxis(event.currentTarget.value as Manhua3dAssetAxis | "")}
        >
          <option value="">轴向（必选）</option>
          <option value="y_up">Y 向上</option>
          <option value="z_up">Z 向上</option>
        </select>
      </div>
      <button
        type="button"
        className="w-full rounded border border-white/15 bg-white/[0.04] px-1.5 py-1 text-[9px] font-medium text-white/70 hover:bg-white/[0.08] disabled:opacity-40"
        disabled={disabled || busy || !ready}
        title="只校验已保存的 GLB（单位/轴向/网格/骨架/材质），不调用外部建模服务"
        onClick={() =>
          importMutation.mutate({
            sourceJobId,
            assetRef,
            units: units || undefined,
            axis: axis || undefined,
            source: "upload",
          })
        }
      >
        {importMutation.isPending ? "校验中…" : "导入 GLB 校验（不生成）"}
      </button>
      {latest ? (
        <div className="space-y-0.5">
          <p className={`text-[9px] leading-3 ${verificationLabelZh(latest).tone}`}>{verificationLabelZh(latest).text}</p>
          {latest.geometry ? (
            <p className="text-[9px] leading-3 text-white/45">
              网格 {latest.geometry.meshCount} · 骨架{" "}
              {latest.skeleton?.hasArmature
                ? latest.skeleton.previsRigCompatible
                  ? "兼容白模绑骨"
                  : `有骨但缺 ${latest.skeleton.missingPrevisBones.length} 根标准骨`
                : "无"}{" "}
              · 材质 {latest.materials?.materialCount ?? 0}
            </p>
          ) : null}
          {latest.verification.status === "verified" && !latest.adoptedAt ? (
            <button
              type="button"
              className="w-full rounded border border-emerald-300/30 bg-emerald-500/10 px-1.5 py-1 text-[9px] font-medium text-emerald-100 disabled:opacity-40"
              disabled={disabled || busy}
              onClick={() => adoptMutation.mutate({ assetId: latest.assetId })}
            >
              采用此资产
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
