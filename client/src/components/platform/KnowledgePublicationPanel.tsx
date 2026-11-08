import {KNOWLEDGE_INTERIOR_PRICE_COPY} from "@shared/knowledgePublicationPricing";
import {knowledgeConversationAnswerSchema} from "@shared/knowledgeConversation";
import type {KnowledgeSupplementSelection} from "@shared/knowledgeSupplement";
import { completedKnowledgeBatches, knowledgeCompletedPrefix, runKnowledgeParallelBatches } from "@shared/knowledgePublicationParallel";
import type { KnowledgePublicationPagination } from "@shared/knowledgePublication";
import { pollJobUntilTerminal } from "@/lib/jobs";
import {knowledgePresentationSourceManuscript,knowledgePresentationRequestMatches,knowledgePresentationRangeSchema,knowledgePresentationPlanSchema,knowledgePresentationCapacityIssues,assertKnowledgePresentationCapacity,validateKnowledgePresentationRevision,type KnowledgePresentationPlan} from "@shared/knowledgePresentation";
import { knowledgePublicationTemplates, resolveKnowledgePublicationTemplate } from "@shared/knowledgePublicationTemplates";
import { useEffect, useRef, useState } from "react";
import type { EditableLayout } from "@shared/editableLayout";
import {
  type KnowledgeReview,
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
import { withKnowledgeAdvisorRecovery } from "@/lib/knowledgeAdvisorRecovery";
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
  autoStartToken = 0,
  preauthorizedCredits,
  autoPreparePresentation = false,
  preauthorizedPresentationCredits,
  waitForImages,
  waitForReading,
  onPagination,
  onSupplement,
  compact = false,
}: {
  doc: EditableLayout;
  compact?: boolean;
  commit: (doc: EditableLayout) => Promise<Saved>;
  onChange: (doc: EditableLayout) => void;
  onBusy: (value: boolean) => void;
  autoStart?: boolean;
  autoStartToken?: number;
  preauthorizedCredits?: number;
  autoPreparePresentation?: boolean;
  preauthorizedPresentationCredits?: number;
  waitForImages?: (ids: string[]) => Promise<void>;
  waitForReading?: () => Promise<void>;
  onSupplement?: (selection:KnowledgeSupplementSelection,markdown:string)=>Promise<void>;
  onPagination?: (doc: EditableLayout, pagination: KnowledgePublicationPagination | null) => void;
}) {
  const utils = trpc.useUtils();
  const streamKnowledgeAdvisor: typeof streamManhuaAdvisor = (input, onText, onModel) => {
    const documentId = input.knowledgePublicationContext?.documentId;
    return withKnowledgeAdvisorRecovery(input.requestId, () => streamManhuaAdvisor(input, onText, onModel),
      () => utils.client.auth.me.query(), () => alive.current && latest.current.id === documentId);
  };
  const exporter = trpc.editableLayout.exportPublication.useMutation();
  const pptxExporter = trpc.editableLayout.exportPublicationPptx.useMutation();
  const [layoutView,setLayoutView]=useState<{doc:EditableLayout;review:KnowledgeReview;images:Record<string,string>}|null>(null);
  const [layoutPreviewError,setLayoutPreviewError]=useState("");
  const [minSlides,setMinSlides]=useState(doc.publication?.presentationRequest?.minSlides ?? 15);
  const [maxSlides,setMaxSlides]=useState(doc.publication?.presentationRequest?.maxSlides ?? 20);
  const [presentationBusy,setPresentationBusy]=useState(false);
  const presentationActive=useRef(false), presentationStarted=useRef("");
  const saveQueue=useRef<Promise<unknown>>(Promise.resolve());
  const [planDraft,setPlanDraft]=useState<KnowledgePresentationPlan|null>(null);
  const [revisionError,setRevisionError]=useState("");
  const [pptxFile,setPptxFile]=useState<{pptxUrl:string;slides:number}|null>(null);
  const latest = useRef(doc);
  const observedDocument = useRef(doc);
  const pendingSaves = useRef(0);
  // 本地进度状态刷新不能把正在保存的新请求退回上一次父组件快照。
  if(observedDocument.current!==doc){
    observedDocument.current=doc;
    if(pendingSaves.current===0||doc.id!==latest.current.id)latest.current=doc;
  }
  const active = useRef(false),
    started = useRef("");
  const alive = useRef(true);
  const authorizationConsumed = useRef(false);
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
    imagePages?: number;
    totalPages?: number;
    billing?: {readingPages:number;unitCredits:number;chargedCredits:number;alreadyCharged:boolean};
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
  const paginationVersion = (value: EditableLayout) => JSON.stringify([
    value.id, value.title, value.aspect, value.theme, value.fontSize, value.pages,
    value.publication?.manuscript, value.publication?.infographicTemplateId, value.publication?.designMode, value.publication?.review,
    value.publication?.layoutConversationId, value.publication?.supplementDocumentId,
  ]);
  const currentPaginationVersion = paginationVersion(doc);
  useEffect(()=>{
    let current=true;
    setLayoutView(null);setLayoutPreviewError("");
    if(doc.publication?.layoutConversationId){
      void utils.editableLayout.bookLayoutPreview.fetch({documentId:doc.id}).then(view=>{
        if(current)setLayoutView(view);
      }).catch(error=>{if(current)setLayoutPreviewError(knowledgePublicationPublicError(error).message);});
    }
    return ()=>{current=false;};
  },[currentPaginationVersion]);
  useEffect(() => {
    setFiles(null);
    onPagination?.(doc, null);
  }, [currentPaginationVersion]);
  const locked = (value: boolean) => {
    active.current = value;
    setBusy(value);
    onBusy(value||presentationActive.current);
  };
  const save = async (next: EditableLayout) => {
    latest.current = next;
    pendingSaves.current+=1;
    const saving=saveQueue.current.catch(()=>undefined).then(()=>{
      if(latest.current.id!==next.id)throw Error("已切换稿件，未覆盖当前稿；请返回原任务恢复结果");
      return commit(next);
    }).finally(()=>{pendingSaves.current-=1;});
    saveQueue.current=saving;
    return saving;
  };
  const arrangeBook = async () => {
    const initial=latest.current,pub=initial.publication!,intent=pub.automaticLayout;
    if(!intent||!pub.review||pub.synchronizedStarted!==true)return;
    const documentId=initial.id;
    const current=()=>{
      const value=latest.current;
      if(!alive.current||value.id!==documentId||value.publication?.automaticLayout?.requestId!==intent.requestId||value.publication.manuscript!==pub.manuscript)throw Error("稿件已变化，排版结果保留在原请求，请恢复原稿");
      return value;
    };
    if(pub.layoutConversationId)return;
    const history=pub.conversation||[];
    let turn=history.find(t=>t.request.id===intent.requestId);
    if(!turn){
      if(history.some(t=>!t.response))throw Error("原交流尚未结束，请先恢复该请求；整册排版尚未重复提交");
      const input=await utils.editableLayout.bookLayoutInput.fetch({documentId});
      turn={request:{id:intent.requestId,question:"请根据完整正文和现有全部图卡重新安排整册顺序与设计，将图片放到相关内容附近，保留每段文字和每张图片，做好精美排版。",imagePageIds:[],manuscript:pub.manuscript,action:"layout",layoutSourceDigest:input.sourceDigest}};
      const fresh=current();
      await save({...fresh,publication:{...fresh.publication!,conversation:[...history,turn]},updatedAt:new Date().toISOString()});
    }
    if(turn.request.manuscript!==pub.manuscript)throw Error("排版请求对应另一版正文，未重复调用");
    // 恢复本地待保存请求时先补齐云端版本，再查询原请求；绝不更换ID。
    if(history.some(t=>t.request.id===intent.requestId))await save(current());
    let answer=turn.response;
    if(!answer){
      const quote=await utils.editableLayout.publicationQuote.fetch({documentId,purpose:"conversation"});
      if(quote.maxCredits!==0)throw Error("当前服务尚未应用顾问不另收费规则，请刷新后恢复原任务");
      current();setMessage("正在将全部图片安排到对应正文，统一整册顺序、配色和版式…");
      const response=await streamKnowledgeAdvisor({question:turn.request.question,rawQuestion:turn.request.question,requestId:intent.requestId,knowledgePublicationContext:{documentId,batchIndex:current().publication!.conversation!.findIndex(t=>t.request.id===intent.requestId),attempt:0,purpose:"conversation"},confirmPaid:quote.maxCredits>0,confirmedCredits:quote.paidUnit},()=>undefined);
      answer=knowledgeConversationAnswerSchema.parse(JSON.parse(response.answer));
    }
    if(answer.requestId!==intent.requestId||!answer.layoutPlan||answer.layoutPlan.sourceDigest!==turn.request.layoutSourceDigest)throw Error("整册排版方案与本次完整稿件不符，未采用");
    const fresh=current();
    const next={...fresh,publication:{...fresh.publication!,confirmedManuscript:pub.manuscript,layoutConversationId:intent.requestId,conversation:fresh.publication!.conversation!.map(t=>t.request.id===intent.requestId?{...t,response:answer}:t)},updatedAt:new Date().toISOString()};
    let saved:Saved;
    try{saved=await save(next);}catch(error){latest.current=fresh;onChange(fresh);throw error;}
    await exportLayout(next,saved);
  };
  const run = async (retryFailed = false) => {
    if (active.current) return;
    locked(true);
    setError("");
    setTerminal(false);
    setFiles(null);
    setPptxFile(null);
    try {
      const beforeRetry = latest.current;
      let next = latest.current,
        pub = next.publication!;
      const initialAuthorization = !retryFailed && !authorizationConsumed.current && preauthorizedCredits!==undefined ? Math.max(0,preauthorizedCredits-(pub.automaticLayout?.maxCredits||0)) : undefined;
      authorizationConsumed.current = true;
      if (pub.synchronizedStarted === false && initialAuthorization === undefined) throw new Error("这份同步草稿尚未确认生成，请返回配图入口核对后开始；没有发起图片或文字收费任务");
      if (pub.synchronizedStarted === false) { pub = { ...pub, synchronizedStarted: true }; next = { ...next, publication: pub }; }
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
      if (!pub.parallel) {
        pub = { ...pub, parallel: { channels: {}, completed: Array.from(completedKnowledgeBatches(pub, batches.length)) } };
        next = { ...next, publication: pub };
      }
      try { await save(next); }
      catch (error) {
        if (retryFailed) { latest.current = beforeRetry; onChange(beforeRetry); }
        throw error;
      }
      let quote = await utils.editableLayout.publicationQuote.fetch({
        documentId: next.id,
      });
      // 顾问已包含在最终内文页费中；旧报价不能触发额外扣费。
      if(quote.maxCredits!==0)throw Error("当前服务尚未应用顾问不另收费规则，请刷新后恢复原任务");
      let charged = 0, authorizedCredits = Math.max(quote.maxCredits, initialAuthorization ?? 0);
      total = quote.batches;
      const documentId = next.id;
      const stillHere = () => alive.current && latest.current.id === documentId;
      let saves = Promise.resolve();
      const update = (change: () => void) => {
        const saving = saves.then(async () => {
          if (!stillHere()) throw new Error("已切换稿件，结果保留在原任务，请返回原稿恢复");
          change();
          // 并发课件规划可先完成，审校保存不可用旧快照覆盖其回执。
          const presentation = latest.current.publication;
          pub = { ...pub, presentationRequest: presentation?.presentationRequest, presentationPlan: presentation?.presentationPlan, presentationRevision: presentation?.presentationRevision };
          next = { ...next, publication: pub };
          await save({ ...next, updatedAt: new Date().toISOString() });
        });
        saves = saving;
        return saving;
      };
      const prepare = async (i: number) => {
        if (i < batches.length) {
          const imageJobs = batches[i].map(n => pub.source.pages[n].imageJobId).filter((id): id is string => Boolean(id)).map(id => pub.imageReplacements?.[id] || id);
          if (imageJobs.length) {
            if (waitForImages && initialAuthorization !== undefined) await waitForImages(imageJobs);
            else await Promise.all(imageJobs.map(async jobId => {
              const job = await pollJobUntilTerminal(jobId, { intervalMs: 3000, maxWaitMs: 28 * 60_000 });
              if (job.status !== "succeeded") throw new Error("原配图任务未成功，文字已保存；请先恢复配图，不会自动重新购买");
            }));
          } else if (waitForReading) await waitForReading();
        }
      };
      const execute = async (i: number) => {
        setMessage(
          i >= batches.length
            ? "联网校验搜索：全册疑点集中核实，随后修订统稿…"
            : `正在整理第 ${batches[i].map(n=>n+1).join("、")} 章 · 已完成内容已保存`
        );
        const attempt = pub.attempts[String(i)] || 0;
        const response = await streamKnowledgeAdvisor(
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
        return response;
      };
      const consume = async (i: number, response: Awaited<ReturnType<typeof streamManhuaAdvisor>>) => {
        if (!response.replayed) charged += response.creditsCharged;
        if (charged > authorizedCredits)
          throw new Error("费用回执超出本次确认范围，后续整理已暂停");
        return update(() => {
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
            throw new Error("整理结果与原章节不一致，已暂停");
          if(result.pages && result.pages.map(page=>page.id).join(",")!==result.reviewedPages.join(","))throw Error("章节正文与原稿编号不一致，未采用");
          pub = {...pub,chapterReviewDigest:result.sourceDigest,chapterReviews:{...pub.chapterReviews,...Object.fromEntries((result.pages||[]).map(page=>[page.id,page]))}};
          const completed = completedKnowledgeBatches(pub, batches.length);
          completed.add(i);
          pub = { ...pub, parallel: { channels: pub.parallel!.channels, completed: Array.from(completed).sort((a, b) => a - b) }, completedBatches: knowledgeCompletedPrefix(completed, batches.length) };
          const imageUrls = new Map((result.images || []).map(image => [image.id, image.url]));
          next = { ...next, pages: next.pages.map(page => imageUrls.has(page.id) ? { ...page, imageUrl: imageUrls.get(page.id)! } : page), publication: pub };
        }
        });
      };
      const failures = await runKnowledgeParallelBatches({
        count: batches.length,
        completed: completedKnowledgeBatches(pub, batches.length),
        channels: pub.parallel!.channels,
        active: stillHere,
        assign: (i, channel) => update(() => {
          const assigned = pub.parallel!.channels[String(i)];
          if (assigned && assigned !== channel) throw new Error("原整理请求已固定，请继续原任务");
          pub = { ...pub, parallel: { ...pub.parallel!, channels: { ...pub.parallel!.channels, [i]: channel } } };
          next = { ...next, publication: pub };
        }),
        prepare,
        execute: i => execute(i),
        complete: consume,
      });
      if (failures.length) throw failures[0].error;
      if (!stillHere()) return;
      if (completedKnowledgeBatches(pub, batches.length).size !== batches.length) throw new Error("仍有未完成章节，已完成内容已保存");
      for (let i = Math.max(batches.length, pub.completedBatches); i < total; i++) {
        if (!stillHere()) return;
        if (i === batches.length && !quote.consistencyKnown) {
          const updated = await utils.editableLayout.publicationQuote.fetch({ documentId: next.id });
          const extra = Math.max(0, charged + updated.maxCredits - authorizedCredits);
          if (extra > 0) throw Error("当前服务尚未应用顾问不另收费规则，请刷新后恢复原任务");
          authorizedCredits += extra;
          quote = updated;
          total = updated.batches;
        }
        await consume(i, await execute(i));
      }
      if(latest.current.publication?.automaticLayout)await arrangeBook();
      else setMessage("已完成整套图文审校与说明整理。可直接确认生成；手动修改是可选项。");
    } catch (e) {
      setMessage("");
      // 诊断：前台只显示业务提示，真实原因写入浏览器控制台（去掉地址），便于定位根因而不是只看到兜底文案。
      console.warn("[knowledgePublication] 整理失败原因：", String((e as Error)?.message ?? e).replace(/(?:https?|gs):\/\/\S+/g, "[地址]").slice(0, 800));
      const safe = knowledgePublicationPublicError(e);
      setTerminal(safe.retryable || (e as { retryable?: boolean })?.retryable === true);
      setError(safe.message);
    } finally {
      locked(false);
    }
  };
  useEffect(() => {
    const key = `${doc.id}:${autoStartToken}`;
    if (autoStart && started.current !== key && (!doc.publication?.review || (doc.publication.automaticLayout && !doc.publication.layoutConversationId))) {
      started.current = key;
      void run();
    }
  }, [autoStart, autoStartToken, doc.id]);
  const planPptx = async (retryFailed = false, automatic = false, finalReview = false) => {
    if(presentationActive.current)return;
    presentationActive.current=true;setPresentationBusy(true);onBusy(true);setError("");setPptxFile(null);
    try {
      setPlanDraft(null);setRevisionError("");
      const range=knowledgePresentationRangeSchema.parse({minSlides,maxSlides});
      const current=latest.current,pub=current.publication!,documentId=current.id;
      const previous=pub.presentationRequest;
      const reuse=knowledgePresentationRequestMatches(previous,pub)&&previous!.minSlides===minSlides&&previous!.maxSlides===maxSlides&&!(finalReview&&pub.review&&pub.presentationPlan&&previous?.basis==='source');
      const early=!pub.review || (reuse && previous?.basis==='source');
      let retryId:string|undefined;
      let retryQuote:Awaited<ReturnType<typeof utils.editableLayout.publicationQuote.fetch>>|undefined;
      if(retryFailed){
        if(!reuse||pub.presentationPlan)throw Error("稿件或页数已变化，请恢复原请求后再操作");
        const checked=await utils.editableLayout.presentationRetry.fetch({documentId:current.id,failedRequestId:previous!.id});
        retryQuote=await utils.editableLayout.publicationQuote.fetch({documentId:current.id,purpose:"presentation"});
        if(!window.confirm(`原请求已确认失败，退款核对与上游状态检查已通过。重新规划最多 ${retryQuote.maxCredits} 积分，将创建一次新请求，是否确认重试？`))return;
        retryId=checked.requestId;
      }
      const request=retryId?{...previous!,id:retryId}:reuse?previous!:{id:crypto.randomUUID(),...range,...(early?{basis:'source' as const}:{}),manuscript:early?knowledgePresentationSourceManuscript(pub.source):pub.manuscript};
      const parsed=early?null:parseKnowledgeManuscript(pub.manuscript,pub.source.pages.map(p=>p.id));
      let next:EditableLayout={...current,...(parsed?{title:parsed.title,pages:current.pages.map((p,i)=>({...p,...parsed.pages[i]}))}:{}),publication:{...pub,...(early?{}:{confirmedManuscript:pub.manuscript}),presentationRequest:request,presentationPlan:reuse?pub.presentationPlan:undefined,presentationRevision:reuse?pub.presentationRevision:undefined},updatedAt:new Date().toISOString()};
      await save(next);
      if(reuse&&pub.presentationPlan){setMessage("已恢复当前提纲，无需重复调用顾问。");return;}
      const quote=retryQuote??await utils.editableLayout.publicationQuote.fetch({documentId:next.id,purpose:"presentation"});
      if(automatic && (preauthorizedPresentationCredits===undefined||quote.maxCredits>preauthorizedPresentationCredits))throw Error("提前课件规划尚未获得本次费用确认，请使用规划按钮核对费用后继续。");
      if(quote.maxCredits!==0)throw Error("当前服务尚未应用顾问不另收费规则，请刷新后恢复原任务");
      setMessage(`正在按 ${minSlides}–${maxSlides} 页提前规划重点与版式，实际配图仍须最终审校…`);
      const response=await streamKnowledgeAdvisor({question:"按指定页数范围规划可编辑课件，提炼有答案的重点，保持字体与版式层次。",rawQuestion:"按指定页数范围规划可编辑课件，提炼有答案的重点，保持字体与版式层次。",requestId:request.id,knowledgePublicationContext:{documentId:next.id,batchIndex:0,attempt:0,purpose:"presentation"},confirmPaid:quote.maxCredits>0,confirmedCredits:quote.paidUnit},()=>undefined);
      const plan=knowledgePresentationPlanSchema.parse(JSON.parse(response.answer));
      if(plan.requestId!==request.id||plan.minSlides!==minSlides||plan.maxSlides!==maxSlides)throw Error("提纲与指定页数范围不一致，未采用");
      const fresh=latest.current;
      if(fresh.id!==documentId||fresh.publication?.presentationRequest?.id!==request.id||!knowledgePresentationRequestMatches(request,fresh.publication))throw Error("已切换稿件或原稿变化，请返回原请求恢复提纲");
      next={...fresh,publication:{...fresh.publication!,presentationPlan:plan},updatedAt:new Date().toISOString()};
      await save(next);setMessage(`已提前规划 ${plan.slides.length} 页；全部图片和文字审校结束后，可核对提纲并导出。`);
    }catch(e){setError(knowledgePublicationPublicError(e).message);}finally{presentationActive.current=false;setPresentationBusy(false);onBusy(active.current);}
  };
  useEffect(()=>{
    const key=`${doc.id}:${autoStartToken}`;
    if(autoPreparePresentation&&doc.publication?.synchronizedStarted!==false&&doc.publication?.presentationRequest?.basis==='source'&&presentationStarted.current!==key){
      presentationStarted.current=key;
      void planPptx(false,true);
    }
  },[autoPreparePresentation,autoStartToken,doc.id,doc.publication?.synchronizedStarted,doc.publication?.presentationRequest?.id]);
  const savePlanRevision = async () => {
    if(active.current||!planDraft)return;
    locked(true);setRevisionError("");
    try {
      const current=latest.current,pub=current.publication!;
      if(!pub.presentationPlan||!knowledgePresentationRequestMatches(pub.presentationRequest,pub)||pub.presentationRequest!.minSlides!==minSlides||pub.presentationRequest!.maxSlides!==maxSlides)throw Error("稿件或页数范围已改变，请重新规划提纲。");
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
      if(pub.billing&&!pub.billing.confirmed&&!window.confirm(KNOWLEDGE_INTERIOR_PRICE_COPY+" 是否确认？"))return;
      const parsed = parseKnowledgeManuscript(
        pub.manuscript,
        pub.source.pages.map(p => p.id)
      );
      const next = {
        ...current,
        title: parsed.title,
        pages: current.pages.map((p, i) => ({ ...p, ...parsed.pages[i] })),
        publication: { ...pub, confirmedManuscript: pub.manuscript,...(pub.billing?{billing:{...pub.billing,confirmed:true}}:{}) },
        updatedAt: new Date().toISOString(),
      };
      const saved = await save(next);
      if(format==="pptx"){
        if(!pub.presentationPlan||!knowledgePresentationRequestMatches(pub.presentationRequest,pub)||pub.presentationRequest!.minSlides!==minSlides||pub.presentationRequest!.maxSlides!==maxSlides)throw Error("请先按当前页数范围规划并确认提纲");
        setMessage("确认稿已保存，正在生成可编辑课件…");
        const result=await pptxExporter.mutateAsync({documentId:next.id,expectedGeneration:saved.generation});
        setPptxFile(result);setMessage(`PPTX已生成，共${result.slides}页，可下载后编辑。`);
      }else{
        setMessage("确认稿已保存，正在自动排版并生成 HTML 和 PDF…");
        const result=await exporter.mutateAsync({documentId:next.id,expectedGeneration:saved.generation});
        if (paginationVersion(latest.current) !== paginationVersion(next)) return;
        setFiles(result);
        if (result.pdfUrl && result.totalPages && result.imagePages !== undefined) {
          onPagination?.(next, { imagePages: result.imagePages, totalPages: result.totalPages });
          setMessage(`排版完成：图片 ${result.imagePages} 页｜手册共 ${result.totalPages} 页。可直接下载。`);
        } else setMessage(result.pdfError || "HTML 和 PDF 已生成并保存，可直接下载。");
      }
    } catch (e) {
      console.warn("[knowledgePublication] 导出失败原因：", String((e as Error)?.message ?? e).replace(/(?:https?|gs):\/\/\S+/g, "[地址]").slice(0, 800));
      setError(knowledgePublicationPublicError(e).message);
    } finally {
      locked(false);
    }
  };
  const exportLayout=async(next:EditableLayout,saved:Saved)=>{
    setFiles(null);setError("");
    setMessage("顾问方案已保存，正在按指定章节顺序和设计生成 PDF…");
    const result=await exporter.mutateAsync({documentId:next.id,expectedGeneration:saved.generation});
    if(latest.current.id!==next.id)return;
    setFiles(result);
    if(result.pdfUrl&&result.totalPages&&result.imagePages!==undefined){
      onPagination?.(next,{imagePages:result.imagePages,totalPages:result.totalPages});
      setMessage(`已按顾问方案排版：图片 ${result.imagePages} 页｜手册共 ${result.totalPages} 页。`);
    }else setMessage(result.pdfError||"排版方案已保存，可继续导出，无需重新调用顾问。");
  };
  const pub = doc.publication!,
    review = pub.layoutConversationId ? layoutView?.review ?? pub.review : pub.review;
  const reviewBatchCount = knowledgeReviewBatches(pub.source).length;
  const completedGroups = completedKnowledgeBatches(pub, reviewBatchCount);
  const chapterBatches = knowledgeReviewBatches(pub.source);
  const completedCount = chapterBatches.filter((_,i)=>completedGroups.has(i)).reduce((n,pages)=>n+pages.length,0);
  const pendingChapters = chapterBatches.flatMap((pages,i)=>completedGroups.has(i)?[]:pages.map(n=>n+1));
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
  if (review && (!pub.layoutConversationId || layoutView)) {
    try {
      const parsed = parseKnowledgeManuscript(
        pub.manuscript,
        pub.source.pages.map(p => p.id)
      );
      const current = pub.layoutConversationId && layoutView ? layoutView.doc : {
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
          layoutView?.images[current.pages[index].imageUrl] || current.pages[index].imageUrl,
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
      className={`space-y-4 rounded-2xl border border-[#b9c4ad]/40 bg-[#182721] ${compact ? "p-3" : "p-5"} text-[#f5f0e5]`}
    >
      <div>
        <h4 className="text-lg font-semibold">图文知识手册</h4>
        <p className="mt-1 text-sm text-[#c0cabb]">
          整套 {pub.source.pages.length} 章内容、{pub.source.pages.filter(p => p.imageUrl).length} 张原图；按原顺序处理全部正文，手册按内容自动分页。
        </p>
      </div>
      <p className="text-xs text-[#c0cabb]">{KNOWLEDGE_INTERIOR_PRICE_COPY}</p>
      <details open={!compact} className="space-y-3">
      <summary className="cursor-pointer text-sm text-[#c0cabb]">手册与阅读设置</summary>
      <p className="text-sm text-[#c0cabb]">内容整理后自动排版，保留原图与完整正文；需要时可以调整阅读模板。</p>
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
        <p className="mt-2 text-xs text-[#c0cabb]">模板保留原图，按章节组织配色与表格；更换模板后会重新生成版面。</p>
      </label>
      <p className="text-sm text-[#c0cabb]">{pub.source.detailLevel === "concise" ? "精华版 · 主要知识成图，次要知识用文字和表格" : pub.source.detailLevel === "full" ? "完整版 · 主次知识浓缩成图，配简练说明" : "旧稿未记录图卡版本 · 保留现有说明密度"}</p>
      {review && <p className="text-sm text-[#c0cabb]">
        {selectedTemplate ? "已应用所选版式" : "已按内容匹配版式"}
        {!pub.infographicTemplateId && review.pages[index]?.reading?.templateReason ? ` · ${review.pages[index].reading!.templateReason}` : ""}
      </p>}
      </details>
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
          <section className="space-y-3 rounded-xl border border-[#b9c4ad]/40 p-4" aria-label="PPTX课件规划">
            <div><h3 className="font-semibold">PPTX 页数与提纲</h3><p className="text-sm text-[#c0cabb]">可在出图期间按完整文字稿提前规划；待生成图片只预留位置，实际图片与整稿审校通过后确认导出。标题、总结也计入总页数。</p></div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">最少页数<input aria-label="PPTX最少页数" type="number" min={1} max={200} value={minSlides} disabled={presentationBusy||!!planDraft} onChange={e=>{setMinSlides(Number(e.target.value));setPptxFile(null);}} className="ml-2 w-20 rounded bg-[#f9f6ee] p-2 text-[#243a35]" /></label>
              <label className="text-sm">最多页数<input aria-label="PPTX最多页数" type="number" min={1} max={200} value={maxSlides} disabled={presentationBusy||!!planDraft} onChange={e=>{setMaxSlides(Number(e.target.value));setPptxFile(null);}} className="ml-2 w-20 rounded bg-[#f9f6ee] p-2 text-[#243a35]" /></label>
              <button className={button} disabled={presentationBusy||!!planDraft||pub.synchronizedStarted===false||minSlides<1||maxSlides>200||minSlides>maxSlides} onClick={()=>void planPptx()}>{presentationBusy?"正在提前规划…":"规划 PPTX 提纲"}</button>
              {review&&displayedPlan&&pub.presentationRequest?.basis==='source'&&<button className={button} disabled={busy||presentationBusy||!!planDraft} onClick={()=>void planPptx(false,false,true)}>按最终审校稿重新规划</button>}
              {!displayedPlan&&knowledgePresentationRequestMatches(pub.presentationRequest,pub)&&pub.presentationRequest!.minSlides===minSlides&&pub.presentationRequest!.maxSlides===maxSlides&&<button className={button} disabled={presentationBusy} onClick={()=>void planPptx(true)}>核对失败状态并重试</button>}
            </div>
            {displayedPlan&&knowledgePresentationRequestMatches(pub.presentationRequest,pub)&&pub.presentationRequest!.minSlides===minSlides&&pub.presentationRequest!.maxSlides===maxSlides&&<>
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
              <button className={button} disabled={busy||presentationBusy||!review||!!planDraft||capacityIssues.length>0} onClick={()=>void publish("pptx")}>确认提纲并导出 PPTX</button>
            </>}
          </section>
      {!review ? (
        <div className="space-y-3">
          <p className="text-sm">
            正文整理 {Math.round(completedCount/Math.max(1,pub.source.pages.length)*100)}% · 已完成 {completedCount}/{pub.source.pages.length} 章。原稿与配图已保留。
            {pendingChapters.length>0 && <span>第 {pendingChapters.join("、")} 章{error ? "尚未成功，已完成章节不会重做。" : "正在等待或整理。"}</span>}
            {completedCount===pub.source.pages.length && <span>联网校验搜索进行中，尚未完成最终统稿。</span>}
          </p>
          <div aria-label="已整理章节" aria-live="polite" className="max-h-[720px] space-y-4 overflow-y-auto">
            {pub.source.pages.map((source,i)=>{const chapter=pub.chapterReviews?.[source.id];if(!chapter || !pub.chapterReviewDigest)return null;
              const page=doc.pages.find(p=>p.id===source.id);
              const partialDoc={...doc,pages:[{...page!,headline:chapter.headline,body:chapter.body}]};
              const partialReview:KnowledgeReview={kind:"knowledge_publication_v1",sourceDigest:pub.chapterReviewDigest,title:doc.title,pages:[chapter]};
              return <article key={source.id}><h5>第 {i+1} 章 · {chapter.headline}</h5><p className="whitespace-pre-wrap">{chapter.body}</p>
                <iframe title={`第 ${i+1} 章图文预览`} sandbox="" className="h-[520px] w-full rounded-lg bg-[#faf7f0]" srcDoc={knowledgePublicationHead(doc.title)+knowledgePublicationChapter(partialDoc,partialReview,0,page?.imageUrl||"",true)+"</body></html>"}/>
              </article>;
            })}
          </div>
          <button
            className={button}
            disabled={busy}
            onClick={() => void run(terminal)}
          >
            {busy
              ? "正在自动处理…"
              : terminal
                ? "仅恢复失败章节并继续"
                : completedCount
                  ? "继续自动审校"
                  : "开始自动审校"}
          </button>
        </div>
      ) : (
        <>
          {pub.automaticLayout&&!pub.layoutConversationId&&<button className={button} disabled={busy} onClick={()=>void run()}>恢复整册自动排版（沿用原请求）</button>}
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
          {layoutPreviewError&&<p role="alert" className="text-rose-200">{layoutPreviewError}</p>}
          {pub.layoutConversationId&&!layoutView&&!layoutPreviewError&&<p role="status">正在读取整册预览…</p>}
          <iframe
            title="图文知识手册预览"
            sandbox="allow-scripts"
            srcDoc={preview}
            className="h-[720px] w-full rounded-xl border-0 bg-[#faf7f0]"
          />

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
            {files?.billing&&<p className="text-sm">纯内文 {files.billing.readingPages} 页 · 本稿已结算 {files.billing.chargedCredits} 积分{files.billing.alreadyCharged?"，本次未重复扣费":""} · 顾问不另收费</p>}
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
                    下载 PDF{files.totalPages ? ` · 手册共 ${files.totalPages} 页` : ""}
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
