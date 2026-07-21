/**
 * Platform 内容创作 · 文生图与海报：分类模板 + 提示词草稿 + 出图。
 */
import { useEffect, useMemo, useState } from "react";
import { Image as ImageIcon, Loader2, Sparkles, Upload, X } from "lucide-react";
import { toast } from "sonner";
import {
  buildPlatformImageGenPrompt,
  listPlatformImageGenByGroup,
  mapPlatformImageGenAspectForApi,
  type PlatformImageGenAspectHint,
  type PlatformImageGenTemplate,
} from "@shared/platformImageGenTemplates";
import { withFlyHealthGate } from "@/lib/flyHealthGate";
import { flyHealthProbeOriginForUrl, withLongJobsFlyDirect } from "@/lib/longJobsFlyOrigin";
import { trpc } from "@/lib/trpc";

const IMAGE_GEN_CREDITS = 54;

function mapAspectLabel(hint: PlatformImageGenAspectHint): string {
  return hint;
}

export default function PlatformImageGenPanel({ disabled }: { disabled?: boolean }) {
  const groups = useMemo(() => listPlatformImageGenByGroup(), []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [subjectHint, setSubjectHint] = useState("");
  const [aspectHint, setAspectHint] = useState<PlatformImageGenAspectHint>("3:4");
  const [needsReference, setNeedsReference] = useState(false);
  const [refUrl, setRefUrl] = useState<string | null>(null);
  const [refPreview, setRefPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const chargeStepMutation = trpc.workflow.chargeStep.useMutation();
  const refundStepMutation = trpc.workflow.refundStep.useMutation();
  const uploadRefMutation = trpc.mvAnalysis.uploadCoverReferencePhoto.useMutation();

  useEffect(() => {
    return () => {
      if (refPreview?.startsWith("blob:")) URL.revokeObjectURL(refPreview);
    };
  }, [refPreview]);

  const applyTemplate = (t: PlatformImageGenTemplate) => {
    setActiveId(t.id);
    setNeedsReference(t.needsReference);
    setAspectHint(t.aspectHint);
    setDraft(buildPlatformImageGenPrompt(t.id, { subjectHint }));
    setError(null);
  };

  const refreshDraftFromHint = () => {
    if (!activeId) return;
    setDraft(buildPlatformImageGenPrompt(activeId, { subjectHint }));
  };

  const handleUploadRef = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("请上传图片文件（JPG / PNG）");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error("图片过大（请 ≤ 25MB）");
      return;
    }
    setUploading(true);
    try {
      const jpegBase64 = await new Promise<string>((resolve, reject) => {
        const img = new window.Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(objectUrl);
          const maxEdge = 1280;
          const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const cctx = canvas.getContext("2d");
          if (!cctx) {
            reject(new Error("无法处理图片"));
            return;
          }
          cctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
          const base64 = dataUrl.split(",")[1] || "";
          if (!base64) reject(new Error("图片编码失败"));
          else resolve(base64);
        };
        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error("图片读取失败"));
        };
        img.src = objectUrl;
      });
      const { url } = await uploadRefMutation.mutateAsync({
        imageBase64: jpegBase64,
        mimeType: "image/jpeg",
      });
      if (!url) throw new Error("上传未返回地址");
      if (refPreview?.startsWith("blob:")) URL.revokeObjectURL(refPreview);
      setRefUrl(url);
      setRefPreview(URL.createObjectURL(file));
      toast.success("参考图已上传");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "参考图上传失败");
    } finally {
      setUploading(false);
    }
  };

  const clearRef = () => {
    if (refPreview?.startsWith("blob:")) URL.revokeObjectURL(refPreview);
    setRefUrl(null);
    setRefPreview(null);
  };

  const canGenerate =
    Boolean(draft.trim()) &&
    !busy &&
    !disabled &&
    !uploading &&
    (!needsReference || Boolean(refUrl));

  const handleGenerate = async () => {
    const prompt = draft.trim();
    if (!prompt) {
      toast.error("请先选择模板或填写提示词");
      return;
    }
    if (needsReference && !refUrl) {
      toast.error("该模板需要先上传参考图");
      return;
    }
    setBusy(true);
    setError(null);
    setResultUrl(null);
    let chargedCost = 0;
    try {
      toast.info("正在生成图片…", { duration: 6000 });
      const charge = await chargeStepMutation.mutateAsync({
        step: "scene_image",
        quantity: 1,
        creditsOverride: IMAGE_GEN_CREDITS,
      });
      chargedCost = charge.cost;
      const apiAspect = mapPlatformImageGenAspectForApi(aspectHint);
      const gptUrl = withLongJobsFlyDirect("/api/jobs?op=canvasGptImage2");
      const probeOrigin = flyHealthProbeOriginForUrl(gptUrl);
      const refs = refUrl ? [refUrl] : [];
      const res = await withFlyHealthGate(probeOrigin, () =>
        fetch(gptUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "omit",
          body: JSON.stringify({
            prompt,
            aspectRatio: apiAspect,
            referenceImageUrl: refs[0] || undefined,
            referenceImageUrls: refs.length ? refs : undefined,
            imageMode: refs.length ? "edit" : "generate",
            generalImageEdit: refs.length > 0,
          }),
        }),
      );
      const text = await res.text();
      let json: { ok?: boolean; imageUrl?: string; error?: string; message?: string } = {};
      try {
        json = JSON.parse(text) as typeof json;
      } catch {
        throw new Error(
          /An error o|ROUTER_EXTERNAL/i.test(text)
            ? "算力紧张或网关超时，请稍后重试"
            : `生成失败：${text.slice(0, 160)}`,
        );
      }
      if (!res.ok || !json.ok || !json.imageUrl) {
        throw new Error(json.error || json.message || "生成失败");
      }
      setResultUrl(String(json.imageUrl));
      toast.success(chargedCost > 0 ? `已生成（已扣 ${chargedCost} 积分）` : "已生成");
    } catch (e) {
      if (chargedCost > 0) {
        try {
          await refundStepMutation.mutateAsync({
            step: "scene_image",
            quantity: 1,
            creditsOverride: chargedCost,
            reason: "Platform文生图失败退款",
          });
        } catch {
          /* ignore refund errors */
        }
      }
      const msg = e instanceof Error ? e.message : "生成失败";
      setError(msg);
      toast.error(msg.slice(0, 120));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-black/25 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-white/85">文生图与海报模板</div>
            <p className="mt-0.5 text-[10px] text-white/40">
              按用途分类点选；卡片上的「能做什么」说明适用场景。带「·图」须先上传参考图。
            </p>
          </div>
          <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-100/80">
            约 {IMAGE_GEN_CREDITS} 积分 / 张
          </span>
        </div>

        <div className="mt-3 space-y-3">
          {groups.map(({ group, items }) => (
            <div key={group.id}>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/40">
                {group.labelZh}
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {items.map((t) => {
                  const on = activeId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      disabled={disabled || busy}
                      title={t.blurbZh}
                      onClick={() => applyTemplate(t)}
                      className={`rounded-lg border px-2.5 py-2 text-left transition disabled:opacity-40 ${
                        on
                          ? "border-cyan-400/50 bg-cyan-500/15"
                          : "border-white/12 bg-white/[0.03] hover:border-white/25"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-semibold text-white/85">
                          {t.labelZh}
                          {t.needsReference ? (
                            <span className="ml-1 text-amber-200/70">·图</span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-[9px] text-white/35">
                          {mapAspectLabel(t.aspectHint)}
                        </span>
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-rose-100/70">
                        能做什么：{t.capabilityZh}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_minmax(220px,0.9fr)]">
        <div className="space-y-2">
          <label className="block text-[11px] font-semibold text-white/55">
            补充关键词（可选）
            <input
              type="text"
              value={subjectHint}
              disabled={disabled || busy}
              onChange={(e) => setSubjectHint(e.target.value)}
              onBlur={refreshDraftFromHint}
              placeholder="如城市名、产品名、活动标题…"
              className="mt-1 w-full rounded-lg border border-white/12 bg-black/40 px-3 py-2 text-[12px] text-white/85 outline-none placeholder:text-white/30 focus:border-cyan-400/40"
            />
          </label>
          <label className="block text-[11px] font-semibold text-white/55">
            提示词草稿
            <textarea
              value={draft}
              disabled={disabled || busy}
              onChange={(e) => setDraft(e.target.value)}
              rows={12}
              placeholder="点选上方模板填入，或直接粘贴自定义提示词…"
              className="mt-1 w-full resize-y rounded-lg border border-white/12 bg-black/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-white/80 outline-none placeholder:text-white/30 focus:border-cyan-400/40"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!canGenerate}
              onClick={() => void handleGenerate()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[linear-gradient(135deg,#49e6ff,#6a5cff)] px-4 py-2 text-[12px] font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-45"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {busy ? "正在生成…" : "生成图片"}
            </button>
            {needsReference && !refUrl ? (
              <span className="text-[10px] text-amber-200/75">请先上传参考图</span>
            ) : null}
            <span className="text-[10px] text-white/35">
              出图画幅：{mapPlatformImageGenAspectForApi(aspectHint)}（模板建议 {aspectHint}）
            </span>
          </div>
          {error ? (
            <p className="text-[11px] text-rose-300/90">{error}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-white/55">参考图（可选 / 模板要求时必填）</div>
          {refPreview ? (
            <div className="relative overflow-hidden rounded-lg border border-white/12">
              <img src={refPreview} alt="" className="max-h-48 w-full object-contain bg-black/40" />
              <button
                type="button"
                disabled={busy || uploading}
                onClick={clearRef}
                className="absolute right-2 top-2 rounded-full border border-white/20 bg-black/60 p-1 text-white/80 hover:bg-black/80"
                aria-label="清除参考图"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <label
              className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/20 bg-white/[0.03] px-3 py-8 text-center transition hover:border-white/35 ${
                uploading ? "cursor-wait opacity-70" : ""
              }`}
            >
              {uploading ? (
                <Loader2 className="h-5 w-5 animate-spin text-white/50" />
              ) : (
                <Upload className="h-5 w-5 text-white/40" />
              )}
              <span className="text-[11px] text-white/55">
                {uploading ? "上传中…" : "点击上传参考图"}
              </span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={disabled || busy || uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUploadRef(f);
                  e.target.value = "";
                }}
              />
            </label>
          )}

          <div className="text-[11px] font-semibold text-white/55">生成结果</div>
          <div className="flex min-h-[180px] items-center justify-center overflow-hidden rounded-lg border border-white/12 bg-black/40">
            {busy ? (
              <div className="flex flex-col items-center gap-2 text-white/50">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-[11px]">正在生成图片…</span>
              </div>
            ) : resultUrl ? (
              <img src={resultUrl} alt="" className="max-h-[420px] w-full object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-1 text-white/30">
                <ImageIcon className="h-6 w-6" />
                <span className="text-[11px]">结果将显示在这里</span>
              </div>
            )}
          </div>
          {resultUrl ? (
            <a
              href={resultUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-[11px] text-cyan-200/80 underline-offset-2 hover:underline"
            >
              在新标签打开原图
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
