import { makeDigitalHumanKeyframeAdviceTarget } from "@/lib/digitalHumanKeyframeAdvice";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { DigitalHumanDraft, DigitalHumanMedia as Media } from "@shared/digitalHumanStudio";
import { digitalHumanKeyframeGenerationInputSchema, digitalHumanKeyframeGenerationPrompt, type DigitalHumanKeyframeGenerationInput } from "@shared/digitalHumanKeyframeGeneration";
import { canvasImageCredits } from "@shared/canvasGenerationPricing";
import { gsUriFromSignedGcsUrl } from "@shared/manhuaMultiview";
import { DigitalHumanMedia } from "./DigitalHumanStudio";

type Props = { draft: DigitalHumanDraft; disabled: boolean; save: (fn: (d: DigitalHumanDraft) => DigitalHumanDraft) => void; beforeSubmit: () => Promise<void>; acquireWork: (label: string) => () => void; uploadFile: (file: File) => Promise<Media> };
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

export function DigitalHumanKeyframeGenerationPanel(props: Props) {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const label = props.draft.keyframeImageDraft?.label || "", description = props.draft.keyframeImageDraft?.description || "";
  const setLabel = (value: string) => props.save(d => ({ ...d, keyframeImageDraft: { ...d.keyframeImageDraft, label: value, description: d.keyframeImageDraft?.description || "" } }));
  const setDescription = (value: string) => props.save(d => ({ ...d, keyframeImageDraft: { ...d.keyframeImageDraft, label: d.keyframeImageDraft?.label || "", description: value } }));
  const api = trpc.useUtils();
  const create = trpc.digitalHuman.createKeyframe.useMutation({ retry: false });
  const current = useRef(props), locked = useRef(false), alive = useRef(true);
  current.current = props;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const portraits = props.draft.originalPortraits || [], receipts = props.draft.keyframeGenerations || [];
  const pending = receipts.filter(r => ["submitted", "running", "unknown"].includes(r.status));
  function change(id: string, fn: (d: DigitalHumanDraft) => DigitalHumanDraft) {
    if (!alive.current || current.current.draft.id !== id) throw new Error("制作稿已切换，未修改其他作品");
    current.current.save(d => { if (d.id !== id) throw new Error("制作稿已变化"); return fn(d); });
  }
  async function act(fn: (id: string) => Promise<void>) {
    if (locked.current || props.disabled) return;
    locked.current = true; setBusy(true); setError("");
    const id = current.current.draft.id;
    let release: (() => void) | undefined;
    try { release = current.current.acquireWork("关键分镜图片"); await fn(id); }
    catch (e) { if (alive.current) setError(errorText(e)); }
    finally { release?.(); locked.current = false; if (alive.current) setBusy(false); }
  }
  async function upload(files: File[], id: string) {
    if (files.length + portraits.length > 5) throw new Error("最多保留5张指定人像参考，请先整理数量");
    for (const f of files) if (!/\.(png|jpe?g|webp)$/i.test(f.name) || !f.size || f.size > 20 * 1024 * 1024) throw new Error("人像支持PNG/JPEG/WebP，每张不超过20MB");
    await current.current.beforeSubmit();
    for (const file of files) {
      const media = await current.current.uploadFile(file);
      change(id, d => ({ ...d, originalPortraits: [...(d.originalPortraits || []), media] }));
      await current.current.beforeSubmit();
    }
  }
  async function submit(request: DigitalHumanKeyframeGenerationInput, id: string, existing = false) {
    if (request.draftId !== id) throw new Error("原请求属于其他制作稿");
    if (!existing) {
      if (request.adviceRevision && makeDigitalHumanKeyframeAdviceTarget(current.current.draft).revision !== request.adviceRevision) throw new Error("顾问建议对应的制作输入已变化，请重新核对后再生成");
      if (pending.length) throw new Error("请先核对原图片任务，未创建新单");
      if ((current.current.draft.keyframes?.length || 0) >= 24 || receipts.length >= 100) throw new Error("候选或任务记录已达上限，请先整理");
      if (!window.confirm(`使用上方展示的人像原文件、本段场景参考与完整提示词，高清关键分镜，${canvasImageCredits(0)}积分/张。确认生成？`)) return;
      change(id, d => ({ ...d, keyframeGenerations: [...(d.keyframeGenerations || []), { request, status: "submitted" }] }));
    } else if (!window.confirm("按原任务编号和原输入继续提交；已存在的任务不会新建或重复扣费。确认继续？")) return;
    await current.current.beforeSubmit();
    try {
      const result = await create.mutateAsync(request);
      change(id, d => ({ ...d, keyframeGenerations: d.keyframeGenerations.map(r => r.request.requestId === request.requestId ? { ...r, jobId: result.jobId, status: "running", message: undefined } : r) }));
      await current.current.beforeSubmit();
    } catch (e) {
      change(id, d => ({ ...d, keyframeGenerations: d.keyframeGenerations.map(r => r.request.requestId === request.requestId ? { ...r, status: "unknown", message: errorText(e) } : r) }));
      await current.current.beforeSubmit();
      throw e;
    }
  }
  async function refresh(requestId: string, id: string) {
    const row = await api.digitalHuman.getKeyframe.fetch({ requestId });
    if (!row) throw new Error("服务端尚未找到原任务；可按原编号继续提交，不要新建另一单");
    const out = (row.output || {}) as { imageUrl?: string; imageUrls?: string[]; gcsUri?: string };
    const url = out.gcsUri || out.imageUrl || out.imageUrls?.[0];
    const source = url ? gsUriFromSignedGcsUrl(url) || url : undefined;
    if (row.status === "succeeded" && (!source || !/^(gs:\/\/|https:\/\/)/.test(source))) throw new Error("原任务成功但没有有效图片，未登记为空候选，请核对原任务");
    change(id, d => {
      const receipt = d.keyframeGenerations.find(r => r.request.requestId === requestId);
      if (!receipt) throw new Error("原请求记录不存在");
      const terminal = row.status === "succeeded" || row.status === "failed";
      const status = terminal ? row.status as "succeeded" | "failed" : "running" as const;
      const keyframes = d.keyframes || [];
      if (status === "succeeded" && !keyframes.some(f => f.id === requestId) && keyframes.length >= 24) throw new Error("候选已满，原任务结果已保留，整理后查询原任务即可");
      return { ...d, keyframeGenerations: d.keyframeGenerations.map(r => r.request.requestId === requestId ? { ...r, status, jobId: row.jobId, source, message: row.error || undefined } : r),
        keyframes: status === "succeeded" && !keyframes.some(f => f.id === requestId)
          ? [...keyframes, { id: requestId, label: receipt.request.label, media: { source: source!, name: receipt.request.label }, startSec: receipt.request.startSec, endSec: receipt.request.endSec, useZh: `按指定人像直接生成的${receipt.request.label}；完整画面要求保存在原生成请求中，采用前请填写本图对应动作与用途。`, adopted: false }]
          : keyframes };
    });
    await current.current.beforeSubmit();
  }
  // 只查询已有编号；无自动重提，无自动采用，刷新页面仍保留原请求。
  useEffect(() => {
    const timer = window.setInterval(() => {
      const d = current.current.draft;
      const row = d.keyframeGenerations?.find(r => r.status === "running" && r.jobId);
      if (!row || locked.current || current.current.disabled) return;
      void act(id => refresh(row.request.requestId, id));
    }, 5000);
    return () => window.clearInterval(timer);
  });
  let preview = "", previewError = "";
  try { preview = digitalHumanKeyframeGenerationPrompt(digitalHumanKeyframeGenerationInputSchema.parse({ requestId: "00000000-0000-4000-8000-000000000001", draftId: props.draft.id, label, description, aspectRatio: props.draft.aspectRatio, portraits, scene: props.draft.scene })); } catch (e) { previewError = errorText(e); }
  return <section className="dh-card dh-wide">
    <h3>用指定人像生成关键分镜</h3>
    <p>每张都直接使用下方人像原文件。上一张分镜不会成为下一张的改图底图。新图只登记为候选，核对面貌后再采用。</p>
    <label>上传指定人像参考（最多5张）<input type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={props.disabled || busy || Boolean(pending.length)} onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ""; if (files.length) void act(id => upload(files, id)); }} /></label>
    {portraits.map((p, index) => <div key={p.source}><DigitalHumanMedia source={p.source} kind="image" name={p.name} /><p>参考{index + 1}：{p.name}</p>
      <button type="button" disabled={props.disabled || busy || Boolean(pending.length)} onClick={() => void act(async id => { change(id, d => ({ ...d, originalPortraits: d.originalPortraits.filter(r => r.source !== p.source) })); await current.current.beforeSubmit(); })}>移出本次参考组</button>
      <button type="button" disabled={props.disabled || busy} onClick={() => void act(async id => { change(id, d => ({ ...d, portrait: p })); await current.current.beforeSubmit(); })}>设为本稿主要人像</button></div>)}
    {props.draft.scene && <div><p>本段场景参考：{props.draft.scene.name}</p><DigitalHumanMedia source={props.draft.scene.source} kind="image" name="本段原场景" /></div>}
    <label>分镜名称<input value={label} maxLength={120} onChange={e => setLabel(e.target.value)} disabled={props.disabled || busy} /></label>
    <label>本镜画面要求<textarea value={description} maxLength={8000} onChange={e => setDescription(e.target.value)} disabled={props.disabled || busy} placeholder="写清场景、服装、动作、构图与需要避开的遮挡。人物身份由上方原文件约束。" /></label>
    <details open><summary>实际发送内容 · {props.draft.aspectRatio} · 高清关键分镜 · {canvasImageCredits(0)}积分/张</summary><pre>{preview || (portraits.length && label && description ? `输入尚不可提交：${previewError}` : "请先上传人像并填写名称和画面要求。")}</pre></details>
    <button type="button" disabled={props.disabled || busy || !preview || Boolean(pending.length)} onClick={() => void act(id => submit(digitalHumanKeyframeGenerationInputSchema.parse({ ...current.current.draft.keyframeImageDraft, requestId: crypto.randomUUID(), draftId: id, label, description, aspectRatio: current.current.draft.aspectRatio, portraits: current.current.draft.originalPortraits, scene: current.current.draft.scene }), id))}>生成关键分镜 · {canvasImageCredits(0)}积分</button>
    {error && <p role="alert">{error}</p>}
    {receipts.map(r => <details key={r.request.requestId}><summary>{r.request.label} · {r.status === "succeeded" ? "已生成候选" : r.status === "failed" ? "失败，保留原记录" : "待核对原任务"}</summary>
      <p>任务编号：{r.jobId || r.request.requestId}</p><pre>{digitalHumanKeyframeGenerationPrompt(r.request)}</pre><p>原人像：{r.request.portraits.map(p => p.name).join("、")}</p>
      {r.source && <DigitalHumanMedia source={r.source} kind="image" name={r.request.label} />}{r.message && <p>{r.message}</p>}
      <button type="button" disabled={props.disabled || busy} onClick={() => void act(id => refresh(r.request.requestId, id))}>查询原任务</button>
      {["submitted", "unknown"].includes(r.status) && <button type="button" disabled={props.disabled || busy} onClick={() => void act(id => submit(r.request, id, true))}>按原编号继续提交</button>}
    </details>)}
  </section>;
}
