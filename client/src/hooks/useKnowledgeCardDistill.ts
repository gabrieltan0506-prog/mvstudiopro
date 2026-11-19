/**
 * 图文知识手册 · 提炼 / 精华派生 / 切档（前台流程）。
 * 1119 C0：自 PlatformPage.tsx 原样搬出（零逻辑改动），便于后续评审 diff；依赖全部经 deps 转交。
 */
import { assertKnowledgeCardIllustrationSelection } from "@shared/knowledgeCardIllustrationSelection";
import { knowledgeCardFullManuscript, knowledgeCardInputFingerprint, knowledgeCardInputKey } from "@shared/knowledgeCardSourceIdentity";
import { knowledgeCardProgressFromDistill, knowledgeCardStageCounts } from "@/components/platform/KnowledgeCardProgress";
import { knowledgeCardRecoveryMessage, knowledgeCardTrackedJobId, submitKnowledgeCardOnce } from "@/lib/knowledgeCardTrackedSubmission";
import { knowledgeEditionParts } from "@shared/knowledgeCardEdition";
import { planKnowledgeCardPages } from "@shared/knowledgeCardPagination";
import { pollJobUntilTerminal } from "@/lib/jobs";
import { toast } from "@/lib/platformToast";
import { useEffect, useState } from "react";
import { withLongJobsFlyDirect } from "@/lib/longJobsFlyOrigin";
import type { KnowledgeCardDetailLevel } from "@shared/knowledgeCardDistillSections";
import type { KnowledgeReadingProgress } from "@shared/knowledgeReadingPreparation";
import type { KnowledgeCardPendingFile, KnowledgeDistillDiagnosticView } from "@/pages/PlatformPage";

/** PlatformPage 原组件作用域里的依赖（纯搬移：名字与原变量一致，原样转交）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UseKnowledgeCardDistillDeps = Record<string, any>;

export function useKnowledgeCardDistill(deps: UseKnowledgeCardDistillDeps) {
  const {
    KNOWLEDGE_CARD_DERIVE_STALE_MESSAGE,
    bumpCustomNoteRevision,
    customNoteBusy,
    customNoteCompactMarkdown,
    customNoteCompactMarkdownRef,
    customNoteDetailLevel,
    customNoteDistillModel,
    customNoteDistillPhase,
    customNoteFollowOnlyJobRef,
    customNoteFullMarkdown,
    customNoteFullMarkdownRef,
    customNoteIllustrationMarkdown,
    customNoteInfographicTemplateId,
    customNoteLevelSwitching,
    customNotePagination,
    customNotePendingConfirmRef,
    customNotePendingFilesRef,
    customNoteRevisionRef,
    customNoteText,
    customNoteTrackedRequestRef,
    customNoteUploadBusy,
    customNoteUploadStopRef,
    deriveOwnedJobIdRef,
    enqueueKnowledgeCardLevelDeriveMutation,
    hasSupervisorOpsAccess,
    knowledgeCardLayoutSourceIdRef,
    knowledgeCardPageTasks,
    knowledgePollingRef,
    knowledgeVerifiedEditionRef,
    prepareKnowledgeCardCopyMutation,
    readingControllerRef,
    readingFullMarkdownRef,
    setCustomNoteCancelRequested,
    setCustomNoteCompactMarkdown,
    setCustomNoteDetailLevel,
    setCustomNoteDistillJobId,
    setCustomNoteFullMarkdown,
    setCustomNoteLevelSwitching,
    setCustomNotePendingMeta,
    setCustomNotePreparedModel,
    setCustomNoteProgress,
    setCustomNoteText,
    setCustomNoteUploadStatus,
    setKnowledgeCardEpubPdfs,
    setKnowledgeDistillDiagnostics,
    setKnowledgeDistillLive,
    setReadingAdvisorDrafts,
    setReadingAdvisorStatus,
    showKnowledgeCardEpubPdfs,
    workbenchUserKey,
  } = deps;

  /**
   * 提炼：短文同步直出；长书由服务端转后台任务，这里轮询进度直到拿到稿子。
   * 上传后与「点生成时仍有待处理文件」两条路径共用，避免逻辑分叉。
   */
  /** 完整版长稿 → 精华版：后台任务（DeepSeek，几美分，不扣积分），带进度；结果缓存，切回完整版不再重算 */
  const customNotePaginationKey = knowledgeCardInputKey({ owner: workbenchUserKey, text: customNoteIllustrationMarkdown, full: knowledgeCardFullManuscript(customNoteText, customNoteFullMarkdown, customNoteCompactMarkdown), level: customNoteDetailLevel, template: customNoteInfographicTemplateId, model: customNoteDistillModel });
  const [paginationFingerprint, setPaginationFingerprint] = useState<{ key: string; hash: string } | null>(null);
  useEffect(() => {
    let stale = false;
    void knowledgeCardInputFingerprint(customNotePaginationKey).then(hash => {
      if (!stale) setPaginationFingerprint({ key: customNotePaginationKey, hash });
    }).catch(() => { if (!stale) setPaginationFingerprint(null); });
    return () => { stale = true; };
  }, [customNotePaginationKey]);
  const currentNotePagination = customNotePagination?.sourceId === knowledgeCardLayoutSourceIdRef.current && customNotePagination.inputKey === customNotePaginationKey ? customNotePagination : null;
  const deriveCompactFromFull = async (full: string): Promise<string> => {
    const cached = customNoteCompactMarkdownRef.current;
    if (cached && knowledgeEditionParts(cached) && knowledgeEditionParts(full)) {
      try { assertKnowledgeCardIllustrationSelection(cached, customNoteDistillModel); return cached; }
      catch { setCustomNoteCompactMarkdown(null); }
    }
    // 本次派生绑定的稿件版本；回写前比对，旧响应一律作废
    const pageRequestId = knowledgeCardPageTasks.begin("knowledge_card_derive_level");
    const revision = customNoteRevisionRef.current;
    setCustomNoteLevelSwitching(true);
    setCustomNoteCancelRequested(false);
    setCustomNoteProgress({ status: "running", percent: 1, label: "选择重点配图…" });
    try {
      const pollController=new AbortController();
      knowledgePollingRef.current?.abort();knowledgePollingRef.current=pollController;
      const derivedJobId = await knowledgeCardTrackedJobId(workbenchUserKey,"knowledge_card_derive_level",pageRequestId);
      customNoteTrackedRequestRef.current={jobId:derivedJobId,requestId:pageRequestId,action:"knowledge_card_derive_level"};
      setCustomNoteDistillJobId(derivedJobId);
      deriveOwnedJobIdRef.current = derivedJobId;
      const queued: any = await submitKnowledgeCardOnce(() => enqueueKnowledgeCardLevelDeriveMutation.mutateAsync({
        pageRequestId,
        fullMarkdown: full,
        distillModel: customNoteDistillModel,
        editionVersion: 2,
      }), error=>{knowledgeCardPageTasks.finish(pageRequestId);pollController.abort(error);}).catch(error=>{knowledgeCardPageTasks.finish(pageRequestId);throw error;});
      knowledgeCardPageTasks.assertLive();
      if(queued && queued.progressJobId!==derivedJobId)throw Error("任务回执身份不一致，已停止后续处理");
      const job = await pollJobUntilTerminal(derivedJobId, {
        signal:pollController.signal,
        onUnavailable: error => {
          const message=knowledgeCardRecoveryMessage(error);
          setCustomNoteProgress((prev: any)=>({...prev,status:"running",label:message}));
          setCustomNoteUploadStatus(message);
        },
        intervalMs: 3000,
        // 服务端不设总时长（只按连续无进度判死），前端也不设：轮询到终态为止
        maxWaitMs: Number.MAX_SAFE_INTEGER,
        onPoll: ({ output }) => {
          // 稿子已经换过：这条派生的进度与当前文本框无关，不许再动进度条
          if (revision !== customNoteRevisionRef.current) return;
          const out = (output || {}) as { distillPercent?: number; distillStage?: string; distillStageDone?: number; distillStageTotal?: number };
          const total = Number(out.distillStageTotal) || 0;
          const stage=out.distillStage==="verifying"?"联网核实与修订":out.distillStage==="revising"?"保存核实结果":out.distillStage==="merging"?"汇总知识与疑点":"提炼整理";
          const label=total?`${stage} ${Number(out.distillStageDone)||0}/${total} 批`:stage+"…";
          setCustomNoteUploadStatus(label);
          setCustomNoteProgress({
            status: "running",
            percent: Math.max(1, Math.min(97, Number(out.distillPercent) || 1)),
            label,
            ...knowledgeCardStageCounts(out),
          });
        },
      });
      knowledgeCardPageTasks.finish(pageRequestId);
      knowledgeCardPageTasks.assertLive();
      if (job.status === "failed") throw new Error(job.error || "精华版派生失败，请稍后重试");
      const out = (job.output || {}) as { distilledMarkdown?: string; distillModel?: string; fullEditionMarkdown?:string;verificationProcessed?:boolean;editionIssues?:{message:string}[];editionPendingVerification?:{pageIndex:number;message:string}[] };
      const compact = String(out.distilledMarkdown || "").trim();
      if (!compact) throw new Error("精华版派生结果为空");
      assertKnowledgeCardIllustrationSelection(compact, out.distillModel || customNoteDistillModel);
      // 审查 P1：稿子在派生期间被换过（清空/重新提炼/换书）→ 这份结果作废，不许覆盖新稿
      if (revision !== customNoteRevisionRef.current) {
        throw new Error(KNOWLEDGE_CARD_DERIVE_STALE_MESSAGE);
      }
      if (out.distillModel) setCustomNotePreparedModel(out.distillModel);
      if(out.fullEditionMarkdown){
        knowledgeVerifiedEditionRef.current=out.verificationProcessed?{jobId:derivedJobId,full:out.fullEditionMarkdown,concise:compact}:null;
        setCustomNoteFullMarkdown(out.fullEditionMarkdown);
        setCustomNoteText(customNoteDetailLevel==='full'?out.fullEditionMarkdown:compact);
      }
      setCustomNoteCompactMarkdown(compact);
      const remaining=out.editionIssues||[];
      const pendingVerification=out.editionPendingVerification||[];
      setCustomNoteProgress({ status: "succeeded", percent: 100, successLabel:remaining.length?"稿件已保存，部分章节待补齐":"生图前整理完成", label: remaining.length?`已保留全部章节，${remaining.length}项待处理：${remaining.map(i=>i.message).join('；')}`:`整理已结束${pendingVerification.length?`，${pendingVerification.length}项已标待验证并保留，可继续制作`:""}，请核对图片张数和文字说明页数` });
      return compact;
    } catch (error) {
      // 审查 P2：稿子换过之后才失败的，同样与当前文本框无关——统一标成 stale，
      // 否则「失败回退」会把上一本的完整版写回来
      if (revision !== customNoteRevisionRef.current) {
        throw new Error(KNOWLEDGE_CARD_DERIVE_STALE_MESSAGE);
      }
      throw error;
    } finally {
      setCustomNoteLevelSwitching(false);
      // 只清自己那单（迟到的旧派生不许抹掉新任务的终止按钮）
      const owned = deriveOwnedJobIdRef.current;
      if (owned) {
        setCustomNoteDistillJobId((prev: any) => (prev === owned ? "" : prev));
        deriveOwnedJobIdRef.current = "";
        if(customNoteTrackedRequestRef.current?.jobId===owned)customNoteTrackedRequestRef.current=null;
        setCustomNoteCancelRequested(false);
      }
    }
  };

  /**
   * 提炼产出的完整版长稿落为真源，按当前档决定文本框显示哪一档（精华版即派生一次）。
   * 审查 P1：三条提炼路径（上传、点生成时仍有待处理文件、粘贴长文先提炼）必须走同一个入口，
   * 否则选精华版却拿到完整版、按更多页计费；旧书的真源也必须在这里被替换。
   */
  const adoptDistilledFullMarkdown = async (distilled: string): Promise<string> => {
    setCustomNoteFullMarkdown(distilled);
    setCustomNoteText(distilled);
    setCustomNoteCompactMarkdown(null);
    // 选图失败保留全文并停止本次出图，不能按全文自动继续购买配图。
    setCustomNoteUploadStatus("完整底稿已保留，正在核实疑点并选择精华配图…");
    try {
      const compact=await deriveCompactFromFull(distilled);
      return customNoteDetailLevel==='full'?(customNoteFullMarkdownRef.current||distilled):compact;
    } catch (deriveErr) {
      const msg = String((deriveErr as { message?: string })?.message || "精华版派生失败");
      // 审查 P2：稿子已换，这份 distilled 也是旧的——往上抛，调用方不许把它当成功稿写回文本框
      if (msg === KNOWLEDGE_CARD_DERIVE_STALE_MESSAGE) throw deriveErr;
      customNotePendingFilesRef.current = [];
      setCustomNotePendingMeta([]);
      throw new Error(`重点配图尚未选好：${msg}。完整正文已保留，本次未开始出图`);
    }
  };

  /** adopt 抛 stale＝稿子已被换掉：整条流程静默收手，不写文本框、不报错 */
  const isKnowledgeCardDeriveStale = (err: unknown) =>
    String((err as { message?: string })?.message || "") === KNOWLEDGE_CARD_DERIVE_STALE_MESSAGE;

  /** 成稿档切换：有完整版真源时直接换视图（精华版首次切需派生一次） */
  const switchKnowledgeCardLevel = async (next: KnowledgeCardDetailLevel) => {
    // 等出图确认期间不许切档：确认弹窗上写的成稿档必须等于真正出图用的那一档
    if (customNotePendingConfirmRef.current) {
      toast.info("正在等你确认出图，先点「返回修改」再切档");
      return;
    }
    if (customNoteLevelSwitching) {
      toast.info("精华版还在派生中，等它结束再切档");
      return;
    }
    // 提炼/上传/出图在途也不许切档（handler 级，与按钮 disabled 同口径）：
    // 否则下拉显示精华版、文本框还是完整版、报价按完整版算
    if (customNoteBusy || customNoteUploadBusy || customNoteDistillPhase === "distilling") {
      toast.info("提炼或生成还在进行中，等它结束再切档");
      return;
    }
    const previousLevel = customNoteDetailLevel;
    setCustomNoteDetailLevel(next);
    try { localStorage.setItem("mvs-knowledge-card-detail-level", next); } catch { /* ignore */ }
    if (!customNoteFullMarkdown) return;
    try {
      const compact = await deriveCompactFromFull(customNoteFullMarkdown);
      const selected=next==='full'?(customNoteFullMarkdownRef.current||customNoteFullMarkdown):compact;
      setCustomNoteText(selected);
      const plan = planKnowledgeCardPages(selected, customNoteDistillModel);
      toast.success(`${next==='full'?'完整版·多图少字':'精华版·少图多字'} · ${plan.pageCount} 张图片 · ${plan.credits} 积分`);
    } catch (err) {
      // 审查 P1：派生失败时下拉不能停在「精华版」而文本框是完整版——档位回退，与上传路径一致
      const msg = String((err as { message?: string })?.message || "精华版派生失败");
      // 稿子已经被换掉：这次派生的成败都与当前文本框无关，静默收手，不回写不改档
      if (msg === KNOWLEDGE_CARD_DERIVE_STALE_MESSAGE) return;
      setCustomNoteDetailLevel(previousLevel);
      try { localStorage.setItem("mvs-knowledge-card-detail-level", previousLevel); } catch { /* ignore */ }
      toast.error(`${msg}；正文未改变，未开始出图`);
      setCustomNoteProgress((prev: any) => ({ ...prev, status: "failed", percent: prev.status === "running" ? prev.percent : 0, error: msg }));
    }
  };

  useEffect(() => () => { readingControllerRef.current?.stop(); }, []);

  const runKnowledgeCardDistill = async (args: {
    sourceText?: string;
    files?: KnowledgeCardPendingFile[];
    onStatus?: (text: string) => void;
    /** 纯文本长文里用户主动买的提炼，服务端据此收提炼费 */
    chargeDistillFee?: boolean;
  }): Promise<string> => {
    setCustomNoteProgress((prev: any) => ({ status: "running", percent: Math.max(prev.status === "running" ? prev.percent : 0, 1), label: "提交提炼任务…" }));
    // 新一轮提炼开始：旧书的真源作废，避免切档把上一本写回来；版本 +1 让在途派生的回写失效
    bumpCustomNoteRevision();
    // 原文提炼已经产出完整 Markdown，不再额外启动逐段设计顾问。
    readingControllerRef.current?.stop();
    readingControllerRef.current = null;
    setReadingAdvisorDrafts([]);
    setReadingAdvisorStatus("完整正文整理中；图文完成后自动整理并排版。");
    setCustomNoteFullMarkdown(null); setCustomNotePreparedModel(null);
    setCustomNoteCompactMarkdown(null);
    // 新一轮提炼：上一本 EPUB 的 PDF 按钮不再挂着（本轮转档成功会重新出现）
    setKnowledgeCardEpubPdfs([]);
    setCustomNoteCancelRequested(false);
    const pageRequestId = knowledgeCardPageTasks.begin("knowledge_card_distill");
    const trackedJobId = await knowledgeCardTrackedJobId(workbenchUserKey,"knowledge_card_distill",pageRequestId);
    customNoteTrackedRequestRef.current={jobId:trackedJobId,requestId:pageRequestId,action:"knowledge_card_distill"};
    setCustomNoteDistillJobId(trackedJobId);
    const pollController=new AbortController();
    knowledgePollingRef.current?.abort();knowledgePollingRef.current=pollController;
    const queued: any = await submitKnowledgeCardOnce(() => prepareKnowledgeCardCopyMutation.mutateAsync({
      pageRequestId,
      sourceText: args.sourceText,
      files: args.files?.length ? args.files : undefined,
      forceDistill: true,
      billingPolicy: "interior-pages-v1",
      distillModel: customNoteDistillModel,
      // 提炼一律出完整版长稿当真源；精华版之后从长稿派生，两档随时切
      detailLevel: "full",
      ...(args.chargeDistillFee ? { chargeDistillFee: true } : {}),
    }), error=>{knowledgeCardPageTasks.finish(pageRequestId);pollController.abort(error);}).catch(error=>{
      knowledgeCardPageTasks.finish(pageRequestId);
      readingControllerRef.current?.stop();
      setCustomNoteDistillJobId((prev: any)=>prev===trackedJobId?"":prev);
      if(customNoteTrackedRequestRef.current?.jobId===trackedJobId)customNoteTrackedRequestRef.current=null;
      throw error;
    });

    knowledgeCardPageTasks.assertLive();
    if (queued && (!queued.isAsync || !queued.progressJobId)) {
      knowledgeCardPageTasks.finish(pageRequestId);
      knowledgeCardPageTasks.assertLive();
      setCustomNoteProgress({ status: "running", percent: knowledgeCardProgressFromDistill(98), label: "提炼完成" });
      setCustomNotePreparedModel(queued.distillModel || customNoteDistillModel);
      return String(queued.distilledMarkdown || "").trim();
    }

    // 同一份资料已在另一页处理中（1114）：服务端不建第二单。两种回执：
    // · 常规：回本页自己的编号（服务端落了跟进记录），照常轮询它即跟到原任务；停止/离页由服务端按交接规则处理。
    // · 降级（跟进记录没写成）：回原任务编号，本页只读跟进；本页的停止只停止本页跟进，不动原任务。
    const followOnlyJobId = queued?.attachedToExistingJob && typeof queued.progressJobId === "string"
      && queued.progressJobId !== trackedJobId && /^[\w-]{8,64}$/.test(queued.progressJobId) ? queued.progressJobId : "";
    if(queued?.progressJobId && queued.progressJobId!==trackedJobId && !followOnlyJobId)throw Error("任务回执身份不一致，已停止后续处理");
    if (queued?.attachedToExistingJob) toast.message("这份资料正在处理中，本页已接上原进度，完成后结果同步显示");
    const pollJobId = followOnlyJobId || trackedJobId;
    if (followOnlyJobId) {
      // 本页请求编号没有建任何行，离页无须停止；停止按钮只断本页轮询
      knowledgeCardPageTasks.finish(pageRequestId);
      if(customNoteTrackedRequestRef.current?.jobId===trackedJobId)customNoteTrackedRequestRef.current=null;
      customNoteFollowOnlyJobRef.current = followOnlyJobId;
    }
    const totalHint = Math.max(1, queued?.estimatedChunks || 1);
    args.onStatus?.(
      queued && queued.sourceChars > 0
        ? `已读出约 ${queued.sourceChars.toLocaleString()} 字，正在分 ${totalHint} 段提炼…`
        : "正在整理文件内容…",
    );
    const stageLabel = (out: {
      distillStage?: string; distillStageDone?: number; distillStageTotal?: number; distillFileName?: string;
      distillPhase?: string; distillDoneChunks?: number; distillTotalChunks?: number; distillResumeNotice?: string;
    }): string => {
      // 服务端自动续做：说明只补未完成段，不让用户以为从头开始。
      const resume = typeof out.distillResumeNotice === "string" && out.distillResumeNotice ? `${out.distillResumeNotice} · ` : "";
      return resume + stageLabelBase(out);
    };
    const stageLabelBase = (out: {
      distillStage?: string; distillStageDone?: number; distillStageTotal?: number; distillFileName?: string;
      distillPhase?: string; distillDoneChunks?: number; distillTotalChunks?: number;
    }): string => {
      const stage = out.distillStage || out.distillPhase || "";
      if (stage === "resuming") return "准备续做";
      const done = Number(out.distillStageDone) || 0;
      const total = Number(out.distillStageTotal) || 0;
      if (stage === "converting") return `EPUB 转 PDF · ${out.distillFileName || ""}`;
      if (stage === "reading") return total ? `读原稿 ${done}/${total} 页` : "读原稿…";
      if (stage === "selecting") return total ? `挑选参考页 ${done}/${total} 张目录页` : "挑选值得参考的原稿页…";
      if (stage === "rendering") return total ? `渲染参考页 ${done}/${total}` : "渲染参考页…";
      if (stage === "refining") return "统稿合并…";
      if (stage === "finishing") return "写入结果…";
      const dc = Number(out.distillDoneChunks) || 0;
      const tc = Number(out.distillTotalChunks) || totalHint;
      return `分段提炼 ${dc}/${tc} 段`;
    };
    // 只读跟进时在上传途中点了中止：先于登记任务编号退出，否则后面的收尾走不到，页面会一直显示「任务进行中」。
    if (customNoteUploadStopRef.current && args.files?.length && followOnlyJobId) {
      customNoteFollowOnlyJobRef.current = "";
      setCustomNoteCancelRequested(false);
      throw new Error("本页已停止跟进");
    }
    setCustomNoteDistillJobId(pollJobId);
    // 提交请求在途时点中止：取得同一任务 ID 后请求停止，失败仍继续轮询并允许重试中止。
    if (customNoteUploadStopRef.current && args.files?.length) {
      try {
        const response = await fetch(withLongJobsFlyDirect(`/api/jobs/knowledge-card/${encodeURIComponent(trackedJobId)}/cancel`), { method: "POST", credentials: "include" });
        const result = await response.json();
        if (!response.ok) throw new Error("中止请求未确认，请再点中止任务；不要重复提交精炼");
        setCustomNoteCancelRequested(Boolean(result.cancelled));
        toast.message(String(result.messageZh || "已请求中止"));
      } catch (error) {
        setCustomNoteCancelRequested(false);
        toast.error(error instanceof Error ? error.message : "中止请求未确认，请再点中止任务");
      }
    }
    const ownedJobId = pollJobId;
    try {
    const job = await pollJobUntilTerminal(pollJobId, {
        signal:pollController.signal,
        onUnavailable: error => {
          const message=knowledgeCardRecoveryMessage(error);
          setCustomNoteProgress((prev: any)=>({...prev,status:"running",label:message}));
          setCustomNoteUploadStatus(message);
        },
      intervalMs: 3000,
      // 服务端不设总时长（只按连续无进度判死），前端也不设：轮询到终态为止
      maxWaitMs: Number.MAX_SAFE_INTEGER,
      adaptiveBackoffAfterAttempts: 40,
      maxIntervalMs: 8000,
      onPoll: ({ output }) => {
        const out = (output || {}) as {
          distillPercent?: number;
          distillStage?: string; distillStageDone?: number; distillStageTotal?: number; distillFileName?: string;
          distillPhase?: string; distillDoneChunks?: number; distillTotalChunks?: number;
          epubPdfs?: Array<{ fileName: string; url: string }>;
          readingPreparation?: KnowledgeReadingProgress;
          distillStageAt?: Record<string, string>;
        };
        // 1119 F1/F2：只读记录本次提炼的分段计时与已就绪分组数，供 Debug 计时与进行中预览；不触发任何请求或收费
        setKnowledgeDistillLive?.({ jobId: pollJobId, readyBatches: Array.isArray(out.readingPreparation?.ready) ? out.readingPreparation!.ready.length : 0, stageAt: out.distillStageAt && typeof out.distillStageAt === "object" ? out.distillStageAt : undefined });
        // EPUB 一转完就出下载按钮，不等提炼结束（后面提炼失败也能下载）
        if (Array.isArray(out.epubPdfs) && out.epubPdfs.length) showKnowledgeCardEpubPdfs(out.epubPdfs);
        const label = stageLabel(out);
        setCustomNoteUploadStatus(label);
        args.onStatus?.(label);
        setCustomNoteProgress({
          status: "running",
          percent: knowledgeCardProgressFromDistill(Number(out.distillPercent) || 2),
          label,
          ...knowledgeCardStageCounts(out),
        });
      },
    });
    knowledgeCardPageTasks.finish(pageRequestId);
    knowledgeCardPageTasks.assertLive();
    if (job.status === "failed") {
      const diagnostics = (job.output as { distillFailureDiagnostics?: KnowledgeDistillDiagnosticView[] } | undefined)?.distillFailureDiagnostics;
      if (hasSupervisorOpsAccess && Array.isArray(diagnostics)) setKnowledgeDistillDiagnostics(diagnostics);
      throw new Error(job.error || "提炼失败，请查看原任务");
    }
    setCustomNoteProgress({ status: "running", percent: knowledgeCardProgressFromDistill(98), label: "提炼完成" });
    const out = (job.output || {}) as { distilledMarkdown?: string; distillModel?: string; epubPdfs?: Array<{ fileName: string; url: string }>; readingPreparation?:KnowledgeReadingProgress };
    readingFullMarkdownRef.current=String(out.distilledMarkdown||"").trim();
    setCustomNotePreparedModel(out.distillModel || queued?.distillModel || customNoteDistillModel);
    if (Array.isArray(out.epubPdfs) && out.epubPdfs.length) showKnowledgeCardEpubPdfs(out.epubPdfs);
    return String(out.distilledMarkdown || "").trim();
    } finally {
      // 只清自己那单：迟到的旧轮询不许把新任务的终止按钮抹掉
      setCustomNoteDistillJobId((prev: any) => (prev === ownedJobId ? "" : prev));
      if(customNoteTrackedRequestRef.current?.jobId===ownedJobId)customNoteTrackedRequestRef.current=null;
      if(customNoteFollowOnlyJobRef.current===ownedJobId)customNoteFollowOnlyJobRef.current="";
      setCustomNoteCancelRequested(false);
      // 进行中预览只属于这单；结束（成功/失败/停止）即收起，计时留给 Debug 面板
      setKnowledgeDistillLive?.((prev: { jobId: string } | null) => (prev?.jobId === ownedJobId ? { ...prev, done: true } : prev));
    }
  };

  return { customNotePaginationKey, paginationFingerprint, setPaginationFingerprint, currentNotePagination, deriveCompactFromFull, adoptDistilledFullMarkdown, isKnowledgeCardDeriveStale, switchKnowledgeCardLevel, runKnowledgeCardDistill };
}
