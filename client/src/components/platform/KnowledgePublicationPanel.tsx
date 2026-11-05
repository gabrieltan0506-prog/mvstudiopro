import {knowledgePresentationRangeSchema,knowledgePresentationPlanSchema,knowledgePresentationCapacityIssues,assertKnowledgePresentationCapacity,validateKnowledgePresentationRevision,type KnowledgePresentationPlan} from "@shared/knowledgePresentation";
import { knowledgePublicationTemplates, resolveKnowledgePublicationTemplate } from "@shared/knowledgePublicationTemplates";
import { useEffect, useRef, useState } from "react";
import type { EditableLayout } from "@shared/editableLayout";
import {
  knowledgeReviewBatches,
  knowledgeBatchRequestId,
  knowledgeBatchResultSchema,
  knowledgeConsistencyBatchResultSchema,
  knowledgeReviewSchema,
  knowledgeManuscript,
  parseKnowledgeManuscript,
  KNOWLEDGE_PUBLICATION_QUESTION,
} from "@shared/knowledgePublication";
import {
  knowledgePublicationHead,
  knowledgePublicationChapter,
} from "@shared/knowledgePublicationHtml";
import { trpc } from "@/lib/trpc";
import { streamManhuaAdvisor } from "@/lib/manhuaAdvisorStream";
import { flyDownloadUrl } from "@/lib/gcsTransfer";
import { knowledgePublicationPublicError } from "@shared/knowledgePublicationPublic";

type Saved = { generation: string };
const button =
  "rounded-lg border border-[#b9c4ad] px-4 py-2 text-sm disabled:opacity-40";
export default function KnowledgePublicationPanel({
  doc,
  commit,
  onChange,
  onBusy,
  autoStart = false,
}: {
  doc: EditableLayout;
  commit: (doc: EditableLayout) => Promise<Saved>;
  onChange: (doc: EditableLayout) => void;
  onBusy: (value: boolean) => void;
  autoStart?: boolean;
}) {
  const utils = trpc.useUtils();
  const exporter = trpc.editableLayout.exportPublication.useMutation();
  const pptxExporter = trpc.editableLayout.exportPublicationPptx.useMutation();
  const [minSlides,setMinSlides]=useState(doc.publication?.presentationRequest?.minSlides ?? 15);
  const [maxSlides,setMaxSlides]=useState(doc.publication?.presentationRequest?.maxSlides ?? 20);
  const [planDraft,setPlanDraft]=useState<KnowledgePresentationPlan|null>(null);
  const [revisionError,setRevisionError]=useState("");
  const [pptxFile,setPptxFile]=useState<{pptxUrl:string;slides:number}|null>(null);
  const latest = useRef(doc);
  latest.current = doc;
  const active = useRef(false),
    started = useRef("");
  const alive = useRef(true);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [terminal, setTerminal] = useState(false),
    [manual, setManual] = useState(false),
    [onlyIssues, setOnlyIssues] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [files, setFiles] = useState<{
    htmlUrl: string;
    pdfUrl?: string;
    pdfError?: string;
  } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setFiles(null);
    setPptxFile(null);
    setPageIndex(0);
    setPlanDraft(null);setRevisionError("");
    setMinSlides(doc.publication?.presentationRequest?.minSlides ?? 15);
    setMaxSlides(doc.publication?.presentationRequest?.maxSlides ?? 20);
    setError("");
    setTerminal(false);
  }, [doc.id]);
  const locked = (value: boolean) => {
    active.current = value;
    setBusy(value);
    onBusy(value);
  };
  const save = async (next: EditableLayout) => {
    latest.current = next;
    return commit(next);
  };
  const run = async (retryFailed = false) => {
    if (active.current) return;
    locked(true);
    setError("");
    setTerminal(false);
    setFiles(null);
    setPptxFile(null);
    try {
      let next = latest.current,
        pub = next.publication!;
      const batches = knowledgeReviewBatches(pub.source);
      let total = batches.length + 1;
      if (retryFailed) {
        pub = {
          ...pub,
          attempts: {
            ...pub.attempts,
            [pub.completedBatches]:
              (pub.attempts[String(pub.completedBatches)] || 0) + 1,
          },
        };
        next = { ...next, publication: pub };
      }
      await save(next);
      let quote = await utils.editableLayout.publicationQuote.fetch({
        documentId: next.id,
      });
      // 费用只按现有顾问单批费率计算，不用短问答免费名义暗中发起整套付费请求。
      if (
        quote.maxCredits > 0 &&
        !window.confirm(
          `将自动整理剩余${quote.remaining}组内容，预计${quote.estimatedCredits}积分，最多${quote.maxCredits}积分。整套核对若需增加费用，会先向你确认。无需逐页修改，是否开始？`
        )
      )
        return;
      let charged = 0, authorizedCredits = quote.maxCredits;
      total = quote.batches;
      for (let i = pub.completedBatches; i < total; i++) {
        if (!alive.current) return;
        if (i === batches.length && !quote.consistencyKnown) {
          const updated = await utils.editableLayout.publicationQuote.fetch({ documentId: next.id });
          const extra = Math.max(0, charged + updated.maxCredits - authorizedCredits);
          if (extra > 0 && !window.confirm(`内容已整理保存。整套核对还需处理${updated.remaining}组，最多新增${extra}积分，是否继续？`)) return;
          authorizedCredits += extra;
          quote = updated;
          total = updated.batches;
        }
        setMessage(
          i >= batches.length
            ? "全部配图已检查，正在核对整套知识说明的一致性…"
            : `正在自动审校第 ${i + 1} / ${batches.length} 批 · 已完成部分已保存`
        );
        const attempt = pub.attempts[String(i)] || 0;
        const response = await streamManhuaAdvisor(
          {
            question: KNOWLEDGE_PUBLICATION_QUESTION,
            rawQuestion: KNOWLEDGE_PUBLICATION_QUESTION,
            requestId: knowledgeBatchRequestId(pub.requestId, i, attempt),
            knowledgePublicationContext: {
              documentId: next.id,
              batchIndex: i,
              attempt,
            },
            confirmPaid: quote.maxCredits > 0,
            confirmedCredits: quote.paidUnit,
          },
          () => undefined
        );
        if (!response.replayed) charged += response.creditsCharged;
        if (charged > authorizedCredits)
          throw new Error("费用回执超出本次确认范围，已暂停后续批次");
        const answer = JSON.parse(response.answer);
        if (i >= batches.length && answer.kind === "knowledge_consistency_batch_v1") {
          const result = knowledgeConsistencyBatchResultSchema.parse(answer);
          if (result.batchIndex !== i || result.batchCount !== total) throw new Error("整理进度与保存内容不一致，已暂停");
          pub = { ...pub, completedBatches: i + 1 };
          next = { ...next, publication: pub };
        } else if (i >= batches.length) {
          const review = knowledgeReviewSchema.parse(answer);
          if (
            review.pages.length !== pub.source.pages.length ||
            review.pages.some((p, n) => p.id !== pub.source.pages[n].id)
          )
            throw new Error("整套审校页号未闭合，未采用部分结果");
          pub = {
            ...pub,
            review,
            completedBatches: total,
            manuscript: knowledgeManuscript(review),
            confirmedManuscript: undefined,
          };
          next = {
            ...next,
            title: review.title,
            pages: next.pages.map((p, n) => ({
              ...p,
              headline: review.pages[n].headline,
              body: review.pages[n].body,
            })),
            publication: pub,
          };
        } else {
          const result = knowledgeBatchResultSchema.parse(
            JSON.parse(response.answer)
          );
          if (
            result.batchIndex !== i ||
            result.batchCount !== batches.length ||
            result.reviewedPages.join(",") !==
              batches[i].map(n => pub.source.pages[n].id).join(",")
          )
            throw new Error("本批审校回执页号不一致，已暂停");
          pub = { ...pub, completedBatches: i + 1 };
          next = { ...next, publication: pub };
        }
        await save({ ...next, updatedAt: new Date().toISOString() });
      }
      setMessage(
        "已完成整套图文审校与说明整理。可直接确认生成；手动修改是可选项。"
      );
    } catch (e) {
      const safe = knowledgePublicationPublicError(e);
      setTerminal(safe.retryable || (e as { retryable?: boolean })?.retryable === true);
      setError(safe.message);
    } finally {
      locked(false);
    }
  };
  useEffect(() => {
    if (autoStart && started.current !== doc.id && !doc.publication?.review) {
      started.current = doc.id;
      void run();
    }
  }, [autoStart, doc.id]);
  const planPptx = async () => {
    if(active.current)return;
    locked(true);setError("");setPptxFile(null);
    try {
      setPlanDraft(null);setRevisionError("");
      const range=knowledgePresentationRangeSchema.parse({minSlides,maxSlides});
      const current=latest.current,pub=current.publication!;
      const parsed=parseKnowledgeManuscript(pub.manuscript,pub.source.pages.map(p=>p.id));
      const previous=pub.presentationRequest;
      const reuse=previous?.manuscript===pub.manuscript&&previous.minSlides===minSlides&&previous.maxSlides===maxSlides;
      const request=reuse?previous!:{id:crypto.randomUUID(),...range,manuscript:pub.manuscript};
      let next:EditableLayout={...current,title:parsed.title,pages:current.pages.map((p,i)=>({...p,...parsed.pages[i]})),publication:{...pub,confirmedManuscript:pub.manuscript,presentationRequest:request,presentationPlan:reuse?pub.presentationPlan:undefined,presentationRevision:reuse?pub.presentationRevision:undefined},updatedAt:new Date().toISOString()};
      await save(next);
      if(reuse&&pub.presentationPlan){setMessage("已恢复当前提纲，无需重复调用顾问。");return;}
      const quote=await utils.editableLayout.publicationQuote.fetch({documentId:next.id,purpose:"presentation"});
      if(quote.maxCredits>0&&!window.confirm(`将由创作顾问规划 ${minSlides}–${maxSlides} 页课件，最多 ${quote.maxCredits} 积分。仅生成逐页提纲，确认后再渲染，是否继续？`))return;
      setMessage(`正在按 ${minSlides}–${maxSlides} 页规划重点与版式，尚未渲染…`);
      const response=await streamManhuaAdvisor({question:"按指定页数范围规划可编辑课件，提炼有答案的重点，保持字体与版式层次。",rawQuestion:"按指定页数范围规划可编辑课件，提炼有答案的重点，保持字体与版式层次。",requestId:request.id,knowledgePublicationContext:{documentId:next.id,batchIndex:0,attempt:0,purpose:"presentation"},confirmPaid:quote.maxCredits>0,confirmedCredits:quote.paidUnit},()=>undefined);
      const plan=knowledgePresentationPlanSchema.parse(JSON.parse(response.answer));
      if(plan.requestId!==request.id||plan.minSlides!==minSlides||plan.maxSlides!==maxSlides)throw Error("提纲与指定页数范围不一致，未采用");
      next={...next,publication:{...next.publication!,presentationPlan:plan},updatedAt:new Date().toISOString()};
      await save(next);setMessage(`已规划 ${plan.slides.length} 页，请查看逐页提纲后确认导出。`);
    }catch(e){setError(knowledgePublicationPublicError(e).message);}finally{locked(false);}
  };
  const savePlanRevision = async () => {
    if(active.current||!planDraft)return;
    locked(true);setRevisionError("");
    try {
      const current=latest.current,pub=current.publication!;
      if(!pub.presentationPlan||pub.presentationRequest?.manuscript!==pub.manuscript||pub.presentationRequest.minSlides!==minSlides||pub.presentationRequest.maxSlides!==maxSlides)throw Error("稿件或页数范围已改变，请重新规划提纲。");
      const revision=validateKnowledgePresentationRevision(planDraft,pub.presentationPlan);
      await save({...current,publication:{...pub,presentationRevision:revision},updatedAt:new Date().toISOString()});
      setPlanDraft(null);setPptxFile(null);setError("");setMessage("提纲修订已保存，请确认后导出。原稿与原提纲均保留，未调用顾问。");
    }catch(e){setRevisionError(e instanceof Error?e.message:"修订保存失败，请重试。");}finally{locked(false);}
  };
  const editPlanField = (index:number,field:"title"|"point"|"column"|"cell",value:string,row=0,col=0) => {
    setPlanDraft(old=>{
      if(!old)return old;
      const next=structuredClone(old),slide=next.slides[index];
      if(field==="title")slide.title=value;
      else if(field==="point"&&slide.type!=="table")slide.points[row]=value;
      else if(field==="column"&&slide.type==="table")slide.columns[row]=value;
      else if(field==="cell"&&slide.type==="table")slide.rows[row][col]=value;
      return next;
    });setRevisionError("");
  };
  const publish = async (format: "pdf" | "pptx" = "pdf") => {
    if (active.current) return;
    locked(true);
    setError("");
    try {
      const current = latest.current,
        pub = current.publication!;
      if(format==="pptx"){
        if(planDraft)throw Error("请先保存提纲修订，再确认导出。");
        const plan=pub.presentationRevision??pub.presentationPlan;
        if(plan)assertKnowledgePresentationCapacity(plan);
      }
      const parsed = parseKnowledgeManuscript(
        pub.manuscript,
        pub.source.pages.map(p => p.id)
      );
      const next = {
        ...current,
        title: parsed.title,
        pages: current.pages.map((p, i) => ({ ...p, ...parsed.pages[i] })),
        publication: { ...pub, confirmedManuscript: pub.manuscript },
        updatedAt: new Date().toISOString(),
      };
      const saved = await save(next);
      if(format==="pptx"){
        if(!pub.presentationPlan||pub.presentationRequest?.manuscript!==pub.manuscript||pub.presentationRequest.minSlides!==minSlides||pub.presentationRequest.maxSlides!==maxSlides)throw Error("请先按当前页数范围规划并确认提纲");
        setMessage("确认稿已保存，正在生成可编辑课件…");
        const result=await pptxExporter.mutateAsync({documentId:next.id,expectedGeneration:saved.generation});
        setPptxFile(result);setMessage(`PPTX已生成，共${result.slides}页，可下载后编辑。`);
      }else{
        setMessage("确认稿已保存，正在自动排版并生成 HTML 和 PDF…");
        const result=await exporter.mutateAsync({documentId:next.id,expectedGeneration:saved.generation});
        setFiles(result);setMessage(result.pdfError || "HTML 和 PDF 已生成并保存，可直接下载。");
      }
    } catch (e) {
      setError(knowledgePublicationPublicError(e).message);
    } finally {
      locked(false);
    }
  };
  const pub = doc.publication!,
    review = pub.review;
  const displayedPlan=pub.presentationRevision??pub.presentationPlan;
  const capacityIssues=displayedPlan?knowledgePresentationCapacityIssues(displayedPlan):[];
  const draftIssues=planDraft?knowledgePresentationCapacityIssues(planDraft):[];
  const issues = review?.pages.filter(p => p.cautions.length).length || 0;
  const visible =
    review?.pages
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => !onlyIssues || p.cautions.length) || [];
  const index = visible.some(v => v.i === pageIndex)
    ? pageIndex
    : visible[0]?.i || 0;
  const selectedTemplate = resolveKnowledgePublicationTemplate(pub.infographicTemplateId, review?.pages[index]?.reading?.templateId);
  let preview = "";
  if (review) {
    try {
      const parsed = parseKnowledgeManuscript(
        pub.manuscript,
        pub.source.pages.map(p => p.id)
      );
      const current = {
        ...doc,
        title: parsed.title,
        pages: doc.pages.map((p, i) => ({ ...p, ...parsed.pages[i] })),
      };
      preview =
        knowledgePublicationHead(current.title) +
        knowledgePublicationChapter(
          current,
          review,
          index,
          current.pages[index].imageUrl,
          true
        ) +
        "</body></html>";
    } catch {
      /* 无效手改留在文本框，确认时给出具体错误；不导出错配页。 */
    }
  }
  return (
    <section
      aria-label="图文知识手册自动审校与排版"
      className="space-y-4 rounded-2xl border border-[#b9c4ad]/40 bg-[#182721] p-5 text-[#f5f0e5]"
    >
      <div>
        <h4 className="text-lg font-semibold">创作顾问 · 图文知识手册</h4>
        <p className="mt-1 text-sm text-[#c0cabb]">
          整套 {pub.source.pages.length} 章内容、{pub.source.pages.filter(p => p.imageUrl).length} 张原图；按原顺序处理全部正文，手册按内容自动分页。
        </p>
      </div>
      <label className="block text-sm">
        阅读模板
        <select aria-label="阅读模板" className="ml-3 max-w-full rounded-lg bg-[#24382e] p-2"
          value={pub.infographicTemplateId || "auto"} disabled={busy}
          onChange={e => {
            setFiles(null);
            setPptxFile(null);
            onChange({ ...doc, publication: { ...pub, infographicTemplateId: e.target.value === "auto" ? undefined : e.target.value, confirmedManuscript: undefined }, updatedAt: new Date().toISOString() });
          }}>
          <option value="auto">按内容自动匹配第一组模板</option>
          {pub.infographicTemplateId && !knowledgePublicationTemplates.some(t => t.id === pub.infographicTemplateId) && <option value={pub.infographicTemplateId} disabled>旧模板已停用，请选择第一组模板</option>}
          {knowledgePublicationTemplates.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <p className="mt-2 text-xs text-[#c0cabb]">只使用第一组人景物融合模板，按内容匹配；也可手动指定整套模板。先预览，再确认生成 PDF；换模板不重新整理正文。</p>
      </label>
      <p className="text-sm text-[#c0cabb]">{pub.source.detailLevel === "concise" ? "精华版图卡 · 顾问补充详尽说明" : pub.source.detailLevel === "full" ? "完整版图卡 · 顾问精简重复说明" : "旧稿未记录图卡版本 · 保留现有说明密度"}</p>
      {review && <p className="text-sm text-[#c0cabb]">
        {selectedTemplate ? "已应用所选版式" : "已按内容匹配版式"}
        {!pub.infographicTemplateId && review.pages[index]?.reading?.templateReason ? ` · ${review.pages[index].reading!.templateReason}` : ""}
      </p>}
      {message && (
        <p role="status" className="text-sm text-[#d6e4bd]">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="whitespace-pre-wrap text-sm text-rose-200">
          {error}
        </p>
      )}
      {!review ? (
        <div className="space-y-3">
          <p className="text-sm">
            {pub.source.pages.length} 章内容 · 已完成 {pub.completedBatches}{" "}
            批。原稿与配图保留，刷新后可以继续。
          </p>
          <button
            className={button}
            disabled={busy}
            onClick={() => void run(terminal)}
          >
            {busy
              ? "正在自动处理…"
              : terminal
                ? "仅重试失败批次并继续"
                : pub.completedBatches
                  ? "继续自动审校"
                  : "开始自动审校"}
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">
              全套 {review.pages.length} 页已检查 ·{" "}
              {issues ? `${issues} 页有阅读提示` : "本轮未发现图文冲突"}
            </span>
            <label className="text-sm">
              <input
                type="checkbox"
                checked={onlyIssues}
                disabled={busy || !issues}
                onChange={e => setOnlyIssues(e.target.checked)}
              />{" "}
              只看需要留意的页
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <select
              aria-label="查看手册章节"
              className="max-w-full rounded-lg bg-[#24382e] p-2"
              value={index}
              onChange={e => setPageIndex(Number(e.target.value))}
            >
              {visible.map(({ p, i }) => (
                <option key={p.id} value={i}>
                  {i + 1} · {p.headline}
                </option>
              ))}
            </select>
            <button
              className={button}
              disabled={busy}
              onClick={() => setManual(!manual)}
            >
              {manual ? "收起文字" : "查看或手动修改说明（可选）"}
            </button>
          </div>
          {manual && (
            <label className="block text-sm">
              整套说明确认框
              <p className="mb-2 text-xs text-[#c0cabb]">
                通常无需修改。保留各页编号即可保持配图对应；手动改动由你确认，不会自动重付费审校。
              </p>
              <textarea
                aria-label="整套说明确认框"
                rows={14}
                className="w-full rounded-lg border border-[#bdc9b5]/40 bg-[#f9f6ee] p-4 leading-7 text-[#243a35]"
                value={pub.manuscript}
                disabled={busy}
                onChange={e => {
                  setFiles(null);
            setPptxFile(null);
                  onChange({
                    ...doc,
                    publication: {
                      ...pub,
                      manuscript: e.target.value,
                      confirmedManuscript: undefined,
                    },
                    updatedAt: new Date().toISOString(),
                  });
                }}
              />
            </label>
          )}
          <iframe
            title="图文知识手册预览"
            sandbox="allow-scripts"
            srcDoc={preview}
            className="h-[720px] w-full rounded-xl border-0 bg-[#faf7f0]"
          />
          <section className="space-y-3 rounded-xl border border-[#b9c4ad]/40 p-4" aria-label="PPTX课件规划">
            <div><h3 className="font-semibold">PPTX 页数与提纲</h3><p className="text-sm text-[#c0cabb]">先指定总页数范围，顾问提炼重点。标题、总结也计入总页数；确认提纲后才渲染。</p></div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">最少页数<input aria-label="PPTX最少页数" type="number" min={1} max={200} value={minSlides} disabled={busy||!!planDraft} onChange={e=>{setMinSlides(Number(e.target.value));setPptxFile(null);}} className="ml-2 w-20 rounded bg-[#f9f6ee] p-2 text-[#243a35]" /></label>
              <label className="text-sm">最多页数<input aria-label="PPTX最多页数" type="number" min={1} max={200} value={maxSlides} disabled={busy||!!planDraft} onChange={e=>{setMaxSlides(Number(e.target.value));setPptxFile(null);}} className="ml-2 w-20 rounded bg-[#f9f6ee] p-2 text-[#243a35]" /></label>
              <button className={button} disabled={busy||!!planDraft||!preview||minSlides<1||maxSlides>200||minSlides>maxSlides} onClick={()=>void planPptx()}>规划 PPTX 提纲</button>
            </div>
            {displayedPlan&&pub.presentationRequest?.manuscript===pub.manuscript&&pub.presentationRequest.minSlides===minSlides&&pub.presentationRequest.maxSlides===maxSlides&&<>
              <p className="text-sm">共 {displayedPlan.slides.length} 页 · {displayedPlan.fontStyle==="editorial"?"宋体标题 · 黑体正文":"现代黑体层次"}</p>
              <ol className="max-h-96 space-y-3 overflow-y-auto">
                {displayedPlan.slides.map((slide,i)=><li key={i} className="border-b border-[#b9c4ad]/20 pb-3"><strong>{i+1}. {slide.title}</strong><div className="mt-1 whitespace-pre-wrap text-sm text-[#d5ddcf]">{slide.type==="table"?[slide.columns.join(" · "),...slide.rows.map(r=>r.join(" · "))].join("\n"):slide.points.join("\n")}</div>{slide.type==="image"&&<span className="text-xs">配原稿图解</span>}</li>)}
              </ol>
              {capacityIssues.length>0&&<div role="alert" className="text-sm text-amber-200">{capacityIssues.map(text=><p key={text}>{text}</p>)}</div>}
              {!planDraft&&<button className={button} disabled={busy} onClick={()=>{setPlanDraft(structuredClone(displayedPlan));setRevisionError("");setPptxFile(null);}}>修订提纲（不调用顾问）</button>}
              {planDraft&&<section aria-label="修订PPTX提纲" className="space-y-4">
                <p className="text-sm">可缩短页面文字或减少换行；原稿、原提纲、页数和配图均保留。保存后再确认导出，不产生顾问费用。</p>
                {planDraft.slides.map((slide,i)=><div key={i} className="space-y-2 border-b border-[#b9c4ad]/20 pb-3">
                  <label className="block">第 {i+1} 页标题<input aria-label={`第${i+1}页标题`} disabled={busy} value={slide.title} onChange={e=>editPlanField(i,"title",e.target.value)} className="block w-full rounded p-2 text-[#243a35]" /></label>
                  {slide.type!=="table"?slide.points.map((point,j)=><label key={j} className="block">要点 {j+1}<textarea aria-label={`第${i+1}页要点${j+1}`} disabled={busy} value={point} onChange={e=>editPlanField(i,"point",e.target.value,j)} className="block w-full rounded p-2 text-[#243a35]" /></label>):<>
                    {slide.columns.map((text,j)=><label key={`h${j}`} className="block">表头 {j+1}<input aria-label={`第${i+1}页表头${j+1}`} disabled={busy} value={text} onChange={e=>editPlanField(i,"column",e.target.value,j)} className="block w-full rounded p-2 text-[#243a35]" /></label>)}
                    {slide.rows.map((row,j)=>row.map((text,k)=><label key={`${j}-${k}`} className="block">第 {j+1} 行第 {k+1} 列<textarea aria-label={`第${i+1}页表格${j+1}行${k+1}列`} disabled={busy} value={text} onChange={e=>editPlanField(i,"cell",e.target.value,j,k)} className="block w-full rounded p-2 text-[#243a35]" /></label>))}
                  </>}
                </div>)}
                {draftIssues.map(text=><p key={text} role="alert" className="text-sm text-amber-200">{text}</p>)}
                {revisionError&&<p role="alert" className="text-sm text-amber-200">{revisionError}</p>}
                <button className={button} disabled={busy||draftIssues.length>0||!knowledgePresentationPlanSchema.safeParse(planDraft).success} onClick={()=>void savePlanRevision()}>保存提纲修订</button>
                <button className={button} disabled={busy} onClick={()=>{setPlanDraft(null);setRevisionError("");}}>取消修订</button>
              </section>}
              <button className={button} disabled={busy||!!planDraft||capacityIssues.length>0} onClick={()=>void publish("pptx")}>确认提纲并导出 PPTX</button>
            </>}
          </section>
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-lg bg-[#d7e6c4] px-5 py-3 font-semibold text-[#20372b] disabled:opacity-40"
              disabled={busy || !preview}
              onClick={() => void publish()}
            >
              {busy
                ? "正在生成…"
                : pub.confirmedManuscript === pub.manuscript
                  ? "下载当前版 HTML 和 PDF"
                  : "确认生成图文知识手册"}
            </button>

            {pptxFile && <a className={button} href={flyDownloadUrl(pptxFile.pptxUrl)} download>下载 PPTX · {pptxFile.slides}页</a>}
            {files && (
              <>
                <a
                  className={button}
                  href={flyDownloadUrl(files.htmlUrl)}
                  download
                >
                  下载 HTML
                </a>
                {files.pdfUrl && (
                  <a
                    className={button}
                    href={flyDownloadUrl(files.pdfUrl)}
                    download
                  >
                    下载 PDF
                  </a>
                )}
              </>
            )}
          </div>
          {issues > 0 && (
            <p className="text-xs text-[#d5c3a1]">
              这些是作者审校记录。PPTX 正文采用顾问整理并由你确认的内容，审校记录保留在备注中。原图文字不会被改写；旧稿需要重新审校，才会按新要求检查无答案内容。
            </p>
          )}
        </>
      )}
    </section>
  );
}
