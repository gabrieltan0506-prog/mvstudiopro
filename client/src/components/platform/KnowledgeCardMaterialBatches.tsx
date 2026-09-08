import { resolveKnowledgeCardSubjectPosition, type KnowledgeCardSubjectPosition } from "@shared/knowledgeCardSubjectPosition";
import { KnowledgeCardTextReviewPanel } from "./KnowledgeCardTextReviewPanel";
import { useEffect, useRef, useState } from "react";
import { type ActiveKnowledgeCardDistillModelId, knowledgeCardDistillFeeForModel, resolveActiveKnowledgeCardDistillModel } from "@shared/knowledgeCardDistillModels";
import { KNOWLEDGE_CARD_SKIP_DISTILL_MAX_CHARS, knowledgeCardCreditsForPageIndex, planKnowledgeCardPages } from "@shared/knowledgeCardPagination";
import { createKnowledgeCardMaterialBatches, editKnowledgeCardMaterialBatch, archiveKnowledgeCardGeneration, findKnowledgeCardGeneration, knowledgeCardRemainingPages, knowledgeCardDraftError, knowledgeCardGenerationError, parseKnowledgeCardMaterialSaved, type KnowledgeCardMaterialBatch, type KnowledgeCardPending } from "@/lib/knowledgeCardMaterialBatches";

export type KnowledgeCardMaterialBatchesProps = {
  initialSource: string;
  initialSubjectPosition?: KnowledgeCardSubjectPosition;
  storageKey: string;
  model: ActiveKnowledgeCardDistillModelId;
  fromDocument: boolean;
  disabled: boolean;
  /** 历史材料只允许查询原任务，不可重新提炼或生成。 */
  readOnly?: boolean;
  onBusyChange: (busy: boolean) => void;
  onDistill: (source: string, model: ActiveKnowledgeCardDistillModelId, onJob: (id: string) => void) => Promise<string>;
  onGenerate: (draft: string, pageIndex: number, pageTotal: number, model: ActiveKnowledgeCardDistillModelId, onJob: (id: string) => void, subjectPosition: KnowledgeCardSubjectPosition) => Promise<string>;
  onResume: (jobId: string, kind: "distill" | "image") => Promise<string>;
  onImagesChange: (urls: string[]) => void;
};

type Saved = { version: 1; batches: KnowledgeCardMaterialBatch[] };
const inputStyle = "w-full rounded-lg border border-white/10 bg-black/25 p-3 text-sm text-slate-200 disabled:opacity-60";
const buttonStyle = "rounded-lg border border-white/15 px-3 py-2 text-xs text-violet-100 hover:bg-white/10 disabled:opacity-40";

/** storageKey应由用户、素材身份组成；切换素材时父组件同时切换React key。 */
export function KnowledgeCardMaterialBatches(props: KnowledgeCardMaterialBatchesProps) {
  const [loadError, setLoadError] = useState("");
  const [batches, setBatches] = useState<KnowledgeCardMaterialBatch[]>(() => {
    try {
      const raw = localStorage.getItem(props.storageKey);
      if (raw) {
        const saved = parseKnowledgeCardMaterialSaved(raw);
        return saved.batches;
      }
    } catch (error) {
      // 不覆盖无法读取的原草稿；挂载后设置错误并锁住付费按钮。
      return createKnowledgeCardMaterialBatches(props.initialSource, props.initialSubjectPosition).map(batch => ({ ...batch, error: `本地草稿读取失败：${String(error)}` }));
    }
    return createKnowledgeCardMaterialBatches(props.initialSource, props.initialSubjectPosition);
  });
  const current = useRef(batches);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const initialReadFailed = useRef(Boolean(batches[0]?.error?.startsWith("本地草稿读取失败")));
  const callbackRef = useRef(props);
  callbackRef.current = props;

  useEffect(() => {
    if (initialReadFailed.current) setLoadError("原草稿读取失败，请先核对本地保存记录；当前禁止提交，避免覆盖已有任务。");
  }, []);
  useEffect(() => { callbackRef.current.onImagesChange(batches.flatMap(b => b.images.map(i => i.url))); }, [batches]);

  const save = (next: KnowledgeCardMaterialBatch[]) => {
    if (initialReadFailed.current) throw new Error("原草稿无法读取，已停止提交");
    // 必须先保存成功再发起请求；空间不足时不能继续付费。
    localStorage.setItem(props.storageKey, JSON.stringify({ version: 1, batches: next } satisfies Saved));
    current.current = next;
    setBatches(next);
  };
  const patch = (id: string, change: Partial<KnowledgeCardMaterialBatch>) => {
    save(current.current.map(b => b.id === id ? { ...b, ...change } : b));
  };
  const edit = (fn: () => void) => {
    try { fn(); } catch (error) { setLoadError(`草稿保存失败：${String(error)}。已停止提交，请先释放浏览器存储空间。`); }
  };
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current || props.disabled || loadError || initialReadFailed.current) return;
    busyRef.current = true;
    setBusy(true);
    props.onBusyChange(true);
    try { await action(); }
    catch (error) { setLoadError(`任务记录保存失败：${String(error)}。请先核对任务，勿重复提交。`); }
    finally { busyRef.current = false; setBusy(false); callbackRef.current.onBusyChange(false); }
  };
  const startPending = (batch: KnowledgeCardMaterialBatch, pending: KnowledgeCardPending) => {
    patch(batch.id, { pending, error: undefined });
    return (jobId: string) => {
      if (!jobId.trim()) throw new Error("任务编号为空");
      patch(batch.id, { pending: { ...pending, jobId } });
    };
  };
  const finish = (id: string, pending: KnowledgeCardPending, result: string) => {
    if (!result.trim()) throw new Error("任务返回空结果，请核对任务状态");
    const latest = current.current.find(b => b.id === id)!;
    if (pending.kind === "distill") patch(id, { draft: result, draftModel: pending.model, pending: undefined, error: undefined });
    else patch(id, {
      images: [...latest.images, { url: result, pageIndex: pending.pageIndex || 1, subjectPosition: resolveKnowledgeCardSubjectPosition(pending.subjectPosition) }],
      generation: latest.generation ? { ...latest.generation, completed: Array.from(new Set([...latest.generation.completed, pending.pageIndex || 1])) } : undefined,
      pending: undefined, error: undefined,
    });
  };
  const failure = (id: string, error: unknown) => {
    const terminal = Boolean(error && typeof error === "object" && ((error as { terminal?: boolean }).terminal === true || (error as { code?: string }).code === "JOB_TERMINAL_FAILED"));
    patch(id, {
      ...(terminal ? { pending: undefined } : {}),
      error: `${error instanceof Error ? error.message : String(error)}。${terminal ? "已确认任务结束；可核对费用后再次点击，未自动重发。" : "提交状态需核对，未自动重发。"}`,
    });
  };
  const distill = (batch: KnowledgeCardMaterialBatch) => {
    const model = props.model;
    const fee = !props.fromDocument && batch.source.trim().length > KNOWLEDGE_CARD_SKIP_DISTILL_MAX_CHARS ? knowledgeCardDistillFeeForModel(model) : 0;
    if (!window.confirm(`提炼本份 ${batch.source.length} 字符材料？\n${fee ? `提炼费 ${fee} 积分。` : props.fromDocument ? "文档提炼费用已含在页费中，本步不另收。" : "本份提炼不另收积分。"}\n提炼后确认实际页数与生成费用，再生成4K图片。旧图片保留。`)) return;
    void run(async () => {
      const pending: KnowledgeCardPending = { kind: "distill", model };
      const onJob = startPending(batch, pending);
      try { finish(batch.id, pending, await props.onDistill(batch.source, model, onJob)); }
      catch (error) { failure(batch.id, error); }
    });
  };
  const generate = (batch: KnowledgeCardMaterialBatch) => {
    if (knowledgeCardDraftError(batch.draft)) return;
    const model = resolveActiveKnowledgeCardDistillModel(batch.draftModel || props.model);
    const plan = planKnowledgeCardPages(batch.draft, model);
    if (knowledgeCardGenerationError(batch, model, plan.pageCount)) return;
    const subjectPosition = resolveKnowledgeCardSubjectPosition(batch.subjectPosition);
    const generation = findKnowledgeCardGeneration(batch, model) || { draft: batch.draft, model, subjectPosition, pageTotal: plan.pageCount, completed: [] };
    const remaining = knowledgeCardRemainingPages(batch, model, plan.pageCount);
    const credits = remaining.reduce((sum, i) => sum + knowledgeCardCreditsForPageIndex(i, model), 0);
    if (!remaining.length || !window.confirm(`本份共 ${plan.pageCount} 页，本次生成剩余 ${remaining.length} 页，全部4K，共 ${credits} 积分。\n已完成页不重做；已有图片继续保留。确认提交？`)) return;
    void run(async () => {
      patch(batch.id, { generationHistory: archiveKnowledgeCardGeneration(batch), generation });
      for (const index of remaining) {
        const pending: KnowledgeCardPending = { kind: "image", model, pageIndex: index, subjectPosition };
        const onJob = startPending(batch, pending);
        try { finish(batch.id, pending, await props.onGenerate(batch.draft, index, plan.pageCount, model, onJob, subjectPosition)); }
        catch (error) { failure(batch.id, error); break; }
      }
    });
  };
  const resume = (batch: KnowledgeCardMaterialBatch) => {
    const pending = batch.pending;
    if (!pending?.jobId) return;
    void run(async () => {
      try { finish(batch.id, pending, await props.onResume(pending.jobId!, pending.kind)); }
      catch (error) { failure(batch.id, error); }
    });
  };

  return <section className="space-y-4 rounded-xl border border-violet-300/15 bg-black/15 p-4">
    <p className="text-sm text-violet-100">材料已分为 {batches.length} 份，每份最多50,000字符。逐份确认提炼和生成，已完成图片保留。</p>
    {loadError && <p role="alert" className="text-sm text-amber-300">{loadError}</p>}
    {batches.map((batch, index) => {
      const blocked = busy || props.disabled || Boolean(props.readOnly) || Boolean(batch.pending) || Boolean(loadError) || initialReadFailed.current;
      const draftError = knowledgeCardDraftError(batch.draft);
      const plan = planKnowledgeCardPages(draftError ? "" : batch.draft, batch.draftModel || props.model);
      const generationError = !draftError ? knowledgeCardGenerationError(batch, batch.draftModel || props.model, plan.pageCount) : undefined;
      const remaining = knowledgeCardRemainingPages(batch, batch.draftModel || props.model, plan.pageCount);
      const credits = remaining.reduce((sum, i) => sum + knowledgeCardCreditsForPageIndex(i, batch.draftModel || props.model), 0);
      return <article key={batch.id} className="space-y-3 rounded-xl border border-white/10 bg-slate-950/35 p-4">
        <h3 className="text-sm font-medium text-slate-100">第 {index + 1} 份 · {batch.source.length.toLocaleString()} 字符</h3>
        <label className="flex items-center gap-2 text-xs text-slate-300">主体位置（横版16:9）
          <select aria-label={`第${index + 1}份主体位置`} className="rounded-lg border border-white/15 bg-slate-900 p-2" disabled={blocked} value={resolveKnowledgeCardSubjectPosition(batch.subjectPosition)} onChange={event => edit(() => patch(batch.id, { subjectPosition: resolveKnowledgeCardSubjectPosition(event.target.value) }))}>
            <option value="left">左侧</option><option value="center">居中</option>
          </select>
        </label>
        <label className="block space-y-1 text-xs text-slate-400"><span>原始材料</span>
          <textarea className={inputStyle} rows={6} value={batch.source} disabled={blocked} onChange={event => edit(() => save(editKnowledgeCardMaterialBatch(current.current, batch.id, event.target.value)))} />
        </label>
        <KnowledgeCardTextReviewPanel
          sourceText={batch.source}
          storageKey={`${props.storageKey}/review/${batch.id}/source`}
          disabled={blocked}
          onBusyChange={props.onBusyChange}
          onApply={(text) => save(editKnowledgeCardMaterialBatch(current.current, batch.id, text))}
        />
        <button type="button" className={buttonStyle} disabled={blocked || !batch.source.trim()} onClick={() => distill(batch)}>提炼这一份</button>
        <label className="block space-y-1 text-xs text-slate-400"><span>提炼稿（可编辑；修改后旧图片仍保留）</span>
          <textarea className={inputStyle} rows={6} value={batch.draft} disabled={blocked} onChange={event => edit(() => patch(batch.id, { draft: event.target.value }))} />
        </label>
        <KnowledgeCardTextReviewPanel
          sourceText={batch.draft}
          storageKey={`${props.storageKey}/review/${batch.id}/draft`}
          disabled={blocked}
          onBusyChange={props.onBusyChange}
          onApply={(text) => patch(batch.id, { draft: text })}
        />
        {(draftError || generationError) && <p role="alert" className="text-xs text-amber-300">{draftError || generationError}</p>}
        <button type="button" className={buttonStyle} disabled={blocked || Boolean(draftError || generationError) || !batch.draft.trim() || !remaining.length} onClick={() => generate(batch)}>生成这一份 · 剩余{remaining.length}/{plan.pageCount}页 · 4K · {credits}积分</button>
        {batch.pending && <div className="space-y-2 text-xs text-amber-200">
          <p>{batch.pending.jobId ? `已有${batch.pending.kind === "distill" ? "提炼" : "图片"}任务，恢复时仅查询原任务。` : "提交结果尚未确认，未取得任务编号。请先核对任务与扣费，禁止重复提交。"}</p>
          {batch.pending.jobId && <button type="button" className={buttonStyle} disabled={busy || props.disabled || Boolean(loadError)} onClick={() => resume(batch)}>查询已有任务</button>}
        </div>}
        {batch.error && <p role="alert" className="text-xs text-amber-300">{batch.error}</p>}
        {!!batch.images.length && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{batch.images.map((image, i) => <a key={`${image.url}-${i}`} href={image.url} target="_blank" rel="noreferrer" className="space-y-1 text-xs text-slate-400"><img src={image.url} alt={`第${index + 1}份已保存图片${i + 1}`} className="w-full rounded-lg" /><span>已保存结果 {i + 1} · 第{image.pageIndex}页</span></a>)}</div>}
      </article>;
    })}
  </section>;
}
