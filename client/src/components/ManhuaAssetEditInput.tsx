import { useRef, useState } from "react";
import { manhuaAssetStandardizeCredits, type ManhuaAssetStandardizeQuality } from "@shared/manhuaAssetStandardize";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

/** 页面内编辑输入，避免内置浏览器不支持原生 prompt；计费确认仍由原回调负责。 */
export function ManhuaAssetEditInput({
  labelZh,
  disabled,
  busy,
  onSubmit,
}: {
  labelZh: string;
  disabled: boolean;
  busy: boolean;
  onSubmit: (instructionZh: string, quality: ManhuaAssetStandardizeQuality) => void | boolean | Promise<void | boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState<ManhuaAssetStandardizeQuality>("medium");
  const [instruction, setInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  return (
    <>
      <button
        type="button"
        disabled={disabled || submitting}
        onClick={() => {
          setInstruction("");
          setError("");
          setOpen(true);
        }}
        title="输入修改要求后编辑这张图；原图保留，新图进入同一资产栏"
        className="rounded border border-violet-300/40 bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-medium text-violet-100 hover:bg-violet-500/25 disabled:opacity-40"
      >
        {busy || submitting ? "编辑中…" : "编辑图片"}
      </button>
      <Dialog
        open={open}
        onOpenChange={value => {
          if (!locked.current) setOpen(value);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="z-[90] border-white/15 bg-[#141418] text-white"
        >
          <DialogTitle>编辑图片 · {labelZh}</DialogTitle>
          <DialogDescription>
            写清楚这张图要改什么。未提到的部分会尽量保持原样；原图保留，新图进入同一资产栏。下一步仍需确认费用。
          </DialogDescription>
          <label className="text-sm">
            图片画质
            <select aria-label="图片画质" value={quality} disabled={submitting}
              onChange={event => setQuality(event.target.value === "high" ? "high" : "medium")}
              className="ml-3 rounded border border-white/20 bg-[#141418] p-2">
              <option value="medium">标准（medium）· {manhuaAssetStandardizeCredits("medium")} 积分</option>
              <option value="high">高质（high）· {manhuaAssetStandardizeCredits("high")} 积分</option>
            </select>
          </label>
          <label className="text-sm">
            修改要求
            <textarea
              aria-label="修改要求"
              value={instruction}
              disabled={submitting}
              onChange={event => {
                setInstruction(event.target.value);
                setError("");
              }}
              rows={7}
              className="mt-2 w-full rounded-lg border border-white/20 bg-black/40 p-3"
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-rose-300">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              disabled={submitting}
              onClick={() => setOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              disabled={disabled || submitting || !instruction.trim()}
              onClick={async () => {
                if (locked.current || disabled || !instruction.trim()) return;
                locked.current = true;
                setSubmitting(true);
                try {
                  const accepted = await onSubmit(instruction.trim(), quality);
                  // 父层已提示取消／失败时保留文字，不把正常返回误认成成功。
                  if (accepted !== false) setOpen(false);
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : "图片编辑未提交，请检查后重试"
                  );
                } finally {
                  locked.current = false;
                  setSubmitting(false);
                }
              }}
              className="rounded-lg bg-violet-600 px-3 py-2 disabled:opacity-40"
            >
              {submitting ? "处理中…" : "继续确认费用"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
