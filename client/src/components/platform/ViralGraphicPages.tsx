import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { pollJobUntilTerminal } from "@/lib/jobs";
import type { PlatformGraphicNotePage } from "@shared/platformTopicShortlist";
import { knowledgeCardCreditsForPageIndex } from "@shared/knowledgeCardPagination";

type Request = {
  sceneId: string; title: string; scriptContext: string; kind: "single_page_knowledge_card";
  viralCreation: true; singleGraphicPage: true; pageRequestId: string; progressJobId: string;
  notePageIndex: number; notePageTotal: number; imagePromptTranslator: "gpt54";
  distillModel: string; referencePhotoUrl?: string; executionDetails?: string;
};
type Receipt = { request: Request; status: "submitting" | "running" | "succeeded" | "failed"; jobId?: string; imageUrl?: string; error?: string };
type Receipts = Record<number, Receipt>;
const MODEL = "glm-5.3-flash";

/** 每页独立请求、任务及图片；失败只允许显式重试，提交不明复用同一请求编号。 */
export default function ViralGraphicPages(props: { userKey: string; sceneId: string; pages: PlatformGraphicNotePage[]; referencePhotoUrl?: string; visualBrief?: string; disabled: boolean; onBusyChange: (busy: boolean) => void }) {
  const key = `mvstudiopro.viralGraphicPages.v1.${props.userKey}.${props.sceneId}`;
  const [receipts, setReceipts] = useState<Receipts>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const current = useRef<Receipts>({});
  const locked = useRef(false);
  const alive = useRef(true);
  const mutate = trpc.mvAnalysis.generatePlatformCompositeSheet.useMutation();
  const pages = props.pages.filter(page => page.role !== "cover");
  const save = (page: number, receipt: Receipt) => {
    const next = { ...current.current, [page]: receipt };
    // 落盘失败时不启动新付费请求；已成功任务仍可从服务端回查。
    localStorage.setItem(key, JSON.stringify(next));
    current.current = next;
    if (alive.current) setReceipts(next);
  };
  const poll = async (page: number, receipt: Receipt) => {
    const job = await pollJobUntilTerminal(receipt.jobId!, { intervalMs: 2000, maxWaitMs: 28 * 60_000, adaptiveBackoffAfterAttempts: 20, maxIntervalMs: 5000 });
    if (job.status !== "succeeded") {
      const message = job.error || `任务${job.status}，请检查任务回执`;
      save(page, { ...receipt, status: "failed", error: message });
      throw new Error(message);
    }
    const output = job.output as { compositeImageUrl?: string; imageUrl?: string } | null;
    const imageUrl = output?.compositeImageUrl || output?.imageUrl;
    if (!imageUrl) throw new Error("原任务未返回图片，请查询原任务，不要重新提交");
    save(page, { ...receipt, status: "succeeded", imageUrl, error: undefined });
  };
  const process = async (page: number, receipt: Receipt) => {
    if (receipt.jobId) return poll(page, receipt);
    // 同一requestId由服务端原子预留。网络中断后重放同一快照不会重复扣费。
    const result = await mutate.mutateAsync(receipt.request);
    if (result.imageUrl) { save(page, { ...receipt, imageUrl: result.imageUrl, status: "succeeded" }); return; }
    if (!result.progressJobId) throw new Error("提交结果不明，请恢复原请求");
    const running: Receipt = { ...receipt, jobId: result.progressJobId, status: "running" };
    save(page, running);
    await poll(page, running);
  };
  const run = async (entries: Array<[number, Receipt]>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(""); props.onBusyChange(true);
    try {
      for (const [page, receipt] of entries) {
        if (!alive.current) break;
        save(page, receipt);
        await process(page, receipt);
      }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "生成失败，请查询原任务"); }
    finally { locked.current = false; if (alive.current) setBusy(false); props.onBusyChange(false); }
  };
  useEffect(() => {
    alive.current = true;
    let saved: Receipts = {};
    try {
      const raw = JSON.parse(localStorage.getItem(key) || "{}");
      if (raw && typeof raw === "object") saved = Object.fromEntries(Object.entries(raw).filter(([, r]) => {
        const value = r as Receipt;
        return value?.request?.sceneId === props.sceneId && typeof value.request.pageRequestId === "string";
      })) as Receipts;
      current.current = saved; setReceipts(saved); setReady(true);
    } catch { setError("无法读取逐页记录，请检查浏览器存储后再生成"); }
    // 刷新只查询已知任务，不自动发起或重放模型请求。
    const pending = Object.entries(saved).filter(([, r]) => r.status === "running" && r.jobId).map(([i, r]) => [Number(i), r] as [number, Receipt]);
    if (pending.length) void run(pending);
    return () => { alive.current = false; };
  }, [key]); // 同账号同稿件只恢复一次，避免修改正文触发请求。
  const submit = (selected: PlatformGraphicNotePage[]) => {
    if (!ready || props.disabled || locked.current || !selected.length) return;
    const cost = selected.reduce((sum, page) => sum + knowledgeCardCreditsForPageIndex(page.pageIndex, MODEL), 0);
    if (!window.confirm(`生成 ${selected.length} 张独立图文图片（2K、中画质），合计 ${cost} 点。每张仅呈现对应页内容；失败不自动重试。是否继续？`)) return;
    const entries = selected.map(page => {
      const request: Request = { sceneId: props.sceneId, title: page.headline, scriptContext: `# ${page.headline}\n\n${page.body}`, kind: "single_page_knowledge_card", viralCreation: true, singleGraphicPage: true, pageRequestId: crypto.randomUUID(), progressJobId: crypto.randomUUID(), notePageIndex: page.pageIndex, notePageTotal: props.pages.length, imagePromptTranslator: "gpt54", distillModel: MODEL, referencePhotoUrl: props.referencePhotoUrl, executionDetails: props.visualBrief };
      return [page.pageIndex, { request, status: "submitting", imageUrl: current.current[page.pageIndex]?.imageUrl }] as [number, Receipt];
    });
    void run(entries);
  };
  const unresolved = Object.values(receipts).some(r => r.status === "submitting" || r.status === "running");
  const missing = pages.filter(page => !receipts[page.pageIndex]);
  return <section className="viral-independent-pages" aria-label="独立图文图片">
    <h4>逐页生成图片 · {pages.length} 张正文配图</h4>
    <p>封面单独生成；整篇4–6页（含封面），以下每页输出一张2K中画质竖版图片，沿用本稿参考人像。已生成图片及任务编号可刷新恢复。</p>
    <button type="button" className="creation-primary" disabled={!ready || props.disabled || busy || unresolved || !missing.length} onClick={() => submit(missing)}>{busy ? "逐页生成中…" : `生成未出图的 ${missing.length} 页 · ${missing.reduce((sum, page) => sum + knowledgeCardCreditsForPageIndex(page.pageIndex, MODEL), 0)} 点`}</button>
    {error && <p role="alert">{error}</p>}
    <div className="viral-independent-grid">{pages.map(page => {
      const receipt = receipts[page.pageIndex];
      const pending = receipt?.status === "submitting" || receipt?.status === "running";
      const changed = receipt && (receipt.request.scriptContext !== `# ${page.headline}\n\n${page.body}` || receipt.request.referencePhotoUrl !== props.referencePhotoUrl);
      return <article key={page.pageIndex}><h4>第 {page.pageIndex} 页 · {page.headline}</h4><p>{page.body}</p>
        {receipt?.imageUrl && <a href={receipt.imageUrl} target="_blank" rel="noreferrer"><img src={receipt.imageUrl} alt={`第${page.pageIndex}页已生成图片：${receipt.request.title}`} /></a>}
        {receipt && <p>{receipt.status === "succeeded" ? "已生成" : receipt.status === "failed" ? "生成失败" : "原任务待完成"}{receipt.jobId ? ` · 任务 ${receipt.jobId}` : ""}</p>}
        {changed && <p>正文或参考已变化，上方保留原版本图片。</p>}{receipt?.error && <p role="alert">{receipt.error}</p>}
        <button type="button" disabled={!ready || props.disabled || busy || (!pending && unresolved)} onClick={() => pending ? void run([[page.pageIndex, receipt!]]) : submit([page])}>{pending ? "恢复原请求 / 查询原任务" : receipt ? `重新生成本页 · ${knowledgeCardCreditsForPageIndex(page.pageIndex, MODEL)} 点` : `生成本页 · ${knowledgeCardCreditsForPageIndex(page.pageIndex, MODEL)} 点`}</button>
      </article>;
    })}</div>
  </section>;
}
