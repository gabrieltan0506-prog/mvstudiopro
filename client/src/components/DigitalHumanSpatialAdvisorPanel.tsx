import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { trpc } from "@/lib/trpc";
import { buildDigitalHumanAdvisorProject } from "@/lib/digitalHumanAdvisor";
import { digitalHumanCurrentAnchors, digitalHumanSceneInputKey, digitalHumanSpatialActors, digitalHumanSpatialCandidatePatch, makeDigitalHumanSpatialTarget } from "@/lib/digitalHumanSpatialAdvisor";
import { manhuaCreativeAdvisorContextSchema } from "@shared/manhuaCreativeAdvisor";
import { digitalHumanSpatialCandidateSchema, parseDigitalHumanSpatialPlan, type DigitalHumanSpatialCandidate } from "@shared/digitalHumanSpatialAdvisor";
import type { DigitalHumanDraft } from "@shared/digitalHumanStudio";
import type { ManhuaWorld3dAssets } from "@shared/manhuaWorld3d";
import { ManhuaWorldStagePreview } from "./canvas/ManhuaWorldStagePreview";

const requestSchema = z.object({ requestId: z.string().uuid(), question: z.string().min(2).max(1200), context: manhuaCreativeAdvisorContextSchema, paid: z.boolean(), credits: z.number().int().positive().optional() });
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
export function DigitalHumanSpatialAdvisorPanel(props: {
  draft: DigitalHumanDraft; getDraft: () => DigitalHumanDraft; world?: ManhuaWorld3dAssets;
  disabled: boolean; storage: Storage; beforeSubmit: () => Promise<void>; acquireWork: (label: string) => () => void;
  onApply: (patch: Partial<DigitalHumanDraft>) => void;
}) {
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  function assertCurrent() {
    const draft = props.getDraft();
    if (!active.current || draft.id !== props.draft.id || draft.owner !== props.draft.owner) throw new Error("制作稿已切换，未写入迟到结果；请在原稿恢复原请求");
  }
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false), lock = useRef(false);
  const [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState("");
  const [paymentNeeded, setPaymentNeeded] = useState(false);
  const [pending, setPending] = useState<z.infer<typeof requestSchema> | undefined>(() => {
    try { const raw = props.storage.getItem("scene-pending"); return raw ? requestSchema.parse(JSON.parse(raw)) : undefined; }
    catch (e) { queueMicrotask(() => { setBlocked(true); setError(`原场景请求读取失败：${message(e)}`); }); return undefined; }
  });
  const [candidate, setCandidate] = useState<DigitalHumanSpatialCandidate | undefined>(() => {
    try { const raw = props.storage.getItem("scene-candidate"); return raw ? digitalHumanSpatialCandidateSchema.parse(JSON.parse(raw)) : undefined; }
    catch (e) { queueMicrotask(() => setError(`原场景方案读取失败：${message(e)}`)); return undefined; }
  });
  const [preview, setPreview] = useState<{ patch: Partial<DigitalHumanDraft>; baseKey: string; candidateKey: string }>();
  const [ready, setReady] = useState(false);
  const onReady = useCallback((value: boolean) => setReady(value), []);
  const ask = trpc.mvAnalysis.askPlatformSkillQa.useMutation({ retry: false });
  const quota = trpc.mvAnalysis.getManhuaAdvisorQuota.useQuery(undefined, { retry: false });
  const currentKey = digitalHumanSceneInputKey(props.draft);
  const currentPreview = preview?.baseKey === currentKey && preview.candidateKey === JSON.stringify(candidate) ? preview : undefined;
  const view = currentPreview ? { ...props.draft, ...currentPreview.patch } : undefined;
  async function send(recover = false) {
    if (lock.current || props.disabled || blocked) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    let release: (() => void) | undefined;
    try {
      release = props.acquireWork("场景站位咨询");
      await props.beforeSubmit(); assertCurrent();
      let request = recover ? pending : undefined;
      if (!request) {
        if (!quota.data || quota.isError) throw new Error("无法核对顾问额度，未提交");
        const draft = props.getDraft(), target = await makeDigitalHumanSpatialTarget(draft);
        assertCurrent();
        if (digitalHumanSceneInputKey(draft) !== digitalHumanSceneInputKey(props.getDraft())) throw new Error("场景已变化，请重新确认输入");
        const context = manhuaCreativeAdvisorContextSchema.parse({ ...buildDigitalHumanAdvisorProject(draft).context, activeStudio: { tool: "world3d", episodeIndex: 1, assetId: draft.worldTaskId }, digitalHumanSpatial: target });
        request = requestSchema.parse({ requestId: crypto.randomUUID(), question: question.trim(), context,
          paid: quota.data.remaining === 0 && !quota.data.exempt, credits: quota.data.price });
        if (request.paid && !window.confirm(`本次场景顾问扣除 ${request.credits} 积分，发送当前人物、已标记地点和要求。确认？`)) return;
      } else if (paymentNeeded) {
        const latest = await quota.refetch();
        if (!latest.data) throw new Error("顾问额度暂不可用");
        if (!window.confirm(`原请求需要 ${latest.data.price} 积分，确认按原编号恢复？`)) return;
        request = { ...request, paid: true, credits: latest.data.price };
      }
      props.storage.setItem("scene-pending", JSON.stringify(request)); setPending(request);
      await props.beforeSubmit(); assertCurrent();
      const key = `scene-answer:${request.requestId}`;
      let answer = props.storage.getItem(key);
      if (!answer) {
        const result = await ask.mutateAsync({ requestId: request.requestId, question: request.question, rawQuestion: request.question,
          manhuaContext: request.context, confirmPaid: request.paid || undefined, confirmedCredits: request.paid ? request.credits : undefined });
        assertCurrent();
        answer = result.answer;
        props.storage.setItem(key, answer);
        await props.beforeSubmit();
      }
      assertCurrent();
      const target = request.context.digitalHumanSpatial;
      if (!target) throw new Error("原请求没有场景身份，未重新发送");
      const next = digitalHumanSpatialCandidateSchema.parse({ target, plan: parseDigitalHumanSpatialPlan(answer, target) });
      props.storage.setItem("scene-candidate", JSON.stringify(next)); setCandidate(next);
      props.storage.removeItem("scene-pending"); setPending(undefined); setPaymentNeeded(false);
      setPreview(undefined); setReady(false);
      await props.beforeSubmit(); await quota.refetch();
    } catch (e) {
      setError(message(e));
      if ((e as { data?: { code?: string } })?.data?.code === "PAYMENT_REQUIRED") setPaymentNeeded(true);
      if (active.current && message(e).includes("ADVISOR_OPERATION_FAILED")) {
        const raw = props.storage.getItem("scene-pending");
        if (raw) props.storage.setItem(`scene-failed:${JSON.parse(raw).requestId}`, raw);
        props.storage.removeItem("scene-pending"); setPending(undefined);
      }
    } finally { release?.(); lock.current = false; setBusy(false); }
  }
  async function trial() {
    if (!candidate || props.disabled || busy || !props.world) return;
    setError(""); setReady(false);
    try {
      assertCurrent();
      const draft = props.getDraft(), baseKey = digitalHumanSceneInputKey(draft);
      const patch = await digitalHumanSpatialCandidatePatch(draft, candidate);
      assertCurrent();
      if (baseKey !== digitalHumanSceneInputKey(props.getDraft())) throw new Error("场景已变化，未开始旧方案试看");
      setPreview({ patch, baseKey, candidateKey: JSON.stringify(candidate) });
    } catch (e) { setPreview(undefined); setError(message(e)); }
  }
  async function adopt() {
    if (lock.current || props.disabled || !candidate || !currentPreview || !ready) return;
    lock.current = true; setBusy(true); setError("");
    let release: (() => void) | undefined;
    try {
      release = props.acquireWork("采用场景站位");
      await props.beforeSubmit();
      assertCurrent();
      const draft = props.getDraft(), baseKey = digitalHumanSceneInputKey(draft);
      const patch = await digitalHumanSpatialCandidatePatch(draft, candidate);
      assertCurrent();
      if (baseKey !== currentPreview.baseKey || baseKey !== digitalHumanSceneInputKey(props.getDraft())) throw new Error("场景已变化，未采用旧方案");
      if (draft.previsStudio?.pending || draft.spatialRenders.some(r => r.state.request && ["submitting", "queued", "running"].includes(r.state.request.status))) throw new Error("空间制作任务仍在运行，请等待原任务回执后再采用");
      props.onApply({ ...patch, advisorStorage: { ...draft.advisorStorage,
        [`scene-before:${candidate.target.sourceRevision}`]: JSON.stringify({ mainStage: draft.mainStage, actors: draft.actors, stageCamera: draft.stageCamera, previsStudio: draft.previsStudio }) } });
      await props.beforeSubmit();
      setPreview(undefined); setReady(false); setNotice("场景站位与机位已保存。旧构图图和白模历史保留，请按新站位重新导图与审片。");
    } catch (e) { setError(message(e)); }
    finally { release?.(); lock.current = false; setBusy(false); }
  }
  return <section className="dh-card" aria-label="数字人3D场景创作顾问">
    <h4>场景创作顾问 · 站位与空间</h4>
    <p>用自然语言安排人物，先在当前3D场景试看，再确认采用。未知地点请在下方场景里点选地面并命名。</p>
    <p>已确认地点：{digitalHumanCurrentAnchors(props.draft).map(a => a.labelZh).join("、") || "暂无，可先使用人物之间的相对站位"}</p>
    <details><summary>本次发送的场景信息</summary><p>{props.draft.sceneDescription}</p><p>{digitalHumanSpatialActors(props.draft).map(a => a.labelZh).join("、")}</p><p>当前人物位置、朝向、已保存机位和已确认地点将随要求发送；不提交渲染或生成视频。</p><pre>{JSON.stringify({ script: props.draft.script, actors: digitalHumanSpatialActors(props.draft).map(a => ({ id: a.id, name: a.labelZh, position: [a.x, a.y], yaw: a.yaw })), anchors: digitalHumanCurrentAnchors(props.draft).map(a => ({ id: a.id, name: a.labelZh, point: a.point })), camera: props.draft.stageCamera ?? "以首位人物为主体的默认全景" }, null, 2)}</pre></details>
    <p>{quota.data ? `免费次数 ${quota.data.remaining}；超出后 ${quota.data.price} 积分/次。` : "正在核对顾问额度"}</p>
    <textarea aria-label="场景站位要求" value={question} maxLength={1200} onChange={e => setQuestion(e.target.value)} placeholder="让讲述者站到已标记的窗边，面向镜头；另一人站在他右侧一米。" />
    <button type="button" disabled={props.disabled || busy || blocked || Boolean(pending) || !props.world || question.trim().length < 2} onClick={() => void send()}>生成场景方案</button>
    {pending && <button type="button" disabled={props.disabled || busy || blocked} onClick={() => void send(true)}>恢复原场景请求</button>}
    {!props.world && <p>请先选择已生成并可查看的3D场景。</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {candidate && <div>
      <p>{candidate.plan.summaryZh}</p>
      {candidate.plan.unresolvedZh.map((text, i) => <p key={i}>{text}</p>)}
      <button type="button" disabled={props.disabled || busy || !props.world || candidate.plan.unresolvedZh.length > 0} onClick={() => void trial()}>在真实场景试看（免费）</button>
      {currentPreview && view && props.world && <>
        <ManhuaWorldStagePreview key={currentPreview.candidateKey} world={props.world} sceneLabelZh="场景方案试看" lockCamera cameraOverride={view.stageCamera} onReadyChange={onReady}
          characters={digitalHumanSpatialActors(view).map(a => ({ id: a.id, assetRef: a.model?.assetRef || a.id, labelZh: a.labelZh, glbUrl: a.model?.glbUrl || "", stagePoint: [a.x, a.y], yawDeg: a.yaw }))} />
        <p>确认画面中的站位、朝向和机位。采用后需重新导出构图图，并按新站位重新建立或调整白模。</p>
        <button type="button" disabled={props.disabled || busy || !ready} onClick={() => void adopt()}>确认采用并保存</button>
        <button type="button" disabled={busy} onClick={() => { setPreview(undefined); setReady(false); }}>取消试看，保留原稿</button>
      </>}
      {preview && !currentPreview && <p>当前场景已经变化，旧试看已失效，请重新咨询或核对方案。</p>}
    </div>}
  </section>;
}
