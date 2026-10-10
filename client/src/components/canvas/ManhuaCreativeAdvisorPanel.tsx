import { advisorTemplateChoiceSchema, validateAdvisorTemplateChoice, requestsTemplateRecommendations } from "@shared/manhuaAdvisorTemplateChoice";
import { listSceneProductionBackups } from "@/lib/manhuaSceneProductionBackups";
import { buildAdvisorComparisonRequest, comparisonEpisodeIndex, requestsAdvisorComparison } from "@/lib/manhuaAdvisorComparisonRequest";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { MANHUA_ADVISOR_STUDIO_LABELS } from "@shared/manhuaAdvisorStudioContext";
import { MANHUA_ADVISOR_OPERATION_REQUEST } from "@shared/manhuaAdvisorWorkflow";
import { advisorWorkflowRevision, advisorWorkflowReceiptContext, parseAdvisorWorkflowPlan, type AdvisorWorkflowPlan } from "@/lib/manhuaAdvisorWorkflowPlan";
import type { CreativeVoiceProductionAction } from "@shared/creativeVoiceProduction";
import { ManhuaAdvisorFilmReview } from "./ManhuaAdvisorFilmReview";
import { advisorFilmReviewSchema, type AdvisorFilmReviewTarget } from "@shared/manhuaAdvisorFilmReview";
import { ManhuaAdvisorMediaEdit, type AdvisorMediaEditHandle, type AdvisorMediaWorkspace } from "./ManhuaAdvisorMediaEdit";
import { parseAdvisorMediaProposal, assertAdvisorMediaSource } from "@shared/manhuaAdvisorMediaEdit";
import type { CreativeVoiceTarget } from "@shared/creativeVoice";
import { CreativeVoicePanel } from "./CreativeVoicePanel";
import ManhuaEpisodeOptimization, { type EpisodeOptimizationWorkspace } from "./ManhuaEpisodeOptimization";
import { validateAdvisorRewriteBody, TEMPLATE_REWRITE_MARKER } from "@shared/manhuaAdvisorRewrite";
import { buildTemplateAdviceQuestion } from "@/lib/manhuaTemplateAdvice";
import { Streamdown } from "streamdown";
import { automaticAdvisorContext, automaticAdvisorRequestId, MANHUA_ADVISOR_AUTO_QUESTION, MANHUA_ADVISOR_PAID_CREDITS } from "@shared/manhuaAdvisorPolicy";
import { manhuaProjectStorage as localStorage } from "@shared/manhuaProjectScope";
import { advisorWorldTargetSchema, advisorWorldCandidateSchema, parseAdvisorWorldPlan, type AdvisorWorldTarget, type AdvisorWorldCandidate } from "@shared/manhuaAdvisorWorld";
import { advisorPrevisVideoSourceSchema, withAdvisorPrevisVideo, type AdvisorPrevisVideoSource } from "@shared/manhuaAdvisorPrevisEdit";
import { requestsAdvisorPrevisRender } from "@/lib/manhuaAdvisorPrevisIntent";
import { createPortal } from "react-dom";
import { streamManhuaAdvisor } from "@/lib/manhuaAdvisorStream";
import { advisorPrevisTrialSchema } from "@shared/manhuaAdvisorPrevisEdit";
import { advisorPrevisCandidateSchema, parseAdvisorPrevisPatch, type AdvisorPrevisCandidate, type AdvisorPrevisTarget, type AdvisorPrevisTrial, type AdvisorPrevisReceipt, prepareAdvisorPrevisComparison } from "@shared/manhuaAdvisorPrevisEdit";
import { ManhuaAdvisorPrevisComparison, type AdvisorPrevisVoiceControl } from "./ManhuaAdvisorPrevisComparison";
import { ManhuaRewriteComparison } from "./ManhuaRewriteComparison";
/** 项目顾问：读取证据、提出模板改写建议；正式稿仅经显式对比采用。 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  try { return advisorTemplateChoiceSchema.parse(JSON.parse(text)).explanation + "\n\n搭配已整理，尚未生成或替换原稿。"; } catch { /* 其他回答按原类型展示。 */ }
  try { const p = parseAdvisorMediaProposal(text); return `素材修改方案 · ${p.blockId}\n\n${p.instruction}\n\n请在图片与视频修改区查看并确认，尚未生成。`; } catch { /* ordinary answer */ }
  try { const r = advisorFilmReviewSchema.parse(JSON.parse(text)); return `${r.summary}\n\n${r.findings.map(f => `${f.atSec.toFixed(1)}–${f.endSec.toFixed(1)}秒 · ${f.category} · ${f.confidence}\n${f.observation}\n建议：${f.suggestion}`).join("\n\n")}\n\n核验范围：${r.limitations}\nGemini Flash · 影片审阅`; } catch { /* other answer */ }
  try { const value = JSON.parse(text); if (value.kind === "world_plan_v1") return value.summaryZh; } catch { /* 普通文本按原路径显示。 */ }
  try { return parseAdvisorPrevisPatch(text).summaryZh; } catch { return formatAdvisorRewriteAnswer(text); }
}

export default function ManhuaCreativeAdvisorPanel(props: {
  knowledgePanel?: ReactNode | ((prepareQuestion: (question: string) => void) => ReactNode);
  dockHost?: HTMLElement | null;
  previewHost?: HTMLElement | null;
  previsTarget?: AdvisorPrevisTarget;
  worldTarget?: AdvisorWorldTarget;
  worldTaskState?: string;
  onGenerateWorld?: (candidate: AdvisorWorldCandidate) => Promise<void | string>;
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
  workflowRevision?: string;
  project?: ReturnType<typeof buildManhuaAdvisorProject>;
  onLocate?: (issue: AdvisorIssue) => void;
  mediaWorkspace?: AdvisorMediaWorkspace;
  voiceTargets?: CreativeVoiceTarget[];
  onVoiceProduction?: (action: Exclude<CreativeVoiceProductionAction, {action:"renderPrevis" | "restoreBackup" | "prepareEpisode" | "applyEpisode" | "applyPrevis" | "retryPrevis" | "generateWorld" | "media"}>, signal: AbortSignal) => Promise<string>;
  onVoiceNavigate?: (target: CreativeVoiceTarget) => string;
  episodeWorkspace?: EpisodeOptimizationWorkspace;
  selectedTemplate?: PublicManhuaViralTemplateCard | null;
  templates: PublicManhuaViralTemplateCard[];
  onApplyRewrite?: (candidate: AdvisorRewriteCandidate) => boolean | Promise<boolean>;
  onTemplateReferences?: (episodeIndex: number, originalBody: string, plans: AdvisorTemplatePlan[]) => boolean;
  onRestoreAdvisorBackup?: (backup: AdvisorBackupEntry) => Promise<void>;
  onRequestTrial: (template: PublicManhuaViralTemplateCard) => void;
  focusSection?: "templates" | null;
  questionSeed?: { id: string; question: string; submit?: boolean } | null;
  onQuestionSeedApplied?: () => void;
}) {
  const { open, onClose, userId, confirmedProjectVersion, project, onLocate, stageZh, selectedTemplate, templates, onRequestTrial } = props;
  // Moving to another workbench dock must not remount the live voice session.
  const fallbackDock = useRef<HTMLDivElement>(null);
  const [stableDock] = useState(() => typeof document === "undefined" ? null : document.createElement("div"));
  useLayoutEffect(() => {
    const target = props.dockHost || fallbackDock.current;
    if (stableDock && target && stableDock.parentNode !== target) {
      stableDock.style.display = "contents";
      target.appendChild(stableDock);
    }
  });
  useEffect(() => () => { stableDock?.remove(); }, [stableDock]);

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
  const [liveSessionActive, setLiveSessionActive] = useState(false);
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
  const previsVoiceControl = useRef<AdvisorPrevisVoiceControl | null>(null);
  const [autoPrevisStart, setAutoPrevisStart] = useState(false);
  const [previsActionHost, setPrevisActionHost] = useState<HTMLDivElement | null>(null);
  const candidateMatches = Boolean(previsCandidate && props.previsTarget && previsCandidate.target.clipId === props.previsTarget.clipId && previsCandidate.target.specJson === props.previsTarget.specJson && JSON.stringify(previsCandidate.target.shotSource) === JSON.stringify(props.previsTarget.shotSource));
  const [savedPreviews, setSavedPreviews] = useState<Array<{ key: string; trial: AdvisorPrevisTrial }>>([]);
  useEffect(() => { setAutoPrevisStart(false); }, [props.previsTarget?.clipId, props.previsTarget?.specJson, props.previsTarget?.shotSource]);
  const rewriteKey = sessionKey ? `${sessionKey}:rewrite` : null;
  const [initialRewrite] = useState(() => {
    try { const raw = rewriteKey && localStorage.getItem(rewriteKey); return { candidate: raw ? advisorRewriteCandidateSchema.parse(JSON.parse(raw)) : null, error: "" }; }
    catch { return { candidate: null, error: "原稿对比记录无法读取。为保护旧稿，已停止新的咨询与改写；请恢复浏览器存储后刷新。" }; }
  });
  const [rewrite, setRewrite] = useState<AdvisorRewriteCandidate | null>(initialRewrite.candidate);
  const [rewriteEdit, setRewriteEdit] = useState(initialRewrite.candidate?.rewrittenBody || "");
  const [rewriteEditHook, setRewriteEditHook] = useState(initialRewrite.candidate?.endHook || "");
  const [rewriteEditError, setRewriteEditError] = useState("");
  const [comparisonOpen, setComparisonOpen] = useState(Boolean(initialRewrite.candidate));
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
    setComparisonOpen(true);
  }, [rewrite, rewriteKey]);
  function editRewrite(text: string, endHook = rewriteEditHook) {
    setRewriteEdit(text);
    setRewriteEditHook(endHook);
    try {
      if (rewriteKey && rewrite) localStorage.setItem(`${rewriteKey}:edit`, JSON.stringify({ episodeIndex: rewrite.episodeIndex, originalBody: rewrite.originalBody, generatedBody: rewrite.rewrittenBody, text, endHook }));
      setRewriteEditError("");
    } catch { setRewriteEditError("修改尚未保存，请保留页面并复制正文，恢复存储后再套用。"); }
  }
  async function applyRewrite() {
    if (!rewrite || rewriteEditError) return;
    try {
      validateAdvisorRewriteBody(rewrite.originalBody, rewriteEdit, rewriteEditHook);
      if (await props.onApplyRewrite?.({ ...rewrite, rewrittenBody: rewriteEdit, ...(rewrite.endHook ? { endHook: rewriteEditHook } : {}) })) { setComparisonOpen(false); toast.success(`已套用第 ${rewrite.episodeIndex} 集，旧稿已备份，请重新确认剧本。`); }
    } catch (error) { toast.error(error instanceof Error ? error.message : "整集优化稿尚未通过检查，原稿保留"); }
  }
  const [backups, setBackups] = useState<AdvisorBackupEntry[]>([]);
  const [backupError, setBackupError] = useState("");
  const [backupPreview, setBackupPreview] = useState<AdvisorBackupEntry | null>(null);
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
  const filmReviewKey = sessionKey ? `${sessionKey}:film-review` : null;
  const [filmResult, setFilmResult] = useState<{ target: AdvisorFilmReviewTarget; report: ReturnType<typeof advisorFilmReviewSchema.parse> } | null>(() => {
    try { const raw = filmReviewKey && localStorage.getItem(filmReviewKey); if (!raw) return null; const v = JSON.parse(raw); return { target: v.target, report: advisorFilmReviewSchema.parse(v.report) }; } catch { return null; }
  });
  const mediaWorkspaceRef = useRef(props.mediaWorkspace); mediaWorkspaceRef.current = props.mediaWorkspace;
  const mediaEditRef = useRef<AdvisorMediaEditHandle>(null);
  const voiceReplies = useRef(new Map<string, (answer: string | undefined) => void>());
  function finishVoiceReply(id: string, answer?: string) { const resolve = voiceReplies.current.get(id); voiceReplies.current.delete(id); resolve?.(answer); }
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
    return () => { mounted.current = false; for (const id of Array.from(voiceReplies.current.keys())) finishVoiceReply(id, "作品或页面已切换，语音请求结束；原顾问恢复记录保留。"); };
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

  const operationKey = sessionKey ? `${sessionKey}:operation` : null;
  const operationSource = advisorWorkflowRevision({ project: props.project?.context, version: confirmedProjectVersion, workflowRevision:props.workflowRevision, userId, projectId: props.projectId });
  const [operationPlan, setOperationPlan] = useState<{ plan: AdvisorWorkflowPlan; source: string; result?: string; executionId?:string; startedAt?:string } | null>(null);
  const activeOperationKey=useRef(operationKey);activeOperationKey.current=operationKey;
  const activeOperationSource=useRef(operationSource);activeOperationSource.current=operationSource;
  const productionLock=useRef(false);
  const [operationBusy, setOperationBusy] = useState(false);
  const operationLock = useRef(false);
  useEffect(() => {
    setOperationPlan(null);
    if (!operationKey) return;
    try {
      const raw = localStorage.getItem(operationKey);
      if (raw) { const entry = JSON.parse(raw); if(entry.executionId && !entry.result)entry.result="上次已开始执行但回执未保存；请读取原任务与原面板，不再次提交同一步。"; setOperationPlan({ ...entry, plan: parseAdvisorWorkflowPlan(JSON.stringify(entry.plan)) }); }
    } catch { toast.error("原操作方案无法读取，未覆盖记录。"); }
  }, [operationKey]);
  async function requestWorkflowOperation() {
    if (operationLock.current || asking || pendingPaid || unresolvedFailed || !operationKey) return;
    operationLock.current = true; setOperationBusy(true);
    try {
      const capturedSource=operationSource;
      const question = draft.trim();
      if (question.length < 2) throw new Error("请先说明要操作哪个流程。");
      const inventory = await executeProductionAction({ action: "inspect" }, new AbortController().signal);
      const workspace = JSON.stringify({ activeStudio: project?.context.activeStudio, currentInventory: JSON.parse(inventory), ...(operationPlan?.result ? { previousOperation: { action: operationPlan.plan.action, result: advisorWorkflowReceiptContext(operationPlan.result), matchesCurrentSource: operationPlan.source === capturedSource, note: "历史回执仅供识别原任务；目标、版本和在途状态须按当前清单与原入口核对" } } : {}) });
      if(capturedSource!==activeOperationSource.current)throw new Error("作品已变化，未提交旧工作区的操作方案");
      if (!send(`${MANHUA_ADVISOR_OPERATION_REQUEST}${question}`, undefined, false, undefined, undefined, undefined, undefined, {workspace,revision:props.workflowRevision || "legacy-workspace"})) throw new Error("顾问请求未提交，请查看当前任务或提示。");
    } catch (error) { toast.error(error instanceof Error ? error.message : "未准备操作"); }
    finally { operationLock.current = false; setOperationBusy(false); }
  }
  async function applyWorkflowOperation() {
    if (!operationPlan || operationPlan.result || operationPlan.executionId || !operationKey || operationLock.current || asking || pendingPaid || unresolvedFailed) return;
    if (operationPlan.source !== operationSource) { toast.error("作品或正文已变化，请重新准备操作方案，未执行旧方案。"); return; }
    if (!window.confirm(`执行这一步工作流操作？\n${operationPlan.plan.summaryZh}\n付费生成仍会按原入口确认费用。`)) return;
    operationLock.current = true; setOperationBusy(true);
    const capturedKey=operationKey;
    const started={...operationPlan,executionId:crypto.randomUUID(),startedAt:new Date().toISOString()};
    try {
      const saved=JSON.stringify(started);localStorage.setItem(capturedKey,saved);
      localStorage.setItem(`${capturedKey}:execution:${started.executionId}`,saved);
      if(localStorage.getItem(capturedKey)!==saved)throw new Error("操作开始记录未可靠保存，未执行");
      setOperationPlan(started);
      const result = await executeProductionAction(started.plan.action, new AbortController().signal);
      const next = { ...started, result };
      localStorage.setItem(capturedKey, JSON.stringify(next));
      localStorage.setItem(`${capturedKey}:execution:${started.executionId}`,JSON.stringify(next));
      if(activeOperationKey.current===capturedKey)setOperationPlan(next);
    } catch (error) {
      const message=error instanceof Error ? error.message : "操作回执未确认，请查看原任务。";
      try {const failed=JSON.stringify({...started,result:message});localStorage.setItem(capturedKey,failed);localStorage.setItem(`${capturedKey}:execution:${started.executionId}`,failed);}catch{}
      if(activeOperationKey.current===capturedKey)setOperationPlan({...started,result:message});
      toast.error(message);
    }
    finally { operationLock.current = false; setOperationBusy(false); }
  }

  async function submit(request: PendingQuestion, confirmPaid: boolean, confirmedCredits?: number) {
    let voiceWaitingForPayment = false; let voiceAnswer: string | undefined;
    if (inFlight.current || !userId || sessionStorageBlocked) { finishVoiceReply(request.requestId); return; }
    if (!request.manhuaContext) { toast.error("请先选择漫剧项目，再向创作顾问提问；本次未调用模型。"); finishVoiceReply(request.requestId); return; }
    const recovering = initialRecovery.value?.request.requestId === request.requestId || (failed?.newAttempt !== true && failed?.request.requestId === request.requestId);
    if ((!quotaQuery.data || quotaQuery.isError) && !recovering) { toast.error("暂时无法核对本作品额度，本次未提交、未扣费。请刷新额度后重试。"); finishVoiceReply(request.requestId); return; }
    const capturedOperationKey = operationKey;
    const capturedOperationSource = operationSource;
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
      finishVoiceReply(request.requestId); return;
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
      if (request.rawQuestion.startsWith(MANHUA_ADVISOR_OPERATION_REQUEST)) {
        try {
          const entry = { plan: parseAdvisorWorkflowPlan(answer), source: request.manhuaContext?.workflowOperation?.revision === props.workflowRevision ? capturedOperationSource : `stale:${request.manhuaContext?.workflowOperation?.revision || "unknown"}` };
          if (!capturedOperationKey) throw new Error("当前作品没有操作方案保存位置，未执行。");
          const json = JSON.stringify(entry); localStorage.setItem(capturedOperationKey, json);
          if (localStorage.getItem(capturedOperationKey) !== json) throw new Error("操作方案未完整保存，未执行。");
          if (mounted.current && activeOperationKey.current===capturedOperationKey && activeOperationSource.current===capturedOperationSource) setOperationPlan(entry);
        } catch (error) { if (mounted.current) toast.message(error instanceof Error ? error.message : "操作方案未通过检查，作品未改。"); }
      }
      if (request.manhuaContext?.filmReview) {
        const value = { target: request.manhuaContext.filmReview, report: advisorFilmReviewSchema.parse(JSON.parse(answer)) };
        if (filmReviewKey) localStorage.setItem(filmReviewKey, JSON.stringify(value));
        if (mounted.current) setFilmResult(value);
      }
      if (request.rawQuestion.startsWith("【素材修改】") && mounted.current) {
        try {
          const proposal = parseAdvisorMediaProposal(answer), source = request.manhuaContext?.mediaEditTarget;
          if (!source || proposal.blockId !== source.blockId || proposal.kind !== source.kind) throw new Error("顾问返回的目标与原请求不一致，未准备修改");
          assertAdvisorMediaSource({ ...proposal, source }, mediaWorkspaceRef.current?.sources || []);
          mediaEditRef.current?.propose(proposal);
        }
        catch (e) { toast.error(e instanceof Error ? e.message : "修改方案未通过检查，原素材保留"); }
      }
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
        if (mounted.current) { setPrevisCandidate(candidate); setAutoPrevisStart(!request.voiceConsultOnly && activePrevisTarget.current?.clipId === candidate.target.clipId && activePrevisTarget.current.specJson === candidate.target.specJson && (request.previsRenderRequested === true || requestsAdvisorPrevisRender(request.rawQuestion))); }
      }
      let choiceRaw: unknown;
      try { choiceRaw = JSON.parse(answer); } catch { /* 普通咨询。 */ }
      if ((choiceRaw as {kind?: string})?.kind === "template-choice") {
        const choice = validateAdvisorTemplateChoice(choiceRaw, templates, request.manhuaContext?.templateChoiceIds || []);
        const episode = props.episodeWorkspace?.episodes.find(ep => ep.index === request.manhuaContext?.episodeIndex);
        const plans = episode?.templateReferences;
        if (!plans || !props.onTemplateReferences || !request.manhuaContext || plans.some(plan => !request.manhuaContext!.templateChoiceIds?.includes(plan.publicId))) throw new Error("推荐内容已变化，请重新核对搭配；原稿保留");
        const chosen = new Map(choice.choices.map(item => [item.publicId, item.features]));
        const next = plans.map(plan => ({ ...plan, selected: chosen.has(plan.publicId), selectedFeatures: chosen.get(plan.publicId) || [] }));
        if (!props.onTemplateReferences(request.manhuaContext.episodeIndex, request.manhuaContext.episodeBody, next)) throw new Error("搭配暂未保存，原回答保留，请取回本次结果");
      }
      if (request.rawQuestion === TEMPLATE_PLAN_QUESTION || request.manhuaContext?.templateRecommendation) {
        const plans = parseAdvisorTemplatePlans(answer, templates);
        if (!plans.length) {
          if (mounted.current) toast.error("本次回答未提供3—5个合法模板方案；原回答已保留供查看。");
        } else if (props.onTemplateReferences && !props.onTemplateReferences(request.manhuaContext.episodeIndex, request.manhuaContext.episodeBody, plans)) {
          throw new Error("模板方案已返回，但本集参考记录未能保存；原回答和操作编号保留。");
        }
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
      voiceAnswer = answer; return answer;
    } catch (error) {
      const message = error instanceof Error ? error.message : "顾问暂时无法回答，请稍后重试。";
      voiceAnswer = `本次未完成。实际错误：${formatManhuaAdvisorError(message)}。不得猜测其他失败原因，不要自动重试。`;
      if (!mounted.current) return;
      if (/已用完|PAYMENT_REQUIRED|扣除.*积分/.test(message) && !/不足/.test(message)) {
        voiceWaitingForPayment = true;
        setPendingPaid({ request, credits: Number(message.match(/扣除\s*(\d+)\s*积分/)?.[1]) || undefined, hint: message.replace(/\b(?:Sol|Terra)\b/g, "").replace(/（成本\+60%）/g, "") });
      } else setFailed({ request, confirmPaid, confirmedCredits, message: formatManhuaAdvisorError(message), newAttempt: /ADVISOR_OPERATION_(?:FAILED|MISMATCH)/.test(message) });
    } finally { if (!voiceWaitingForPayment) finishVoiceReply(request.requestId, voiceAnswer); inFlight.current = false; if (mounted.current) { setStreamPending(false); setStreamText(""); } }
  }

  function send(rawQuestion: string, wrappedQuestion?: string, renderRequested = false, episode?: EpisodeOptimizationWorkspace["episodes"][number], voiceReply?: (answer: string | undefined) => void, filmReview?: AdvisorFilmReviewTarget, worldOverride?: AdvisorWorldTarget, workflowOperation?: {workspace:string;revision:string}) {
    if (inFlight.current || pendingPaid || unresolvedFailed || !userId || sessionStorageBlocked) return;
    let question = rawQuestion.trim();
    if (!/^【/.test(question) && !renderRequested && !filmReview && !worldOverride && !workflowOperation && requestsAdvisorComparison(question)) {
      try {
        const index = comparisonEpisodeIndex(question, project?.context.episodeIndex || 0);
        episode = props.episodeWorkspace?.episodes.find(e => e.index === index);
        if (!episode && index !== project?.context.episodeIndex) throw new Error("目标集完整正文未打开，未提交比较稿。");
        question = buildAdvisorComparisonRequest(question, templates, selectedTemplate);
        if (episode) props.episodeWorkspace?.onFocusEpisode(index);
      } catch (error) { toast.error(error instanceof Error ? error.message : "无法准备比较稿"); return; }
    }
    if (question.length < 2 || question.length > 1200) { toast.error("请输入 2—1200 字的问题，内容不会被自动截断。"); return; }
    const rewriting = question.startsWith(TEMPLATE_REWRITE_MARKER);
    const choiceIds = props.episodeWorkspace?.episodes.find(ep => ep.index === (episode?.index || project?.context.episodeIndex))?.templateReferences?.map(plan => plan.publicId);
    const templateRecommendation = requestsTemplateRecommendations(question);
    const templateDiscussion = templateRecommendation || question === TEMPLATE_PLAN_QUESTION || /模板|亮点|混搭|混合|搭配|主推荐|备选/.test(question) || Boolean(choiceIds?.length && /选|選|就用|我要|喜欢|喜歡|结合|結合/.test(question));
    const rewriteBody = episode?.body ?? project?.context.episodeBody;
    if (rewriting && (!rewriteBody?.trim() || (!episode && project?.contextNotes.some(note => note.includes("本集正文"))))) {
      toast.error("当前集正文为空或已节选，不能生成完整优化稿，请先打开完整本集。"); return;
    }
    const operationRequest = question.startsWith(MANHUA_ADVISOR_OPERATION_REQUEST);
    const mediaRequest = Boolean(props.mediaWorkspace && question.startsWith("【素材修改】"));
    const mediaEditTarget = mediaRequest ? props.mediaWorkspace?.sources.find(s => question.includes(s.blockId)) : undefined;
    if (mediaRequest && (!mediaEditTarget || !project)) { toast.error("请先选择本作品的素材，未提交咨询"); return; }
    if (props.previsIssue && !templateDiscussion && !rewriting && !mediaRequest && !filmReview && !worldOverride && !operationRequest) { toast.error(props.previsIssue); return; }
    let previsEdit = props.previsTarget && !templateDiscussion && !rewriting && !mediaRequest && !filmReview && !worldOverride && !operationRequest ? withAdvisorPrevisVideo(props.previsTarget, previewVideoSource) : undefined;
    if (previsEdit && !previsEdit.previousPreviewRequestId && previsCandidate?.target.clipId === previsEdit.clipId && previsCandidate.target.specJson === previsEdit.specJson) {
      try { previsEdit = { ...previsEdit, previousPreviewSpecJson: prepareAdvisorPrevisComparison(previsCandidate).afterContextJson }; } catch { /* 未支持要求不继承为已执行配置。 */ }
    }
    let questionContext = project?.context;
    if (episode && questionContext) questionContext = {...questionContext,episodeIndex:episode.index,episodeTitle:episode.title,episodeBody:episode.body,episodeEndHook:episode.endHook||"",activeStudio:questionContext.activeStudio?.episodeIndex===episode.index?questionContext.activeStudio:undefined};
    try {
      if (project && questionContext) questionContext = resolveAdvisorVideoPromptContext({ context: questionContext, question, drafts: project.videoPromptDrafts, selectedSegmentIndex: project.selectedSegmentIndex });
    } catch (error) { toast.error(error instanceof Error ? error.message : "无法读取本段提示词"); return; }
    const result = questionContext ? manhuaCreativeAdvisorContextSchema.safeParse({ ...questionContext, ...(props.projectId ? { projectId: props.projectId } : {}), history: advisorRecentHistory(turns), ...(templateRecommendation ? {templateRecommendation:true} : {}), ...(choiceIds?.length ? { templateChoiceIds: choiceIds } : {}), ...(workflowOperation?{workflowOperation}:{}), ...(previsEdit ? { previsEdit } : {}), ...(!templateDiscussion && !operationRequest && !rewriting && !filmReview && !mediaRequest && props.studio3d ? { studio3d: { directionCardId: props.studio3d.directionCardId, directionCardVersion: props.studio3d.directionCardVersion } } : {}), ...(!templateDiscussion && !operationRequest && !rewriting && !filmReview && !mediaRequest && (worldOverride || props.worldTarget) ? { worldTarget: worldOverride || props.worldTarget } : {}), ...(filmReview ? { filmReview } : {}), ...(mediaEditTarget ? { mediaEditTarget } : {}) }) : null;
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
      ...(((voiceReply && !renderRequested) || operationRequest || mediaRequest || filmReview) ? { voiceConsultOnly: true } : {}),
      ...(props.previsTarget && renderRequested ? { previsRenderRequested: true } : {}),
      rawQuestion: question,
      question: operationRequest ? question : mediaRequest ? `根据用户要求整理素材修改指令，不声称看过没有收到的图片或视频。只返回JSON对象，不写Markdown：{"kind":"image或video","blockId":"真实素材编号","instruction":"完整的修改要求"}。只可选以下素材，图片指令最多2000字，视频240字。保留未要求改变的内容。不得生成或声称完成。\n素材：${JSON.stringify(props.mediaWorkspace!.sources.filter(source => question.includes(source.blockId)).map(({blockId,kind,label})=>({blockId,kind,label})))}\n用户：${question}` : wrappedQuestion || buildAdvisorQuestion({
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
    if (voiceReply) voiceReplies.current.set(request.requestId, voiceReply);
    return submit(request, false);
  }

  function recommendTemplates() {
    if (!project?.context.episodeBody.trim()) { toast.error("请先填写当前集故事正文。"); return; }
    try { send(TEMPLATE_PLAN_QUESTION, buildTemplatePlanQuestion(templates)); }
    catch (error) { toast.error(error instanceof Error ? error.message : "模板暂不可用"); }
  }

  function requestRewrite(plan: AdvisorTemplatePlan) {
    const body = project?.context.episodeBody || "";
    if (!body.trim() || project?.contextNotes.some(note => note.includes("本集正文"))) {
      toast.error("当前集正文为空或已节选，不能安全改写完整正文。请先拆分当前集。"); return;
    }
    const question = buildTemplateRewriteQuestion(plan);
    if (question.length > 3900) { toast.error("方案过长，请先精简方案后再改写。"); return; }
    send(`${TEMPLATE_REWRITE_QUESTION} 模板编号 ${plan.publicId}`, question);
  }

  const backupReadScope = JSON.stringify({userId, confirmedProjectVersion, context: project?.context});
  const latestBackupReadScope = useRef(backupReadScope); latestBackupReadScope.current = backupReadScope;
  async function refreshBackups() {
    if (!userId || !project) return;
    const scopeKey = backupReadScope;
    try {
      const scope = {userId, confirmedProjectVersion, seriesTitle: project.context.seriesTitle,
        episodeIndex: project.context.episodeIndex, body: project.context.episodeBody,
        originalBody: rewrite?.episodeIndex === project.context.episodeIndex ? rewrite.originalBody : undefined};
      const result = listAdvisorBackups(localStorage, scope);
      let sceneEntries: AdvisorBackupEntry[] = [], sceneError = false;
      try { sceneEntries = await listSceneProductionBackups(scope); } catch { sceneError = true; }
      if (!mounted.current || latestBackupReadScope.current !== scopeKey) return;
      const entries = [...result.entries, ...sceneEntries].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
      setBackups(entries);
      setBackupError(sceneError ? "场景制作备份暂无法读取；旧稿备份仍保留。" : result.errors ? `${result.errors}条本账户备份无法解析，原记录未改动。` : entries.length ? "" : "没有找到与当前项目版本或原稿匹配的备份。");
    } catch { if (mounted.current && latestBackupReadScope.current === scopeKey) setBackupError("本机备份暂无法读取，原记录未改动。"); }
  }

  const executeProductionActionInternal = async (action: CreativeVoiceProductionAction, signal: AbortSignal) => {
          if (signal.aborted) throw new Error("语音已结束，未提交");
          if (action.action === "media") {
            if (!mediaEditRef.current) throw new Error("请打开当前作品的素材修改区。");
            return mediaEditRef.current.execute(action.operation);
          }
          if (action.action === "retryPrevis") {
            if (!previsVoiceControl.current) throw new Error("当前没有白模试看，请先打开原片段。");
            return previsVoiceControl.current.retry();
          }
          if (action.action === "generateWorld") {
            if (!worldCandidate || !worldMatches || !props.onGenerateWorld || worldLock.current || props.worldTaskState || props.worldTarget?.previousTaskId) throw new Error("当前没有可提交的3DGS方案，或已有任务；请检查原方案与任务，未重复生成。");
            worldLock.current=true;setWorldGenerating(true);
            try { const receipt = await props.onGenerateWorld(worldCandidate); return receipt || "未取得3DGS任务回执，请检查场景卡；不能声称已提交或完成，不自动重试。"; }
            finally {worldLock.current=false;if(mounted.current)setWorldGenerating(false);}
          }
          if (action.action === "applyPrevis") return previsVoiceControl.current ? previsVoiceControl.current.apply() : "当前没有可应用的白模试看，请先生成并观看。";
          if (action.action === "prepareEpisode") {
            const episode = props.episodeWorkspace?.episodes.find(e => e.index === action.episode)
              || (project?.context.episodeIndex === action.episode ? {index:action.episode,title:project.context.episodeTitle,body:project.context.episodeBody,endHook:project.context.episodeEndHook || ""} : undefined);
            if (!episode || !props.onApplyRewrite) throw new Error("当前作品没有这集的完整正文或套用入口，未提交改稿。");
            if (inFlight.current || pendingPaid || unresolvedFailed || sessionStorageBlocked) throw new Error("原顾问任务尚未结束，请查询原任务，不重复改稿。");
            props.episodeWorkspace?.onFocusEpisode(action.episode);
            return new Promise<string>(resolve => {
              let done = false;
              const reply = (answer?: string) => {
                if (done) return; done = true; signal.removeEventListener("abort", abort);
                for (const [id, cb] of Array.from(voiceReplies.current)) if (cb === reply) voiceReplies.current.delete(id);
                try {
                  if (!answer) throw new Error("没有收到完整优化稿，请查看原顾问任务，不重复提交。");
                  const candidate = parseAdvisorRewrite(answer, episode.index, episode.body, episode.endHook || "");
                  // The submit path must have persisted this exact candidate before reporting it usable.
                  const saved = sessionKey ? localStorage.getItem(`${sessionKey}:rewrite`) : null;
                  if (!saved || JSON.stringify(JSON.parse(saved)) !== JSON.stringify(candidate)) throw new Error("优化稿尚未可靠保存，请查看顾问恢复入口；不能套用或声称已修改。");
                  resolve(JSON.stringify({episode:episode.index,status:"candidate_ready",changes:candidate.changes,instruction:"完整候选已保存在原稿/新稿对照浮窗，差异已高亮，正文未修改。请用户先审阅，确认后调用applyEpisode；成功回执前不得声称已保存正文。"}));
                } catch (error) { resolve(error instanceof Error ? error.message : "候选未通过检查，原稿保留。"); }
              };
              const abort = () => reply("语音已结束，已提交任务在原顾问保留，请查询原任务。");
              signal.addEventListener("abort", abort, {once:true});
              try {
                const question = buildAdvisorComparisonRequest(action.question, templates, selectedTemplate);
                if (!send(question, undefined, false, episode, reply)) reply();
              } catch (error) { reply(error instanceof Error ? error.message : "比较稿准备失败，未提交。"); }
            });
          }
          if (action.action === "restoreBackup") {
            if (!userId || !project) throw new Error("没有当前作品，未还原。");
            const result = listAdvisorBackups(localStorage, {userId, confirmedProjectVersion, seriesTitle: project.context.seriesTitle, episodeIndex: project.context.episodeIndex, body: project.context.episodeBody, originalBody: rewrite?.originalBody});
            setBackups(result.entries); setBackupPreview(result.entries[0] || null);
            if (!result.entries.length) return "未找到当前作品可核实的改前版本，未还原。";
            return "已展示改前版本完整内容。请用户核对并点击确认还原；当前正文尚未修改，还原前会备份现状。";
          }
          if (action.action === "applyEpisode") {
            if (!rewrite || rewrite.episodeIndex !== action.episode || rewriteEditError || !props.onApplyRewrite) throw new Error("当前没有这集的可应用优化稿，请先调用顾问准备整集修改候选。");
            validateAdvisorRewriteBody(rewrite.originalBody, rewriteEdit, rewriteEditHook);
            if (!window.confirm(`将对照浮窗中的优化稿应用到第${action.episode}集？旧稿会先备份。`)) return "用户取消，未改正文。";
            return await props.onApplyRewrite({...rewrite,rewrittenBody:rewriteEdit,...(rewrite.endHook ? {endHook:rewriteEditHook} : {})}) ? `第${action.episode}集优化稿已写回，旧稿已备份，请重新确认剧本。` : "应用被工作区阻止，原稿保留，请查看提示。";
          }
          if (action.action === "world" && action.question) {
            const worldQuestion = action.question;
            if (!props.onVoiceProduction || signal.aborted) throw new Error("当前不能准备场景方案");
            const selection = JSON.parse(await props.onVoiceProduction(action, signal));
            const target = advisorWorldTargetSchema.parse(selection.worldTarget);
            if (target.sceneRefId !== action.assetId || signal.aborted) throw new Error("场景已变化，未咨询或生成");
            return new Promise<string>(resolve => {
              let done=false;
              const reply=(answer?:string)=>{if(done)return;done=true;signal.removeEventListener("abort",abort);for(const [id,cb] of Array.from(voiceReplies.current))if(cb===reply)voiceReplies.current.delete(id);
                resolve(answer ? answer+"\n只有通过结构检查的方案才显示在3DGS场景方案卡。尚未生成世界，用户确认后才能generateWorld。" : "未取得可执行场景方案，请查看原请求；尚未生成世界。");};
              const abort=()=>reply();signal.addEventListener("abort",abort,{once:true});
              if(!send(worldQuestion,undefined,false,undefined,reply,undefined,target))reply();
            });
          }
          if (action.action !== "renderPrevis") {
            if (!props.onVoiceProduction) throw new Error("当前工作区没有制作入口");
            const result = await props.onVoiceProduction(action, signal);
            return action.action === "inspect" ? JSON.stringify({production:JSON.parse(result),previs:previsVoiceControl.current?.inspect() || null,rewrite:rewrite ? {episode:rewrite.episodeIndex,ready:!rewriteEditError} : null}) : result;
          }
          if (!props.previsTarget || props.previsIssue || props.previsLaunchIssue || props.previewHost?.dataset.clipId !== props.previsTarget.clipId || !props.onPreparePrevis) throw new Error(props.previsIssue || props.previsLaunchIssue || "请先打开指定片段的白模页面；未开始渲染。");
          if (!window.confirm("按这段描述调用创作顾问并渲染独立白模试看？顾问沿用本作品次数，超额另行确认积分；Blender渲染使用服务器算力。原配置保留，满意后再应用。\n\n" + action.question)) return "用户取消，未咨询或渲染。";
          return new Promise<string>(resolve => {
            let done = false;
            const reply = (answer?: string) => { if (done) return; done = true; signal.removeEventListener("abort", abort); for (const [id,cb] of Array.from(voiceReplies.current)) if (cb === reply) voiceReplies.current.delete(id); resolve(answer ? `${readableAdvice(answer)}\n方案已返回；有效方案交给本页Blender试看入口提交。视频是否完成以本页任务编号、状态和播放器为准，不能把方案当成已生成视频。` : "未取得可执行方案，请查看原顾问请求，不重试。"); };
            const abort = () => reply("语音已结束，已提交任务请在原工作区查询，不重复提交。");
            signal.addEventListener("abort", abort, {once:true});
            if (!send(action.question, undefined, true, undefined, reply)) reply();
          });
        };

  const executeProductionAction=async(action:CreativeVoiceProductionAction,signal:AbortSignal):Promise<string>=>{
    const readOnly=action.action==="inspect" || ("operation" in action && action.operation==="inspect");
    if(!readOnly && productionLock.current)throw new Error("顾问上一项操作尚未返回，请查原回执");
    const capturedSource=activeOperationSource.current;
    signal.throwIfAborted();
    if(!readOnly)productionLock.current=true;
    try {
      if(capturedSource!==activeOperationSource.current)throw new Error("工作区已变化，未操作");
      return await executeProductionActionInternal(action,signal);
    } finally {if(!readOnly)productionLock.current=false;}
  };

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
    if (liveSessionActive || !props.automaticMonitoring || !userId || !autoSnapshot || draft.trim() || creationMode || asking || pendingPaid || failed || sessionStorageBlocked || !quotaQuery.data || quotaQuery.isError) return;
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
  }, [autoSnapshot, props.automaticMonitoring, liveSessionActive, userId, draft, creationMode, asking, pendingPaid, failed, sessionStorageBlocked, quotaQuery.data, quotaQuery.isError, turns]);

  if (!open && !(previsCandidate && props.previewHost)) return null;
  const currentStage = project?.context.activeStudio ? MANHUA_ADVISOR_STUDIO_LABELS[project.context.activeStudio.tool] : project ? MANHUA_ADVISOR_STAGE_LABELS[project.context.stage] : stageZh || "创作咨询";
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
        <button type="button" onClick={onClose} className="min-h-10 shrink-0 whitespace-nowrap rounded-md px-3 text-xs text-white/70 hover:bg-white/10 focus-visible:outline-cyan-300">收起</button>
      </header>
      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {(props.previsTarget || props.previsIssue) && <section aria-label="白模生成步骤" className="space-y-2 rounded-lg border border-cyan-300/25 p-3 text-xs text-cyan-100">
          <strong>{props.previsLabel || "当前片段"} · 白模视频试看</strong>
          <ol className="space-y-1"><li>1. 在下方描述人物走位、动作或镜头要求。</li><li>2. 点击「生成白模视频试看」，默认先看无声动作。</li><li>3. 视频在本页显示，逐帧与常速检查动作、人数和运镜。</li><li>4. 满意后才应用；需要声音时绑定本段音轨，再勾选带上对白与BGM。</li></ol>
          {(props.previsIssue || props.previsLaunchIssue) && <p role="status" className="text-amber-100">{props.previsIssue || props.previsLaunchIssue}</p>}
          <button type="button" className="underline" onClick={props.onLeavePrevis}>返回普通咨询</button>
        </section>}
        {typeof props.knowledgePanel === "function" ? props.knowledgePanel(question => {
          if (draft.length + question.length + 2 > 1200) { toast.error("当前草稿较长，请先发送或整理后再添加资料问题"); return; }
          setDraft(previous => previous.trim() ? `${previous}\n\n${question}` : question);
          questionRef.current?.focus();
        }) : props.knowledgePanel}
        <details className="rounded-lg border border-white/10 p-2 text-xs"><summary className="cursor-pointer text-white/65">咨询额度与快捷提问</summary>
        <button type="button" disabled={!userId || !project || asking || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked} onClick={() => { setDraft("请结合当前剧情、已更新模板库、导演包与镜头规格，提出剧情、美术与特效整合方案：角色欲望、阻力、代价和反转形成因果，设计独特且服务剧情的视觉记忆点；明确妆发服装材质、场景尺度与空间层次、真实光源和气氛变化；特效分清生成主体与后期增强，不能以叠光冒充法相或电影级场景。逐镜写明一位小数秒窗、摄影机起终位置、移动方向、FOV/景别、焦点与光源变化；说明氛围随事件怎样变化，以及各角色的意图、喜怒哀乐、眼神/微表情、身体和听者反应。区分白模已表达和正式影片还需补充的技巧。保留人物、动作和已确认音轨，只给建议，不生成、重渲染或自动采用。"); questionRef.current?.focus(); }} className="mb-2 rounded-md border border-cyan-300/30 px-3 py-2 text-xs text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-40">优化摄影、氛围与表演</button>
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
        {!creationMode && props.episodeWorkspace && <section ref={templateSectionRef}><ManhuaEpisodeOptimization key={`${userId}:${props.projectId}`} {...props.episodeWorkspace} userId={userId} projectId={props.projectId} focusEpisode={project?.context.episodeIndex||1} templates={templates} plans={props.episodeWorkspace.episodes.find(ep=>ep.index===(project?.context.episodeIndex||1))?.templateReferences || []} asking={asking||Boolean(pendingPaid)||unresolvedFailed||sessionStorageBlocked} onRecommend={async episodes=>{
          for (const episode of episodes) {
            const answer = await send(TEMPLATE_PLAN_QUESTION,buildTemplatePlanQuestion(templates)+`\n只根据第${episode.index}集完整剧情与对白，给一个主推荐和另外三个不同模板的亮点，说明适合本集的地方；不改稿、不重列分段技术表。`,false,episode);
            if (!answer || !parseAdvisorTemplatePlans(answer,templates).length) break;
          }
        }}/></section>}
        {!creationMode && !props.episodeWorkspace && <section ref={templateSectionRef} aria-label="剧本模板优化" className="rounded-lg border border-cyan-300/20 p-3 text-xs">
          <h3 className="font-semibold">用模板优化当前整集</h3>
          <p className="mt-2 text-white/65">生成完整优化稿 → 对比并编辑 → 套用本集。沿用顾问额度，超额先确认；套用已生成稿不再收费。</p>
          {selectedTemplate && <button type="button" disabled={!userId || !project || asking || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked} onClick={() => send(buildTemplateAdviceQuestion(selectedTemplate))} className="mt-2 rounded bg-emerald-500/20 px-3 py-2 font-semibold text-emerald-100 disabled:opacity-40">用「{selectedTemplate.storyPreview?.teaserTitleZh || selectedTemplate.nameZh}」优化本集</button>}
          <button type="button" disabled={!userId || !project || asking || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked} onClick={recommendTemplates} className="mt-2 rounded border border-cyan-300/30 px-3 py-2 disabled:opacity-40">推荐一种思路，再看看其他三种</button>
        </section>}
        {rewrite && <section aria-label="比较稿入口" className="space-y-2 rounded-lg border border-emerald-300/30 p-3 text-xs">
          <h3 className="font-semibold">第 {rewrite.episodeIndex} 集 · 比较稿已保留</h3>
          <p className="text-white/65">原稿与新稿独立保存，打开浮窗查看差异并继续编辑。</p>
          <button type="button" onClick={() => setComparisonOpen(true)} className="rounded bg-emerald-500/20 px-3 py-2 text-emerald-100">打开原稿 / 新稿对照</button>
          <Dialog open={comparisonOpen && open} onOpenChange={setComparisonOpen}>
            <DialogContent aria-label="改写原稿对比" showCloseButton={false} overlayClassName="z-[110]" className="z-[111] flex max-h-[92dvh] w-[96vw] max-w-[1440px] flex-col gap-3 border-white/20 bg-slate-950 p-4 text-white sm:max-w-[1440px] sm:p-6">
              <div className="flex shrink-0 items-start justify-between gap-4">
                <div><DialogTitle>第 {rewrite.episodeIndex} 集 · 原稿 / 新稿对照</DialogTitle><DialogDescription className="mt-2 text-white/65">红色显示原稿删改，绿色显示新稿新增。新稿仅作比较，确认填入才修改本集。</DialogDescription></div>
                <DialogClose className="shrink-0 rounded border border-white/25 px-3 py-2 text-sm">关闭对照</DialogClose>
              </div>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                <ManhuaRewriteComparison before={rewrite.originalBody} after={rewriteEdit} afterLabel="新稿" />
                {rewrite.endHook && <section aria-label="片尾钩子差异"><h4 className="mb-2 text-sm font-semibold">片尾钩子</h4><ManhuaRewriteComparison before={rewrite.originalEndHook || ""} after={rewriteEditHook} afterLabel="新钩子" /></section>}
                <details><summary className="cursor-pointer text-sm">本次具体改动 · {rewrite.changes.length} 项</summary><ul className="mt-2 space-y-1 text-sm text-white/75">{rewrite.changes.map((change, i) => <li key={i}>• {change}</li>)}</ul></details>
                <details><summary className="cursor-pointer text-sm">继续编辑新稿</summary>
                  <label className="mt-3 block text-sm">新稿 · 待你确认<textarea aria-label="优化后整集正文" value={rewriteEdit} onChange={e => editRewrite(e.target.value)} rows={12} className="mt-2 w-full rounded border border-white/20 bg-black/20 p-3 text-sm leading-7" /></label>
                  {rewrite.endHook && <label className="mt-3 block text-sm">片尾钩子<textarea aria-label="优化后片尾钩子" value={rewriteEditHook} onChange={e => editRewrite(rewriteEdit, e.target.value)} rows={3} className="mt-2 w-full rounded border border-white/20 bg-black/20 p-3 leading-6" /></label>}
                </details>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/15 pt-3">
                <p className="max-w-3xl text-xs text-white/65">仅替换本集正文与片尾钩子，旧稿先备份。本集及后续制作需重新确认，旧图与成片归档保留。</p>
                <button type="button" disabled={!props.onApplyRewrite || asking || Boolean(rewriteEditError) || project?.context.episodeIndex !== rewrite.episodeIndex || project?.context.episodeBody !== rewrite.originalBody} onClick={applyRewrite} className="rounded bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">可以，填入本集</button>
              </div>
              {rewriteEditError && <p role="alert" className="text-sm text-amber-100">{rewriteEditError}</p>}
              {(project?.context.episodeIndex !== rewrite.episodeIndex || project?.context.episodeBody !== rewrite.originalBody) && <p role="status" className="text-sm text-amber-100">当前剧本与原快照不同，已停止覆盖。原稿与优化稿仍保留。</p>}
            </DialogContent>
          </Dialog>
        </section>}
        {!creationMode && <section aria-label="旧稿备份" className="space-y-2 border-t border-white/10 pt-3 text-xs">
          <button type="button" disabled={!userId || !project} onClick={refreshBackups} className="rounded border border-white/20 px-3 py-2 disabled:opacity-40">查找当前项目旧稿备份</button>
          <p className="text-white/50">说错或顾问理解错，都可先查看旧版再还原。还原前也保留当前版本；已经支付的生成费用不会撤销。</p>
          {backups.map(backup => <div key={backup.key} className="flex items-center justify-between gap-2"><span>第{backup.episodeIndex}集 · {new Date(backup.createdAt).toLocaleString("zh-CN")}</span>{backup.downloadOnly ? <span className="text-white/60">完整工程备份 · 下载后可从导入备份恢复</span> : <button type="button" onClick={() => setBackupPreview(backup)}>查看并还原</button>}<button type="button" onClick={() => { try { downloadAdvisorBackup(backup); } catch { toast.error("备份下载失败，原记录未改动。"); } }} className="shrink-0 text-cyan-100">下载旧稿JSON</button></div>)}
          {backupPreview && <article aria-label="还原前版本预览" className="space-y-2 rounded-xl border border-amber-300/40 p-3"><h4>还原到 {new Date(backupPreview.createdAt).toLocaleString("zh-CN")}</h4><p>此备份会还原作品及当时的素材配置。请核对，后续修改也会先保存为另一个备份。</p><div tabIndex={0} className="max-h-80 overflow-auto whitespace-pre-wrap">{JSON.parse(backupPreview.json).writerPack.episodes.map((ep: {index:number;body:string}) => `第${ep.index}集\n${ep.body}`).join("\n\n")}</div><button type="button" disabled={!props.onRestoreAdvisorBackup || asking} onClick={() => void props.onRestoreAdvisorBackup?.(backupPreview).catch(error => toast.error(error instanceof Error ? error.message : "还原未完成"))}>确认还原这个版本</button><button type="button" onClick={() => setBackupPreview(null)}>保留现状</button></article>}
          {backupError && <p role="status" className="text-amber-100">{backupError}</p>}
        </section>}
        {props.mediaWorkspace && userId && <ManhuaAdvisorMediaEdit key={`${userId}:${props.projectId || "legacy"}`} ref={mediaEditRef} scopeKey={`${userId}:${props.projectId || "legacy"}`} userId={userId} workspace={props.mediaWorkspace} consulting={asking || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked} exempt={quotaQuery.data?.exempt} onAsk={text => { send(`【素材修改】${text}`); }} onReview={source => { send(`【影片审阅】请审阅${source.label}：指出值得保留的手法与需要修改的音画问题，给出时间点与最小修改建议。`, undefined, false, undefined, undefined, { videoUri: source.url, blockId: source.blockId, revision: source.revision, label: source.label }); }} />}
        {filmResult && <ManhuaAdvisorFilmReview report={filmResult.report} target={filmResult.target} disabled={asking || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked || props.mediaWorkspace?.disabled} onEdit={text => {
          const source = props.mediaWorkspace?.sources.find(s => s.blockId === filmResult.target.blockId && s.url === filmResult.target.videoUri && s.revision === filmResult.target.revision);
          if (!source) { toast.error("审片对应素材已变化，请审阅当前版本后再修改"); return; }
          send(`【素材修改】素材编号：${source.blockId}；${text}`);
        }} />}
        {!turns.length && <p className="text-xs leading-5 text-white/60">结合当前剧本、参考图绑定和选中镜头给建议。只读取当前项目；未查看原图、原片时不会宣称质量通过。</p>}
        {turns.map((turn) => <div key={turn.id} className={turn.role === "user" ? "ml-8" : "mr-3"}>
          <div className={`whitespace-pre-wrap break-words rounded-lg px-3 py-2.5 text-[15px] leading-7 ${turn.role === "user" ? "bg-cyan-500/15 text-cyan-50" : "border border-white/10 bg-white/[0.035] text-white/85"}`}>{turn.role === "advisor" && parseAdvisorTemplatePlans(turn.text, templates).length ? "已根据当前故事给出以下方案，请选择后查看改写对比。" : turn.role === "advisor" ? <Streamdown>{readableAdvice(turn.text)}</Streamdown> : turn.text.includes(MANHUA_ADVISOR_AUTO_QUESTION) ? `${turn.text.split("\n")[0]}：检查本步骤的剧情、空间与制作建议。` : turn.text === TEMPLATE_PLAN_QUESTION ? "根据当前故事推荐一种思路，再看看其他三种。" : turn.text.startsWith(TEMPLATE_REWRITE_MARKER) ? "按所选方案改写当前集，先查看对比再采用。" : turn.text}</div>
          {turn.role === "advisor" && (creationMode || props.previsTarget || props.worldTarget) && <button type="button" onClick={() => void copyAdvice(turn.text)} className="mt-1 min-h-8 rounded px-2 text-xs text-cyan-100 hover:bg-white/10">复制建议</button>}
          {turn.role === "advisor" && !props.episodeWorkspace && parseAdvisorTemplatePlans(turn.text, templates).map((plan, index) => <section key={plan.publicId} className="mt-2 space-y-2 rounded border border-cyan-300/25 p-3 text-xs">
            <h3 className="font-semibold">{index === 0 ? "主推荐" : `另一个思路 ${index}`} · {templates.find(t => t.publicId === plan.publicId)?.methodBrief?.title || templates.find(t => t.publicId === plan.publicId)?.nameZh}</h3>
            <p>{plan.reason}</p><ul>{plan.changes.map((change, i) => <li key={i}>• {change}</li>)}</ul><p>保留：{plan.preserve}</p>
            <button type="button" disabled={asking || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked} onClick={() => requestRewrite(plan)} className="rounded border border-cyan-300/40 px-2 py-1 disabled:opacity-40">生成本集完整优化稿</button>
            <button type="button" onClick={() => onRequestTrial(templates.find(t => t.publicId === plan.publicId)!)} className="ml-2 text-cyan-100">免费试写大纲对比</button>
          </section>)}
          {turn.role === "advisor" && !props.episodeWorkspace && !parseAdvisorTemplatePlans(turn.text, templates).length && !props.previsTarget && !props.worldTarget && findMentionedTemplates(turn.text, templates).map((template) => <button key={template.publicId} type="button" disabled={asking || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked} onClick={() => send(buildTemplateAdviceQuestion(template))} className="mt-2 rounded border border-cyan-300/30 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40">用「{template.storyPreview?.teaserTitleZh || template.nameZh}」生成本集优化稿</button>)}
        </div>)}
        {previsKey && (props.previsTarget || previsCandidate) && <details className="text-xs"><summary onClick={recoverPreviews} className="cursor-pointer py-2 text-cyan-100">找回本项目的独立试看</summary>{savedPreviews.map(({ key, trial }) => <button key={key} type="button" className="my-1 block rounded border border-white/20 px-2 py-2 text-left" onClick={() => { try { localStorage.setItem(`${previsKey}:trial`, trial.request.requestId); localStorage.setItem(previsKey, JSON.stringify(trial.candidate)); setAutoPrevisStart(false); setPrevisCandidate(trial.candidate); } catch { toast.error("试看恢复记录无法保存，未切换。"); } }}>{trial.candidate.patch.summaryZh} · {trial.request.spec.durationSec}秒</button>)}</details>}
        {candidateMatches && previsCandidate && <ManhuaAdvisorPrevisComparison voiceControl={previsVoiceControl} key={JSON.stringify(previsCandidate)} candidate={previsCandidate} previewHost={props.previewHost} actionHost={previsActionHost} onCheckReady={props.onCheckPrevisReady} storageKey={previsKey ? `${previsKey}:trial` : null} autoStart={autoPrevisStart} onPreviewReady={rememberPreviewVideo} onPrepare={props.onPreparePrevis} onRevise={() => { setDraft("保留这版其他安排，我想调整："); questionRef.current?.focus(); }} disabled={asking || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked} onApply={props.onApplyPrevis} />}
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
          <div className="mt-2 flex gap-3">{sessionKey && <button type="button" disabled={asking || sessionStorageBlocked || !pendingPaid.credits} onClick={() => void submit(pendingPaid.request, true, pendingPaid.credits)} className="rounded border border-amber-200/40 px-3 py-1">确认支付 {pendingPaid.credits ?? "待核对"} 积分并继续</button>}<button type="button" onClick={() => { if (pendingPaid) finishVoiceReply(pendingPaid.request.requestId, "用户取消本次扣点咨询，未取得付费结果。"); setPendingPaid(null); }}>取消</button></div>
        </div>}
        {failed && <div role="alert" className="rounded-lg border border-rose-300/25 p-3 text-xs text-rose-100"><p>{failed.message}</p><p className="mt-1 text-white/70">原问题：{failed.request.label}</p><p className="mt-1 whitespace-pre-wrap text-white/70">{failed.request.rawQuestion}</p>{!failed.newAttempt && <p className="mt-2 text-amber-100">此请求仍未决，请先恢复原问题；草稿可以继续编辑，但不会覆盖恢复记录。</p>}<button type="button" disabled={asking || sessionStorageBlocked || (failed.confirmPaid && !sessionKey)} onClick={() => void submit(failed.newAttempt ? { ...failed.request, requestId: crypto.randomUUID() } : failed.request, failed.newAttempt ? false : failed.confirmPaid, failed.newAttempt ? undefined : failed.confirmedCredits)} className="mt-2 rounded border border-white/20 px-3 py-1">{failed.newAttempt ? "重新提问（新的一次，重新检查额度）" : "恢复原问题（沿用原请求编号）"}</button></div>}
      </div>
      <footer data-advisor-composer className="shrink-0 space-y-2 border-t border-white/10 p-3">
        <p className="text-xs text-white/65" aria-live="polite">{quotaQuery.data?.exempt ? "管理员测试 · 免扣积分" : quota ? `本作品免费剩余 ${quota.remaining}/5 次 · 超出后 ${quota.price} 积分/次` : "正在核对本作品额度…"}</p>
        {props.previsAudioControls}
        <CreativeVoicePanel onSessionActiveChange={setLiveSessionActive} key={`${userId}:${props.projectId}:${confirmedProjectVersion || "draft"}`} scopeKey={`${userId}:${props.projectId || `legacy:${confirmedProjectVersion || "draft"}`}`} context={JSON.stringify({ activeStudio: project?.context.activeStudio, stage: currentStage, project: project?.context, selectedTemplate })} onReviewFilm={(blockId, question, signal) => new Promise(resolve => {
          const source = props.mediaWorkspace?.sources.find(s => s.blockId === blockId && s.kind === "video");
          if (signal.aborted || !source || props.mediaWorkspace?.disabled) { resolve("当前影片不可审阅，请重新选择"); return; }
          if (!window.confirm(`把${source.label}交给Gemini Flash审阅？计入本作品顾问次数；超出免费次数会另行确认扣点。`)) { resolve("用户取消影片审阅"); return; }
          let done = false;
          const reply = (answer?: string) => { if (done) return; done = true; signal.removeEventListener("abort", abort); for (const [id,cb] of Array.from(voiceReplies.current)) if (cb === reply) voiceReplies.current.delete(id); resolve(answer ? readableAdvice(answer) : undefined); };
          const abort = () => reply("语音已结束，已提交的审阅继续在原顾问保存，不重提");
          signal.addEventListener("abort", abort, {once:true});
          if (!send(`【影片审阅】${question}`, undefined, false, undefined, reply, {videoUri:source.url,blockId:source.blockId,revision:source.revision,label:source.label})) reply();
        })} onInspectMedia={() => mediaEditRef.current?.inspect() || null} mediaSources={props.mediaWorkspace?.sources} onProposeMediaEdit={proposal => { if (!mediaEditRef.current) throw new Error("素材编辑区尚未就绪"); return mediaEditRef.current.propose(proposal); }} onProductionAction={executeProductionAction} disabled={!userId || asking || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked} onUse={text => setDraft(text)} targets={props.voiceTargets || props.episodeWorkspace?.episodes.map(e => ({ episode: e.index, label: e.title })) || []} onNavigate={props.onVoiceNavigate} onAskAdvisor={(question, signal) => {
          if (requestsAdvisorComparison(question)) {
            try { return executeProductionAction({action:"prepareEpisode",episode:comparisonEpisodeIndex(question, project?.context.episodeIndex || 0),question}, signal); }
            catch (error) { return Promise.resolve(error instanceof Error ? error.message : "无法确定比较稿目标集"); }
          }
          return new Promise(resolve => {
          if (signal.aborted) { resolve(undefined); return; }
          let done = false;
          const reply = (answer?: string) => { if (done) return; done = true; signal.removeEventListener("abort", abort); for (const [id, callback] of Array.from(voiceReplies.current)) if (callback === reply) voiceReplies.current.delete(id); resolve(answer); };
          const abort = () => reply("语音讨论已结束；已提交的顾问请求仍可在原入口查询，不重复生成。");
          signal.addEventListener("abort", abort, { once: true });
          if (!send(question, undefined, false, undefined, reply)) reply();
        }); }} />
          {operationPlan && <section aria-label="工作流操作方案" className="rounded border border-cyan-300/30 p-3 text-sm">
            <p className="whitespace-pre-wrap">{operationPlan.plan.summaryZh}</p>
            <p className="mt-1 text-xs text-white/60">{operationPlan.result ? "原操作回执" : "方案已准备，尚未执行"}</p>
            {operationPlan.result ? <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs">{operationPlan.result}</pre> : <button type="button" disabled={operationBusy || asking || Boolean(pendingPaid) || unresolvedFailed || operationPlan.source !== operationSource} onClick={() => void applyWorkflowOperation()} className="mt-2 rounded border px-3 py-2">确认执行这一步</button>}
          </section>}
        <div className="flex items-end gap-2">
          <button type="button" disabled={!operationKey || operationBusy || asking || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked || draft.trim().length < 2} onClick={() => void requestWorkflowOperation()} className="rounded border border-cyan-300/40 px-3 py-2">{operationBusy ? "正在核对操作…" : "让顾问操作工作流"}</button>
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
  return <><div ref={fallbackDock} style={{display:"contents"}} />{stableDock ? createPortal(panel, stableDock) : panel}</>;
}
