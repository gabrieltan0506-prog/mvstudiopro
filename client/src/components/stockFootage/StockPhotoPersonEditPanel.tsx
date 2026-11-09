/**
 * 素材抽屉内「放入人物重绘」（1109）：选中一张实拍照片后，选男主/女主/双人 + 一句动作描述，
 * 以该照片为底图重绘，把人物合成进真实街景（保留透视、材质与光源）。
 * 底图先按抽屉同一采用流程存入本人空间（拿 assetId），再幂等入队；按画布出图单价结算，失败自动退回。
 */
import { useMemo, useState } from "react";
import { Loader2, UserRoundPlus } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { StockFootageAssetView } from "@shared/stockFootage";
import { canvasImageCredits } from "@shared/canvasGenerationPricing";
import {
  STOCK_PHOTO_PERSON_EDIT_CAST,
  STOCK_PHOTO_PERSON_EDIT_CAST_LABEL_ZH,
  pickStockPhotoPersonEditPeople,
  type StockPhotoPersonEditCast,
  type StockPhotoPersonEditCastOption,
} from "@shared/stockPhotoPersonEdit";

export type StockPhotoPersonEditResult = { requestId: string; imageUrl: string; baseAssetId: string; cast: StockPhotoPersonEditCast; actionText: string };

export type StockPhotoPersonEditPanelProps = {
  /** 业务方提供的人物来源（如 MV 演唱者/主锚图、女主定妆帧）；为空时按钮置灰并说明原因。 */
  options: StockPhotoPersonEditCastOption[];
  aspectRatio: "9:16" | "16:9" | "1:1";
  /** 先采用当前选中的照片（与抽屉「采用」同一流程），返回本人空间里的资产。 */
  ensureAsset: () => Promise<StockFootageAssetView | null>;
  disabled?: boolean;
  onEdited: (result: StockPhotoPersonEditResult) => void | Promise<void>;
};

export function StockPhotoPersonEditPanel(props: StockPhotoPersonEditPanelProps) {
  const [open, setOpen] = useState(false);
  const [cast, setCast] = useState<StockPhotoPersonEditCast>(() => (props.options.some(o => o.slot === "lead") ? "lead" : "partner"));
  const [actionText, setActionText] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [meta, setMeta] = useState<{ baseAssetId: string; cast: StockPhotoPersonEditCast; actionText: string } | null>(null);
  const picked = useMemo(() => pickStockPhotoPersonEditPeople(cast, props.options), [cast, props.options]);
  const missing = "missingZh" in picked ? picked.missingZh : "";
  const create = trpc.stockFootage.personEdit.useMutation();
  const status = trpc.stockFootage.getPersonEdit.useQuery(
    { requestId: requestId ?? "00000000-0000-4000-8000-000000000000" },
    { enabled: Boolean(requestId), refetchInterval: q => (q.state.data && ["succeeded", "failed"].includes(q.state.data.status) ? false : 3000), refetchOnWindowFocus: false },
  );
  const job = status.data;
  const running = submitting || (Boolean(requestId) && (!job || !["succeeded", "failed"].includes(job.status)));

  const submit = async () => {
    if (running || missing || !actionText.trim() || "missingZh" in picked) return;
    setSubmitting(true);
    try {
      const asset = await props.ensureAsset();
      if (!asset) return;
      const id = crypto.randomUUID();
      await create.mutateAsync({ requestId: id, baseAssetId: asset.assetId, cast, people: picked.people, actionText: actionText.trim(), aspectRatio: props.aspectRatio });
      setMeta({ baseAssetId: asset.assetId, cast, actionText: actionText.trim() });
      setRequestId(id);
    } catch (error) {
      toast.error((error as { message?: string })?.message || "重绘提交失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-white/10 p-2 text-xs" data-stock-person-edit>
      <button type="button" disabled={props.disabled} aria-expanded={open} onClick={() => setOpen(v => !v)} className="flex min-h-11 items-center gap-1 rounded-md bg-white/10 px-3 hover:bg-white/15 disabled:opacity-40">
        <UserRoundPlus className="h-4 w-4" />放入人物重绘
      </button>
      {open && (
        <div className="space-y-2">
          <p className="opacity-70">以这张实拍照为底图，把人物合成进去，保留真实街景的透视、材质与光线。</p>
          <div role="radiogroup" aria-label="放入谁" className="flex gap-2">
            {STOCK_PHOTO_PERSON_EDIT_CAST.map(c => (
              <button key={c} type="button" role="radio" aria-checked={cast === c} onClick={() => setCast(c)} className={`min-h-11 rounded-md px-3 ${cast === c ? "bg-sky-500 text-black" : "bg-white/10 hover:bg-white/15"}`}>
                {STOCK_PHOTO_PERSON_EDIT_CAST_LABEL_ZH[c]}
              </button>
            ))}
          </div>
          {missing && <p className="text-amber-200">{missing}</p>}
          <label className="block space-y-1">
            <span className="opacity-80">一句动作描述</span>
            <input value={actionText} maxLength={600} onChange={e => setActionText(e.target.value)} placeholder="如：他撑透明伞站在橱窗前开口演唱" className="min-h-11 w-full rounded-md bg-white/10 px-2" />
          </label>
          <button type="button" disabled={running || Boolean(missing) || !actionText.trim() || props.disabled} onClick={() => void submit()} className="flex min-h-11 items-center gap-1 rounded-md bg-sky-500 px-3 font-medium text-black disabled:opacity-40">
            {running && <Loader2 className="h-4 w-4 animate-spin" />}
            {running ? "正在重绘…" : `开始重绘（${canvasImageCredits(0)} 积分）`}
          </button>
          {job?.status === "failed" && <p role="alert" className="text-amber-200">{job.error || "重绘未成功，积分已退回"}</p>}
          {job?.status === "succeeded" && job.imageUrl && meta && requestId && (
            <div className="space-y-2">
              <img src={job.imageUrl} alt="重绘结果" className="max-h-72 w-full rounded object-contain" />
              <button type="button" onClick={() => void props.onEdited({ requestId, imageUrl: job.imageUrl!, ...meta })} className="min-h-11 rounded-md bg-emerald-500 px-3 font-medium text-black">采用重绘图</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default StockPhotoPersonEditPanel;
