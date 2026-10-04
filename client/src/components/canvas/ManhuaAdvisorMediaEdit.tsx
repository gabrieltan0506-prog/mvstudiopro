import type { CreativeVoiceProductionAction } from "@shared/creativeVoiceProduction";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { canvasImageCredits } from "@shared/canvasGenerationPricing";
import { assertAdvisorMediaSource, prepareAdvisorMediaPlan, type AdvisorMediaPlan, type AdvisorMediaSource } from "@shared/manhuaAdvisorMediaEdit";
import { runAdvisorImageEdit } from "@/lib/advisorMediaImageJob";

type Receipt = { variant: "flare" | "sunburst"; status: "submitting" | "pending" | "done" | "failed"; jobId?: string; url?: string };
type Record = { id: string; plan: AdvisorMediaPlan; previews: Receipt[]; result?: Receipt };
type MediaOperation = Extract<CreativeVoiceProductionAction, {action:"media"}>["operation"];
export type AdvisorMediaEditHandle = { propose: (value: unknown) => string; execute: (operation: MediaOperation) => Promise<string> };
export type AdvisorMediaWorkspace = {
  sources: AdvisorMediaSource[]; disabled?: boolean;
  validate: (plan: AdvisorMediaPlan) => void;
  applyImage: (plan: AdvisorMediaPlan, url: string) => void;
  editVideo: (plan: AdvisorMediaPlan) => string;
};
export const ManhuaAdvisorMediaEdit = forwardRef<AdvisorMediaEditHandle, {
  scopeKey: string; userId: string; onAsk?: (text: string) => void; onReview?: (source: AdvisorMediaSource) => void; workspace: AdvisorMediaWorkspace; exempt?: boolean; consulting?: boolean;
}>((props, ref) => {
  const key = `advisor-media-edit:${props.scopeKey}`;
  const [record, setRecord] = useState<Record | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [instruction, setInstruction] = useState(""), [selected, setSelected] = useState("");
  const recordRef = useRef<Record | null>(null), lock = useRef(false), alive = useRef(true), blocked = useRef(false);
  const current = useRef(props); current.current = props;
  useEffect(() => { alive.current = true;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) { const value = JSON.parse(raw) as Record;
        // Restored data is displayed and queried only; it can never start a new generation by itself.
        if (!value?.plan?.source || !Array.isArray(value.previews) || typeof value.id !== "string") throw new Error();
        prepareAdvisorMediaPlan(value.plan && { kind: value.plan.kind, blockId: value.plan.blockId, instruction: value.plan.instruction }, [value.plan.source]);
        for (const r of [...value.previews, ...(value.result ? [value.result] : [])]) if (!["flare", "sunburst"].includes(r.variant) || !["submitting", "pending", "done", "failed"].includes(r.status)) throw new Error();
        recordRef.current = value; setRecord(value); setInstruction(value.plan.instruction); setSelected(value.plan.blockId);
      }
    } catch { blocked.current = true; setError("修改记录读取失败，原始记录保留，请先下载备份；不能提交新任务。"); }
    return () => { alive.current = false; };
  }, [key]);
  function save(value: Record) {
    window.localStorage.setItem(key, JSON.stringify(value)); recordRef.current = value;
    if (alive.current) setRecord(value);
  }
  function pending(r = recordRef.current) { return r && [...r.previews, ...(r.result ? [r.result] : [])].some(x => x.status === "submitting" || x.status === "pending"); }
  function propose(value: unknown) {
    if (lock.current || blocked.current || pending() || current.current.workspace.disabled) throw new Error("已有任务未决或工作区忙，请先处理原任务");
    const plan = prepareAdvisorMediaPlan(value, current.current.workspace.sources);
    current.current.workspace.validate(plan);
    const old = recordRef.current;
    if (old) window.localStorage.setItem(`${key}:history:${old.id}`, JSON.stringify(old));
    save({ id: crypto.randomUUID(), plan, previews: [] }); setInstruction(plan.instruction); setSelected(plan.blockId); setError("");
    return `${plan.source.label}修改方案已放入顾问的图片／视频编辑区，等待用户查看提示词并确认。尚未生成、未扣出图费用。图片必须先Flare预览，再由用户点击确认生成Sunburst；不得自动调用。`;
  }
  async function execute(operation: MediaOperation): Promise<string> {
    const r = recordRef.current;
    if (!r) throw new Error("请先保存图片或视频修改方案，再执行。");
    if (operation === "inspect") return JSON.stringify(r);
    if (lock.current || blocked.current || !alive.current || current.current.workspace.disabled || current.current.consulting) throw new Error("工作区忙或记录未恢复，请保留原任务。");
    if (instruction !== r.plan.instruction) throw new Error("修改要求已变，请先保存新方案。");
    if (operation === "applyImage") {
      if (r.plan.kind !== "image" || r.result?.status !== "done" || !r.result.url) throw new Error("尚无已完成的Sunburst图片可采用。");
      current.current.workspace.validate(r.plan);
      if (!window.confirm("采用这张Sunburst图片？原图保留在版本历史。")) return "用户取消，未采用图片。";
      current.current.workspace.applyImage(r.plan,r.result.url);
      return "已采用Sunburst图片，原图保留在版本历史。";
    }
    if (operation === "editVideo") {
      if (r.plan.kind !== "video") throw new Error("当前不是视频修改方案。");
      current.current.workspace.validate(r.plan);
      return current.current.workspace.editVideo(r.plan);
    }
    if (r.plan.kind !== "image") throw new Error("当前不是图片修改方案。");
    if (operation === "resumeMedia") {
      const receipt = [...r.previews,...(r.result?[r.result]:[])].find(x=>x.status==="pending" || x.status==="submitting");
      if (!receipt) return "没有在途图片任务；已失败可重新生成，已有成功结果无需重试。";
      if (!receipt.jobId) throw new Error("提交结果未知且没有编号，须先对账，未重新下单。");
      await generate(receipt.variant,true);
    } else {
      await generate(operation === "previewImage" ? "flare" : "sunburst");
    }
    return JSON.stringify({changed:recordRef.current !== r,record:recordRef.current,note:"只以回执status与jobId判断结果；取消或失败不算完成。"});
  }
  useImperativeHandle(ref, () => ({ propose, execute }));
  async function generate(variant: "flare" | "sunburst", resume = false) {
    const r = recordRef.current;
    if (!r || lock.current || blocked.current || !alive.current || current.current.workspace.disabled || current.current.consulting) return;
    const last = r.previews[r.previews.length - 1];
    let receipt = variant === "flare" ? last : r.result;
    let active = r;
    const update = (next: Receipt) => {
      receipt = next;
      active = variant === "flare" ? { ...active, previews: [...active.previews.slice(0, -1), next] } : { ...active, result: next };
      save(active);
    };
    try {
      if (resume) { if (!receipt?.jobId) throw new Error("没有收到任务编号，提交结果未知；禁止重复提交，请核查任务记录。"); }
      else {
        if (pending(r)) throw new Error("先查询原任务，不能重复提交");
        assertAdvisorMediaSource(r.plan, current.current.workspace.sources); current.current.workspace.validate(r.plan);
        if (variant === "sunburst" && (!last?.url || last.status !== "done")) throw new Error("请先生成并查看Flare预览");
        if (variant === "sunburst" && r.result?.status === "done") throw new Error("已有Sunburst结果，请先查看");
        const price = current.current.exempt ? "管理员免扣积分，上游有实际成本" : `${canvasImageCredits()}积分／张，Flare与Sunburst同价，分别计费`;
        if (!window.confirm(`${variant === "flare" ? "生成Flare修改预览" : "我确认这版Flare修改效果，生成Sunburst图片"}\n${r.plan.source.label}\n${r.plan.instruction}\n${price}。继续？`)) return;
        current.current.workspace.validate(r.plan);
        receipt = { variant, status: "submitting" };
        if (r.previews.length || r.result) window.localStorage.setItem(`${key}:history:${r.id}:${crypto.randomUUID()}`, JSON.stringify(r));
        active = variant === "flare" ? { ...r, result: undefined, previews: [...r.previews, receipt] } : { ...r, result: receipt };
        save(active); // persist intent BEFORE submitting, so an uncertain receipt can never be retried silently
      }
      lock.current = true; setBusy(true); setError("");
      const url = await runAdvisorImageEdit({ plan: r.plan, variant, userId: current.current.userId,
        previewUrl: variant === "sunburst" ? last?.url : undefined, jobId: resume ? receipt?.jobId : undefined,
        onJob: jobId => update({ variant, status: "pending", jobId }),
      });
      update({ ...receipt!, status: "done", url });
    } catch (e) {
      if ((e as { terminal?: boolean }).terminal && receipt) update({ ...receipt, status: "failed" });
      if (alive.current) setError(e instanceof Error ? e.message : "请求未完成，保留原任务；不会自动重试");
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  function download() {
    const raw = window.localStorage.getItem(key) || "{}"; const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "图片视频修改记录.json"; a.click(); URL.revokeObjectURL(url);
  }
  const disabled = Boolean(props.workspace.disabled || props.consulting || busy || blocked.current), unresolved = Boolean(pending(record));
  const preview = record?.previews[record.previews.length - 1];
  const button = "rounded border border-cyan-300/40 px-3 py-2 disabled:opacity-40";
  return <section aria-label="顾问图片与视频编辑" className="space-y-3 rounded-xl border border-cyan-300/25 p-3 text-sm">
    <h3 className="font-semibold">图片与视频修改</h3>
    <p className="text-xs opacity-70">图片：Flare预览 → 你确认 → Sunburst出图 → 选择采用。两个模型同价，每次生成分别计费。</p>
    <select aria-label="选择修改素材" value={selected} disabled={disabled || unresolved} onChange={e => setSelected(e.target.value)} className="w-full rounded bg-slate-900 p-2">
      <option value="">选择当前作品的素材</option>{props.workspace.sources.map(s => <option value={s.blockId} key={s.blockId}>{s.label}</option>)}
    </select>
    {props.onReview && <button className={button} disabled={disabled || unresolved || !props.workspace.sources.some(s => s.blockId === selected && s.kind === "video")} onClick={() => { const source = props.workspace.sources.find(s => s.blockId === selected && s.kind === "video"); if (source && window.confirm("把所选影片发送给Gemini Flash审阅音画？计入本作品顾问次数，超出免费次数仍先确认扣点。")) props.onReview?.(source); }}>审阅所选影片 · Gemini Flash</button>}
    <textarea aria-label="图片视频修改要求" maxLength={2000} rows={3} value={instruction} disabled={disabled || unresolved} onChange={e => setInstruction(e.target.value)} placeholder="例如：保留人物身份，把背景改成月夜，左侧增加暖色灯光。" className="w-full rounded border border-white/20 bg-black/20 p-2" />
    {props.onAsk && <button className={button} disabled={disabled || unresolved || !selected || instruction.trim().length < 2 || instruction.length > 950} onClick={() => props.onAsk?.(`素材编号：${selected}；我的要求：${instruction}`)}>让顾问整理修改要求</button>}
    <button className={button} disabled={disabled || unresolved || !selected || instruction.trim().length < 2} onClick={() => { try { const source = props.workspace.sources.find(s => s.blockId === selected); propose({ kind: source?.kind, blockId: selected, instruction }); } catch (e) { setError((e as Error).message); } }}>保存修改方案</button>
    {record && <>
      <p className="font-medium">当前方案 · {record.plan.source.label}</p><p className="whitespace-pre-wrap">{record.plan.instruction}</p>
      {instruction !== record.plan.instruction && <p className="text-amber-200">修改要求已变，请先保存新方案；旧预览不会用于新要求。</p>}
      <div className="grid grid-cols-2 gap-2">
        <figure>{record.plan.kind === "image" ? <img src={record.plan.source.url} alt="原图" className="max-h-64 w-full object-contain" /> : <video src={record.plan.source.url} controls className="max-h-64 w-full" />}<figcaption>原素材</figcaption></figure>
        {preview?.url && <figure><img src={preview.url} alt="Flare修改预览" className="max-h-64 w-full object-contain"/><figcaption>Flare预览</figcaption></figure>}
        {record.result?.url && <figure><img src={record.result.url} alt="Sunburst修改结果" className="max-h-64 w-full object-contain"/><figcaption>Sunburst结果</figcaption><a href={record.result.url} target="_blank" rel="noreferrer">打开图片</a></figure>}
      </div>
      {record.plan.kind === "image" ? <div className="flex flex-wrap gap-2">
        <button className={button} disabled={disabled || unresolved || instruction !== record.plan.instruction} onClick={() => void generate("flare")}>生成Flare预览</button>
        <button className={button} disabled={disabled || unresolved || !preview?.url || preview.status !== "done" || record.result?.status === "done" || instruction !== record.plan.instruction} onClick={() => void generate("sunburst")}>我确认，生成Sunburst</button>
        {[preview, record.result].filter((r): r is Receipt => Boolean(r && (r.status === "pending" || r.status === "submitting"))).map(r => <button key={r.variant} className={button} disabled={disabled || !r.jobId} onClick={() => void generate(r.variant, true)}>查询{r.variant}原任务（不重提）</button>)}
        {record.result?.url && <button className={button} disabled={disabled || instruction !== record.plan.instruction} onClick={() => { try { if (!window.confirm("采用这张Sunburst图片？原图保留在版本历史。")) return; props.workspace.applyImage(record.plan, record.result!.url!); setError("已采用，原图保留在版本历史。"); } catch (e) { setError((e as Error).message); } }}>采用Sunburst图片</button>}
      </div> : <button className={button} disabled={disabled || instruction !== record.plan.instruction} onClick={() => { if (lock.current) return; lock.current = true; try { setError(props.workspace.editVideo(record.plan)); } catch(e) { setError((e as Error).message); } finally { lock.current = false; } }}>提交Seedance视频编辑（先确认）</button>}
      {unresolved && <p className="text-xs text-amber-200">任务正在处理或回执未决。刷新后查询原编号；没有编号时请核查任务记录，不要重新生成。</p>}
      <button className={button} onClick={download}>下载修改记录</button>
    </>}
    {error && <p role="status" className="whitespace-pre-wrap text-amber-200">{error}</p>}
    {blocked.current && <button className={button} onClick={download}>下载原始备份</button>}
  </section>;
});
