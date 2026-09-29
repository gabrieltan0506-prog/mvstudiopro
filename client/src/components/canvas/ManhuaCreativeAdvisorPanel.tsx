import { advisorPrevisTrialSchema } from "@shared/manhuaAdvisorPrevisEdit";
import { manhuaPrevisSpecSchema } from "@shared/manhuaPrevis";
import { advisorPrevisCandidateSchema, parseAdvisorPrevisPatch, type AdvisorPrevisCandidate, type AdvisorPrevisTarget, type AdvisorPrevisTrial, type AdvisorPrevisReceipt, applyAdvisorPrevisPatch, advisorPrevisSpecJson } from "@shared/manhuaAdvisorPrevisEdit";
import { ManhuaAdvisorPrevisComparison } from "./ManhuaAdvisorPrevisComparison";
import { ManhuaRewriteComparison } from "./ManhuaRewriteComparison";
/** 项目顾问：读取证据、提出模板改写建议；正式稿仅经显式对比采用。 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { copyTextWithToast } from "@/lib/copyText";
import { buildAdvisorQuestion, findMentionedTemplates } from "@/lib/manhuaCreativeAdvisorContext";
import { manhuaCreativeAdvisorContextSchema } from "@shared/manhuaCreativeAdvisor";
import type { PublicManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";
import type { buildManhuaAdvisorProject, AdvisorIssue } from "@/lib/manhuaAdvisorProject";
import { advisorRecentHistory, loadAdvisorMessages, loadAdvisorPendingRecovery, makeAdvisorPendingRecovery, manhuaAdvisorSessionKey, mergeAdvisorCompletedExchange, persistAdvisorCompletedExchange, type AdvisorMessage, type AdvisorMessagesLoadResult, type AdvisorPendingRequest, type AdvisorRecoveryLoadResult } from "@/lib/manhuaAdvisorSession";
import { advisorRewriteCandidateSchema, buildTemplatePlanQuestion, buildTemplateRewriteQuestion, parseAdvisorRewrite, parseAdvisorTemplatePlans, formatAdvisorRewriteAnswer, TEMPLATE_PLAN_QUESTION, TEMPLATE_REWRITE_QUESTION, type AdvisorRewriteCandidate, type AdvisorTemplatePlan } from "@/lib/manhuaAdvisorTemplates";
import { downloadAdvisorBackup, listAdvisorBackups, type AdvisorBackupEntry } from "@/lib/manhuaAdvisorBackups";
import { MANHUA_ADVISOR_STAGE_LABELS } from "@/lib/manhuaAdvisorEntry";
import { formatManhuaAdvisorContextIssue, formatManhuaAdvisorError } from "@/lib/manhuaAdvisorFeedback";

type PendingQuestion = AdvisorPendingRequest;
function readableAdvice(text: string) {
  try { return parseAdvisorPrevisPatch(text).summaryZh; } catch { return formatAdvisorRewriteAnswer(text); }
}

export default function ManhuaCreativeAdvisorPanel(props: {
  previsTarget?: AdvisorPrevisTarget;
  previsIssue?: string;
  onLeavePrevis?: () => void;
  onPreparePrevis?: (candidate: AdvisorPrevisCandidate) => AdvisorPrevisTrial;
  onApplyPrevis?: (trial: AdvisorPrevisTrial, receipt: AdvisorPrevisReceipt) => boolean;
  open: boolean;
  onClose: () => void;
  stageZh?: string;
  userId?: string;
  confirmedProjectVersion?: string;
  project?: ReturnType<typeof buildManhuaAdvisorProject>;
  onLocate?: (issue: AdvisorIssue) => void;
  selectedTemplate?: PublicManhuaViralTemplateCard | null;
  templates: PublicManhuaViralTemplateCard[];
  onApplyRewrite?: (candidate: AdvisorRewriteCandidate) => boolean;
  onRequestTrial: (template: PublicManhuaViralTemplateCard) => void;
  focusSection?: "templates" | null;
}) {
  const { open, onClose, userId, confirmedProjectVersion, project, onLocate, stageZh, selectedTemplate, templates, onRequestTrial } = props;
  const sessionKey = userId && confirmedProjectVersion ? manhuaAdvisorSessionKey(userId, confirmedProjectVersion) : null;
  const previsKey = sessionKey ? `${sessionKey}:previs-edit` : null;
  const [previsCandidate, setPrevisCandidate] = useState<AdvisorPrevisCandidate | null>(() => {
    try { const raw = previsKey && localStorage.getItem(previsKey); return raw ? advisorPrevisCandidateSchema.parse(JSON.parse(raw)) : null; }
    catch { return null; }
  });
  const [autoPrevisStart, setAutoPrevisStart] = useState(false);
  const [savedPreviews, setSavedPreviews] = useState<Array<{ key: string; trial: AdvisorPrevisTrial }>>([]);
  const rewriteKey = sessionKey ? `${sessionKey}:rewrite` : null;
  const [initialRewrite] = useState(() => {
    try { const raw = rewriteKey && localStorage.getItem(rewriteKey); return { candidate: raw ? advisorRewriteCandidateSchema.parse(JSON.parse(raw)) : null, error: "" }; }
    catch { return { candidate: null, error: "原稿对比记录无法读取。为保护旧稿，已停止新的咨询与改写；请恢复浏览器存储后刷新。" }; }
  });
  const [rewrite, setRewrite] = useState<AdvisorRewriteCandidate | null>(initialRewrite.candidate);
  const [backups, setBackups] = useState<AdvisorBackupEntry[]>([]);
  const [backupError, setBackupError] = useState("");
  const recoveryKey = sessionKey ? `${sessionKey}:pending` : null;
  // 宿主用用户/已确认项目版本 key 重建面板，旧项目的在途答复不得写入新项目。
  const [initial] = useState<AdvisorMessagesLoadResult>(() => {
    try { return sessionKey ? loadAdvisorMessages(localStorage, sessionKey) : { turns: [], error: "", writable: true }; }
    catch { return { turns: [], error: "本机历史无法读取。为保护原记录，已停止新的问答与扣点；请检查浏览器存储后刷新。", writable: false }; }
  });
  const [turns, setTurns] = useState<AdvisorMessage[]>(initial.turns);
  const [initialRecovery] = useState<AdvisorRecoveryLoadResult>(() => {
    try { return recoveryKey ? loadAdvisorPendingRecovery(localStorage, recoveryKey) : { value: null, error: "" }; }
    catch { return { value: null, error: "上次问答的恢复记录无法读取，原记录未覆盖。" }; }
  });
  const [storageError, setStorageError] = useState(initial.error);
  const [draft, setDraft] = useState("");
  const [pendingPaid, setPendingPaid] = useState<{ request: PendingQuestion; hint: string; credits?: number } | null>(null);
  const [failed, setFailed] = useState<{ request: PendingQuestion; message: string; confirmPaid: boolean; confirmedCredits?: number; newAttempt?: boolean } | null>(() => initialRecovery.value ? {
    request: initialRecovery.value.request,
    confirmPaid: initialRecovery.value.confirmPaid,
    confirmedCredits: initialRecovery.value.confirmedCredits,
    message: "上次问答尚未收到回执。恢复会沿用原请求编号，不自动发起新的问答。",
  } : null);
  const [quota, setQuota] = useState<{ remaining: number; price: number } | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const questionRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const templateSectionRef = useRef<HTMLElement | null>(null);
  const askMutation = trpc.mvAnalysis.askPlatformSkillQa.useMutation({ retry: false });
  const quotaQuery = trpc.mvAnalysis.getManhuaAdvisorQuota.useQuery(undefined, { enabled: open && Boolean(userId), staleTime: 0, retry: false, refetchOnWindowFocus: true });
  useEffect(() => { if (quotaQuery.data) setQuota({ remaining: quotaQuery.data.remaining, price: quotaQuery.data.price }); }, [quotaQuery.data?.remaining, quotaQuery.data?.price]);
  const sessionStorageBlocked = Boolean((sessionKey && !initial.writable) || initialRewrite.error);
  // 唯一 pending 槽仍属于这个非终态请求；先恢复，不能被新问题覆盖。
  const unresolvedFailed = Boolean(failed && !failed.newAttempt);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!sessionKey || sessionStorageBlocked) return;
    try { localStorage.setItem(sessionKey, JSON.stringify(turns)); setStorageError(""); }
    catch { setStorageError("本机空间不足，本次对话未保存；关闭页面前请复制需要的内容。"); }
  }, [turns, sessionKey, sessionStorageBlocked]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [turns, open, pendingPaid, failed]);
  useEffect(() => {
    if (!open || props.focusSection !== "templates") return;
    requestAnimationFrame(() => templateSectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }, [open, props.focusSection]);

  async function submit(request: PendingQuestion, confirmPaid: boolean, confirmedCredits?: number) {
    if (inFlight.current || !userId || sessionStorageBlocked) return;
    if (!quotaQuery.data || quotaQuery.isError) { toast.error("暂时无法核对今日额度，本次未提交、未扣费。请刷新额度后重试。"); return; }
    const capturedSessionKey = sessionKey;
    const capturedRecoveryKey = recoveryKey;
    const capturedPrevisKey = previsKey;
    if (confirmPaid && !capturedSessionKey) {
      setPendingPaid(null);
      setFailed({
        request,
        confirmPaid: true,
        message: "先确认项目后再付费咨询，避免改稿或切页时丢失扣点回执。本次未发起扣点请求。",
      });
      return;
    }
    inFlight.current = true;
    if (mounted.current) {
      setPendingPaid(null);
      setFailed(null);
      setTurns((prev) => mergeAdvisorCompletedExchange(prev, request));
    }
    // 捕获发起时的键；即使切集导致旧面板卸载，回包仍只写回旧项目会话。
    let recoveryWritten = false;
    try {
      const recoveryStorageBlocked = Boolean(initialRecovery.error && !initialRecovery.quarantineKey);
      if (capturedRecoveryKey && !recoveryStorageBlocked) {
        try {
          localStorage.setItem(capturedRecoveryKey, JSON.stringify(makeAdvisorPendingRecovery(request, confirmPaid, confirmedCredits)));
          recoveryWritten = true;
        }
        catch { if (mounted.current) setStorageError("本次恢复编号未能保存；请保持页面开启，连接中断时使用原问题重试按钮。"); }
      }
      if (confirmPaid && !recoveryWritten) {
        if (mounted.current) {
          setFailed({
            request,
            confirmPaid: true,
            message: "本机无法保存问答恢复编号，本次未发起扣点请求。请清理浏览器存储后重试；再次点击会先重新检查保存。",
          });
        }
        return;
      }
      const res = await askMutation.mutateAsync({ requestId: request.requestId, question: request.question, rawQuestion: request.rawQuestion, manhuaContext: request.manhuaContext, confirmPaid: confirmPaid || undefined, confirmedCredits: confirmPaid ? confirmedCredits : undefined });
      const answer = String(res.answer || "").trim();
      if (!answer) throw new Error("本次没有收到有效回答，请重试原问题。");
      if (request.manhuaContext?.previsEdit) {
        const candidate = advisorPrevisCandidateSchema.parse({ target: request.manhuaContext.previsEdit, patch: parseAdvisorPrevisPatch(answer) });
        if (capturedPrevisKey) {
          try { localStorage.setItem(capturedPrevisKey, JSON.stringify(candidate)); }
          catch { if (mounted.current) setStorageError("调度建议未能保存，关闭页面前请保留当前对话。"); }
        }
        if (mounted.current) { setPrevisCandidate(candidate); setAutoPrevisStart(false); }
      }
      if (request.rawQuestion === TEMPLATE_PLAN_QUESTION && !parseAdvisorTemplatePlans(answer, templates).length && mounted.current) {
        toast.error("本次回答未提供3—4个合法模板方案，不能自动选择；原回答已保留供查看。");
      }
      if (request.rawQuestion.startsWith("【模板改写建议】")) {
        try {
          const candidate = parseAdvisorRewrite(answer, request.manhuaContext!.episodeIndex, request.manhuaContext!.episodeBody);
          if (capturedSessionKey) localStorage.setItem(`${capturedSessionKey}:rewrite`, JSON.stringify(candidate));
          if (mounted.current) setRewrite(candidate);
        } catch {
          if (mounted.current) toast.error("改写未通过完整格式或保存检查，保留原稿；请查看回答后重新咨询。");
        }
      }
      let persisted = !capturedSessionKey;
      if (capturedSessionKey) {
        try {
          persistAdvisorCompletedExchange(localStorage, capturedSessionKey, request, answer);
          persisted = true;
        } catch {
          if (mounted.current) setStorageError("顾问已回包，但本机历史未能安全写入；恢复编号已保留，请用原问题恢复。原历史未覆盖。");
        }
      }
      if (mounted.current) {
        setTurns((prev) => mergeAdvisorCompletedExchange(prev, request, answer));
        setQuota({ remaining: res.remainingFreeToday, price: res.paidUnitCredits });
        if (res.paidThisTurn && res.creditsCharged > 0) toast.message(`问答扣点回执：${res.creditsCharged} 积分；恢复回执不代表再次扣点`);
      }
      if (capturedRecoveryKey && recoveryWritten && persisted) {
        try { localStorage.removeItem(capturedRecoveryKey); } catch { /* 下次仍可用同一编号取回结果。 */ }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "顾问暂时无法回答，请稍后重试。";
      if (!mounted.current) return;
      if (/已用完|PAYMENT_REQUIRED|扣除.*积分/.test(message) && !/不足/.test(message)) {
        setPendingPaid({ request, credits: Number(message.match(/扣除\s*(\d+)\s*积分/)?.[1]) || undefined, hint: message.replace(/\b(?:Sol|Terra)\b/g, "").replace(/（成本\+60%）/g, "") });
      } else setFailed({ request, confirmPaid, confirmedCredits, message: formatManhuaAdvisorError(message), newAttempt: /ADVISOR_OPERATION_(?:FAILED|MISMATCH)/.test(message) });
    } finally { inFlight.current = false; }
  }

  function send(rawQuestion: string, wrappedQuestion?: string) {
    if (inFlight.current || pendingPaid || unresolvedFailed || !userId || sessionStorageBlocked) return;
    const question = rawQuestion.trim();
    if (question.length < 2 || question.length > 1200) { toast.error("请输入 2—1200 字的问题，内容不会被自动截断。"); return; }
    if (props.previsIssue) { toast.error(props.previsIssue); return; }
    let previsEdit = props.previsTarget;
    if (previsEdit && previsCandidate?.target.clipId === previsEdit.clipId && previsCandidate.target.specJson === previsEdit.specJson) {
      try { previsEdit = { ...previsEdit, previousPreviewSpecJson: advisorPrevisSpecJson(applyAdvisorPrevisPatch(manhuaPrevisSpecSchema.parse(JSON.parse(previsEdit.specJson)), previsCandidate.patch)) }; } catch { /* 未支持要求不继承为已执行配置。 */ }
    }
    const result = project ? manhuaCreativeAdvisorContextSchema.safeParse({ ...project.context, history: advisorRecentHistory(turns), ...(previsEdit ? { previsEdit } : {}) }) : null;
    if (result && !result.success) {
      toast.error("当前上下文超出读取范围或包含不适合发送的内容", {
        description: result.error.issues.map(formatManhuaAdvisorContextIssue).join("；"),
      });
      return;
    }
    const label = project ? `第 ${project.context.episodeIndex} 集 · ${MANHUA_ADVISOR_STAGE_LABELS[project.context.stage]} · ${project.selectionLabel}` : stageZh || "创作咨询";
    const request: PendingQuestion = {
      requestId: crypto.randomUUID(),
      rawQuestion: question,
      question: wrappedQuestion || buildAdvisorQuestion({
        question, stageZh, selectedTemplate, templates, hasProjectEvidence: Boolean(project),
        projectSignals: project ? {
          gateZh: project.context.gateZh, assetGapZh: project.context.assetGapZh, keyframeBlockZh: project.context.keyframeBlockZh,
          pipeline3dZh: project.context.pipeline3dZh, queueZh: project.context.queueZh, creditsZh: project.context.creditsZh,
          rule3dZh: project.recommend3d?.reasonZh,
        } : undefined,
      }),
      manhuaContext: result?.success ? result.data : undefined, label,
    };
    setDraft("");
    void submit(request, false);
  }

  function recommendTemplates() {
    if (!project?.context.episodeBody.trim()) { toast.error("请先填写当前集故事正文。"); return; }
    try { send(TEMPLATE_PLAN_QUESTION, buildTemplatePlanQuestion(templates)); }
    catch (error) { toast.error(error instanceof Error ? error.message : "模板暂不可用"); }
  }

  function requestRewrite(plan: AdvisorTemplatePlan) {
    const body = project?.context.episodeBody || "";
    if (!body.trim() || body.length > 8000 || project?.contextNotes.some(note => note.includes("本集正文"))) {
      toast.error("当前集正文为空、已节选或超过8000字，不能安全改写完整正文。请先拆分当前集。"); return;
    }
    const question = buildTemplateRewriteQuestion(plan);
    if (question.length > 3900) { toast.error("方案过长，请先精简方案后再改写。"); return; }
    send(TEMPLATE_REWRITE_QUESTION, question);
  }

  function refreshBackups() {
    if (!userId || !project) return;
    try {
      const result = listAdvisorBackups(localStorage, { userId, confirmedProjectVersion,
        seriesTitle: project.context.seriesTitle, episodeIndex: project.context.episodeIndex,
        body: project.context.episodeBody, originalBody: rewrite?.episodeIndex === project.context.episodeIndex ? rewrite.originalBody : undefined });
      setBackups(result.entries);
      setBackupError(result.errors ? `${result.errors}条本账户备份无法解析，原记录未改动。` : result.entries.length ? "" : "没有找到与当前项目版本或原稿匹配的备份。");
    } catch { setBackupError("本机备份暂无法读取，原记录未改动。"); }
  }

  async function copyAdvice(text: string) {
    await copyTextWithToast(text, {
      successZh: "建议已复制，可粘贴后修改。",
      errorZh: "复制失败，请选中文字手动复制。",
    });
  }

  if (!open) return null;
  const currentStage = project ? MANHUA_ADVISOR_STAGE_LABELS[project.context.stage] : stageZh || "创作咨询";
  function recoverPreviews() {
    if (!previsKey) return;
    try {
      const found: Array<{ key: string; trial: AdvisorPrevisTrial }> = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        if (!key.startsWith(`${previsKey}:trial:`)) continue;
        const trial = advisorPrevisTrialSchema.parse(JSON.parse(localStorage.getItem(key)!));
        if (props.previsTarget && trial.candidate.target.clipId !== props.previsTarget.clipId) continue;
        found.push({ key, trial });
      }
      setSavedPreviews(found.reverse());
      if (!found.length) toast.message("当前项目暂无已保存的顾问试看。");
    } catch { toast.error("部分试看记录无法读取，原记录保留，未新建任务。"); }
  }
  const quick = [
    ["检查当前内容", "检查当前内容，指出有证据的问题。"],
    ["给我修改方案", "针对当前内容给修改方案，先列依据与差异，不改正式稿。"],
    ["检查白模规格", "检查当前白模规格的角色与站位、持物及接触对象、机位变化、动作时段和节奏说明，结合正文指出遗漏。只检查已提供的规格；明确哪些问题必须逐帧与常速观看实际媒体，不宣称已审片。"],
    ["下一步怎么做", "根据当前状态，下一步应该做什么？"],
  ];
  return (
    <aside data-manhua-creative-advisor aria-label="创作顾问"
      onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
      className={`fixed bottom-0 right-0 top-[4.5rem] z-[60] flex w-full ${props.previsTarget || previsCandidate ? "max-w-[920px]" : "max-w-[420px]"} flex-col border-l border-cyan-200/15 bg-[#10171f] text-white shadow-2xl`}>
      <header className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-cyan-100">创作顾问</h2>
          <p className="mt-1 truncate text-xs text-white/65">{project?.context.seriesTitle || "未命名项目"} · {currentStage}</p>
          <p className="mt-1 text-[11px] text-white/45">{project ? `第 ${project.context.episodeIndex} 集 · ${project.selectionLabel}` : "当前没有项目上下文"}</p>
        </div>
        <button type="button" onClick={onClose} className="min-h-10 rounded-md px-3 text-xs text-white/70 hover:bg-white/10 focus-visible:outline-cyan-300">收起</button>
      </header>
      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {!userId && <p className="text-sm text-amber-100">登录后可以咨询当前项目。<a href="/login" className="ml-2 underline">去登录</a></p>}
        {project && <section aria-label="当前项目检查" className="border-l-2 border-cyan-400/65 pl-3">
          <h3 className="text-xs font-semibold text-white/85">当前项目检查 · 不消耗问答次数</h3>
          {project.issues.length ? project.issues.map((issue) => <div key={issue.id} className="mt-2 flex items-start gap-2 text-xs leading-5">
            <span className="flex-1 text-amber-100/85">{issue.text}</span>
            {onLocate && <button type="button" onClick={() => onLocate(issue)} className="shrink-0 rounded border border-white/15 px-2 text-cyan-100 hover:bg-cyan-500/15">去处理</button>}
          </div>) : <p className="mt-2 text-xs text-white/55">未发现上述结构缺项；尚未验证画面、声音或成片质量。</p>}
        </section>}
        {project?.contextNotes.length ? <section aria-label="本次读取范围" className="text-xs leading-5 text-amber-100/80">
          <h3 className="font-semibold">本次读取范围</h3>
          {project.contextNotes.map((note) => <p key={note}>{note}</p>)}
        </section> : null}
        {!props.previsTarget && !props.previsIssue && <section ref={templateSectionRef} aria-label="剧本模板优化" className="rounded-lg border border-cyan-300/20 p-3 text-xs">
          <p className="text-white/65">根据当前故事推荐模板，再选择方案改写本集。推荐与改写沿用顾问问答额度，超额先确认。</p>
          <button type="button" disabled={!userId || !project || askMutation.isPending || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked} onClick={recommendTemplates} className="mt-2 rounded border border-cyan-300/30 px-3 py-2 disabled:opacity-40">推荐3—4个剧本模板方案</button>
        </section>}
        {rewrite && <section aria-label="改写原稿对比" className="space-y-2 rounded-lg border border-emerald-300/30 p-3 text-xs">
          <h3 className="font-semibold">第 {rewrite.episodeIndex} 集 · 改写对比</h3>
          <ul>{rewrite.changes.map((change, i) => <li key={i}>• {change}</li>)}</ul>
          <ManhuaRewriteComparison before={rewrite.originalBody} after={rewrite.rewrittenBody} />
          <p className="text-amber-100">采用后本集及后续制作需重新确认，旧图/片归档保留；完整旧稿另存本机备份。</p>
          <button type="button" disabled={!props.onApplyRewrite || askMutation.isPending || project?.context.episodeIndex !== rewrite.episodeIndex || project?.context.episodeBody !== rewrite.originalBody} onClick={() => { if (props.onApplyRewrite?.(rewrite)) toast.success("改写已采用，请重新检查并确认剧本。"); }} className="rounded border border-emerald-300/40 px-3 py-2 disabled:opacity-40">采用这版改写</button>
          {(project?.context.episodeIndex !== rewrite.episodeIndex || project?.context.episodeBody !== rewrite.originalBody) && <p>当前剧本与原快照不同，已停止覆盖。原稿与建议仍保留供复制。</p>}
        </section>}
        <section aria-label="旧稿备份" className="space-y-2 border-t border-white/10 pt-3 text-xs">
          <button type="button" disabled={!userId || !project} onClick={refreshBackups} className="rounded border border-white/20 px-3 py-2 disabled:opacity-40">查找当前项目旧稿备份</button>
          <p className="text-white/50">仅下载备份JSON，不自动覆盖当前工程。未确认稿按剧名与正文共同匹配。</p>
          {backups.map(backup => <div key={backup.key} className="flex items-center justify-between gap-2"><span>第{backup.episodeIndex}集 · {new Date(backup.createdAt).toLocaleString("zh-CN")}</span><button type="button" onClick={() => { try { downloadAdvisorBackup(backup); } catch { toast.error("备份下载失败，原记录未改动。"); } }} className="shrink-0 text-cyan-100">下载旧稿JSON</button></div>)}
          {backupError && <p role="status" className="text-amber-100">{backupError}</p>}
        </section>
        {!turns.length && <p className="text-xs leading-5 text-white/60">结合当前剧本、参考图绑定和选中镜头给建议。只读取当前项目；未查看原图、原片时不会宣称质量通过。</p>}
        {turns.map((turn) => <div key={turn.id} className={turn.role === "user" ? "ml-8" : "mr-3"}>
          <div className={`whitespace-pre-wrap break-words rounded-lg px-3 py-2.5 text-[13px] leading-6 ${turn.role === "user" ? "bg-cyan-500/15 text-cyan-50" : "border border-white/10 bg-white/[0.035] text-white/85"}`}>{turn.role === "advisor" && parseAdvisorTemplatePlans(turn.text, templates).length ? "已根据当前故事给出以下方案，请选择后查看改写对比。" : turn.role === "advisor" ? readableAdvice(turn.text) : turn.text === TEMPLATE_PLAN_QUESTION ? "根据当前故事推荐3—4个剧本模板方案。" : turn.text === TEMPLATE_REWRITE_QUESTION ? "按所选方案改写当前集，先查看对比再采用。" : turn.text}</div>
          {turn.role === "advisor" && <button type="button" onClick={() => void copyAdvice(turn.text)} className="mt-1 min-h-8 rounded px-2 text-xs text-cyan-100 hover:bg-white/10">复制建议</button>}
          {turn.role === "advisor" && parseAdvisorTemplatePlans(turn.text, templates).map(plan => <section key={plan.publicId} className="mt-2 space-y-2 rounded border border-cyan-300/25 p-3 text-xs">
            <h3 className="font-semibold">{templates.find(t => t.publicId === plan.publicId)?.nameZh}</h3>
            <p>{plan.reason}</p><ul>{plan.changes.map((change, i) => <li key={i}>• {change}</li>)}</ul><p>保留：{plan.preserve}</p>
            <button type="button" disabled={askMutation.isPending || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked} onClick={() => requestRewrite(plan)} className="rounded border border-cyan-300/40 px-2 py-1 disabled:opacity-40">选此方案，改写当前集</button>
            <button type="button" onClick={() => onRequestTrial(templates.find(t => t.publicId === plan.publicId)!)} className="ml-2 text-cyan-100">免费试写大纲对比</button>
          </section>)}
          {turn.role === "advisor" && findMentionedTemplates(turn.text, templates).map((template) => <button key={template.publicId} type="button" onClick={() => onRequestTrial(template)} className="mt-2 rounded border border-cyan-300/30 px-2 py-1 text-xs text-cyan-100">查看「{template.nameZh}」试写入口 →</button>)}
        </div>)}
        {previsKey && (props.previsTarget || previsCandidate) && <details className="text-xs"><summary onClick={recoverPreviews} className="cursor-pointer py-2 text-cyan-100">找回本项目的独立试看</summary>{savedPreviews.map(({ key, trial }) => <button key={key} type="button" className="my-1 block rounded border border-white/20 px-2 py-2 text-left" onClick={() => { try { localStorage.setItem(`${previsKey}:trial`, trial.request.requestId); localStorage.setItem(previsKey, JSON.stringify(trial.candidate)); setAutoPrevisStart(false); setPrevisCandidate(trial.candidate); } catch { toast.error("试看恢复记录无法保存，未切换。"); } }}>{trial.candidate.patch.summaryZh} · {trial.request.spec.durationSec}秒</button>)}</details>}
        {previsCandidate && <ManhuaAdvisorPrevisComparison key={JSON.stringify(previsCandidate)} candidate={previsCandidate} storageKey={previsKey ? `${previsKey}:trial` : null} autoStart={autoPrevisStart} onPrepare={props.onPreparePrevis} onRevise={() => { setDraft("保留这版其他安排，我想调整："); questionRef.current?.focus(); }} disabled={askMutation.isPending || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked} onApply={props.onApplyPrevis} />}
        {askMutation.isPending && <p role="status" className="text-xs text-cyan-200">正在核对本次问题与项目证据…</p>}
        {pendingPaid && <div role="alert" className="rounded-lg border border-amber-300/30 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
          <p>{pendingPaid.hint}</p><p className="mt-1">原问题：{pendingPaid.request.label}（按提问时快照继续）</p><p className="mt-1 whitespace-pre-wrap text-white/75">{pendingPaid.request.rawQuestion}</p>
          {!sessionKey && <p className="mt-2 font-semibold">先确认项目后再付费咨询，避免改稿丢回执。本次不会发起扣点请求。</p>}
          <div className="mt-2 flex gap-3">{sessionKey && <button type="button" disabled={askMutation.isPending || sessionStorageBlocked || !pendingPaid.credits} onClick={() => void submit(pendingPaid.request, true, pendingPaid.credits)} className="rounded border border-amber-200/40 px-3 py-1">确认支付 {pendingPaid.credits ?? "待核对"} 积分并继续</button>}<button type="button" onClick={() => setPendingPaid(null)}>取消</button></div>
        </div>}
        {failed && <div role="alert" className="rounded-lg border border-rose-300/25 p-3 text-xs text-rose-100"><p>{failed.message}</p><p className="mt-1 text-white/70">原问题：{failed.request.label}</p><p className="mt-1 whitespace-pre-wrap text-white/70">{failed.request.rawQuestion}</p>{!failed.newAttempt && <p className="mt-2 text-amber-100">此请求仍未决，请先恢复原问题；草稿可以继续编辑，但不会覆盖恢复记录。</p>}<button type="button" disabled={askMutation.isPending || sessionStorageBlocked || (failed.confirmPaid && !sessionKey)} onClick={() => void submit(failed.newAttempt ? { ...failed.request, requestId: crypto.randomUUID() } : failed.request, failed.newAttempt ? false : failed.confirmPaid, failed.newAttempt ? undefined : failed.confirmedCredits)} className="mt-2 rounded border border-white/20 px-3 py-1">{failed.newAttempt ? "重新提问（新的一次，重新检查额度）" : "恢复原问题（沿用原请求编号）"}</button></div>}
      </div>
      {(props.previsTarget || props.previsIssue) && <div className="border-t border-cyan-300/20 px-3 py-2 text-xs text-cyan-100"><b>正在调整当前片段的白模</b><p>{props.previsIssue || "直接说出人物走向、动作和镜头变化；先讨论调度方案，选定后生成独立试看；不满意继续修改，满意才应用。"}</p><button type="button" className="mt-1 underline" onClick={props.onLeavePrevis}>返回普通咨询</button></div>}
      <footer className="border-t border-white/10 p-3">
        {!props.previsTarget && !props.previsIssue && <div className="mb-2 flex flex-wrap gap-2">{quick.map(([label, question]) => <button key={label} type="button" disabled={!userId || askMutation.isPending || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked} onClick={() => send(question!)} className="rounded-md border border-white/15 px-2 py-1.5 text-xs text-white/75 hover:border-cyan-300/60 disabled:opacity-40">{label}</button>)}</div>}
        <div className="flex items-end gap-2">
          <textarea ref={questionRef} aria-label="向创作顾问提问" value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} maxLength={1200} disabled={!userId || sessionStorageBlocked}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(draft); } }}
            placeholder={props.previsTarget ? "例如：曹三逼近时推紧镜头，出手前下沉到侧面，接触时切马肩特写。只改10—17秒。" : "问当前剧本、人物或镜头…"} className="min-w-0 flex-1 resize-none rounded-lg border border-white/20 bg-black/20 px-3 py-2 text-sm outline-none focus:border-cyan-300" />
          <button type="button" disabled={!userId || askMutation.isPending || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked || draft.trim().length < 2} onClick={() => send(draft)} className="rounded-lg bg-cyan-400 px-3 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-40">{quota && !quotaQuery.data?.exempt && quota.remaining === 0 ? `咨询 · ${quota.price} 积分（先确认）` : "发送"}</button>
        </div>
        <p className="mt-2 text-[11px] leading-4 text-white/45">{props.previsTarget ? "先提议、再试看；可以多轮修改，满意后点击应用。" : "顾问建议需由你确认采用。"}{sessionKey ? "历史按已确认项目版本保存在本机。" : "未确认稿仅保留本次页面会话，改稿后重新咨询。"}追问携带最近 8 条，长答复标记为节选。</p>
        <section aria-label="今日咨询额度" className="mt-2 rounded-lg border border-cyan-300/25 bg-cyan-400/5 p-3 text-xs leading-5" aria-live="polite">
          {quotaQuery.isError ? <p role="alert">额度暂时无法读取；未提交、未扣费。<button type="button" onClick={() => void quotaQuery.refetch()} className="ml-2 underline">刷新额度</button></p> : !quota ? <p>正在读取今日免费额度…</p> : quotaQuery.data?.exempt ? <p>管理员测试：咨询免扣积分。</p> : <><p className="font-semibold">今日咨询免费剩余 {quota.remaining}/5 次</p><p>{quota.remaining ? "本次咨询免费。" : `免费次数已用完，继续咨询需 ${quota.price} 积分/次；提交前请确认。`}每天北京时间 00:00 更新。</p></>}
          <p className="text-white/65">查看已有建议、播放已有试看和应用方案不收费。新增咨询或生成将分别显示本次费用；未经确认不扣积分。</p>
        </section>
        {storageError && <p role="alert" className="mt-1 text-xs text-amber-100">{storageError}</p>}
        {initialRewrite.error && <p role="alert" className="mt-1 text-xs text-amber-100">{initialRewrite.error}</p>}
        {initialRecovery.error && <p role="alert" className="mt-1 text-xs text-amber-100">{initialRecovery.error}</p>}
      </footer>
    </aside>
  );
}
