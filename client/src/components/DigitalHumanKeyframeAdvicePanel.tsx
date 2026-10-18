import { digitalHumanKeyframeImageDraftSchema } from "@shared/digitalHumanKeyframeGeneration";
import { useRef, useState } from "react";
import { z } from "zod";
import { trpc } from "@/lib/trpc";
import { buildDigitalHumanAdvisorProject } from "@/lib/digitalHumanAdvisor";
import { makeDigitalHumanKeyframeAdviceTarget } from "@/lib/digitalHumanKeyframeAdvice";
import { manhuaCreativeAdvisorContextSchema } from "@shared/manhuaCreativeAdvisor";
import type { DigitalHumanDraft } from "@shared/digitalHumanStudio";
import { previsPlaybackDuration } from "@shared/manhuaPrevisPlayback";
import { DIGITAL_HUMAN_KEYFRAME_ADVICE_QUESTION, digitalHumanKeyframeAdviceTargetSchema, digitalHumanKeyframeAdviceSchema, parseDigitalHumanKeyframeAdvice } from "@shared/digitalHumanKeyframeAdvice";

const pendingKey = "keyframe-advice-pending", resultKey = "keyframe-advice-result";
const pendingSchema = z.object({ id: z.string().uuid(), target: digitalHumanKeyframeAdviceTargetSchema, context: manhuaCreativeAdvisorContextSchema, paid: z.boolean(), credits: z.number() }).refine(value => JSON.stringify(value.target) === JSON.stringify(value.context.digitalHumanKeyframeAdvice), "原审片请求与目标不一致，请保留记录后核对");
const resultSchema = z.object({ target: digitalHumanKeyframeAdviceTargetSchema, plan: digitalHumanKeyframeAdviceSchema });
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function DigitalHumanKeyframeAdvicePanel(props: { draft: DigitalHumanDraft; disabled: boolean; save: (fn: (draft: DigitalHumanDraft) => DigitalHumanDraft) => void; beforeSubmit: () => Promise<void>; acquireWork: (label: string) => () => void }) {
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [paymentNeeded, setPaymentNeeded] = useState(false);
  const lock = useRef(false);
  const ask = trpc.mvAnalysis.askPlatformSkillQa.useMutation({ retry: false });
  const quota = trpc.mvAnalysis.getManhuaAdvisorQuota.useQuery(undefined, { retry: false });
  const pendingRaw = props.draft.advisorStorage[pendingKey];
  let currentTarget: ReturnType<typeof makeDigitalHumanKeyframeAdviceTarget> | undefined, unavailable = "";
  try { currentTarget = makeDigitalHumanKeyframeAdviceTarget(props.draft); } catch (e) { unavailable = errorText(e); }
  let result: z.infer<typeof resultSchema> | undefined, storedError = "";
  try {
    if (props.draft.advisorStorage[resultKey]) {
      const saved = resultSchema.parse(JSON.parse(props.draft.advisorStorage[resultKey]));
      if (saved.target.id !== props.draft.id) throw new Error("补图建议属于其他制作稿");
      result = { target: saved.target, plan: parseDigitalHumanKeyframeAdvice(JSON.stringify(saved.plan), saved.target) };
    }
  }
  catch { storedError = "历史补图建议无法读取，原记录已保留。"; }
  let previewTarget = currentTarget;
  try { if (pendingRaw) previewTarget = pendingSchema.parse(JSON.parse(pendingRaw)).target; }
  catch { /* 点击恢复时显示原请求的具体校验错误，不删除记录。 */ }

  async function send() {
    if (lock.current || props.disabled) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    const draftId = props.draft.id;
    let release: (() => void) | undefined;
    try {
      release = props.acquireWork("审白模与补图建议");
      let pending = pendingRaw ? pendingSchema.parse(JSON.parse(pendingRaw)) : undefined;
      if (pending && pending.target.id !== draftId) throw new Error("原白模审片请求属于其他制作稿，请保留记录后核对");
      if (!pending || paymentNeeded) {
        const latest = await quota.refetch();
        if (!latest.data) throw new Error("顾问额度暂不可用，未提交");
        const paid = paymentNeeded || latest.data.remaining === 0 && !latest.data.exempt;
        if (paid && !window.confirm(`白模审片补图建议需要${latest.data.price}积分，确认${pending ? "按原编号继续" : "发送当前白模视频与制作稿"}？`)) return;
        if (pending) pending = { ...pending, paid: true, credits: latest.data.price };
        else {
          const target = makeDigitalHumanKeyframeAdviceTarget(props.draft);
          const context = manhuaCreativeAdvisorContextSchema.parse({ ...buildDigitalHumanAdvisorProject(props.draft).context, digitalHumanKeyframeAdvice: target });
          pending = { id: crypto.randomUUID(), target, context, paid, credits: latest.data.price };
        }
        const savedPending = pending;
        props.save(draft => {
          if (draft.id !== savedPending.target.id) throw new Error("制作稿已切换，未保存或提交其他作品的白模审片请求");
          return { ...draft, advisorStorage: { ...draft.advisorStorage, [pendingKey]: JSON.stringify(savedPending) } };
        });
        setPaymentNeeded(false);
      }
      await props.beforeSubmit();
      const response = await ask.mutateAsync({ requestId: pending.id, question: DIGITAL_HUMAN_KEYFRAME_ADVICE_QUESTION, rawQuestion: DIGITAL_HUMAN_KEYFRAME_ADVICE_QUESTION, manhuaContext: pending.context, confirmPaid: pending.paid || undefined, confirmedCredits: pending.paid ? pending.credits : undefined });
      const plan = parseDigitalHumanKeyframeAdvice(response.answer, pending.target);
      props.save(draft => {
        if (draft.id !== pending.target.id) throw new Error("制作稿已切换，原请求结果未绑定到其他作品");
        const storage = { ...draft.advisorStorage };
        if (storage[resultKey]) storage[`keyframe-advice-history:${pending.id}`] = storage[resultKey];
        storage[`keyframe-advice-response:${pending.id}`] = response.answer;
        storage[resultKey] = JSON.stringify({ target: pending.target, plan }); delete storage[pendingKey];
        return { ...draft, advisorStorage: storage };
      });
      await props.beforeSubmit();
    } catch (e) {
      setError(errorText(e));
      if ((e as { data?: { code?: string } })?.data?.code === "PAYMENT_REQUIRED") setPaymentNeeded(true);
      if (errorText(e).includes("ADVISOR_OPERATION_FAILED")) {
        props.save(draft => { if (draft.id !== draftId) return draft; const storage = { ...draft.advisorStorage }; storage[`keyframe-advice-failed:${Date.now()}`] = JSON.stringify({ request: storage[pendingKey], error: errorText(e) }); delete storage[pendingKey]; return { ...draft, advisorStorage: storage }; });
        await props.beforeSubmit().catch(() => {});
      }
    } finally { release?.(); lock.current = false; setBusy(false); }
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setNotice("已复制补图要求，可用于准备图片并在下方绑定时段。"); }
    catch { setError("复制失败，请选中文字手动复制。"); }
  }
  return <section className="dh-card dh-wide">
    <h3>先审白模，再建议关键分镜</h3>
    <p>顾问读取当前已渲染的白模视频，判断哪些画面值得补图。只生成建议，不自动生图、采用或改稿。</p>
    <p>顾问分析不能代替逐帧与常速人工审片；白模中的人物脸、材质和声音不作为最终效果验收。</p>
    <p>{quota.data ? `顾问剩余免费${quota.data.remaining}次，超出${quota.data.price}积分/次` : "正在核对顾问额度"}</p>
    {unavailable && <p>{unavailable}</p>}
    {previewTarget && <details><summary>本次发送内容</summary><p>白模视频 {previsPlaybackDuration(JSON.parse(previewTarget.previs.specJson))} 秒；对应完整配音从 {previewTarget.timelineStartSec} 秒开始。附当前制作稿、导演要求与已有关键图文字登记；未发送关键图图片，不核验真人身份与音频。</p>{pendingRaw && currentTarget?.revision !== previewTarget.revision && <p>恢复的是原版本请求，当前修改不会替换已提交内容。</p>}</details>}
    <button type="button" disabled={props.disabled || busy || !pendingRaw && !currentTarget} onClick={() => void send()}>{pendingRaw ? "恢复原白模审片请求" : "审白模并建议补图"}</button>
    {(error || storedError) && <p role="alert">{error || storedError}</p>}{notice && <p role="status">{notice}</p>}
    {result && <>
      {result.target.revision !== currentTarget?.revision && <p>输入已变化，以下保留的是上一版白模的建议，不能当作当前版本的审片结论。</p>}
      <p>{result.plan.summaryZh}</p>
      <details><summary>白模观察与待修问题</summary>
        <ul>{result.plan.observations.map((row, i) => <li key={`o${i}`}>视频 {row.atVideoSec} 秒：{row.detailZh}</li>)}</ul>
        {result.plan.whiteboxIssues.length > 0 && <><p>以下白模问题须先处理，补图不能代替修正：</p><ul>{result.plan.whiteboxIssues.map((row, i) => <li key={i}>视频 {row.atVideoSec} 秒：{row.detailZh}</li>)}</ul></>}
      </details>
      {!result.plan.candidates.length && <p>{result.plan.noAdditionalFramesReasonZh}</p>}
      {result.plan.candidates.map((row, i) => {
        const content = `${row.label} · 完整配音 ${row.startSec}–${row.endSec} 秒\n必要性：${row.necessity === "required" ? "建议补图" : "可选补图"}；${row.reasonZh}\n人物：${row.identityZh}\n场景：${row.sceneZh}\n动作：${row.actionZh}\n构图：${row.compositionZh}\n参考职责：${row.referenceRoleZh}\n未验：${row.unverifiedZh.join("；")}`;
        return <details key={i} open><summary>{row.label} · {row.startSec}–{row.endSec} 秒 · 候选</summary><pre>{content}</pre><button type="button" onClick={() => void copy(content)}>复制补图要求</button><button type="button" disabled={props.disabled || busy || result.target.revision !== currentTarget?.revision} onClick={() => {
          try {
            const latest = makeDigitalHumanKeyframeAdviceTarget(props.draft);
            if (latest.revision !== result.target.revision) throw new Error("制作输入已变化，请先更新顾问建议");
            const imageDraft = digitalHumanKeyframeImageDraftSchema.parse({ label: row.label, description: `人物：${row.identityZh}\n场景：${row.sceneZh}\n动作：${row.actionZh}\n构图：${row.compositionZh}\n参考职责：${row.referenceRoleZh}`, startSec: row.startSec, endSec: row.endSec, adviceRevision: latest.revision });
            props.save(d => { if (d.id !== latest.id) throw new Error("制作稿已切换"); return { ...d, keyframeImageDraft: imageDraft }; });
            setNotice("已带入下方关键分镜生成输入；请核对指定人像与提示词后生成，尚未扣费。");
          } catch (e) { setError(errorText(e)); }
        }}>带入关键分镜生成</button></details>;
      })}
      <p>未验范围：{result.plan.unverifiedZh.join("；")}</p>
    </>}
  </section>;
}
