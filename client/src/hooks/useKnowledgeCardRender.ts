/**
 * 图文知识手册 · 出图 / 补图 / PDF 导出（前台流程）。
 * 1119 C0：自 PlatformPage.tsx 原样搬出（零逻辑改动），便于后续评审 diff；依赖全部经 deps 转交。
 */
import { KNOWLEDGE_CARD_DETAIL_LEVEL_LABEL_ZH, suggestKnowledgeCardMinSections } from "@shared/knowledgeCardDistillSections";
import { KNOWLEDGE_CARD_GATEWAY_PAGE_MESSAGE, sanitizePlatformUserMessage } from "@/lib/platformUserFacingCopy";
import { KNOWLEDGE_CARD_SKIP_DISTILL_MAX_CHARS, estimateKnowledgeCardDistillTradeoff, knowledgeCardCreditsForPageIndex, planKnowledgeCardPages } from "@shared/knowledgeCardPagination";
import { KNOWLEDGE_CARD_SUBJECT_POSITION_LABEL_ZH } from "@shared/knowledgeCardSubjectPosition";
import { assertKnowledgeCardIllustrationSelection } from "@shared/knowledgeCardIllustrationSelection";
import { cachePhotoTemporaryMedia, triggerTemporaryDownload } from "@/lib/photoTemporaryMedia";
import { extractInfographicSubjectFromUserCopy } from "@shared/infographicNoteTemplates";
import { formatOptimizationAdvice } from "@shared/marketingOffer";
import { getJob, pollJobUntilTerminal } from "@/lib/jobs";
import { inspectKnowledgeIllustrationRetry, knowledgeIllustrationJobId, knowledgeIllustrationRun, runKnowledgeIllustrationBatch } from "@/lib/knowledgeIllustrationRun";
import { knowledgeCardFullManuscript, knowledgeCardInputFingerprint, knowledgeCardInputKey } from "@shared/knowledgeCardSourceIdentity";
import { knowledgeCardProgressFromRender } from "@/components/platform/KnowledgeCardProgress";
import { knowledgeCardRecordedModelLabel } from "@shared/knowledgeCardDistillModels";
import { HANDBOOK_IMAGE_MODEL, HANDBOOK_IMAGE_TIER_LABEL_ZH, HANDBOOK_IMAGE_VARIANT } from "@shared/openaiImageVariant";
import { knowledgeCardPlannedTextPages } from "@/lib/knowledgeCardPreflightCounts";
import { handbookManuscriptNeedsStaging, stageHandbookManuscript } from "@/lib/handbookManuscriptStage";
import { knowledgeIllustrationBatchCounts, knowledgeIllustrationBatchSummaryZh } from "@/lib/knowledgeIllustrationBatchCounts";
import { synchronizedKnowledgeCardSource } from "@shared/knowledgeCardEditableLayout";
import { toast } from "@/lib/platformToast";
import type { KnowledgeSupplementSelection } from "@shared/knowledgeSupplement";


/** PlatformPage 原组件作用域里的依赖（纯搬移：名字与原变量一致，原样转交）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UseKnowledgeCardRenderDeps = Record<string, any>;

export function useKnowledgeCardRender(deps: UseKnowledgeCardRenderDeps) {
  const {
    COMPOSITE_SHEET_IMAGE_PROMPT_TRANSLATOR,
    adoptDistilledFullMarkdown,
    allowBloggerTitle,
    askKnowledgeCardPreflight,
    customNoteBusy,
    customNoteCardsOnly,
    customNoteCompactMarkdownRef,
    customNoteDetailLevel,
    customNoteDistillJobId,
    customNoteDistillModel,
    customNoteDistillPhase,
    customNoteFullMarkdown,
    customNoteFullMarkdownRef,
    customNoteImagesRef,
    customNoteInfographicLabelZh,
    customNoteInfographicTemplateId,
    customNoteKind,
    customNoteLevelSwitching,
    customNotePendingFilesRef,
    customNoteRevisionRef,
    customNoteSelectedFileCount,
    customNoteStopRenderRef,
    customNoteSubjectPosition,
    customNoteText,
    customNoteUploadBusy,
    customOptimizeBrief,
    deleteKnowledgeCardEpubPdfMutation,
    deriveCompactFromFull,
    enabledPlatformSkillIds,
    generateCustomNoteMutation,
    isKnowledgeCardDeriveStale,
    knowledgeCardDraftChanged,
    knowledgeCardEpubPdfBusy,
    knowledgeCardEpubPdfTakenRef,
    knowledgeCardInflight,
    knowledgeCardLayoutSourceIdRef,
    knowledgeCardPageTasks,
    knowledgeCardPdfBusy,
    knowledgeCardRenderConcurrency,
    knowledgeVerifiedEditionRef,
    layoutStudioRef,
    markInflight,
    newPlatformCompositeProgressJobId,
    optimizeCustomCopyMutation,
    pendingOptimizeLiveTrendsRef,
    pendingOptimizeVisionRef,
    readPosterResumeRecord,
    readingControllerRef,
    readingFullMarkdownRef,
    renderRunIdRef,
    renderedDetailLevelRef,
    renderedDraftRef,
    renderedFullManuscriptRef,
    renderedImageJobsRef,
    renderedSettingsRef,
    renderedSubmittedImageJobsRef,
    resolveKnowledgeCardSourceText,
    runKnowledgeCardDistill,
    setCustomNoteBusy,
    setCustomNoteDistillPhase,
    setCustomNoteError,
    setCustomNoteImageLower,
    setCustomNoteImageUpper,
    setCustomNoteImages,
    setCustomNotePageProgress,
    setCustomNotePartInFlight,
    setCustomNotePendingMeta,
    setCustomNoteProgress,
    setCustomNoteRendering,
    setCustomNoteText,
    setCustomNoteUploadStatus,
    setCustomOptimizeResult,
    setCustomOptimizeSummary,
    setKnowledgeCardEpubPdfBusy,
    setKnowledgeCardEpubPdfs,
    setKnowledgeCardInflight,
    setKnowledgeCardPdfBusy,
    setKnowledgeCardPdfProgress,
    setKnowledgeCardPdfUrl,
    startKnowledgeCardPdfExportMutation,
    trpcUtils,
    workbenchUserKey,
    writePosterResumeRecord,
  } = deps;

  /** 单页补出：只重出失败/缺失的那一页，按该页页费确认后扣费；不动其它页 */
  const retryKnowledgeCardPage = async (idx: number) => {
    if (!workbenchUserKey) { toast.error("请先登录再补出图片"); return; }
    if (customNoteBusy) { toast.info("上一个生成任务还在进行中，请稍候"); return; }
    const total = customNoteImagesRef.current.length;
    // 必须用出图时的提炼稿快照：文本框改过再按新文本出第 N 页，会拿到另一份稿的页还照旧计费
    const text = renderedDraftRef.current;
    if (!text || idx < 0 || idx >= total) return;
    if (knowledgeCardDraftChanged()) { toast.error("文案已改动，补出会对不上这套卡；请重新整套生成"); return; }
    if (knowledgeCardInflight.includes(idx)) { toast.info(`第 ${idx + 1} 页仍在生成中，请稍候`); return; }
    const runId = renderRunIdRef.current;
    setCustomNoteBusy(true);
    setCustomNoteError(null);
    setKnowledgeCardPdfUrl(null);
    setCustomNoteProgress({ status: "running", percent: knowledgeCardProgressFromRender(customNoteImagesRef.current.filter(Boolean).length, total), stageDone: customNoteImagesRef.current.filter(Boolean).length, stageTotal: total, label: `补出第 ${idx + 1}/${total} 页` });
    markInflight(runId, idx, true);
    try {
      const settings = renderedSettingsRef.current;
      if (!settings) throw new Error("缺少原成品的读档与版式记录，请先恢复对应云端备份");
      const originalJobs = layoutStudioRef.current?.imageJobs(text, settings.distillModel, settings.infographicTemplateId) || renderedImageJobsRef.current;
      const originalJobId = originalJobs?.[idx];
      if (!originalJobId) throw new Error("缺少原配图任务身份，请先恢复对应云端稿件");
      let url = "", replacementJobId = originalJobId;
      if (originalJobId) {
        const knownUnsubmitted = renderedImageJobsRef.current?.[idx] === originalJobId && renderedSubmittedImageJobsRef.current !== null && !renderedSubmittedImageJobsRef.current.has(originalJobId);
        url = await inspectKnowledgeIllustrationRetry(originalJobId, knownUnsubmitted, getJob) || "";
      }
      const reusedOriginal = Boolean(url);
      if (!url) {
        const quote = await trpcUtils.client.mvAnalysis.quoteKnowledgeCardForGeneration.mutate(await handbookQuoteInput(text, settings.distillModel));
        const price = knowledgeCardCreditsForPageIndex(idx + 1, quote.billingModel);
        if (!window.confirm(`补出第 ${idx + 1}/${total} 页，${price} 积分，是否继续？`)) return;
        const replacementRequestId = knowledgeCardPageTasks.begin("platform_composite_sheet_progress");
        replacementJobId = await knowledgeIllustrationJobId(workbenchUserKey, replacementRequestId);
        const studio = layoutStudioRef.current;
        if (!studio) throw new Error("云端稿件尚未就绪，未开始补图");
        // 保存回包丢失时保留取消账本，刷新可为未发送请求取得明确的未扣费回执。
        await studio.beginImageAttempt(originalJobId, replacementRequestId, replacementJobId);
        // 发送前保留身份；无论请求、轮询或成功映射保存失败，再点只核这一次。
        renderedImageJobsRef.current = originalJobs!.slice();
        renderedImageJobsRef.current[idx] = replacementJobId;
        renderedSubmittedImageJobsRef.current?.add(replacementJobId);
        url = await generateCustomNoteOne(text, "single_page_knowledge_card", undefined, { index: idx + 1, total }, idx % 2 === 0 ? "openai" : "evolink", { ...settings, billingModel: quote.billingModel }, { requestId: replacementRequestId, jobId: replacementJobId });
      }
      if (runId !== renderRunIdRef.current) return; // 期间已重新整套生成，旧结果丢弃
      const next = customNoteImagesRef.current.slice();
      next[idx] = url;
      const ready = next.filter(Boolean).length;
      if (originalJobId) await layoutStudioRef.current?.attachImage(originalJobId, replacementJobId, ready >= total);
      // 云稿绑定成功后才移除缺页恢复按钮；保存失败仍能查询同一成功任务。
      customNoteImagesRef.current = next;
      setCustomNoteImages(next);
      if (renderedImageJobsRef.current) renderedImageJobsRef.current[idx] = replacementJobId;
      setCustomNoteProgress(ready >= total ? { status: "succeeded", percent: 100, successLabel: "配图完成", label: "正在自动整理正文与版面" } : { status: "running", percent: knowledgeCardProgressFromRender(ready, total), stageDone: ready, stageTotal: total, label: `出图 ${ready}/${total} 页` });
      toast.success(reusedOriginal ? `第 ${idx + 1} 页已恢复，未重复购买` : `第 ${idx + 1} 页已补出并保存`);
    } catch (e) {
      const msg = mapCustomNoteError(e);
      setCustomNoteError(msg);
      setCustomNoteProgress((prev) => ({ ...prev, status: "failed", percent: prev.status === "running" ? prev.percent : 0, error: msg }));
      toast.error(`补出失败：${msg.slice(0, 120)}`);
    } finally {
      markInflight(runId, idx, false);
      setCustomNoteBusy(false);
    }
  };

  /** EPUB 转好的 PDF：GCS 存档，下载时经 Fly 临时空间转存（国内可达），与整套导出同一路径 */
  const downloadKnowledgeCardEpubPdf = async (pdf: { fileName: string; url: string }) => {
    if (knowledgeCardEpubPdfBusy) return;
    setKnowledgeCardEpubPdfBusy(pdf.url);
    try {
      const downloadUrl = await cachePhotoTemporaryMedia(pdf.url, "pdf");
      triggerTemporaryDownload(downloadUrl, pdf.fileName || "epub.pdf");
      // 0923 用户令：下载后直接删档、按钮消失。Fly 临时副本已建好（下载走它，12 小时自动过期），
      // 所以此刻删 GCS 存档不影响这次下载
      knowledgeCardEpubPdfTakenRef.current.add(pdf.url);
      setKnowledgeCardEpubPdfs((prev) => prev.filter((p) => p.url !== pdf.url));
      deleteKnowledgeCardEpubPdfMutation.mutateAsync({ url: pdf.url }).catch((err) => {
        console.warn("[knowledgeCard] EPUB PDF 存档删除失败：", err);
      });
    } catch (e) {
      const raw = String((e as { message?: string })?.message || "");
      toast.error(`PDF 下载失败：${raw.slice(0, 120) || "请稍后重试"}（链接 7 天内有效，过期请重新上传 EPUB）`, { duration: 10_000 });
    } finally {
      setKnowledgeCardEpubPdfBusy(null);
    }
  };

  /**
   * 纯图片 PDF：发起即拿任务标识，后台合成，前台轮询进度（1111）。
   * 多页 4K 合成要数分钟，原先的同步长请求会被网关截断，表现为「导出中断」。
   * PDF 保留 GCS 存档，下载时由服务端转存 Fly 临时空间。
   */
  const downloadKnowledgeCardPdf = async (urls: string[]) => {
    if (!urls.length || knowledgeCardPdfBusy) return;
    setKnowledgeCardPdfBusy(true);
    setKnowledgeCardPdfProgress({ done: 0, total: urls.length });
    try {
      const title = extractInfographicSubjectFromUserCopy(customNoteText);
      type PdfTaskState = Awaited<ReturnType<typeof startKnowledgeCardPdfExportMutation.mutateAsync>> | { status: "missing"; taskId: string };
      let state: PdfTaskState = await startKnowledgeCardPdfExportMutation.mutateAsync({ imageUrls: urls, title });
      let reissued = 0, misses = 0;
      const deadline = Date.now() + 40 * 60_000;
      while (state.status === "running" || state.status === "missing") {
        if (Date.now() > deadline) throw new Error("PDF 合成时间过长，请稍后重新点击导出");
        if (state.status === "missing") {
          if (++reissued > 3) throw new Error("PDF 合成任务暂时无法续看，请重新点击导出");
          state = await startKnowledgeCardPdfExportMutation.mutateAsync({ imageUrls: urls, title });
          continue;
        }
        setKnowledgeCardPdfProgress({ done: state.donePages, total: state.totalPages });
        await new Promise((resolve) => setTimeout(resolve, 3000));
        // 单次轮询失败（网络抖动）不算导出失败，连续多次才放弃
        try { state = await trpcUtils.client.mvAnalysis.knowledgeCardPdfExportStatus.query({ taskId: state.taskId }); misses = 0; }
        catch (error) { if (++misses > 8) throw error; }
      }
      if (state.status === "failed") throw new Error(state.error || "PDF 合成失败，请稍后重试");
      const res = state.result;
      // 临时下载链接同时留在页面上，便于再次下载。
      const downloadUrl = await cachePhotoTemporaryMedia(res.url, "pdf");
      setKnowledgeCardPdfUrl(downloadUrl);
      triggerTemporaryDownload(downloadUrl, "knowledge-cards.pdf");
      toast.success(`纯图片 PDF 已生成（${res.pageCount} 页），可点「打开 / 下载 PDF」`);
    } catch (e) {
      const raw = String((e as { message?: string })?.message || "");
      const broken = /is not valid JSON|Unexpected token|Failed to fetch|NetworkError|ECONNRESET|terminated/i.test(raw);
      toast.error(
        broken
          ? "网络中断，没能确认 PDF 是否合成完成。再点一次导出会接着看同一份，不会重做。"
          : `PDF 导出失败：${raw.slice(0, 120)}`,
        { duration: 10_000 },
      );
    } finally {
      setKnowledgeCardPdfBusy(false);
      setKnowledgeCardPdfProgress(null);
    }
  };
  /**
   * 生成一張卡片：同步回 imageUrl 直接用；非同步回 progressJobId 則輪詢至終態取圖。
   * @param notePart 舊上/下篇兼容；新路径用 notePageIndex。
   */
  /** 1119 C4：大稿分段暂存接口（服务端按用户 + sha256 内容寻址，幂等） */
  const handbookStageApi = () => ({
    stageChunk: (input: { digest: string; index: number; count: number; totalChars: number; text: string }) => trpcUtils.client.mvAnalysis.stageKnowledgeCardManuscriptChunk.mutate(input),
    finalize: (input: { digest: string; count: number; totalChars: number }) => trpcUtils.client.mvAnalysis.finalizeKnowledgeCardManuscript.mutate(input),
  });
  const handbookQuoteInput = async (markdown: string, distillModel: string) => handbookManuscriptNeedsStaging(markdown)
    ? { manuscriptDigest: await stageHandbookManuscript(markdown, handbookStageApi()), distillModel }
    : { markdown, distillModel };

  const generateCustomNoteOne = async (
    trimmed: string,
    kind: "single_page_knowledge_card" | "storyboard_sheet_landscape",
    notePart?: "upper" | "lower",
    notePage?: { index: number; total: number },
    imageProvider?: "evolink" | "openai",
    /**
     * 确认弹窗那一刻冻住的参数（复审 P1）。传了就用它，不再读实时 state——
     * 实测：确认期间改了正文/版式，付费请求发的仍是旧闭包的稿，用户看到的和买到的对不上。
     */
    snapshot?: {
      distillModel: typeof customNoteDistillModel;
      billingModel: string;
      subjectPosition: typeof customNoteSubjectPosition;
      infographicTemplateId: string | null;
    },
    assignedImageRequest?: { requestId: string; jobId: string },
  ): Promise<string> => {
    knowledgeCardPageTasks.assertLive();
    const pageRequestId = kind === "single_page_knowledge_card"
      ? assignedImageRequest?.requestId || knowledgeCardPageTasks.begin("platform_composite_sheet_progress") : undefined;
    const sceneId = `custom-note-${notePage?.index ?? notePart ?? "single"}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const progressJobId = assignedImageRequest?.jobId || newPlatformCompositeProgressJobId();
    const title = extractInfographicSubjectFromUserCopy(trimmed);
    /**
     * 知识卡的 scriptContext 会被 `planKnowledgeCardPages` 逐页切开当**正文**渲染，
     * 所以绝不能把版式块拼进来：`composeInfographicScriptContext` 的块以
     * 「【图文可视化模板·X·仅版式】+ 版式元结构 + 内容锁定 + LAYOUT ONLY 英文 prompt」开头，
     * 排在正文之前就整页印成模板说明书（用户 2026-08-05 选「左右对半对比」后第 1 页即是）。
     * 版式意图只能走出图约束，不能当内容。
     */
    const scriptContext = trimmed;
    // 1119 C4：超过 20 万字的手册原稿只带摘要与本页正文（服务端取回全文核对）；20 万字及以下请求形状不变
    const staged = kind === "single_page_knowledge_card" && notePage && handbookManuscriptNeedsStaging(scriptContext)
      ? { manuscriptDigest: await stageHandbookManuscript(scriptContext, handbookStageApi()), pageBody: planKnowledgeCardPages(scriptContext).pages[notePage.index - 1] ?? "" }
      : null;
    const res = await generateCustomNoteMutation.mutateAsync({
      sceneId,
      pageRequestId,
      title,
      ...(staged ? staged : { scriptContext }),
      kind,
      ...(notePage
        ? { notePageIndex: notePage.index, notePageTotal: notePage.total }
        : notePart
          ? { notePart }
          : {}),
      ...(kind === "single_page_knowledge_card"
        ? {
            distillModel: snapshot?.distillModel ?? customNoteDistillModel,
            confirmedPageCredits: snapshot ? knowledgeCardCreditsForPageIndex(notePage?.index ?? 1, snapshot.billingModel) : undefined,
            subjectPosition: snapshot?.subjectPosition ?? customNoteSubjectPosition,
            ...(imageProvider ? { imageProvider } : {}),
            // 多页入口显式分配官方/EvoLink；未指定通道的旧入口仍使用服务端默认。
            // 手册配图只准授权档（1119 C1）：不读前台偏好——偏好为空/缺失时会落到 Flare；服务端另行绑定并拒绝其他档位。
            openaiImageVariant: HANDBOOK_IMAGE_VARIANT,
            // 版式走独立字段进出图指令；拼进 scriptContext 会被当正文印出来
            ...((snapshot ? snapshot.infographicTemplateId : customNoteInfographicTemplateId)
              ? { infographicTemplateId: (snapshot ? snapshot.infographicTemplateId : customNoteInfographicTemplateId)! }
              : {}),
          }
        : {}),
      imagePromptTranslator: COMPOSITE_SHEET_IMAGE_PROMPT_TRANSLATOR,
      progressJobId,
      enabledSkillIds: Array.from(enabledPlatformSkillIds),
      allowBloggerTitle,
    });
    if (res.imageUrl) {
      if (pageRequestId) knowledgeCardPageTasks.finish(pageRequestId);
      knowledgeCardPageTasks.assertLive();
      return res.imageUrl;
    }
    if ((res as { isAsync?: boolean }).isAsync && (res as { progressJobId?: string }).progressJobId) {
      const pid = (res as { progressJobId?: string }).progressJobId!;
      // 入队即落库：刷新/换页后开页可自动续轮询，不再丢单（2026-08-12 实证三连丢后加）
      writePosterResumeRecord({ jobId: pid, kind, titleHead: title, firedAt: Date.now() });
      try {
        const j = await pollJobUntilTerminal(pid, {
          intervalMs: 1500,
          // 0910：服务端整链墙钟 25min（官方→WaveSpeed→EvoLink 串行），客户端要等得更久，否则图在出、费已扣、前台却报失败
          maxWaitMs: 28 * 60_000,
          adaptiveBackoffAfterAttempts: 20,
          maxIntervalMs: 5000,
        });
        if (pageRequestId) knowledgeCardPageTasks.finish(pageRequestId);
        knowledgeCardPageTasks.assertLive();
        if (j.status === "failed") throw new Error(j.error || "生成失敗，請重試");
        const out = j.output as { compositeImageUrl?: string; imageUrl?: string } | null;
        const url = out?.compositeImageUrl || out?.imageUrl || "";
        if (!url) throw new Error("未取得圖片 URL，請重試");
        return url;
      } finally {
        // 只清自己的挂账：无条件清会把并发新任务的记录误删（审查抓的竞态）
        if (readPosterResumeRecord()?.jobId === pid) writePosterResumeRecord(null);
      }
    }
    throw new Error("生成失敗，請重試");
  };

  const mapCustomNoteError = (error: unknown): string => {
    const message = String((error as { message?: string })?.message || "");
    // EPUB 转换崩溃的文案自带办法（Calibre 转 PDF / 拆本），剥掉 runner 的「请稍后重试 [原始错误: …]」外壳，不自相矛盾
    const epubHint = /\[原始错误:\s*((?:这本 EPUB 太大|EPUB )[^\]]*)\]/.exec(message)?.[1] || (/EPUB 太大|崩溃两次/.test(message) ? message : "");
    if (epubHint) return epubHint.trim();
    if (message.includes("文档较长") || message.includes("提炼超时")) {
      return message.includes("超时") ? message : "文档较长，提炼超时，请稍后重试";
    }
    if (message.includes("算力紧张")) {
      return message;
    }
    if (/ENOSPC|no space left on device/i.test(message)) {
      return "服务器存储空间不足，尚未完成提炼，请稍后重试";
    }
    if (
      message.includes("Unexpected end of JSON input") ||
      message.includes("Unexpected token") ||
      message.includes("is not valid JSON") ||
      message.includes("An error o")
    ) {
      // 0923 用户令「如实报错」：这里收到的是网关错误页而不是接口数据（发布重启、网关超时都会这样），
      // 不是上游算力紧张——以前统一写「算力紧张」，用户排查方向全错
      return KNOWLEDGE_CARD_GATEWAY_PAGE_MESSAGE;
    }
    // 「模型返回格式异常 / 模型服务暂时异常」本身是中文业务句，落到这里原样给用户，不再改写成算力紧张
    return sanitizePlatformUserMessage(message, "生成失败，请稍后查看原任务结果");
  };

  const handleGenerateCustomNote = async (overrides?: {
    supplementOf?: KnowledgeSupplementSelection;
    text?: string;
    kind?: typeof customNoteKind;
    skipClearOptimize?: boolean;
    /** 只出卡片（1119 C3）：不建手册排版、不报顾问与排版价、不启动顾问；只逐页出图。 */
    cardsOnly?: boolean;
  }) => {
    // 同一原稿仍在读档或恢复查询时，另一生成入口也不能再建任务。
    if (customNoteBusy || customNoteUploadBusy || customNoteDistillJobId) {
      toast.info("上一个生成任务还在进行中，请稍候");
      return;
    }
    if (knowledgeCardInflight.length > 0) {
      toast.info(`还有 ${knowledgeCardInflight.length} 页在生成中，等它们结束再重新生成`);
      return;
    }
    // 审查 P1：精华版还在派生时，文本框里还是完整版——此时出图会按完整版页数计费、出的也是另一档
    if (customNoteLevelSwitching) {
      toast.info("正在准备重点配图方案，完整正文未变，请等待比较方案");
      return;
    }
    if (overrides?.text === undefined && customNoteKind === "single_page_knowledge_card" && customNoteSelectedFileCount > 0) {
      toast.info("还有新选择的文件，请先点击「开始精炼」，核对正文后再生成图片");
      return;
    }
    const kind = overrides?.kind ?? customNoteKind;
    const trimmed = (overrides?.text ?? customNoteText).trim();
    const pendingAhead = customNotePendingFilesRef.current.length;
    if (!trimmed && !(customNoteKind === "single_page_knowledge_card" && pendingAhead > 0)) {
      toast.error(pendingAhead > 0 ? "请等待文件读取完成，或重新上传" : "请先输入中文文案或上传文件");
      return;
    }
    if (kind !== "single_page_knowledge_card") {
      setCustomNoteImageUpper(null);
      setCustomNoteImageLower(null);
      setCustomNoteImages([]);
    }
    setCustomNotePageProgress(null);
    setCustomNoteError(null);
    if (!overrides?.skipClearOptimize) {
      setCustomOptimizeResult(null);
      setCustomOptimizeSummary(null);
    }
    setCustomNoteBusy(true);
    try {
      if (kind === "optimize_custom_copy") {
        const res = await optimizeCustomCopyMutation.mutateAsync({
          sourceText: trimmed,
          optimizationBrief: customOptimizeBrief.trim() || undefined,
          visionContext: pendingOptimizeVisionRef.current,
          includeLiveTrends: pendingOptimizeLiveTrendsRef.current || Boolean(pendingOptimizeVisionRef.current),
          liveTrendWindowDays: 7,
          enabledSkillIds: Array.from(enabledPlatformSkillIds),
          allowBloggerTitle,
        });
        pendingOptimizeVisionRef.current = undefined;
        pendingOptimizeLiveTrendsRef.current = false;
        setCustomOptimizeResult(res.result.optimizedMarkdown);
        setCustomOptimizeSummary(formatOptimizationAdvice(res.result));
        toast.success(`深度优化完成${res.cost > 0 ? `（已扣 ${res.cost} 积分）` : ""}`);
        return;
      }
      if (kind === "single_page_knowledge_card") {
        if (renderedDetailLevelRef.current === "concise" && renderedDraftRef.current && !renderedFullManuscriptRef.current && trimmed === renderedDraftRef.current.trim() && !overrides?.supplementOf) throw new Error("旧备份缺少完整文字稿，请先恢复完整稿；原图仍保留");
        const pendingFiles = overrides?.text === undefined ? customNotePendingFilesRef.current.slice() : [];
        let distilled = trimmed;
        let completeManuscript = knowledgeCardFullManuscript(trimmed, customNoteFullMarkdown, customNoteCompactMarkdownRef.current);
        let hasFullReceipt = Boolean(customNoteFullMarkdown?.trim() && completeManuscript === customNoteFullMarkdown.trim());
        // 上传路径已提炼进文本框时，生成只出图；仅当仍有待处理文件或无文案时再提炼
        if (pendingFiles.length > 0 || !distilled) {
          setCustomNoteDistillPhase("distilling");
          distilled = await runKnowledgeCardDistill({
            sourceText: resolveKnowledgeCardSourceText(trimmed, pendingFiles.length),
            files: pendingFiles,
            onStatus: setCustomNoteUploadStatus,
          });
          if (!distilled) throw new Error("提炼结果为空，请调整文案后重试");
          completeManuscript = distilled;
          hasFullReceipt = true;
          try {
            distilled = await adoptDistilledFullMarkdown(distilled);
            completeManuscript=customNoteFullMarkdownRef.current||completeManuscript;
          } catch (adoptErr) {
            if (isKnowledgeCardDeriveStale(adoptErr)) return;
            throw adoptErr;
          }
          setCustomNoteText(distilled);
          customNotePendingFilesRef.current = [];
          setCustomNotePendingMeta([]);
          setCustomNoteUploadStatus(null);
          setCustomNoteDistillPhase("ready");
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
        } else if (!overrides?.supplementOf && !hasFullReceipt && customNoteDistillPhase !== "ready" && distilled.length > KNOWLEDGE_CARD_SKIP_DISTILL_MAX_CHARS) {
          /**
           * 纯文本长文（本轮尚未提炼过；上传路径已提炼的稿子直接进出图确认，不二次提炼、不二次收费、不丢〔参考原页〕标记）：
           * 先把「提炼 vs 直接出图」的账摆给用户看。
           * 一万字直接出图要 9 页 264 积分；花提炼费换成 4 页 120 积分。默认劝提炼，但省不回本时不打扰。
           */
          const tradeoff = estimateKnowledgeCardDistillTradeoff(
            distilled,
            customNoteDistillModel,
            (chars) => suggestKnowledgeCardMinSections(chars, customNoteDetailLevel),
            0,
          );
          if (tradeoff.saved > 0) {
            setCustomNoteBusy(false);
            const wantDistill = window.confirm(
              [
                `这段文字约 ${distilled.length.toLocaleString()} 字。`,
                "",
                `直接出图：约 ${tradeoff.full.pages} 页 · ${tradeoff.full.credits} 积分 · 4K`,
                `先做提炼：约 ${tradeoff.distilled.pages} 页 · ${tradeoff.distilled.credits} 积分 · 4K（整理不另收费）`,
                "",
                `提炼可省约 ${tradeoff.saved} 积分。`,
                "",
                "点「确定」先提炼（推荐），点「取消」按原文全量出图。",
              ].join("\n"),
            );
            setCustomNoteBusy(true);
            if (wantDistill) {
              setCustomNoteDistillPhase("distilling");
              const refined = await runKnowledgeCardDistill({
                sourceText: distilled,
                onStatus: setCustomNoteUploadStatus,
                chargeDistillFee: true,
              });
              if (!refined) throw new Error("提炼结果为空，请调整文案后重试");
              completeManuscript = refined;
              hasFullReceipt = true;
              try {
                distilled = await adoptDistilledFullMarkdown(refined);
                completeManuscript=customNoteFullMarkdownRef.current||completeManuscript;
              } catch (adoptErr) {
                if (isKnowledgeCardDeriveStale(adoptErr)) return;
                throw adoptErr;
              }
              setCustomNoteText(distilled);
              setCustomNoteUploadStatus(null);
              setCustomNoteDistillPhase("ready");
              await new Promise<void>((r) => requestAnimationFrame(() => r()));
            }
          }
        }
        // 两档共享完整原稿；精华只选择配图章节，未选知识保留为文字。
        if (!overrides?.supplementOf) {
          if (hasFullReceipt) {
            const compact=await deriveCompactFromFull(completeManuscript);
            completeManuscript=customNoteFullMarkdownRef.current||completeManuscript;
            distilled=customNoteDetailLevel==='full'?completeManuscript:compact;
          }
          if(customNoteDetailLevel==='concise')assertKnowledgeCardIllustrationSelection(distilled, customNoteDistillModel);
        }
        const plan = planKnowledgeCardPages(distilled, customNoteDistillModel);
        const pages = plan.pages.length ? plan.pages : [distilled];
        const total = pages.length;
        if(overrides?.supplementOf&&total>8)throw new Error("补充图卡实际分页超过8页，未提交生成");
        const qLabel = "4K";
        const priceQuote = await trpcUtils.client.mvAnalysis.quoteKnowledgeCardForGeneration.mutate(await handbookQuoteInput(distilled, customNoteDistillModel));
        if (priceQuote.pageCount !== total) throw new Error("报价页数与当前稿件不一致，请重新确认");
        const credits = priceQuote.credits;
        /**
         * 复审 P1：等确认期间**不解锁** busy。以前这里 setCustomNoteBusy(false) 之后才 await，
         * 正文、成稿档、版式、模板、生成按钮全是活的，改完再点确认，
         * 付费请求发的还是旧闭包里的稿——用户看到的和买到的对不上。
         */
        const confirmRevision = customNoteRevisionRef.current;
        const pendingSnapshot = {
          distilled,
          revision: confirmRevision,
          distillModel: customNoteDistillModel,
          billingModel: priceQuote.billingModel,
          detailLevel: overrides?.supplementOf ? "full" : customNoteDetailLevel,
          subjectPosition: customNoteSubjectPosition,
          infographicTemplateId: customNoteInfographicTemplateId,
          pageCount: total,
          qualityZh: qLabel,
          credits,
        } as const;
        if (!workbenchUserKey) throw new Error("请先登录再生成手册");
        const studio = layoutStudioRef.current;
        if (!studio) throw new Error("请等待云端稿件就绪");
        const sourceId = `knowledge-card:${crypto.randomUUID()}`;
        const fullMarkdown = pendingSnapshot.detailLevel === "full" ? distilled : completeManuscript || "";
        if (!fullMarkdown.trim()) throw new Error("缺少完整版文字底稿，请先恢复完整稿；尚未开始出图或整理");
        const inputFingerprint = await knowledgeCardInputFingerprint(knowledgeCardInputKey({ owner: workbenchUserKey, text: distilled, full: fullMarkdown, level: pendingSnapshot.detailLevel, template: pendingSnapshot.infographicTemplateId, model: pendingSnapshot.distillModel }));
        const cardsOnly = (overrides?.cardsOnly ?? customNoteCardsOnly) === true && !overrides?.supplementOf;
        const { pageRequestIds, imageJobIds, illustrationRun, publicationQuote, textPageCount } = await (async () => {
          const pageRequestIds: string[] = [];
          try {
            for (let i = 0; i < pages.length; i++) pageRequestIds.push(knowledgeCardPageTasks.begin("platform_composite_sheet_progress"));
            const imageJobIds = await Promise.all(pageRequestIds.map(id => knowledgeIllustrationJobId(workbenchUserKey, id)));
            const illustrationRun = knowledgeIllustrationRun(imageJobIds);
            const synchronizedSource = synchronizedKnowledgeCardSource({
              owner: workbenchUserKey, sourceId, inputFingerprint, fullMarkdown, illustrationMarkdown: distilled,
              detailLevel: pendingSnapshot.detailLevel, distillModel: pendingSnapshot.distillModel,
              infographicTemplateId: pendingSnapshot.infographicTemplateId, imageJobIds,
            });
            const verified=knowledgeVerifiedEditionRef.current;
            if(!overrides?.supplementOf&&verified&&fullMarkdown===verified.full&&[verified.full,verified.concise].includes(distilled))synchronizedSource.verificationJobId=verified.jobId;
            const readingController = readingControllerRef.current;
            const readingPreparation = readingFullMarkdownRef.current === fullMarkdown.trim() ? readingController?.link() : undefined;
            if(readingPreparation && !overrides?.supplementOf) synchronizedSource.readingPreparation = readingPreparation;
            const textPageCount = knowledgeCardPlannedTextPages(distilled, synchronizedSource, cardsOnly);
            const publicationQuote = await studio.prepare(synchronizedSource, illustrationRun.wait,overrides?.supplementOf,{waitForReading:readingPreparation?()=>readingController!.wait():undefined,preparePresentation:false,...(cardsOnly?{cardsOnly:true}:{})});
            return { pageRequestIds, imageJobIds, illustrationRun, publicationQuote, textPageCount };
          } catch (error) {
            pageRequestIds.forEach(id => knowledgeCardPageTasks.finish(id));
            throw error;
          }
        })();
        const continueGen = await askKnowledgeCardPreflight({
          levelZh: KNOWLEDGE_CARD_DETAIL_LEVEL_LABEL_ZH[pendingSnapshot.detailLevel],
          layoutZh: KNOWLEDGE_CARD_SUBJECT_POSITION_LABEL_ZH[pendingSnapshot.subjectPosition],
          templateZh: customNoteInfographicLabelZh || "未选（按正文自动）",
          distillModelZh:
            knowledgeCardRecordedModelLabel(pendingSnapshot.billingModel),
          pageCount: pendingSnapshot.pageCount,
          textPageCount,
          cardsOnly,
          imageTierZh: HANDBOOK_IMAGE_TIER_LABEL_ZH,
          imageModelDebug: HANDBOOK_IMAGE_MODEL,
          pageContents: pages,
          qualityZh: pendingSnapshot.qualityZh,
          credits: pendingSnapshot.credits,
          advisorCredits: publicationQuote.maxCredits,
        }, confirmRevision);
        if (!continueGen) {
          pageRequestIds.forEach(id => knowledgeCardPageTasks.finish(id));
          toast.success(`已保留提炼稿（约 ${total} 页），未出图`);
          setCustomNoteDistillPhase("idle");
          setCustomNoteProgress({ status: "idle", percent: 0 });
          return;
        }
        // 确认期间稿件版本变了（换了稿/切了档）：这次确认作废，不拿旧快照去付费出图
        if (customNoteRevisionRef.current !== confirmRevision) {
          pageRequestIds.forEach(id => knowledgeCardPageTasks.finish(id));
          toast.message("稿件已变化，这次确认作废；请重新点生成");
          setCustomNoteDistillPhase("idle");
          setCustomNoteProgress({ status: "idle", percent: 0 });
          return;
        }
        // 只出卡片不调用 start：prepare 已写入 synchronizedStarted，不启动顾问/排版。
        if (!cardsOnly) {
          try { await studio.start(publicationQuote.documentId, publicationQuote.maxCredits); }
          catch (error) { pageRequestIds.forEach(id => knowledgeCardPageTasks.finish(id)); throw error; }
        }
        setCustomNoteImages([]);
        setCustomNoteImageUpper(null);
        setCustomNoteImageLower(null);
        setKnowledgeCardPdfUrl(null);
        const renderSnapshot = {
          distillModel: pendingSnapshot.distillModel,
          billingModel: pendingSnapshot.billingModel,
          subjectPosition: pendingSnapshot.subjectPosition,
          infographicTemplateId: pendingSnapshot.infographicTemplateId,
        };
        toast.success(`开始出图 · ${total} 页 · ${qLabel} · ${KNOWLEDGE_CARD_SUBJECT_POSITION_LABEL_ZH[customNoteSubjectPosition]}`);
        /**
         * 官方与 EvoLink 同时首发，各两个 worker，共四路；空闲 worker 领取下一页。
         * 每页只发一次，明确失败由服务端同型号回落，结果未知保留原任务；按原页序回填。
         */
        const urls: (string | null)[] = Array.from({ length: total }, () => null);
        let done = 0;
        // 新批次：旧批次在途页返回后不得覆盖；补出单页用这份稿的快照
        const runId = ++renderRunIdRef.current;
        renderedSettingsRef.current = renderSnapshot;
        renderedImageJobsRef.current = imageJobIds;
        renderedSubmittedImageJobsRef.current = new Set();
        renderedDraftRef.current = distilled;
        renderedFullManuscriptRef.current = fullMarkdown;
        renderedDetailLevelRef.current = pendingSnapshot.detailLevel;
        knowledgeCardLayoutSourceIdRef.current = sourceId;
        customNoteImagesRef.current = Array.from({ length: total }, () => "");
        setKnowledgeCardInflight([]);
        const publish = () => {
          if (runId !== renderRunIdRef.current) return;
          const ready = urls.filter((u): u is string => Boolean(u));
          // 保留页序空洞（缺页显示占位），页码/下载名/PDF 页数都按真实页序，不前移
          const snapshot = urls.map((u) => u || "");
          customNoteImagesRef.current = snapshot;
          setCustomNoteImages(snapshot);
          setCustomNoteImageUpper(urls[0] ?? null);
          setCustomNoteImageLower(urls[1] ?? null);
          // 已判失败的终态不被在途页的回填覆盖回「运行中」
          setCustomNoteProgress((prev) => prev.status === "failed" ? prev : { status: "running", percent: knowledgeCardProgressFromRender(ready.length, total), stageDone: ready.length, stageTotal: total, label: `出图 ${ready.length}/${total} 页（并发 ${knowledgeCardRenderConcurrency(total)}）` });
        };
        setCustomNoteProgress({ status: "running", percent: knowledgeCardProgressFromRender(0, total), stageDone: 0, stageTotal: total, label: `出图 0/${total} 页（并发 ${knowledgeCardRenderConcurrency(total)}）` });
        customNoteStopRenderRef.current = false;
        setCustomNoteRendering(true);
        try {
          await runKnowledgeIllustrationBatch({
            count: total,
            concurrency: knowledgeCardRenderConcurrency(total),
            active: () => !customNoteStopRenderRef.current,
            execute: async (i, lane) => {
              const provider = lane % 2 === 0 ? "openai" : "evolink";
              setCustomNotePageProgress({ i: Math.min(total, done + 1), n: total });
              markInflight(runId, i, true);
              try {
                renderedSubmittedImageJobsRef.current?.add(imageJobIds[i]);
                const url = await generateCustomNoteOne(
                  pendingSnapshot.distilled,
                  "single_page_knowledge_card",
                  undefined,
                  { index: i + 1, total },
                  provider,
                  renderSnapshot,
                  { jobId: imageJobIds[i], requestId: pageRequestIds[i] },
                );
                urls[i] = url;
                illustrationRun.done(imageJobIds[i]);
              } finally {
                markInflight(runId, i, false);
              }
              done += 1;
              publish();
            },
          });
        } finally {
          if (urls.some(url => !url)) illustrationRun.stop();
        }
        setCustomNoteRendering(false);
        const stoppedByUser = customNoteStopRenderRef.current;
        customNoteStopRenderRef.current = false;
        const madePages = urls.filter(Boolean).length;
        if (stoppedByUser && madePages < total) {
          // 复审 P2：这里以前写 succeeded，子组件就把进度强拉 100%、还藏掉停止说明。
          // 停止是独立终态：已出的页保留（已计费），进度条如实停在完成度，缺页的补出入口照常开着。
          setCustomNoteProgress({
            status: "stopped",
            percent: knowledgeCardProgressFromRender(madePages, total),
            label: `已停止 · 出图 ${madePages}/${total} 页`,
            stageDone: madePages, stageTotal: total,
            error: `未出的 ${total - madePages} 页不扣费；需要的话可以逐页补出`,
          });
          toast.message(`已停止出图：完成 ${madePages}/${total} 页，按已出页计费（未出的页不扣）`);
        } else {
          setCustomNoteProgress({ status: "succeeded", percent: 100, successLabel: "配图完成", label: cardsOnly ? "卡片已全部生成，可导出纯图 PDF" : "正在自动整理正文与版面" });
          toast.success(`已生成 ${total} 页手册配图（${qLabel} · 约 ${credits} 积分）`);
        }
        setCustomNoteDistillPhase("idle");
      } else {
        setCustomNotePartInFlight(null);
        setCustomNotePageProgress(null);
        const img = await generateCustomNoteOne(trimmed, "storyboard_sheet_landscape", undefined);
        setCustomNoteImageUpper(img);
        setCustomNoteImages([img]);
        toast.success("分鏡圖已生成");
      }
    } catch (e) {
      const msg = mapCustomNoteError(e);
      setCustomNoteError(msg);
      if (kind === "single_page_knowledge_card") {
        setCustomNoteProgress((prev) => ({ ...prev, status: "failed", percent: prev.status === "running" ? prev.percent : 0, error: msg }));
        // 在途页会继续出图并回填，这里如实告知已完成页数与对应页费（读同步镜像，不在 updater 里做副作用）
        const doneCount = customNoteImagesRef.current.filter(Boolean).length;
        // 新批次函数（线 D）抛错时带分项计数：已出页不能被说成「什么都没生成」。旧版普通错误仍按已回填页数计。
        const batchCounts = knowledgeIllustrationBatchCounts(e);
        toast.error(batchCounts
          ? `生成未全部完成：${msg.slice(0, 80)}（${knowledgeIllustrationBatchSummaryZh(batchCounts)}）`
          : doneCount > 0
          ? `生成失败：${msg.slice(0, 100)}（已完成 ${doneCount} 页，按已成功页计费，失败页不扣费）`
          : `生成失败：${msg.slice(0, 120)}`);
      } else {
        toast.error(`生成失敗：${msg.slice(0, 120)}`);
      }
    } finally {
      setCustomNoteBusy(false);
      setCustomNotePartInFlight(null);
      setCustomNotePageProgress(null);
      setCustomNoteDistillPhase("idle");
      setCustomNoteRendering(false);
      customNoteStopRenderRef.current = false;
    }
  };

  return { retryKnowledgeCardPage, downloadKnowledgeCardEpubPdf, downloadKnowledgeCardPdf, generateCustomNoteOne, mapCustomNoteError, handleGenerateCustomNote };
}
