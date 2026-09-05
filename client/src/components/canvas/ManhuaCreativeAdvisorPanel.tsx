/** 项目顾问：读取证据、定位问题；不通过聊天生成或覆盖正式产物。 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { copyTextWithToast } from "@/lib/copyText";
import { buildAdvisorQuestion, findMentionedTemplates } from "@/lib/manhuaCreativeAdvisorContext";
import { manhuaCreativeAdvisorContextSchema } from "@shared/manhuaCreativeAdvisor";
import type { PublicManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";
import type { buildManhuaAdvisorProject, AdvisorIssue } from "@/lib/manhuaAdvisorProject";
import { advisorRecentHistory, loadAdvisorMessages, loadAdvisorPendingRecovery, makeAdvisorPendingRecovery, manhuaAdvisorSessionKey, mergeAdvisorCompletedExchange, persistAdvisorCompletedExchange, type AdvisorMessage, type AdvisorMessagesLoadResult, type AdvisorPendingRequest, type AdvisorRecoveryLoadResult } from "@/lib/manhuaAdvisorSession";
import { MANHUA_ADVISOR_STAGE_LABELS } from "@/lib/manhuaAdvisorEntry";
import { formatManhuaAdvisorContextIssue, formatManhuaAdvisorError } from "@/lib/manhuaAdvisorFeedback";

type PendingQuestion = AdvisorPendingRequest;

export default function ManhuaCreativeAdvisorPanel(props: {
  open: boolean;
  onClose: () => void;
  stageZh?: string;
  userId?: string;
  confirmedProjectVersion?: string;
  project?: ReturnType<typeof buildManhuaAdvisorProject>;
  onLocate?: (issue: AdvisorIssue) => void;
  selectedTemplate?: PublicManhuaViralTemplateCard | null;
  templates: PublicManhuaViralTemplateCard[];
  onRequestTrial: (template: PublicManhuaViralTemplateCard) => void;
}) {
  const { open, onClose, userId, confirmedProjectVersion, project, onLocate, stageZh, selectedTemplate, templates, onRequestTrial } = props;
  const sessionKey = userId && confirmedProjectVersion ? manhuaAdvisorSessionKey(userId, confirmedProjectVersion) : null;
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
  const [pendingPaid, setPendingPaid] = useState<{ request: PendingQuestion; hint: string } | null>(null);
  const [failed, setFailed] = useState<{ request: PendingQuestion; message: string; confirmPaid: boolean; newAttempt?: boolean } | null>(() => initialRecovery.value ? {
    request: initialRecovery.value.request,
    confirmPaid: initialRecovery.value.confirmPaid,
    message: "上次问答尚未收到回执。恢复会沿用原请求编号，不自动发起新的问答。",
  } : null);
  const [quota, setQuota] = useState<{ remaining: number; price: number } | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const askMutation = trpc.mvAnalysis.askPlatformSkillQa.useMutation({ retry: false });
  const sessionStorageBlocked = Boolean(sessionKey && !initial.writable);
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

  async function submit(request: PendingQuestion, confirmPaid: boolean) {
    if (inFlight.current || !userId || sessionStorageBlocked) return;
    const capturedSessionKey = sessionKey;
    const capturedRecoveryKey = recoveryKey;
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
          localStorage.setItem(capturedRecoveryKey, JSON.stringify(makeAdvisorPendingRecovery(request, confirmPaid)));
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
      const res = await askMutation.mutateAsync({ requestId: request.requestId, question: request.question, rawQuestion: request.rawQuestion, manhuaContext: request.manhuaContext, confirmPaid: confirmPaid || undefined });
      const answer = String(res.answer || "").trim();
      if (!answer) throw new Error("本次没有收到有效回答，请重试原问题。");
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
        setPendingPaid({ request, hint: message.replace(/\b(?:Sol|Terra)\b/g, "").replace(/（成本\+60%）/g, "") });
      } else setFailed({ request, confirmPaid, message: formatManhuaAdvisorError(message), newAttempt: /ADVISOR_OPERATION_(?:FAILED|MISMATCH)/.test(message) });
    } finally { inFlight.current = false; }
  }

  function send(rawQuestion: string) {
    if (inFlight.current || pendingPaid || unresolvedFailed || !userId || sessionStorageBlocked) return;
    const question = rawQuestion.trim();
    if (question.length < 2 || question.length > 1200) { toast.error("请输入 2—1200 字的问题，内容不会被自动截断。"); return; }
    const result = project ? manhuaCreativeAdvisorContextSchema.safeParse({ ...project.context, history: advisorRecentHistory(turns) }) : null;
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
      question: buildAdvisorQuestion({ question, stageZh, selectedTemplate, templates, hasProjectEvidence: Boolean(project) }),
      manhuaContext: result?.success ? result.data : undefined, label,
    };
    setDraft("");
    void submit(request, false);
  }

  async function copyAdvice(text: string) {
    await copyTextWithToast(text, {
      successZh: "建议已复制，可粘贴后修改。",
      errorZh: "复制失败，请选中文字手动复制。",
    });
  }

  if (!open) return null;
  const currentStage = project ? MANHUA_ADVISOR_STAGE_LABELS[project.context.stage] : stageZh || "创作咨询";
  const quick = [
    ["检查当前内容", "检查当前内容，指出有证据的问题。"],
    ["给我修改方案", "针对当前内容给修改方案，先列依据与差异，不改正式稿。"],
    ["下一步怎么做", "根据当前状态，下一步应该做什么？"],
  ];
  return (
    <aside data-manhua-creative-advisor aria-label="创作顾问"
      onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
      className="fixed bottom-0 right-0 top-[4.5rem] z-[60] flex w-full max-w-[420px] flex-col border-l border-cyan-200/15 bg-[#10171f] text-white shadow-2xl">
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
        {!turns.length && <p className="text-xs leading-5 text-white/60">结合当前剧本、参考图绑定和选中镜头给建议。只读取当前项目；未查看原图、原片时不会宣称质量通过。</p>}
        {turns.map((turn) => <div key={turn.id} className={turn.role === "user" ? "ml-8" : "mr-3"}>
          <div className={`whitespace-pre-wrap break-words rounded-lg px-3 py-2.5 text-[13px] leading-6 ${turn.role === "user" ? "bg-cyan-500/15 text-cyan-50" : "border border-white/10 bg-white/[0.035] text-white/85"}`}>{turn.text}</div>
          {turn.role === "advisor" && <button type="button" onClick={() => void copyAdvice(turn.text)} className="mt-1 min-h-8 rounded px-2 text-xs text-cyan-100 hover:bg-white/10">复制建议</button>}
          {turn.role === "advisor" && findMentionedTemplates(turn.text, templates).map((template) => <button key={template.publicId} type="button" onClick={() => onRequestTrial(template)} className="mt-2 rounded border border-cyan-300/30 px-2 py-1 text-xs text-cyan-100">查看「{template.nameZh}」试写入口 →</button>)}
        </div>)}
        {askMutation.isPending && <p role="status" className="text-xs text-cyan-200">正在核对本次问题与项目证据…</p>}
        {pendingPaid && <div role="alert" className="rounded-lg border border-amber-300/30 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
          <p>{pendingPaid.hint}</p><p className="mt-1">原问题：{pendingPaid.request.label}（按提问时快照继续）</p><p className="mt-1 whitespace-pre-wrap text-white/75">{pendingPaid.request.rawQuestion}</p>
          {!sessionKey && <p className="mt-2 font-semibold">先确认项目后再付费咨询，避免改稿丢回执。本次不会发起扣点请求。</p>}
          <div className="mt-2 flex gap-3">{sessionKey && <button type="button" disabled={askMutation.isPending || sessionStorageBlocked} onClick={() => void submit(pendingPaid.request, true)} className="rounded border border-amber-200/40 px-3 py-1">确认扣点继续</button>}<button type="button" onClick={() => setPendingPaid(null)}>取消</button></div>
        </div>}
        {failed && <div role="alert" className="rounded-lg border border-rose-300/25 p-3 text-xs text-rose-100"><p>{failed.message}</p><p className="mt-1 text-white/70">原问题：{failed.request.label}</p><p className="mt-1 whitespace-pre-wrap text-white/70">{failed.request.rawQuestion}</p>{!failed.newAttempt && <p className="mt-2 text-amber-100">此请求仍未决，请先恢复原问题；草稿可以继续编辑，但不会覆盖恢复记录。</p>}<button type="button" disabled={askMutation.isPending || sessionStorageBlocked || (failed.confirmPaid && !sessionKey)} onClick={() => void submit(failed.newAttempt ? { ...failed.request, requestId: crypto.randomUUID() } : failed.request, failed.newAttempt ? false : failed.confirmPaid)} className="mt-2 rounded border border-white/20 px-3 py-1">{failed.newAttempt ? "重新提问（新的一次，重新检查额度）" : "恢复原问题（沿用原请求编号）"}</button></div>}
      </div>
      <footer className="border-t border-white/10 p-3">
        <div className="mb-2 flex flex-wrap gap-2">{quick.map(([label, question]) => <button key={label} type="button" disabled={!userId || askMutation.isPending || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked} onClick={() => send(question!)} className="rounded-md border border-white/15 px-2 py-1.5 text-xs text-white/75 hover:border-cyan-300/60 disabled:opacity-40">{label}</button>)}</div>
        <div className="flex items-end gap-2">
          <textarea aria-label="向创作顾问提问" value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} maxLength={1200} disabled={!userId || sessionStorageBlocked}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(draft); } }}
            placeholder="问当前剧本、人物或镜头…" className="min-w-0 flex-1 resize-none rounded-lg border border-white/20 bg-black/20 px-3 py-2 text-sm outline-none focus:border-cyan-300" />
          <button type="button" disabled={!userId || askMutation.isPending || Boolean(pendingPaid) || unresolvedFailed || sessionStorageBlocked || draft.trim().length < 2} onClick={() => send(draft)} className="rounded-lg bg-cyan-400 px-3 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-40">发送</button>
        </div>
        <p className="mt-2 text-[11px] leading-4 text-white/45">只给建议，不自动修改或生成。{sessionKey ? "历史按已确认项目版本保存在本机。" : "未确认稿仅保留本次页面会话，改稿后重新咨询。"}追问携带最近 8 条，长答复标记为节选。</p>
        {quota && <p className="mt-1 text-[11px] text-white/55">本轮回执：免费剩余 {quota.remaining} 次；超额 {quota.price} 积分/次，确认后才扣点。</p>}
        {storageError && <p role="alert" className="mt-1 text-xs text-amber-100">{storageError}</p>}
        {initialRecovery.error && <p role="alert" className="mt-1 text-xs text-amber-100">{initialRecovery.error}</p>}
      </footer>
    </aside>
  );
}
