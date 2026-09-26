import { useEffect, useMemo, useRef, useState } from "react";
import type { PublicManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";
import type { buildManhuaAdvisorProject } from "@/lib/manhuaAdvisorProject";
import { advisorRewriteCandidateSchema, type AdvisorRewriteCandidate } from "@/lib/manhuaAdvisorTemplates";
import { MANHUA_WRITER_EXPAND_CREDITS_PER_EPISODE } from "@shared/manhuaWriterExpandPricing";
import { trpc } from "@/lib/trpc";
import { ManhuaRewriteComparison } from "./ManhuaRewriteComparison";
import { compareScriptSentences } from "@/lib/manhuaSentenceDiff";

const COST_PER_CANDIDATE = MANHUA_WRITER_EXPAND_CREDITS_PER_EPISODE.excellent;
type Slot = 1 | 2;
type Pending = {
  slot: Slot; requestId: string; publicTemplateId: string; nameZh: string;
  episodeNumber: number; sourceMarkdown: string; sourceSha256: string;
};
type Saved = { slot: Slot; requestId: string; publicTemplateId: string; nameZh: string; sourceSha256: string; candidate: AdvisorRewriteCandidate; creditsCost: number };
type RecordData = { pending: Pending | null; candidates: Saved[]; activeRequestId: string | null };
const EMPTY: RecordData = { pending: null, candidates: [], activeRequestId: null };

export type ManhuaOutlineTemplateRewriteProps = {
  userId?: string;
  confirmedProjectVersion?: string;
  project?: ReturnType<typeof buildManhuaAdvisorProject>;
  templates: PublicManhuaViralTemplateCard[];
  onApplyRewrite?: (candidate: AdvisorRewriteCandidate) => boolean;
  onOpenFreePreview?: (publicId: string) => void;
};

function readRecord(key: string): { data: RecordData; error: string } {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { data: EMPTY, error: "" };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") throw new Error("记录格式无效");
    const record = value as Record<string, unknown>;
    if (!Array.isArray(record.candidates) || record.candidates.length > 2) throw new Error("候选历史格式无效");
    const candidates = record.candidates.map((entry): Saved => {
      if (!entry || typeof entry !== "object") throw new Error("候选记录格式无效");
      const item = entry as Record<string, unknown>;
      if ((item.slot !== 1 && item.slot !== 2) || typeof item.requestId !== "string" ||
        typeof item.publicTemplateId !== "string" || typeof item.nameZh !== "string" ||
        typeof item.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sourceSha256) ||
        typeof item.creditsCost !== "number") throw new Error("候选记录格式无效");
      return { slot: item.slot, requestId: item.requestId, publicTemplateId: item.publicTemplateId,
        nameZh: item.nameZh, sourceSha256: item.sourceSha256, creditsCost: item.creditsCost, candidate: advisorRewriteCandidateSchema.parse(item.candidate) };
    });
    let pending: Pending | null = null;
    if (record.pending != null) {
      const item = record.pending as Record<string, unknown>;
      if ((item.slot !== 1 && item.slot !== 2) || typeof item.requestId !== "string" ||
        typeof item.publicTemplateId !== "string" || typeof item.nameZh !== "string" ||
        typeof item.episodeNumber !== "number" || typeof item.sourceMarkdown !== "string" ||
        typeof item.sourceSha256 !== "string") throw new Error("未决请求格式无效");
      pending = item as Pending;
    }
    return { data: { pending, candidates, activeRequestId: typeof record.activeRequestId === "string" ? record.activeRequestId : null }, error: "" };
  } catch { return { data: EMPTY, error: "本机候选或扣费恢复记录无法读取。为保护原记录，已停止新的付费生成；请恢复浏览器存储后刷新。" }; }
}

async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

function isConfirmedUnchargedFailure(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const data = (cause as { data?: unknown }).data;
  return Boolean(data && typeof data === "object" &&
    (data as { code?: unknown }).code === "PRECONDITION_FAILED" &&
    cause instanceof Error && /未扣点/.test(cause.message));
}

function Session(props: ManhuaOutlineTemplateRewriteProps & { storageKey: string | null }) {
  const [initial] = useState(() => props.storageKey ? readRecord(props.storageKey) : { data: EMPTY, error: "" });
  const [record, setRecord] = useState<RecordData>(initial.data);
  const [error, setError] = useState(initial.error);
  const [notice, setNotice] = useState("");
  const [historyFingerprint, setHistoryFingerprint] = useState({ body: "", sha: "" });
  const [selected, setSelected] = useState<Record<Slot, string>>({ 1: "", 2: "" });
  const [comparisonMode, setComparisonMode] = useState<"original" | "candidates">("original");
  const [confirmSlot, setConfirmSlot] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const preparing = useRef(false);
  const adopting = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const mutation = trpc.mvAnalysis.generateManhuaTemplateCandidate.useMutation({ retry: false });
  const active = record.candidates.find(item => item.requestId === record.activeRequestId) || record.candidates.at(-1);
  const currentBody = props.project?.context.episodeBody || "";
  const historySha = historyFingerprint.body === currentBody ? historyFingerprint.sha : "";
  const sourceIsCurrent = Boolean(active && active.candidate.episodeIndex === props.project?.context.episodeIndex && active.candidate.originalBody === currentBody);
  const sourceSafe = Boolean(props.project && currentBody.length >= 300 && currentBody.length <= 8000 && !props.project.contextNotes.some(note => note.includes("本集正文")));
  useEffect(() => {
    let active = true;
    setHistoryFingerprint({ body: "", sha: "" });
    if (props.storageKey && sourceSafe) void sha256(currentBody).then(value => { if (active) setHistoryFingerprint({ body: currentBody, sha: value }); });
    return () => { active = false; };
  }, [props.storageKey, sourceSafe, currentBody]);
  const historyQuery = trpc.mvAnalysis.listManhuaTemplateCandidateHistory.useQuery({
    episodeNumber: props.project?.context.episodeIndex || 1,
    sourceSha256: historySha || "0".repeat(64),
  }, { enabled: Boolean(props.storageKey && sourceSafe && historySha), retry: false });
  const first = record.candidates.find(item => item.slot === 1);
  const second = record.candidates.find(item => item.slot === 2);
  const effectiveTemplateId = (slot: Slot) => record.candidates.find(item => item.slot === slot)?.publicTemplateId || selected[slot];
  const candidatesMatchCurrentSource = record.candidates.every(item =>
    item.candidate.episodeIndex === props.project?.context.episodeIndex && item.candidate.originalBody === currentBody);
  const candidatesShareSource = Boolean(first && second &&
    first.candidate.originalBody === second.candidate.originalBody && first.sourceSha256 === second.sourceSha256);
  const canPay = Boolean(props.userId && props.storageKey && sourceSafe && historyQuery.isSuccess && candidatesMatchCurrentSource &&
    !initial.error && !error && !record.pending && !busy);
  const candidateRows = useMemo(() => first && second
    ? compareScriptSentences(first.candidate.rewrittenBody, second.candidate.rewrittenBody) : [],
    [first?.candidate.rewrittenBody, second?.candidate.rewrittenBody]);

  useEffect(() => {
    if (!props.storageKey || !historySha || !historyQuery.data?.candidates.length) return;
    const current = readRecord(props.storageKey);
    if (current.error || current.data.pending) return;
    const next = [...current.data.candidates];
    try {
      for (const item of historyQuery.data.candidates) {
        if (item.sourceSha256 !== historySha || item.episodeNumber !== props.project?.context.episodeIndex ||
          next.some(saved => saved.requestId === item.requestId || saved.publicTemplateId === item.publicTemplate.publicId)) continue;
        const slot: Slot | null = next.some(saved => saved.slot === 1) ? next.some(saved => saved.slot === 2) ? null : 2 : 1;
        if (!slot) break;
        const candidate = advisorRewriteCandidateSchema.parse({
          episodeIndex: item.episodeNumber, originalBody: currentBody,
          rewrittenBody: item.candidateMarkdown, changes: item.changes,
        });
        next.push({ slot, requestId: item.requestId, publicTemplateId: item.publicTemplate.publicId,
          nameZh: item.publicTemplate.nameZh, sourceSha256: historySha,
          creditsCost: item.creditsCost, candidate });
      }
      if (next.length === current.data.candidates.length) return;
      const updated: RecordData = { ...current.data, candidates: next,
        activeRequestId: current.data.activeRequestId || next[0]?.requestId || null };
      localStorage.setItem(props.storageKey, JSON.stringify(updated));
      if (latest.current.storageKey === props.storageKey) setRecord(updated);
    } catch { setError("已付费候选历史无法安全恢复；原本机记录未覆盖，请稍后刷新核对。"); }
  }, [historyQuery.data, historySha, props.storageKey, props.project?.context.episodeIndex, currentBody, record.pending?.requestId]);

  function save(next: RecordData): boolean {
    if (!props.storageKey) { setError("请先确认项目，才能保存付费候选和恢复编号。"); return false; }
    try { localStorage.setItem(props.storageKey, JSON.stringify(next)); setRecord(next); setError(""); return true; }
    catch { setError("本机无法保存候选或恢复编号，本次未发起新的付费请求。请清理浏览器存储后重试。"); return false; }
  }

  async function submit(pending: Pending) {
    if (inFlight.current || !props.storageKey) return;
    inFlight.current = true;
    setBusy(true);
    const storageKey = props.storageKey;
    try {
      const response = await mutation.mutateAsync({
        requestId: pending.requestId, publicTemplateId: pending.publicTemplateId,
        episodeNumber: pending.episodeNumber, sourceMarkdown: pending.sourceMarkdown,
        sourceSha256: pending.sourceSha256, tier: "excellent", confirmPaid: true,
      });
      if (response.requestId !== pending.requestId || response.sourceSha256 !== pending.sourceSha256 ||
        response.episodeNumber !== pending.episodeNumber || response.originalBody !== pending.sourceMarkdown ||
        response.rewrittenBody !== response.candidateMarkdown ||
        response.publicTemplate.publicId !== pending.publicTemplateId || response.creditsCost > COST_PER_CANDIDATE || response.creditsCost < 0) {
        throw new Error("候选回执与原请求不一致；恢复编号已保留，请暂停并核对。 ");
      }
      const candidate = advisorRewriteCandidateSchema.parse({
        episodeIndex: pending.episodeNumber, originalBody: pending.sourceMarkdown,
        rewrittenBody: response.candidateMarkdown, changes: response.changes,
      });
      const fresh = readRecord(storageKey);
      if (fresh.error) throw new Error(fresh.error);
      const candidates = fresh.data.candidates.some(item => item.requestId === pending.requestId)
        ? fresh.data.candidates
        : [...fresh.data.candidates.filter(item => item.slot !== pending.slot), {
          slot: pending.slot, requestId: pending.requestId, publicTemplateId: pending.publicTemplateId,
          nameZh: pending.nameZh, sourceSha256: pending.sourceSha256, creditsCost: response.creditsCost, candidate,
        }];
      const next: RecordData = { pending: null, candidates, activeRequestId: pending.requestId };
      localStorage.setItem(storageKey, JSON.stringify(next));
      if (latest.current.storageKey === storageKey) { setRecord(next); setError(""); }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "候选回执暂不可用";
      if (isConfirmedUnchargedFailure(cause)) {
        const fresh = readRecord(storageKey);
        if (!fresh.error && fresh.data.pending?.requestId === pending.requestId) {
          const next = { ...fresh.data, pending: null };
          try {
            localStorage.setItem(storageKey, JSON.stringify(next));
            if (latest.current.storageKey === storageKey) {
              setRecord(next);
              setError("");
              setNotice(`${message}。服务端确认本次未扣点，已释放原请求编号；可重新选择并确认付费生成。`);
            }
            return;
          } catch { /* 记录未能安全写回时保留原 pending。 */ }
        }
      }
      if (latest.current.storageKey === storageKey) setError(`${message}。结算或回执状态未确认，恢复时沿用原请求编号，不会自动再次发起。`);
    } finally { inFlight.current = false; setBusy(false); }
  }

  async function confirmGeneration(slot: Slot) {
    if (preparing.current || !canPay || !props.project || !props.storageKey || record.candidates.some(item => item.slot === slot)) return;
    const card = props.templates.find(item => item.publicId === selected[slot]);
    if (!card || effectiveTemplateId(1) === effectiveTemplateId(2)) { setError("请选择两张不同的已审核模板卡。"); return; }
    preparing.current = true;
    setBusy(true);
    setNotice("");
    const sourceMarkdown = props.project.context.episodeBody;
    const episodeNumber = props.project.context.episodeIndex;
    const storageKey = props.storageKey;
    try {
      const sourceSha256 = await sha256(sourceMarkdown);
      if (latest.current.storageKey !== storageKey || latest.current.project?.context.episodeBody !== sourceMarkdown) {
        setError("原稿已改变，请重新核对后再确认付费。"); return;
      }
      const fresh = readRecord(storageKey);
      if (fresh.error || fresh.data.pending || fresh.data.candidates.some(item => item.slot === slot)) {
        setError(fresh.error || "另一个请求正在恢复或本版已有候选，请刷新后核对。"); return;
      }
      if (fresh.data.candidates.some(item => item.candidate.originalBody !== sourceMarkdown ||
        item.candidate.episodeIndex !== episodeNumber || item.sourceSha256 !== sourceSha256 ||
        item.publicTemplateId === card.publicId)) {
        setError("已保存候选的原稿或模板与本次不同，未发起新的付费请求；请先核对当前项目。"); return;
      }
      const pending: Pending = { slot, requestId: crypto.randomUUID(), publicTemplateId: card.publicId,
        nameZh: card.nameZh, episodeNumber, sourceMarkdown, sourceSha256 };
      if (!save({ ...fresh.data, pending })) return;
      setConfirmSlot(null);
      await submit(pending);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法核对当前原稿，本次未发起付费生成。"); }
    finally { preparing.current = false; setBusy(false); }
  }

  function recover() {
    if (!record.pending || busy) return;
    void submit(record.pending);
  }

  function selectCandidate(requestId: string) { save({ ...record, activeRequestId: requestId }); }

  async function adopt() {
    if (adopting.current || record.candidates.length !== 2 || !candidatesShareSource || !active || !sourceIsCurrent || !props.onApplyRewrite) return;
    adopting.current = true;
    try {
      const sourceHash = await sha256(currentBody);
      if (record.candidates.some(item => item.sourceSha256 !== sourceHash) ||
        latest.current.project?.context.episodeBody !== currentBody) {
        setError("当前正文已改变，候选仅保留供比较；未采用。"); return;
      }
      if (!props.onApplyRewrite(active.candidate)) setError("采用前的项目保护检查未通过，正式稿未改动。");
    } catch { setError("无法核对当前原稿，正式稿未改动。"); }
    finally { adopting.current = false; }
  }

  return <section aria-label="剧本大纲剧情增强模板" className="min-w-0 space-y-3 rounded-xl border border-violet-300/35 bg-[#10171f] p-4 text-xs text-white shadow-xl">
    <div><h3 className="text-sm font-semibold text-violet-100">剧情增强模板 · 两版对比</h3><p className="mt-1 text-white/65">自己选两张已审核模板，完整剧本候选各生成一次，先看高亮差异，确认后才采用。创作顾问只提供辅助建议。</p></div>
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-300/20 bg-cyan-500/5 p-3">
      <div><strong className="text-cyan-100">免费梗概预览</strong><p className="mt-1 text-white/60">第 1 集精简梗概试写，不改当前完整正文。</p></div>
      <button type="button" disabled={!props.onOpenFreePreview || !effectiveTemplateId(1)} onClick={() => props.onOpenFreePreview?.(effectiveTemplateId(1))} className="rounded border border-cyan-300/40 px-3 py-2 text-cyan-100 disabled:opacity-40">按候选 1 所选模板前往免费梗概预览</button>
    </div>
    <div className="rounded-lg border border-amber-300/25 bg-amber-400/5 p-3"><strong className="text-amber-100">付费完整剧本候选</strong><p className="mt-1 text-white/70">优秀档 {COST_PER_CANDIDATE} 积分／版；两版共 {COST_PER_CANDIDATE * 2} 积分。每版在确认后单独提交和扣费；只生成候选，不覆盖正式稿。</p></div>
    <div className="grid gap-3 md:grid-cols-2">{([1, 2] as const).map(slot => {
      const saved = record.candidates.find(item => item.slot === slot);
      return <div key={slot} className="rounded-lg border border-white/15 p-3">
        <label className="block font-semibold text-white/85" htmlFor={`manhua-outline-template-${slot}`}>候选 {slot} · 选择模板</label>
        <select id={`manhua-outline-template-${slot}`} aria-label={`候选 ${slot} 选择剧情增强模板`} value={saved?.publicTemplateId || selected[slot]} onChange={event => setSelected(current => ({ ...current, [slot]: event.target.value }))} disabled={Boolean(saved) || Boolean(record.pending) || busy} className="mt-2 w-full rounded border border-white/20 bg-slate-950 px-2 py-2 text-white disabled:opacity-50">
          <option value="">请选择已审核模板</option>{props.templates.map(card => <option key={card.publicId} value={card.publicId}>{card.nameZh}</option>)}
        </select>
        {saved ? <p className="mt-2 text-emerald-100">已保存完整候选 · 实扣回执 {saved.creditsCost} 积分</p> : <button type="button" disabled={!canPay || !selected[slot] || effectiveTemplateId(1) === effectiveTemplateId(2)} onClick={() => setConfirmSlot(slot)} className="mt-2 rounded border border-amber-300/40 px-3 py-2 text-amber-100 disabled:opacity-40">生成候选 {slot} · {COST_PER_CANDIDATE} 积分</button>}
        {confirmSlot === slot && <div role="alertdialog" aria-label={`确认付费生成候选 ${slot}`} className="mt-2 rounded border border-amber-300/50 bg-slate-900 p-3"><p>确认按「{props.templates.find(card => card.publicId === selected[slot])?.nameZh}」生成当前集完整候选？本版收费 {COST_PER_CANDIDATE} 积分；另一版另行确认。生成后先对比，不自动采用。</p><div className="mt-2 flex gap-2"><button type="button" onClick={() => void confirmGeneration(slot)} className="rounded border border-amber-300/50 px-2 py-1">确认付费生成</button><button type="button" onClick={() => setConfirmSlot(null)} className="px-2 py-1">取消</button></div></div>}
      </div>;
    })}</div>
    {record.pending && <div role="alert" className="rounded border border-amber-300/40 p-3 text-amber-100"><p>候选 {record.pending.slot} 的回执未决。恢复沿用原请求编号；在恢复前不能提交新候选。</p><button type="button" disabled={busy} onClick={recover} className="mt-2 rounded border border-amber-300/40 px-2 py-1 disabled:opacity-40">恢复原请求回执</button></div>}
    {busy && <p role="status" className="text-cyan-100">完整候选生成中，请保持页面开启…</p>}
    {record.candidates.length > 0 && <div aria-label="改写候选历史" className="flex flex-wrap gap-2">{record.candidates.map(item => <button key={item.requestId} type="button" aria-pressed={active?.requestId === item.requestId && comparisonMode === "original"} onClick={() => { selectCandidate(item.requestId); setComparisonMode("original"); }} className="rounded border border-cyan-300/40 px-3 py-2 text-cyan-100 aria-pressed:bg-cyan-400/20">候选 {item.slot} · {item.nameZh} vs 原稿</button>)}{first && second && <button type="button" aria-pressed={comparisonMode === "candidates"} onClick={() => setComparisonMode("candidates")} className="rounded border border-violet-300/40 px-3 py-2 text-violet-100 aria-pressed:bg-violet-400/20">两版并列比较</button>}</div>}
    {comparisonMode === "candidates" && first && second && <div aria-label="两版候选并列对比" className="rounded-lg border border-violet-300/25 p-3"><h4 className="mb-2 font-semibold">候选 1「{first.nameZh}」与候选 2「{second.nameZh}」</h4><p className="mb-2 text-white/65">左侧候选 1，右侧候选 2；红色为候选 1 独有，绿色为候选 2 独有，黄色为修改。点击上方候选可与原稿比较并采用。</p><div tabIndex={0} className="max-h-[60vh] overflow-auto rounded border border-white/20"><table className="w-full min-w-[520px] table-fixed text-left text-sm"><thead className="sticky top-0 bg-slate-900"><tr><th scope="col" className="w-1/2 p-3">候选 1 · {first.nameZh}</th><th scope="col" className="w-1/2 p-3">候选 2 · {second.nameZh}</th></tr></thead><tbody>{candidateRows.map((row, index) => <tr key={index} data-candidate-diff-kind={row.kind}><td className={`whitespace-pre-wrap break-words border-t border-white/10 p-3 align-top ${row.kind === "removed" ? "bg-rose-400/15 text-rose-100" : row.kind === "changed" ? "bg-amber-400/15 text-amber-100" : ""}`}>{row.before || "—"}</td><td className={`whitespace-pre-wrap break-words border-t border-white/10 p-3 align-top ${row.kind === "added" ? "bg-emerald-400/15 text-emerald-100" : row.kind === "changed" ? "bg-amber-400/15 text-amber-100" : ""}`}>{row.after || "—"}</td></tr>)}</tbody></table></div></div>}
    {active && comparisonMode === "original" && <div aria-label="改写原稿对比" className="space-y-2 rounded-lg border border-emerald-300/25 p-3"><h4 className="font-semibold">第 {active.candidate.episodeIndex} 集 · {active.nameZh}</h4><ul>{active.candidate.changes.map((change, index) => <li key={index}>• {change}</li>)}</ul><ManhuaRewriteComparison before={active.candidate.originalBody} after={active.candidate.rewrittenBody} /><button type="button" disabled={record.candidates.length !== 2 || !candidatesShareSource || !sourceIsCurrent || !props.onApplyRewrite || busy} onClick={() => void adopt()} className="rounded border border-emerald-300/40 px-3 py-2 text-emerald-100 disabled:opacity-40">确认采用这版改写</button>{record.candidates.length !== 2 && <p className="text-amber-100">先生成并比较两版完整候选，再选择采用其中一版。</p>}{!sourceIsCurrent || record.candidates.length === 2 && !candidatesShareSource ? <p className="text-amber-100">当前正文或两版候选原稿不一致，已禁止覆盖；候选仍可查看。</p> : null}</div>}
    {!props.userId && <p className="text-amber-100">登录后才能生成付费候选。</p>}
    {!props.confirmedProjectVersion && <p className="text-amber-100">请先确认项目，以保存候选与扣费恢复编号。</p>}
    {!sourceSafe && <p className="text-amber-100">当前集完整正文需为 300–8000 字，且不能是节选；请核对原稿后再生成完整候选。</p>}
    {historyQuery.isError && <p role="alert" className="text-amber-100">已付费候选历史暂不能核对，已暂停新的付费生成；请稍后刷新。</p>}
    {!candidatesMatchCurrentSource && <p role="status" className="text-amber-100">当前正文与已保存候选原稿不一致，已暂停新的付费生成；旧候选仍可查看。</p>}
    {error && <p role="alert" className="text-rose-100">{error}</p>}
    {notice && <p role="alert" className="text-amber-100">{notice}</p>}
  </section>;
}

export default function ManhuaOutlineTemplateRewrite(props: ManhuaOutlineTemplateRewriteProps) {
  const storageKey = props.userId && props.confirmedProjectVersion && props.project
    ? `mvs:manhua-template-candidates:v1:${encodeURIComponent(props.userId)}:${encodeURIComponent(props.project.context.seriesTitle)}:${encodeURIComponent(props.confirmedProjectVersion)}:${props.project.context.episodeIndex}` : null;
  const identity = storageKey || JSON.stringify([props.userId || "guest", props.project?.context.seriesTitle, props.project?.context.episodeIndex, props.project?.context.episodeBody]);
  return <Session key={identity} {...props} storageKey={storageKey} />;
}
