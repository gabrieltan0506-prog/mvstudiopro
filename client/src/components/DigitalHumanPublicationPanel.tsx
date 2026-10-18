import { useRef, useState } from "react";
import { z } from "zod";
import { trpc } from "@/lib/trpc";
import { manhuaCreativeAdvisorContextSchema } from "@shared/manhuaCreativeAdvisor";
import type { DigitalHumanDraft } from "@shared/digitalHumanStudio";
import { DIGITAL_HUMAN_PUBLICATION_QUESTION, digitalHumanPublicationTargetSchema, digitalHumanPublicationPlanSchema, parseDigitalHumanPublicationPlan } from "@shared/digitalHumanPublication";

const pendingKey = "publication-pending";
const resultKey = "publication-result";
const pendingSchema = z.object({ id: z.string().uuid(), context: manhuaCreativeAdvisorContextSchema, target: digitalHumanPublicationTargetSchema, paid: z.boolean(), credits: z.number() }).refine(value => JSON.stringify(value.target) === JSON.stringify(value.context.digitalHumanPublication), "原发布请求与文稿目标不一致，请保留记录后核对");
const resultSchema = z.object({ target: digitalHumanPublicationTargetSchema, plan: digitalHumanPublicationPlanSchema });
const labels = { douyin: "抖音", xiaohongshu: "小红书", weixin_channels: "视频号" } as const;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

export function DigitalHumanPublicationPanel(props: { draft: DigitalHumanDraft; disabled: boolean; save: (fn: (draft: DigitalHumanDraft) => DigitalHumanDraft) => void; beforeSubmit: () => Promise<void>; acquireWork: (label: string) => () => void }) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [paymentNeeded, setPaymentNeeded] = useState(false);
  const lock = useRef(false);
  const ask = trpc.mvAnalysis.askPlatformSkillQa.useMutation({ retry: false });
  const quota = trpc.mvAnalysis.getManhuaAdvisorQuota.useQuery(undefined, { retry: false });
  const pendingRaw = props.draft.advisorStorage[pendingKey];
  let pendingScript = props.draft.script;
  try { if (pendingRaw) pendingScript = pendingSchema.parse(JSON.parse(pendingRaw)).target.script; }
  catch { /* 原请求保留，点击恢复时显示具体校验错误。 */ }
  let result: z.infer<typeof resultSchema> | undefined;
  let storedError = "";
  try {
    if (props.draft.advisorStorage[resultKey]) {
      const saved = resultSchema.parse(JSON.parse(props.draft.advisorStorage[resultKey]));
      if (saved.target.id !== props.draft.id) throw new Error("发布建议属于其他制作稿");
      result = { target: saved.target, plan: parseDigitalHumanPublicationPlan(JSON.stringify(saved.plan), saved.target) };
    }
  }
  catch { storedError = "历史发布建议无法读取，原记录已保留。"; }

  async function send() {
    if (lock.current || props.disabled) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    const draftId = props.draft.id;
    let release: (() => void) | undefined;
    try {
      release = props.acquireWork("标题与标签建议");
      let pending = pendingRaw ? pendingSchema.parse(JSON.parse(pendingRaw)) : undefined;
      if (pending && pending.target.id !== props.draft.id) throw new Error("原发布请求属于其他制作稿，请保留记录后核对");
      if (!pending || paymentNeeded) {
        const latest = await quota.refetch();
        if (!latest.data) throw new Error("顾问额度暂不可用，未提交");
        const paid = paymentNeeded || latest.data.remaining === 0 && !latest.data.exempt;
        if (paid && !window.confirm(`标题与标签建议需要${latest.data.price}积分，确认${pending ? "按原编号继续" : "提交当前完整文稿"}？`)) return;
        if (pending) pending = { ...pending, paid: true, credits: latest.data.price };
        else {
          const target = digitalHumanPublicationTargetSchema.parse({ id: props.draft.id, script: props.draft.script });
          const context = manhuaCreativeAdvisorContextSchema.parse({
            seriesTitle: "数字人发布建议", episodeIndex: 1, episodeTitle: "当前文稿", stage: "final", videoModel: "未选择",
            writerConfirmed: true, episodeBody: target.script, assetSummary: "", shotSummary: "", blockers: [],
            digitalHumanPublication: target,
          });
          pending = { id: crypto.randomUUID(), context, target, paid, credits: latest.data.price };
        }
        const savedPending = pending;
        props.save(draft => {
          if (draft.id !== savedPending.target.id) throw new Error("制作稿已切换，未保存或提交其他作品的发布请求");
          return { ...draft, advisorStorage: { ...draft.advisorStorage, [pendingKey]: JSON.stringify(savedPending) } };
        });
        setPaymentNeeded(false);
      }
      // 新提交和恢复均先确认云端保存成功，失败不发送模型请求。
      await props.beforeSubmit();
      const response = await ask.mutateAsync({ requestId: pending.id, question: DIGITAL_HUMAN_PUBLICATION_QUESTION, rawQuestion: DIGITAL_HUMAN_PUBLICATION_QUESTION, manhuaContext: pending.context, confirmPaid: pending.paid || undefined, confirmedCredits: pending.paid ? pending.credits : undefined });
      const plan = parseDigitalHumanPublicationPlan(response.answer, pending.target);
      props.save(draft => {
        if (draft.id !== pending.target.id) throw new Error("制作稿已切换，原发布结果未绑定到其他作品");
        const storage = { ...draft.advisorStorage };
        if (storage[resultKey]) storage[`publication-history:${pending.id}`] = storage[resultKey];
        storage[`publication-response:${pending.id}`] = response.answer;
        storage[resultKey] = JSON.stringify({ target: pending.target, plan });
        delete storage[pendingKey];
        return { ...draft, advisorStorage: storage };
      });
      await props.beforeSubmit();
    } catch (e) {
      setError(messageOf(e));
      if ((e as { data?: { code?: string } })?.data?.code === "PAYMENT_REQUIRED") setPaymentNeeded(true);
      if (messageOf(e).includes("ADVISOR_OPERATION_FAILED")) {
        props.save(draft => {
          if (draft.id !== draftId) return draft;
          const storage = { ...draft.advisorStorage };
          storage[`publication-failed:${Date.now()}`] = JSON.stringify({ request: storage[pendingKey], error: messageOf(e) });
          delete storage[pendingKey];
          return { ...draft, advisorStorage: storage };
        });
        await props.beforeSubmit().catch(() => {});
      }
    } finally { release?.(); lock.current = false; setBusy(false); }
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setNotice("已复制"); setError(""); }
    catch { setError("复制失败，请选中文字手动复制。"); }
  }
  return <section className="dh-card dh-wide">
    <h3>发布标题与标签</h3>
    <p>优先适配抖音、小红书，同时给出视频号建议。基于当前文稿推荐，不修改文稿。</p>
    <p>{quota.data ? `顾问剩余免费${quota.data.remaining}次，超出${quota.data.price}积分/次` : "正在核对顾问额度"}</p>
    <details><summary>本次发送的完整文稿</summary><p>{pendingScript || "请先填写文稿"}</p></details>
    {pendingRaw && pendingScript !== props.draft.script.trim() && <p>正在恢复上一版文稿的原请求；结果返回后可按当前文稿重新推荐。</p>}
    <button type="button" disabled={props.disabled || busy || !pendingRaw && !props.draft.script.trim()} onClick={() => void send()}>{pendingRaw ? "恢复原发布建议请求" : "推荐标题与标签"}</button>
    {(error || storedError) && <p role="alert">{error || storedError}</p>}
    {notice && <p role="status">{notice}</p>}
    {result && <>
      {result.target.script !== props.draft.script.trim() && <p>文稿已变化，下面保留的是上一版建议，请按当前稿件重新推荐。</p>}
      {(["douyin", "xiaohongshu", "weixin_channels"] as const).map(platform => {
        const row = result.plan.platforms.find(item => item.platform === platform)!;
        const tags = row.tags.map(tag => `#${tag.replace(/^#+/, "")}`).join(" ");
        return <div key={platform}>
          <h4>{labels[platform]}</h4>
          <ol>{row.titles.map((title, index) => <li key={index}>{title} <button type="button" onClick={() => void copy(`${title}\n${tags}`)}>复制标题{index + 1}与标签</button></li>)}</ol>
          <p>{tags}</p>
        </div>;
      })}
    </>}
  </section>;
}
