import { useRef, useState } from "react";
import { z } from "zod";
import { trpc } from "@/lib/trpc";
import { buildDigitalHumanAdvisorProject } from "@/lib/digitalHumanAdvisor";
import { manhuaCreativeAdvisorContextSchema } from "@shared/manhuaCreativeAdvisor";
import { advisorPrevisCandidateSchema, makeAdvisorPrevisTarget, parseAdvisorPrevisPatch, applyAdvisorPrevisCandidate, prepareAdvisorPrevisTrial, adoptAdvisorPrevisTrial, type AdvisorPrevisCandidate } from "@shared/manhuaAdvisorPrevisEdit";
import type { ManhuaPrevisStudio } from "@shared/manhuaPrevis";
import type { DigitalHumanDraft } from "@shared/digitalHumanStudio";
import { ManhuaAdvisorPrevisComparison } from "./canvas/ManhuaAdvisorPrevisComparison";

const pendingSchema = z.object({ requestId: z.string().uuid(), question: z.string().min(2).max(1200), context: manhuaCreativeAdvisorContextSchema, paid: z.boolean().default(false), credits: z.number().int().positive().optional() });
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
/** 独立数字人导演入口：仅复用顾问服务与动作候选合同，不加载漫剧工程或分集流程。 */
export function DigitalHumanDirectorPanel(props: {
  draft: DigitalHumanDraft; storage: Storage; disabled: boolean;
  currentStudio: () => ManhuaPrevisStudio;
  onApply: (studio: ManhuaPrevisStudio) => void;
  beforeSubmit: () => Promise<void>;
  acquireWork: (label: string) => () => void;
}) {
  const clipId = `dh-previs-${props.draft.id}`;
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [loadBlocked, setLoadBlocked] = useState(false);
  const [paymentNeeded, setPaymentNeeded] = useState(false);
  const [answer, setAnswer] = useState(() => props.storage.getItem("director-answer") || "");
  const [busy, setBusy] = useState(false), lock = useRef(false);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [candidate, setCandidate] = useState<AdvisorPrevisCandidate | undefined>(() => {
    try { const raw = props.storage.getItem("director-candidate"); return raw ? advisorPrevisCandidateSchema.parse(JSON.parse(raw)) : undefined; }
    catch (e) { queueMicrotask(() => setError(`原导演方案读取失败：${message(e)}`)); return undefined; }
  });
  const [pending, setPending] = useState<z.infer<typeof pendingSchema> | undefined>(() => {
    try { const raw = props.storage.getItem("director-pending"); return raw ? pendingSchema.parse(JSON.parse(raw)) : undefined; }
    catch (e) { queueMicrotask(() => { setLoadBlocked(true); setError(`原导演请求读取失败：${message(e)}`); }); return undefined; }
  });
  const ask = trpc.mvAnalysis.askPlatformSkillQa.useMutation({ retry: false });
  const quota = trpc.mvAnalysis.getManhuaAdvisorQuota.useQuery(undefined, { retry: false });
  async function send(recover = false) {
    if (lock.current || props.disabled || loadBlocked) return;
    lock.current = true; setBusy(true); setError("");
    let release: (() => void) | undefined;
    try {
      release = props.acquireWork("数字人导演咨询");
      if (!recover && (!quota.data || quota.isError)) throw new Error("无法确认顾问额度，未提交");
      let request = recover ? pending : undefined;
      if (request && paymentNeeded) {
        const latest = await quota.refetch();
        if (!latest.data) throw new Error("无法核对当前顾问价格，未提交");
        if (!window.confirm(`原请求需要 ${latest.data.price} 积分，确认后按原编号继续？`)) return;
        request = { ...request, paid: true, credits: latest.data.price };
      }
      if (!request) {
        const target = makeAdvisorPrevisTarget(clipId, props.currentStudio());
        const context = manhuaCreativeAdvisorContextSchema.parse({ ...buildDigitalHumanAdvisorProject(props.draft).context, previsEdit: target });
        request = pendingSchema.parse({ requestId: crypto.randomUUID(), question: question.trim(), context,
          paid: quota.data?.remaining === 0 && !quota.data.exempt,
          credits: quota.data?.price });
        if (request.paid && !window.confirm(`本次数字人导演咨询扣除 ${request.credits} 积分。确认发送当前问题与已展示的制作稿、人物和机位？`)) return;
      }
      props.storage.setItem("director-pending", JSON.stringify(request)); setPending(request);
      await props.beforeSubmit();
      const result = await ask.mutateAsync({ requestId: request.requestId, question: request.question, rawQuestion: request.question,
        manhuaContext: request.context, confirmPaid: request.paid || undefined, confirmedCredits: request.paid ? request.credits : undefined });
      // 先保留原回答，解析失败也能恢复，不以新请求重复扣费。
      props.storage.setItem(`director-answer:${request.requestId}`, result.answer);
      props.storage.setItem("director-answer", result.answer); setAnswer(result.answer);
      props.storage.removeItem("director-pending"); setPending(undefined); setPaymentNeeded(false);
      props.storage.removeItem("director-candidate"); setCandidate(undefined);
      await props.beforeSubmit();
      const next = advisorPrevisCandidateSchema.parse({ target: request.context.previsEdit, patch: parseAdvisorPrevisPatch(result.answer) });
      props.storage.setItem("director-candidate", JSON.stringify(next)); setCandidate(next);
      await props.beforeSubmit(); await quota.refetch();
    } catch (e) {
      const text = message(e); setError(text);
      if (text.includes("ADVISOR_OPERATION_FAILED")) {
        const raw = props.storage.getItem("director-pending");
        if (raw) props.storage.setItem(`director-failed:${JSON.parse(raw).requestId}`, JSON.stringify({ request: JSON.parse(raw), message: text }));
        props.storage.removeItem("director-pending"); setPending(undefined);
      } else if ((e as { data?: { code?: string } })?.data?.code === "PAYMENT_REQUIRED") setPaymentNeeded(true);
    }
    finally { release?.(); lock.current = false; setBusy(false); }
  }
  const ready = () => {
    try {
      if (props.disabled || busy) return "数字人制作正在处理";
      if (candidate) applyAdvisorPrevisCandidate(clipId, props.currentStudio(), candidate);
      return "";
    } catch (e) { return message(e); }
  };
  return <section className="dh-card">
    <h4>数字人导演 · 动作与机位</h4>
    <p>方案只作用于本制作稿中的人物、动作和摄影机。先生成独立试看，满意后应用；视频参考仍须逐帧与常速审片。</p>
    <details><summary>本次导演输入</summary><p style={{ whiteSpace: "pre-wrap" }}>{props.draft.script}</p><pre>{JSON.stringify(props.currentStudio().spec, null, 2)}</pre></details>
    <p>{quota.data ? `顾问可用免费次数：${quota.data.remaining}；超出后 ${quota.data.price} 积分/次。沿用账户现有顾问计费。` : "正在核对顾问额度"}</p>
    <textarea aria-label="数字人导演要求" maxLength={1200} value={question} onChange={e => setQuestion(e.target.value)} placeholder="例如：人物从咖啡机旁走到窗边，停下后看镜头；镜头先跟随再推近。" />
    <button type="button" disabled={props.disabled || busy || loadBlocked || Boolean(pending) || question.trim().length < 2} onClick={() => void send()}>生成导演方案</button>
    {pending && <button type="button" disabled={props.disabled || busy} onClick={() => void send(true)}>恢复原导演请求</button>}
    {error && <p role="alert">{error}</p>}
    {answer && <details><summary>已返回的完整方案</summary><pre>{answer}</pre></details>}
    <div ref={setHost} data-clip-id={clipId} />
    {candidate && <ManhuaAdvisorPrevisComparison key={JSON.stringify(candidate)} candidate={candidate}
      storage={props.storage} beforeSubmit={props.beforeSubmit} acquireWork={props.acquireWork} storageKey="digital-human-director-trial"
      autoStart={false} previewHost={host} disabled={props.disabled || busy} onCheckReady={ready}
      onPrepare={value => prepareAdvisorPrevisTrial(clipId, props.currentStudio(), value)}
      onApply={(trial, receipt) => {
        try { props.onApply(adoptAdvisorPrevisTrial(clipId, props.currentStudio(), trial, receipt)); return true; }
        catch (e) { setError(message(e)); return false; }
      }} />}
  </section>;
}
