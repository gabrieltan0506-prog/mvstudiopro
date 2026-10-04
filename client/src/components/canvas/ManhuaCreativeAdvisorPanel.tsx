import ManhuaEpisodeOptimization, { type EpisodeOptimizationWorkspace } from "./ManhuaEpisodeOptimization";
import { validateAdvisorRewriteBody, TEMPLATE_REWRITE_MARKER } from "@shared/manhuaAdvisorRewrite";
import { buildTemplateAdviceQuestion } from "@/lib/manhuaTemplateAdvice";
import { Streamdown } from "streamdown";
import { automaticAdvisorContext, automaticAdvisorRequestId, MANHUA_ADVISOR_AUTO_QUESTION, MANHUA_ADVISOR_PAID_CREDITS } from "@shared/manhuaAdvisorPolicy";
import { manhuaProjectStorage as localStorage } from "@shared/manhuaProjectScope";
import { advisorWorldCandidateSchema, parseAdvisorWorldPlan, type AdvisorWorldTarget, type AdvisorWorldCandidate } from "@shared/manhuaAdvisorWorld";
import { advisorPrevisVideoSourceSchema, withAdvisorPrevisVideo, type AdvisorPrevisVideoSource } from "@shared/manhuaAdvisorPrevisEdit";
import { requestsAdvisorPrevisRender } from "@/lib/manhuaAdvisorPrevisIntent";
import { createPortal } from "react-dom";
import { streamManhuaAdvisor } from "@/lib/manhuaAdvisorStream";
import { advisorPrevisTrialSchema } from "@shared/manhuaAdvisorPrevisEdit";
import { manhuaPrevisSpecSchema } from "@shared/manhuaPrevis";
import { advisorPrevisCandidateSchema, parseAdvisorPrevisPatch, type AdvisorPrevisCandidate, type AdvisorPrevisTarget, type AdvisorPrevisTrial, type AdvisorPrevisReceipt, applyAdvisorPrevisPatch, advisorPrevisSpecJson } from "@shared/manhuaAdvisorPrevisEdit";
import { ManhuaAdvisorPrevisComparison } from "./ManhuaAdvisorPrevisComparison";
import { ManhuaRewriteComparison } from "./ManhuaRewriteComparison";
/** 项目顾问：读取证据、提出模板改写建议；正式稿仅经显式对比采用。 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { copyTextWithToast } from "@/lib/copyText";
import { buildAdvisorQuestion, findMentionedTemplates } from "@/lib/manhuaCreativeAdvisorContext";
import { manhuaCreativeAdvisorContextSchema } from "@shared/manhuaCreativeAdvisor";
import type { PublicManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";
import { resolveAdvisorVideoPromptContext, type buildManhuaAdvisorProject, type AdvisorIssue } from "@/lib/manhuaAdvisorProject";
import ManhuaAdvisorGenerationMonitor from "./ManhuaAdvisorGenerationMonitor";
import { manhuaIssueResolutionZh } from "@/lib/manhuaMainTaskBlockers";
import { advisorRecentHistory, loadAdvisorMessages, loadAdvisorPendingRecovery, makeAdvisorPendingRecovery, manhuaAdvisorSessionKey, mergeAdvisorCompletedExchange, persistAdvisorCompletedExchange, type AdvisorMessage, type AdvisorMessagesLoadResult, type AdvisorPendingRequest, type AdvisorRecoveryLoadResult } from "@/lib/manhuaAdvisorSession";
import { advisorRewriteCandidateSchema, buildTemplatePlanQuestion, buildTemplateRewriteQuestion, parseAdvisorRewrite, parseAdvisorTemplatePlans, formatAdvisorRewriteAnswer, TEMPLATE_PLAN_QUESTION, TEMPLATE_REWRITE_QUESTION, type AdvisorRewriteCandidate, type AdvisorTemplatePlan } from "@/lib/manhuaAdvisorTemplates";
import { downloadAdvisorBackup, listAdvisorBackups, type AdvisorBackupEntry } from "@/lib/manhuaAdvisorBackups";
import { MANHUA_ADVISOR_STAGE_LABELS } from "@/lib/manhuaAdvisorEntry";
import { formatManhuaAdvisorContextIssue, formatManhuaAdvisorError } from "@/lib/manhuaAdvisorFeedback";

type PendingQuestion = AdvisorPendingRequest;
function readableAdvice(text: string) {
  try { const value = JSON.parse(text); if (value.kind === "world_plan_v1") return value.summaryZh; } catch { /* 普通文本按原路径显示。 */ }
  try { return parseAdvisorPrevisPatch(text).summaryZh; } catch { return formatAdvisorRewriteAnswer(text); }
}

export default function ManhuaCreativeAdvisorPanel(props: {
  dockHost?: HTMLElement | null;
  previewHost?: HTMLElement | null;
  previsTarget?: AdvisorPrevisTarget;
  worldTarget?: AdvisorWorldTarget;
  worldTaskState?: string;
  onGenerateWorld?: (candidate: AdvisorWorldCandidate) => Promise<void>;
  studio3d?: { directionCardId?: string; directionCardVersion?: string };
  previsIssue?: string;
  previsLaunchIssue?: string;
  previsLabel?: string;
  previsAudioControls?: ReactNode;
  onCheckPrevisReady?: (candidate: AdvisorPrevisCandidate) => string;
  onLeavePrevis?: () => void;
  onPreparePrevis?: (candidate: AdvisorPrevisCandidate) => AdvisorPrevisTrial;
  onApplyPrevis?: (trial: AdvisorPrevisTrial, receipt: AdvisorPrevisReceipt) => boolean;
  open: boolean;
  onClose: () => void;
  stageZh?: string;
  userId?: string;
  projectId?: string;
  automaticMonitoring?: boolean;
  confirmedProjectVersion?: string;
  project?: ReturnType<typeof buildManhuaAdvisorProject>;
  onLocate?: (issue: AdvisorIssue) => void;
  episodeWorkspace?: EpisodeOptimizationWorkspace;
  selectedTemplate?: PublicManhuaViralTemplateCard | null;
  templates: PublicManhuaViralTemplateCard[];
  onApplyRewrite?: (candidate: AdvisorRewriteCandidate) => boolean;
  onRequestTrial: (template: PublicManhuaViralTemplateCard) => void;
  focusSection?: "templates" | null;
  questionSeed?: { id: string; question: string; submit?: boolean } | null;
  onQuestionSeedApplied?: () => void;
}) {
  const { open, onClose, userId, confirmedProjectVersion, project, onLocate, stageZh, selectedTemplate, templates, onRequestTrial } = props;
  const draftSessionKey = userId ? manhuaAdvisorSessionKey(userId, props.projectId ? `draft:${props.projectId}` : "legacy-draft") : null;
  // 保留已上线的已确认稿键；新建作品未确认时也能保存恢复编号。
  const sessionKey = userId && confirmedProjectVersion ? manhuaAdvisorSessionKey(userId, confirmedProjectVersion) : draftSessionKey;
  function inheritDraftConversation(key: string, suffix = "") {
    if (!sessionKey || !draftSessionKey || sessionKey === draftSessionKey || localStorage.getItem(`${key}:draft-inherited`) === draftSessionKey) return;
    const sourceKey = draftSessionKey + suffix;
    const draft = localStorage.getItem(sourceKey);
    // 同一草稿请求也不能在下一次确认稿时重新继承；来源全文保留供恢复。
    if (suffix === ":pending" && draft !== null && localStorage.getItem(`${sourceKey}:inherited-record`) === draft) return;
    if (draft !== null && localStorage.getItem(key) === null) {
      localStorage.setItem(key, draft);
      if (suffix === ":pending") localStorage.setItem(`${sourceKey}:inherited-record`, draft);
    }
    if (draft !== null) localStorage.setItem(`${key}:draft-inherited`, draftSessionKey); // 完整保留来源；已结束的 pending 不在重开时复活。
  }
  const previsKey = sessionKey ? `${sessionKey}:previs-edit` : null;
  const worldKey = sessionKey ? `${sessionKey}:world-plan` : null;
  const [worldCandidate, setWorldCandidate] = useState<AdvisorWorldCandidate | null>(() => {
    try { const raw = worldKey && localStorage.getItem(worldKey); return raw ? advisorWorldCandidateSchema.parse(JSON.parse(raw)) : null; } catch { return null; }
  });
  const [worldGenerating, setWorldGenerating] = useState(false);
  const worldLock = useRef(false);
  const activePrevisTarget = useRef(props.previsTarget);
  activePrevisTarget.current = props.previsTarget;
  const creationMode = Boolean(props.previsTarget || props.previsIssue || props.studio3d || props.worldTarget);
  const worldMatches = Boolean(worldCandidate && props.worldTarget && JSON.stringify(worldCandidate.target) === JSON.stringify(props.worldTarget));
  const [previsCandidate, setPrevisCandidate] = useState<AdvisorPrevisCandidate | null>(() => {
    try { const raw = previsKey && localStorage.getItem(previsKey); return raw ? advisorPrevisCandidateSchema.parse(JSON.parse(raw)) : null; }
    catch { return null; }
  });
  const [previewVideoSource, setPreviewVideoSource] = useState<AdvisorPrevisVideoSource | null>(() => {
    try { const raw = previsKey && localStorage.getItem(`${previsKey}:video-source`); return raw ? advisorPrevisVideoSourceSchema.parse(JSON.parse(raw)) : null; }
    catch { return null; }
  });
  function rememberPreviewVideo(source: AdvisorPrevisVideoSource) {
    setPreviewVideoSource(source);
    try { if (previsKey) localStorage.setItem(`${previsKey}:video-source`, JSON.stringify(source)); }
    catch { setStorageError("试看已生成，但视频修改基线未保存；请保持页面开启。"); }
  }
  const lastSelectedVideo = useRef(props.previsTarget?.previousPreviewRequestId);
  useEffect(() => {
    const selected = props.previsTarget?.previousPreviewRequestId;
    if (selected !== lastSelectedVideo.current) {
      lastSelectedVideo.current = selected;
      setPreviewVideoSource(null);
      try { if (previsKey) localStorage.removeItem(`${previsKey}:video-source`); } catch { /* 本次显式选择优先于旧缓存。 */ }
    }
  }, [props.previsTarget?.previousPreviewRequestId, previsKey]);
  const [autoPrevisStart, setAutoPrevisStart] = useState(false);
  const [previsActionHost, setPrevisActionHost] = useState<HTMLDivElement | null>(null);
  const candidateMatches = Boolean(previsCandidate && props.previsTarget && previsCandidate.target.clipId === props.previsTarget.clipId && previsCandidate.target.specJson === props.previsTarget.specJson);
  const [savedPreviews, setSavedPreviews] = useState<Array<{ key: string; trial: AdvisorPrevisTrial }>>([]);
  useEffect(() => { setAutoPrevisStart(false); }, [props.previsTarget?.clipId, props.previsTarget?.specJson]);
  const rewriteKey = sessionKey ? `${sessionKey}:rewrite` : null;
  const [initialRewrite] = useState(() => {
    try { const raw = rewriteKey && localStorage.getItem(rewriteKey); return { candidate: raw ? advisorRewriteCandidateSchema.parse(JSON.parse(raw)) : null, error: "" }; }
    catch { return { candidate: null, error: "原稿对比记录无法读取。为保护旧稿，已停止新的咨询与改写；请恢复浏览器存储后刷新。" }; }
  });
  const [rewrite, setRewrite] = useState<AdvisorRewriteCandidate | null>(initialRewrite.candidate);
  const [rewriteEdit, setRewriteEdit] = useState(initialRewrite.candidate?.rewrittenBody || "");
  const [rewriteEditHook, setRewriteEditHook] = useState(initialRewrite.candidate?.endHook || "");
  const [rewriteEditError, setRewriteEditError] = useState("");
  const rewriteRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!rewrite) return;
    let text = rewrite.rewrittenBody;
    let endHook = rewrite.endHook || "";
    try {
      const saved = rewriteKey && localStorage.getItem(`${rewriteKey}:edit`);
      const value = saved ? JSON.parse(saved) : null;
      if (value?.originalBody === rewrite.originalBody && value?.episodeIndex === rewrite.episodeIndex && typeof value.text === "string" && value.generatedBody === rewrite.rewrittenBody) { text = value.text; if (typeof value.endHook === "string") endHook = value.endHook; }
      setRewriteEditError("");
    } catch { setRewriteEditError("编辑草稿无法读取，仍保留已生成版本，请先下载旧稿。"); }
    setRewriteEdit(text);
    setRewriteEditHook(endHook);
    requestAnimationFrame(() => rewriteRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }, [rewrite, rewriteKey]);
  function editRewrite(text: string, endHook = rewriteEditHook) {
    setRewriteEdit(text);
    setRewriteEditHook(endHook);
    try {
      if (rewriteKey && rewrite) localStorage.setItem(`${rewriteKey}:edit`, JSON.stringify({ episodeIndex: rewrite.episodeIndex, originalBody: rewrite.originalBody, generatedBody: rewrite.rewrittenBody, text, endHook }));
      setRewriteEditError("");
    } catch { setRewriteEditError("修改尚未保存，请保留页面并复制正文，恢复存储后再套用。"); }
  }
  function applyRewrite() {
    if (!rewrite || rewriteEditError) return;
    try {
      validateAdvisorRewriteBody(rewrite.originalBody, rewriteEdit);
      if (props.onApplyRewrite?.({ ...rewrite, rewrittenBody: rewriteEdit, ...(rewrite.endHook ? { endHook: rewriteEditHook } : {}) })) toast.success(`已套用第 ${rewrite.episodeIndex} 集，旧稿已备份，请重新确认剧本。`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "整集优化稿尚未通过检查，原稿保留"); }
  }
  const [backups, setBackups] = useState<AdvisorBackupEntry[]>([]);
  const [backupError, setBackupError] = useState("");
  const recoveryKey = sessionKey ? `${sessionKey}:pending` : null;
  // 宿主用用户/已确认项目版本 key 重建面板，旧项目的在途答复不得写入新项目。
  const [initial] = useState<AdvisorMessagesLoadResult>(() => {
    try { if (sessionKey) inheritDraftConversation(sessionKey); return sessionKey ? loadAdvisorMessages(localStorage, sessionKey) : { turns: [], error: "", writable: true }; }
    catch { return { turns: [], error: "本机历史无法读取。为保护原记录，已停止新的问答与扣点；请检查浏览器存储后刷新。", writable: false }; }
  });
  const [turns, setTurns] = useState<AdvisorMessage[]>(initial.turns);
  const [initialRecovery] = useState<AdvisorRecoveryLoadResult>(() => {
    try { if (recoveryKey) inheritDraftConversation(recoveryKey, ":pending"); return recoveryKey ? loadAdvisorPendingRecovery(localStorage, recoveryKey) : { value: null, error: "" }; }
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
  const [streamPending, setStreamPending] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!streamPending) return;
    const startedAt = Date.now(); setElapsedSec(0);
    const timer = window.setInterval(() => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [streamPending]);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const questionRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const templateSectionRef = useRef<HTMLElement | null>(null);
  const asking = streamPending;
  const quotaQuery = trpc.mvAnalysis.getManhuaAdvisorQuota.useQuery(props.projectId ? { projectId: props.projectId } : undefined, { enabled: (open || Boolean(props.automaticMonitoring)) && Boolean(userId), staleTime: 0, retry: false, refetchOnWindowFocus: true });
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
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [turns, open, pendingPaid, failed, streamText]);
  useEffect(() => {
    if (!open || props.focusSection !== "templates") return;
    requestAnimationFrame(() => templateSectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }, [open, props.focusSection]);

  const appliedQuestionSeed = useRef<string | null>(null);
  useEffect(() => {
    const seed = props.questionSeed;
    if (!open || !seed || appliedQuestionSeed.current === seed.id || asking || pendingPaid || unresolvedFailed || sessionStorageBlocked) return;
    appliedQuestionSeed.current = seed.id;
    // 只有用户明确点击“用顾问优化本集”的种子才提交；其他入口仍预填。
    if (seed.submit && !draft.trim()) {
      send(seed.question);
      props.onQuestionSeedApplied?.();
      return;
    }
    // 正在编辑的问题保留，不被模板卡覆盖。
    if (draft.trim() && draft.length + seed.question.length + 2 > 1200) {
      toast.error("顾问输入区已有较长问题，请先发送或复制保存，再从模板卡提问。原问题已保留。");
    } else {
      setDraft(previous => previous.trim() ? `${previous}\n\n${seed.question}` : seed.question);
    }
    props.onQuestionSeedApplied?.();
    requestAnimationFrame(() => questionRef.current?.focus());
  }, [open, props.questionSeed, asking, pendingPaid, unresolvedFailed, sessionStorageBlocked]);

  async function submit(request: PendingQuestion, confirmPaid: boolean, confirmedCredits?: number) {
    if (inFlight.current || !userId || sessionStorageBlocked) return;
    if (!request.manhuaContext) { toast.error("请先选择漫剧项目，再向创作顾问提问；本次未调用模型。"); return; }
    const recovering = initialRecovery.value?.request.requestId === request.requestId || (failed?.newAttempt !== true && failed?.request.requestId === request.requestId);
    if ((!quotaQuery.data || quotaQuery.isError) && !recovering) { toast.error("暂时无法核对本作品额度，本次未提交、未扣费。请刷新额度后重试。"); return; }
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
    setStreamPending(true);
    setStreamText("");
    setRetrying(false);
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
      const input = { requestId: request.requestId, question: request.question, rawQuestion: request.rawQuestion, manhuaContext: request.manhuaContext, confirmPaid: confirmPaid || undefined, confirmedCredits: confirmPaid ? confirmedCredits : undefined };
      let responseAttempt = 0;
      const res = await streamManhuaAdvisor(input, text => { if (mounted.current) setStreamText(text); }, () => { if (mounted.current) setRetrying(++responseAttempt > 1); });
      const answer = String(res.answer || "").trim();
      if (!answer) throw new Error("本次没有收到有效回答，请重试原问题。");
      if (request.manhuaContext?.worldTarget) {
        const candidate = advisorWorldCandidateSchema.parse({ target: request.manhuaContext.worldTarget, plan: parseAdvisorWorldPlan(answer, request.manhuaContext.worldTarget) });
        if (worldKey) { try { localStorage.setItem(worldKey, JSON.stringify(candidate)); } catch { if (mounted.current) setStorageError("场景方案保存失败，请保持当前页面。"); } }
        if (mounted.current) setWorldCandidate(candidate);
      }
      if (request.manhuaContext?.previsEdit) {
        const candidate = advisorPrevisCandidateSchema.parse({ target: request.manhuaContext.previsEdit, patch: parseAdvisorPrevisPatch(answer) });
        if (capturedPrevisKey) {
          try { localStorage.setItem(capturedPrevisKey, JSON.stringify(candidate)); }
          catch { if (mounted.current) setStorageError("调度建议未能保存，关闭页面前请保留当前对话。"); }
        }
        if (mounted.current) { setPrevisCandidate(candidate); setAutoPrevisStart(activePrevisTarget.current?.clipId === candidate.target.clipId && activePrevisTarget.current.specJson === candidate.target.specJson && (request.previsRenderRequested === true || requestsAdvisorPrevisRender(request.rawQuestion))); }
      }
      if (request.rawQuestion === TEMPLATE_PLAN_QUESTION && !parseAdvisorTemplatePlans(answer, templates).length && mounted.current) {
        toast.error("本次回答未提供3—5个合法模板方案，不能自动选择；原回答已保留供查看。");
      }
      if (request.rawQuestion.startsWith("【模板改写建议】")) {
        try {
          const candidate = parseAdvisorRewrite(answer, request.manhuaContext!.episodeIndex, request.manhuaContext!.episodeBody, request.manhuaContext!.episodeEndHook);
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
        void quotaQuery.refetch();
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
    } finally { inFlight.current = false; if (mounted.current) { setStreamPending(false); setStreamText(""); } }
  }

  function send(rawQuestion: string, wrappedQuestion?: string, renderRequested = false, episode?: EpisodeOptimizationWorkspace["episodes"][number]) {
    if (inFlight.current || pendingPaid || unresolvedFailed || !userId || sessionStorageBlocked) return;
    const question = rawQuestion.trim();
    if (question.length < 2 || question.length > 1200) { toast.error("请输入 2—1200 字的问题，内容不会被自动截断。"); return; }
    if (question.startsWith(TEMPLATE_REWRITE_MARKER) && (!project?.context.episodeBody.trim() || project.context.episodeBody.length > 8000 || project.contextNotes.some(note => note.includes("本集正文")))) {
      toast.error("当前集正文为空、已节选或超过8000字，不能生成完整优化稿，请先打开完整本集。"); return;
    }
    if (props.previsIssue) { toast.error(props.previsIssue); return; }
    let previsEdit = props.previsTarget ? withAdvisorPrevisVideo(props.previsTarget, previewVideoSource) : undefined;
    if (previsEdit && !previsEdit.previousPreviewRequestId && previsCandidate?.target.clipId === previsEdit.clipId && previsCandidate.target.specJson === previsEdit.specJson) {
      try { previsEdit = { ...previsEdit, previousPreviewSpecJson: advisorPrevisSpecJson(applyAdvisorPrevisPatch(manhuaPrevisSpecSchema.parse(JSON.parse(previsEdit.specJson)), previsCandidate.patch)) }; } catch { /* 未支持要求不继承为已执行配置。 */ }
    }
    let questionContext = project?.context;
    if (episode && questionContext) questionContext = {...questionContext,episodeIndex:episode.index,episodeTitle:episode.title,episodeBody:episode.body,episodeEndHook:episode.endHook||""};
    try {
      if (project && questionContext) questionContext = resolveAdvisorVideoPromptContext({ context: questionContext, question, drafts: project.videoPromptDrafts, selectedSegmentIndex: project.selectedSegmentIndex });
    } catch (error) { toast.error(error instanceof Error ? error.message : "无法读取本段提示词"); return; }
    const result = questionContext ? manhuaCreativeAdvisorContextSchema.safeParse({ ...questionContext, ...(props.projectId ? { projectId: props.projectId } : {}), history: advisorRecentHistory(turns), ...(previsEdit ? { previsEdit } : {}), ...(props.studio3d ? { studio3d: { directionCardId: props.studio3d.directionCardId, directionCardVersion: props.studio3d.directionCardVersion } } : {}), ...(props.worldTarget ? { worldTarget: props.worldTarget } : {}) }) : null;
    if (result && !result.success) {
      toast.error("当前上下文超出读取范围或包含不适合发送的内容", {
        description: result.error.issues.map(formatManhuaAdvisorContextIssue).join("；"),
      });
      return;
    }
    const promptScope = questionContext?.shotSummary.match(/^【当前保存的(第 \d+ 段)视频提示词/)?.[1];
    const label = project ? `第 ${project.context.episodeIndex} 集 · ${MANHUA_ADVISOR_STAGE_LABELS[project.context.stage]} · ${promptScope || project.selectionLabel}` : stageZh || "创作咨询";
    const request: PendingQuestion = {
      requestId: crypto.randomUUID(),
      ...(props.previsTarget && renderRequested ? { previsRenderRequested: true } : {}),
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
    send(`${TEMPLATE_REWRITE_QUESTION} 模板编号 ${plan.publicId}`, question);
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

  const automaticSeen = useRef(new Set<string>());
  const autoSnapshot = project && project.context.episodeBody.trim()
    ? JSON.stringify(automaticAdvisorContext({ ...project.context, ...(props.projectId ? { projectId: props.projectId } : {}) })) : "";
  useEffect(() => {
    if (!props.automaticMonitoring || !userId || !autoSnapshot || draft.trim() || creationMode || asking || pendingPaid || failed || sessionStorageBlocked || !quotaQuery.data || quotaQuery.isError) return;
    const quotaSnapshot = quotaQuery.data;
    let cancelled = false;
    const timer = window.setTimeout(() => { void (async () => {
      const context = manhuaCreativeAdvisorContextSchema.parse(JSON.parse(autoSnapshot));
      const requestId = await automaticAdvisorRequestId(userId, context);
      if (cancelled || inFlight.current || automaticSeen.current.has(requestId) || turns.some(t => t.id === `${requestId}:answer`)) return;
      automaticSeen.current.add(requestId);
      const request: PendingQuestion = { requestId, question: MANHUA_ADVISOR_AUTO_QUESTION, rawQuestion: MANHUA_ADVISOR_AUTO_QUESTION,
        manhuaContext: context, label: `自动检查 · 第 ${context.episodeIndex} 集 · ${MANHUA_ADVISOR_STAGE_LABELS[context.stage]} · ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` };
      if (!quotaSnapshot.exempt && quotaSnapshot.remaining === 0) {
        setPendingPaid({ request, credits: MANHUA_ADVISOR_PAID_CREDITS, hint: `本作品 5 次免费建议已用完。自动检查本步骤需要 ${MANHUA_ADVISOR_PAID_CREDITS} 积分，确认后才会提交。` });
      } else { await submit(request, false); }
    })().catch(error => { if (!cancelled) toast.error(error instanceof Error ? error.message : "自动检查未能开始"); }); }, 8000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [autoSnapshot, props.automaticMonitoring, userId, draft, creationMode, asking, pendingPaid, failed, sessionStorageBlocked, quotaQuery.data, quotaQuery.isError, turns]);

  if (!open && !(previsCandidate && props.previewHost)) return null;
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
  const panel = (
    <aside hidden={!open} data-manhua-creative-advisor aria-label="创作顾问"
      onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
      data-advisor-docked={props.dockHost ? "true" : undefined}
      className={`${props.dockHost ? "relative h-full min-h-0 w-full" : "fixed bottom-0 right-0 top-[4.5rem] z-[60] w-full max-w-[420px]"} flex flex-col border-l border-cyan-200/15 bg-[#10171f] text-white shadow-2xl`}>
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-cyan-100">创作顾问 <span className="text-xs font-normal text-white/60">· {currentStage}</span></h2>
          <p className="mt-1 truncate text-[11px] text-white/65">{project?.context.seriesTitle || "未命名项目"} · {props.previsLabel || (project ? `第${project.context.episodeIndex}集 · ${project.selectionLabel}` : "当前没有项目上下文")}</p>
        </div>
        <button type="button" onClick={onClose} className="min-h-10 rounded-md px-3 text-xs text-white/70 hover:bg-white/10 focus-visible:outline-cyan-300">收起</button>
      </header>
      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {(props.previsTarget || props.previsIssue) && <section aria-label="白模生成步骤" className="space-y-2 rounded-lg border border-cyan-300/25 p-3 text-xs text-cyan-100">
          <strong>{props.previsLabel || "当前片段"} · 白模视频试看</strong>
          <ol className="space-y-1"><li>1. 在下方描述人物走位、动作或镜头要求。</li><li>2. 点击「生成白模视频试看」，默认先看无声动作。</li><li>3. 视频在本页显示，逐帧与常速检查动作、人数和运镜。</li><li>4. 满意后才应用；需要声音时绑定本段音轨，再勾选带上对白与BGM。</li></ol>
          {(props.previsIssue || props.previsLaunchIssue) && <p role="status" className="text-amber-100">{props.previsIssue || props.previsLaunchIssue}</p>}
          <button type="button" className="underline" onClick={props.onLeavePrevis}>返回普通咨询</button>
        </section>}
        <details className="rounded-lg border border-white/10 p-2 text-xs"><summary className="cursor-pointer text-white/65">咨询额度与快捷提问</summary>
        <button type="button" disabled={!userId || !project || asking || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked} onClick={() => { setDraft("请结合当前剧情、导演包与镜头规格，优化运镜、灯光、场景氛围和演员表演。逐镜写明一位小数秒窗、摄影机起终位置、移动方向、FOV/景别、焦点与光源变化；说明氛围随事件怎样变化，以及各角色的意图、喜怒哀乐、眼神/微表情、身体和听者反应。区分白模已表达和正式影片还需补充的技巧。保留人物、动作和已确认音轨，只给建议，不生成、重渲染或自动采用。"); questionRef.current?.focus(); }} className="mb-2 rounded-md border border-cyan-300/30 px-3 py-2 text-xs text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-40">优化摄影、氛围与表演</button>
        {!creationMode && <div className="mb-2 flex flex-wrap gap-2">{quick.map(([label, question]) => <button key={label} type="button" disabled={!userId || asking || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked} onClick={() => send(question!)} className="rounded-md border border-white/15 px-2 py-1.5 text-xs text-white/75 hover:border-cyan-300/60 disabled:opacity-40">{label}</button>)}</div>}
        <p className="mt-2 text-[11px] leading-4 text-white/45">{props.previsTarget ? "说“生成试看”会直接渲染到本页；可以多轮修改，满意后点击应用。" : "顾问意见仅供参考，由你选择是否采纳；不会自动修改项目或生成素材。工厂会生成提示词，无需从零手填。"}{sessionKey ? "对话与恢复记录保存在本机，按作品和稿件版本区分。" : "登录后可保存对话与恢复记录。"}追问携带最近 8 条，长答复标记为节选。</p>
        <section aria-label="本作品咨询额度" className="mt-2 rounded-lg border border-cyan-300/25 bg-cyan-400/5 p-3 text-xs leading-5" aria-live="polite">
          {quotaQuery.isError ? <p role="alert">额度暂时无法读取；未提交、未扣费。<button type="button" onClick={() => void quotaQuery.refetch()} className="ml-2 underline">刷新额度</button></p> : !quota ? <p>正在读取本作品免费额度…</p> : quotaQuery.data?.exempt ? <p>管理员测试：咨询免扣积分。</p> : <><p className="font-semibold">本作品免费剩余 {quota.remaining}/5 次</p><p>{quota.remaining ? "本次咨询免费。" : `免费次数已用完，继续咨询需 ${quota.price} 积分/次；提交前请确认。`}每部作品共 5 次，手动提问与自动建议共用，不按天重置。</p></>}
          <p className="text-white/65">查看已有建议、播放已有试看和应用方案不收费。新增咨询或生成将分别显示本次费用；未经确认不扣积分。</p>
        </section>
        </details>
        {!userId && <p className="text-sm text-amber-100">登录后可以咨询当前项目。<a href="/login" className="ml-2 underline">去登录</a></p>}
        {project?.generationSteps && <ManhuaAdvisorGenerationMonitor steps={project.generationSteps} onLocate={onLocate ? phase => onLocate({ id: "generation-step", phase, blocking: false, text: "查看生成步骤" }) : undefined} />}
        {project && <section aria-label="当前项目检查" className="border-l-2 border-cyan-400/65 pl-3">
          <h3 className="text-xs font-semibold text-white/85">本机状态检查 · 不调用顾问</h3>
          {project.issues.length ? project.issues.map((issue) => <div key={issue.id} className="mt-2 flex items-start gap-2 text-xs leading-5">
            <div className="flex-1 text-white/75"><p>{issue.blocking ? "未通过" : "建议"}：{issue.text}</p><p className="text-white/55">处理办法：{manhuaIssueResolutionZh(issue)}</p></div>
            {onLocate && <button type="button" onClick={() => onLocate(issue)} className="shrink-0 rounded border border-white/15 px-2 text-cyan-100 hover:bg-cyan-500/15">去处理</button>}
          </div>) : <p className="mt-2 text-xs text-white/55">未发现上述结构缺项；尚未验证画面、声音或成片质量。</p>}
        </section>}
        {project?.contextNotes.length ? <section aria-label="本次读取范围" className="text-xs leading-5 text-amber-100/80">
          <h3 className="font-semibold">本次读取范围</h3>
          {project.contextNotes.map((note) => <p key={note}>{note}</p>)}
        </section> : null}
        {!creationMode && props.episodeWorkspace && <section ref={templateSectionRef}><ManhuaEpisodeOptimization key={`${userId}:${props.projectId}`} {...props.episodeWorkspace} userId={userId} projectId={props.projectId} focusEpisode={project?.context.episodeIndex||1} templates={templates} plans={[...turns].reverse().map(t=>t.role==="advisor"?parseAdvisorTemplatePlans(t.text,templates):[]).find(p=>p.length)||[]} asking={asking||Boolean(pendingPaid)||unresolvedFailed||sessionStorageBlocked} onRecommend={episodes=>send(TEMPLATE_PLAN_QUESTION,buildTemplatePlanQuestion(templates)+`\n本次计划优化第${episodes.map(e=>e.index).join("、")}集；先以第${episodes[0].index}集完整正文推荐，说明各模板能注入哪些具体特色。`,false,episodes[0])}/></section>}
        {!creationMode && !props.episodeWorkspace && <section ref={templateSectionRef} aria-label="剧本模板优化" className="rounded-lg border border-cyan-300/20 p-3 text-xs">
          <h3 className="font-semibold">用模板优化当前整集</h3>
          <p className="mt-2 text-white/65">生成完整优化稿 → 对比并编辑 → 套用本集。沿用顾问额度，超额先确认；套用已生成稿不再收费。</p>
          {selectedTemplate && <button type="button" disabled={!userId || !project || asking || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked} onClick={() => send(buildTemplateAdviceQuestion(selectedTemplate))} className="mt-2 rounded bg-emerald-500/20 px-3 py-2 font-semibold text-emerald-100 disabled:opacity-40">用「{selectedTemplate.storyPreview?.teaserTitleZh || selectedTemplate.nameZh}」优化本集</button>}
          <button type="button" disabled={!userId || !project || asking || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked} onClick={recommendTemplates} className="mt-2 rounded border border-cyan-300/30 px-3 py-2 disabled:opacity-40">推荐3—5个剧本模板方案</button>
        </section>}
        {!creationMode && rewrite && <section ref={rewriteRef} aria-label="改写原稿对比" className="space-y-3 rounded-lg border border-emerald-300/30 p-3 text-xs">
          <h3 className="font-semibold">第 {rewrite.episodeIndex} 集 · 原集 / 优化后整集</h3>
          <details><summary className="cursor-pointer">查看本次具体改动</summary><ul>{rewrite.changes.map((change, i) => <li key={i}>• {change}</li>)}</ul></details>
          <ManhuaRewriteComparison before={rewrite.originalBody} after={rewriteEdit} />
          <label className="block">优化后整集 · 可直接修改<textarea aria-label="优化后整集正文" value={rewriteEdit} onChange={e => editRewrite(e.target.value)} maxLength={9000} rows={12} className="mt-2 w-full rounded border border-white/20 bg-black/20 p-3 text-sm leading-7" /></label>
          {rewrite.endHook && <label className="block">片尾钩子 · 与正文一起套用<textarea aria-label="优化后片尾钩子" value={rewriteEditHook} onChange={e => editRewrite(rewriteEdit, e.target.value)} maxLength={2000} rows={3} className="mt-2 w-full rounded border border-white/20 bg-black/20 p-3 leading-6" /></label>}
          <p className="text-white/60">套用只替换本集正文与片尾钩子，其他集正文保留。旧稿先备份；本集及后续制作需重新确认，旧图与成片归档保留。</p>
          <button type="button" disabled={!props.onApplyRewrite || asking || Boolean(rewriteEditError) || project?.context.episodeIndex !== rewrite.episodeIndex || project?.context.episodeBody !== rewrite.originalBody} onClick={applyRewrite} className="rounded bg-emerald-500/20 px-4 py-2 font-semibold text-emerald-100 disabled:opacity-40">套用本集</button>
          {rewriteEditError && <p role="alert">{rewriteEditError}</p>}
          {(project?.context.episodeIndex !== rewrite.episodeIndex || project?.context.episodeBody !== rewrite.originalBody) && <p>当前剧本与原快照不同，已停止覆盖。原稿与优化稿仍保留。</p>}
        </section>}
        {!creationMode && <section aria-label="旧稿备份" className="space-y-2 border-t border-white/10 pt-3 text-xs">
          <button type="button" disabled={!userId || !project} onClick={refreshBackups} className="rounded border border-white/20 px-3 py-2 disabled:opacity-40">查找当前项目旧稿备份</button>
          <p className="text-white/50">仅下载备份JSON，不自动覆盖当前工程。未确认稿按剧名与正文共同匹配。</p>
          {backups.map(backup => <div key={backup.key} className="flex items-center justify-between gap-2"><span>第{backup.episodeIndex}集 · {new Date(backup.createdAt).toLocaleString("zh-CN")}</span><button type="button" onClick={() => { try { downloadAdvisorBackup(backup); } catch { toast.error("备份下载失败，原记录未改动。"); } }} className="shrink-0 text-cyan-100">下载旧稿JSON</button></div>)}
          {backupError && <p role="status" className="text-amber-100">{backupError}</p>}
        </section>}
        {!turns.length && <p className="text-xs leading-5 text-white/60">结合当前剧本、参考图绑定和选中镜头给建议。只读取当前项目；未查看原图、原片时不会宣称质量通过。</p>}
        {turns.map((turn) => <div key={turn.id} className={turn.role === "user" ? "ml-8" : "mr-3"}>
          <div className={`whitespace-pre-wrap break-words rounded-lg px-3 py-2.5 text-[15px] leading-7 ${turn.role === "user" ? "bg-cyan-500/15 text-cyan-50" : "border border-white/10 bg-white/[0.035] text-white/85"}`}>{turn.role === "advisor" && parseAdvisorTemplatePlans(turn.text, templates).length ? "已根据当前故事给出以下方案，请选择后查看改写对比。" : turn.role === "advisor" ? <Streamdown>{readableAdvice(turn.text)}</Streamdown> : turn.text.includes(MANHUA_ADVISOR_AUTO_QUESTION) ? `${turn.text.split("\n")[0]}：检查本步骤的剧情、空间与制作建议。` : turn.text === TEMPLATE_PLAN_QUESTION ? "根据当前故事推荐3—5个剧本模板方案。" : turn.text === TEMPLATE_REWRITE_QUESTION ? "按所选方案改写当前集，先查看对比再采用。" : turn.text}</div>
          {turn.role === "advisor" && (creationMode || props.previsTarget || props.worldTarget) && <button type="button" onClick={() => void copyAdvice(turn.text)} className="mt-1 min-h-8 rounded px-2 text-xs text-cyan-100 hover:bg-white/10">复制建议</button>}
          {turn.role === "advisor" && !props.episodeWorkspace && parseAdvisorTemplatePlans(turn.text, templates).map(plan => <section key={plan.publicId} className="mt-2 space-y-2 rounded border border-cyan-300/25 p-3 text-xs">
            <h3 className="font-semibold">{templates.find(t => t.publicId === plan.publicId)?.nameZh}</h3>
            <p>{plan.reason}</p><ul>{plan.changes.map((change, i) => <li key={i}>• {change}</li>)}</ul><p>保留：{plan.preserve}</p>
            <button type="button" disabled={asking || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked} onClick={() => requestRewrite(plan)} className="rounded border border-cyan-300/40 px-2 py-1 disabled:opacity-40">生成本集完整优化稿</button>
            <button type="button" onClick={() => onRequestTrial(templates.find(t => t.publicId === plan.publicId)!)} className="ml-2 text-cyan-100">免费试写大纲对比</button>
          </section>)}
          {turn.role === "advisor" && !props.episodeWorkspace && !parseAdvisorTemplatePlans(turn.text, templates).length && !props.previsTarget && !props.worldTarget && findMentionedTemplates(turn.text, templates).map((template) => <button key={template.publicId} type="button" disabled={asking || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked} onClick={() => send(buildTemplateAdviceQuestion(template))} className="mt-2 rounded border border-cyan-300/30 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40">用「{template.storyPreview?.teaserTitleZh || template.nameZh}」生成本集优化稿</button>)}
        </div>)}
        {previsKey && (props.previsTarget || previsCandidate) && <details className="text-xs"><summary onClick={recoverPreviews} className="cursor-pointer py-2 text-cyan-100">找回本项目的独立试看</summary>{savedPreviews.map(({ key, trial }) => <button key={key} type="button" className="my-1 block rounded border border-white/20 px-2 py-2 text-left" onClick={() => { try { localStorage.setItem(`${previsKey}:trial`, trial.request.requestId); localStorage.setItem(previsKey, JSON.stringify(trial.candidate)); setAutoPrevisStart(false); setPrevisCandidate(trial.candidate); } catch { toast.error("试看恢复记录无法保存，未切换。"); } }}>{trial.candidate.patch.summaryZh} · {trial.request.spec.durationSec}秒</button>)}</details>}
        {candidateMatches && previsCandidate && <ManhuaAdvisorPrevisComparison key={JSON.stringify(previsCandidate)} candidate={previsCandidate} previewHost={props.previewHost} actionHost={previsActionHost} onCheckReady={props.onCheckPrevisReady} storageKey={previsKey ? `${previsKey}:trial` : null} autoStart={autoPrevisStart} onPreviewReady={rememberPreviewVideo} onPrepare={props.onPreparePrevis} onRevise={() => { setDraft("保留这版其他安排，我想调整："); questionRef.current?.focus(); }} disabled={asking || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked} onApply={props.onApplyPrevis} />}
        {props.worldTarget && worldCandidate && <section aria-label="3DGS场景方案" className="space-y-2 rounded-lg border border-cyan-300/30 p-3 text-xs">
          <strong>{worldCandidate.target.labelZh} · 场景方案</strong>
          <p className="whitespace-pre-wrap">{worldCandidate.plan.summaryZh}</p>
          <details><summary className="cursor-pointer py-2 text-cyan-100">查看完整生成提示词</summary><p className="whitespace-pre-wrap leading-5">{worldCandidate.plan.textPrompt}</p></details>
          {!worldMatches && <p className="text-amber-100">这份方案属于另一张图或旧版本；请重新咨询，原方案保留。</p>}
          <button type="button" disabled={!worldMatches || !props.onGenerateWorld || asking || worldGenerating || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked || Boolean(props.worldTarget.previousTaskId || props.worldTaskState)} className="min-h-11 rounded border border-cyan-300/50 px-3 disabled:opacity-40" onClick={async () => {
            if (!worldMatches || !props.onGenerateWorld || worldLock.current) return;
            worldLock.current = true; setWorldGenerating(true);
            try { await props.onGenerateWorld(worldCandidate); } catch (error) { toast.error(error instanceof Error ? error.message : "场景未提交，请保留方案后重试。"); }
            finally { worldLock.current = false; if (mounted.current) setWorldGenerating(false); }
          }}>{worldGenerating ? "提交中…" : "确认方案，生成3DGS（费用另行确认）"}</button>
          {(props.worldTarget.previousTaskId || props.worldTaskState) && <p className="text-white/65">此场景已有任务或产物，请在左侧检查原结果；不会重复提交。</p>}
        </section>}
        {asking && <div role="status" className="whitespace-pre-wrap rounded-lg border border-cyan-300/20 p-3 text-sm leading-6 text-cyan-100"><p className="mb-2 text-xs">{streamText ? "正在生成方案，完成后校验…" : retrying ? "上一次方案未通过检查，正在重新生成…" : "正在分析剧情与场景…"} 已等待 {elapsedSec} 秒</p>{streamText}<p className="mt-2 text-xs text-white/55">正在校验方案；明确要求生成试看时，通过后会直接渲染到本页预览。</p></div>}
        {pendingPaid && <div role="alert" className="rounded-lg border border-amber-300/30 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
          <p>{pendingPaid.hint}</p><p className="mt-1">原问题：{pendingPaid.request.label}（按提问时快照继续）</p><p className="mt-1 whitespace-pre-wrap text-white/75">{pendingPaid.request.rawQuestion}</p>
          {!sessionKey && <p className="mt-2 font-semibold">先确认项目后再付费咨询，避免改稿丢回执。本次不会发起扣点请求。</p>}
          <div className="mt-2 flex gap-3">{sessionKey && <button type="button" disabled={asking || sessionStorageBlocked || !pendingPaid.credits} onClick={() => void submit(pendingPaid.request, true, pendingPaid.credits)} className="rounded border border-amber-200/40 px-3 py-1">确认支付 {pendingPaid.credits ?? "待核对"} 积分并继续</button>}<button type="button" onClick={() => setPendingPaid(null)}>取消</button></div>
        </div>}
        {failed && <div role="alert" className="rounded-lg border border-rose-300/25 p-3 text-xs text-rose-100"><p>{failed.message}</p><p className="mt-1 text-white/70">原问题：{failed.request.label}</p><p className="mt-1 whitespace-pre-wrap text-white/70">{failed.request.rawQuestion}</p>{!failed.newAttempt && <p className="mt-2 text-amber-100">此请求仍未决，请先恢复原问题；草稿可以继续编辑，但不会覆盖恢复记录。</p>}<button type="button" disabled={asking || sessionStorageBlocked || (failed.confirmPaid && !sessionKey)} onClick={() => void submit(failed.newAttempt ? { ...failed.request, requestId: crypto.randomUUID() } : failed.request, failed.newAttempt ? false : failed.confirmPaid, failed.newAttempt ? undefined : failed.confirmedCredits)} className="mt-2 rounded border border-white/20 px-3 py-1">{failed.newAttempt ? "重新提问（新的一次，重新检查额度）" : "恢复原问题（沿用原请求编号）"}</button></div>}
      </div>
      <footer data-advisor-composer className="shrink-0 space-y-2 border-t border-white/10 p-3">
        <p className="text-xs text-white/65" aria-live="polite">{quotaQuery.data?.exempt ? "管理员测试 · 免扣积分" : quota ? `本作品免费剩余 ${quota.remaining}/5 次 · 超出后 ${quota.price} 积分/次` : "正在核对本作品额度…"}</p>
        {props.previsAudioControls}
        <div className="flex items-end gap-2">
          <textarea ref={questionRef} aria-label="向创作顾问提问" value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={1200} disabled={!userId || sessionStorageBlocked}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(draft); } }}
            placeholder={props.worldTarget ? "描述场景布局、时间和氛围；顾问会给出可确认的3DGS方案。" : props.previsTarget ? "描述人物走位、动作和镜头；下方点击生成白模视频试看。" : "问当前剧本、人物或镜头…"} className="min-w-0 flex-1 resize-none rounded-lg border border-white/20 bg-black/20 px-3 py-2 text-sm outline-none focus:border-cyan-300" />
          <button type="button" disabled={!userId || asking || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked || draft.trim().length < 2} onClick={() => send(draft)} className="rounded-lg bg-cyan-400 px-3 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-40">{quota && !quotaQuery.data?.exempt && quota.remaining === 0 ? `咨询 · ${quota.price} 积分（先确认）` : "发送"}</button>
        </div>
        {props.previsTarget && <div ref={setPrevisActionHost} data-advisor-previs-actions>
          {!candidateMatches && <>
            {(props.previsIssue || props.previsLaunchIssue) && <p role="alert" className="mb-1 max-h-12 overflow-y-auto text-xs text-amber-100">{props.previsIssue || props.previsLaunchIssue}</p>}
            <button type="button" disabled={!userId || asking || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked || Boolean(props.previsIssue || props.previsLaunchIssue) || props.previewHost?.dataset.clipId !== props.previsTarget?.clipId || !props.onPreparePrevis || !sessionKey} onClick={() => send(draft.trim() || "保留当前角色与剧情，生成白模视频试看。", undefined, true)} className="min-h-10 w-full rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">{asking ? "正在整理白模方案…" : "生成白模视频试看"}</button>
          </>}
        </div>}
        {(storageError || initialRewrite.error || initialRecovery.error) && <p role="alert" className="max-h-10 overflow-y-auto text-xs text-amber-100">{storageError || initialRewrite.error || initialRecovery.error}</p>}
      </footer>
    </aside>
  );
  return props.dockHost ? createPortal(panel, props.dockHost) : panel;
}
