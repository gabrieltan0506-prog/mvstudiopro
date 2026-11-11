import {refineKnowledgeSupplement} from '@/lib/knowledgeSupplementRefine';
import {withKnowledgeAdvisorRecovery} from '@/lib/knowledgeAdvisorRecovery';
import {streamManhuaAdvisor} from '@/lib/manhuaAdvisorStream';
import { knowledgePresentationSourceManuscript } from "@shared/knowledgePresentation";
import type {KnowledgeSupplementSelection} from "@shared/knowledgeSupplement";
import type { KnowledgePublicationPagination } from "@shared/knowledgePublication";
import { planKnowledgeCardPages } from "@shared/knowledgeCardPagination";
import { sanitizePlatformUserMessage } from "@/lib/platformUserFacingCopy";
import KnowledgePublicationPanel from "./KnowledgePublicationPanel";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { flyDownloadUrl } from "@/lib/gcsTransfer";
import {
  compactLayoutCache,
  compactLayoutCacheKey,
  legacyCacheSafeToDrop,
  legacyLayoutCacheKey,
  mergeCompactWithCloud,
  parseCompactLayoutCache,
  parseLegacyLayoutCache,
  provisionalFromCompact,
  syncedLayoutVersions,
  type CompactLayoutCache,
} from "@/lib/editableLayoutLocalCache";
import {
  buildLayoutHtml,
  editableLayoutSchema,
  layoutFromSource,
  layoutLibrarySchema,
  layoutImageSchema,
  type EditableLayout,
  type LayoutLibrary,
  type LayoutSource,
} from "@shared/editableLayout";
import {
  downloadLayoutBlob,
  exportEditableLayout,
} from "@/lib/editableLayoutExport";
type Cache = {
  library: LayoutLibrary;
  generation: string;
  dirty: boolean;
  activeId: string;
};
const button =
  "rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40";
const field =
  "w-full rounded-lg border border-white/20 bg-[#201b32] p-2 text-white";
export type EditableLayoutStudioHandle = {
  refineSupplement: (sourceId:string)=>Promise<{selection:KnowledgeSupplementSelection;markdown:string}>;
  beginNewSource: () => void;
  prepare: (source: LayoutSource, waitForImages: (ids: string[]) => Promise<void>, supplementOf?: KnowledgeSupplementSelection, options?: {waitForReading?:()=>Promise<void>;preparePresentation?:boolean}) => Promise<{ documentId: string; maxCredits: number; estimatedCredits: number; presentationCredits?:number }>;
  start: (documentId: string, authorizedCredits: number) => Promise<void>;
  imageJobs: (markdown: string, model: string, template: string | null) => string[] | null;
  beginImageAttempt: (originalJobId: string, requestId: string, jobId: string) => Promise<void>;
  attachImage: (originalJobId: string, replacementJobId: string, resume: boolean) => Promise<void>;
};
/** 按账号恢复，条件写入防止旧会话覆盖新稿。 */
const EditableLayoutStudio = forwardRef<EditableLayoutStudioHandle, { owner: string; source: LayoutSource | null; readingView?:ReactNode; compact?: boolean; onSupplement?: (selection:KnowledgeSupplementSelection,markdown:string)=>Promise<void>; onPagination?: (doc: EditableLayout, pagination: KnowledgePublicationPagination | null) => void }>(function EditableLayoutStudio({
  owner,
  source,
  readingView,
  onPagination,
  onSupplement,
  compact = false,
}: {
  owner: string;
  source: LayoutSource | null;
  readingView?:ReactNode;
  compact?: boolean;
  onSupplement?: (selection:KnowledgeSupplementSelection,markdown:string)=>Promise<void>; onPagination?: (doc: EditableLayout, pagination: KnowledgePublicationPagination | null) => void;
}, ref) {
  // 本机缓存（1111 瘦身）：云端为准，本机只完整保存当前打开的稿与未同步的稿，其他稿只留索引；旧 v1 完整库确认云端已有同版或更新版后才删除。
  const legacyKey = legacyLayoutCacheKey(owner);
  const key = compactLayoutCacheKey(owner);
  const [state, setState] = useState<Cache>({
    library: { version: 1, owner, documents: [] },
    generation: "0",
    dirty: false,
    activeId: "",
  });
  const current = useRef(state);
  const cacheWritable = useRef(true);
  /** 本机写入失败后降级为仅云端保存，只提示一次。 */
  const localDegraded = useRef(false);
  /** 最近一次与云端一致时各稿 updatedAt；用于判断哪些稿需在本机完整暂存。 */
  const synced = useRef<Map<string, string>>(new Map());
  /** 旧 v1 完整库仍在本机；内存库是否以它为底稿（以它为底稿时，一次云端保存成功即可安全删除）。 */
  const legacyPresent = useRef(false);
  const legacyInMemory = useRef(false);
  /** 内存库只是本机暂存的部分稿件（云端尚未读回）：禁止整库保存，以免覆盖云端其他稿。 */
  const partialLibrary = useRef(false);
  const alive = useRef(true);
  const sourceSeen = useRef<LayoutSource | null>(null);
  const [ready, setReady] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [autoPublicationId,setAutoPublicationId]=useState("");
  const [autoStartToken, setAutoStartToken] = useState(0);
  const [synchronizedRun, setSynchronizedRun] = useState<{ documentId: string; authorizedCredits: number; presentationCredits?:number; preparePresentation?:boolean; waitForReading?:()=>Promise<void>; waitForImages: (ids: string[]) => Promise<void> } | null>(null);
  const preparedRun = useRef<{ documentId: string; presentationCredits?:number; preparePresentation?:boolean; waitForReading?:()=>Promise<void>; waitForImages: (ids: string[]) => Promise<void> } | null>(null);
  const utils = trpc.useUtils();
  const saveMutation = trpc.editableLayout.save.useMutation();
  const finishedExportStarter = trpc.editableLayout.startExportPublication.useMutation();
  const [finishedDownloading, setFinishedDownloading] = useState("");
  /**
   * 已成册的手册直接取云端成品 PDF（1111）：不重新整理、不重新生图、不重复扣费。
   * 此前回到页面后找不到成品入口，只能再点「生成」，等于重走一遍生图。
   */
  const downloadFinished = async (documentId: string) => {
    if (finishedDownloading) return;
    setFinishedDownloading(documentId); setError(""); setMessage("正在取云端成品 PDF…");
    try {
      const generation = current.current.generation;
      let task: { status: string; taskId: string; result?: unknown; error?: string } = await finishedExportStarter.mutateAsync({ documentId, expectedGeneration: generation });
      let reissued = 0, misses = 0;
      const deadline = Date.now() + 30 * 60_000;
      while (task.status === "running" || task.status === "missing") {
        if (Date.now() > deadline) throw Error("成品 PDF 读取时间过长，请稍后再试");
        if (task.status === "missing") {
          if (++reissued > 3) throw Error("成品 PDF 暂时无法读取，请稍后再试");
          task = await finishedExportStarter.mutateAsync({ documentId, expectedGeneration: generation });
          continue;
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
        try { task = await utils.client.editableLayout.exportPublicationStatus.query({ taskId: task.taskId }); misses = 0; }
        catch (e) { if (++misses > 5) throw e; }
      }
      if (task.status === "failed") throw Error(task.error || "成品 PDF 暂时无法读取，请稍后再试");
      const result = task.result as { pdfUrl?: string; totalPages?: number; pdfError?: string };
      if (!result?.pdfUrl) throw Error(result?.pdfError || "这份手册还没有成品 PDF，请打开稿件后生成");
      const link = document.createElement("a");
      link.href = flyDownloadUrl(result.pdfUrl); link.download = ""; link.rel = "noopener";
      document.body.appendChild(link); link.click(); link.remove();
      setMessage(`已开始下载成品 PDF${result.totalPages ? ` · 共 ${result.totalPages} 页` : ""}；未重新生图`);
    } catch (e) {
      setMessage(""); setError(e instanceof Error ? e.message : "成品 PDF 下载失败");
    } finally { setFinishedDownloading(""); }
  };
  const install = (next: Cache) => {
    current.current = next;
    setState(next);
    if (!next.dirty && !partialLibrary.current) synced.current = syncedLayoutVersions(next.library);
    if (!cacheWritable.current || localDegraded.current) return;
    try {
      localStorage.setItem(key, JSON.stringify(compactLayoutCache(next, synced.current)));
    } catch {
      // 本机空间不足：不再吓人地报「保存失败」，降级为仅云端保存并提示一次。
      localDegraded.current = true;
      setMessage("本机暂存空间不足，已改为仅云端保存；稿件以云端为准，修改后请及时保存云端。");
    }
  };
  /** 所有整库云端保存的唯一入口：不完整库拒绝保存；以旧完整库为底稿的内容一旦保存成功即删除旧 key。 */
  const cloudSave = async (input: { library: LayoutLibrary; expectedGeneration: string }) => {
    if (partialLibrary.current) throw new Error("云端稿件尚未读取完成，本次未保存，避免覆盖其他稿件；请先读取云端");
    const result = await saveMutation.mutateAsync(input);
    if (legacyPresent.current && legacyInMemory.current) {
      try { localStorage.removeItem(legacyKey); legacyPresent.current = false; legacyInMemory.current = false; } catch { /* 删除失败下次再删 */ }
    }
    return result;
  };
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    let local = current.current;
    let legacy: Cache | null = null;
    let compact: CompactLayoutCache | null = null;
    // 无法读取的本机原文先另存再继续；备份失败时禁止本机写入覆盖它。
    const preserveUnreadable = (storageKey: string, raw: string | null) => {
      try {
        if (raw === null) throw new Error("浏览器存储不可读");
        localStorage.setItem(`${storageKey}.unreadable.${Date.now()}`, raw);
        setError("本机稿件无法读取，已另存原始副本；正在读取云端稿件");
      } catch {
        cacheWritable.current = false;
        setError("本机原记录无法备份，未覆盖；请保存云端或导出当前稿件");
      }
    };
    let rawLegacy: string | null = null, rawCompact: string | null = null;
    try {
      rawLegacy = localStorage.getItem(legacyKey);
      if (rawLegacy) legacy = parseLegacyLayoutCache(rawLegacy, owner);
    } catch {
      preserveUnreadable(legacyKey, rawLegacy);
      // 已另存原文副本时释放旧 key 占用的空间；另存失败则原样保留。
      if (cacheWritable.current && rawLegacy !== null) try { localStorage.removeItem(legacyKey); } catch { /* 保留 */ }
    }
    try {
      rawCompact = localStorage.getItem(key);
      if (rawCompact) compact = parseCompactLayoutCache(rawCompact, owner);
    } catch { preserveUnreadable(key, rawCompact); }
    if (legacy) legacyPresent.current = true;
    // 新格式里有基于别的云端版本的未保存修改：不能叠到旧完整库上（会用旧稿覆盖云端），改走新格式路径，旧 key 原样保留。
    if (legacy && compact?.dirty && compact.documents.length && compact.generation !== legacy.generation) legacy = null;
    if (legacy) {
      // 旧完整库为底稿；新格式里同版本的未保存修改叠加其上。
      legacyInMemory.current = true;
      local = legacy;
      if (compact?.dirty && compact.documents.length) {
        const merged = mergeCompactWithCloud(compact, { library: legacy.library, generation: legacy.generation }, owner).state;
        local = { ...merged, generation: compact.generation, activeId: "" };
      }
    } else if (compact) {
      local = provisionalFromCompact(compact, owner);
      partialLibrary.current = true;
    }
    if (legacy || compact) { current.current = local; setState(local); }
    void utils.editableLayout.get
      .fetch()
      .then(result => {
        if (cancelled) return;
        if (result.library && result.library.owner !== owner)
          throw new Error("云端稿件账号不匹配，未读取");
        const cloud = { library: result.library, generation: result.generation };
        if (legacy) {
          // 旧完整库：确认云端已有同版本或更新版本、本机无未保存修改才删；否则原样保留。
          if (legacyCacheSafeToDrop({ generation: legacy.generation, dirty: local.dirty }, { generation: result.generation, hasLibrary: Boolean(result.library) })) {
            try { localStorage.removeItem(legacyKey); legacyPresent.current = false; } catch { /* 下次再删 */ }
          }
          if (!local.dirty) {
            legacyInMemory.current = false;
            install({ library: result.library || { version: 1, owner, documents: [] }, generation: result.generation, dirty: false, activeId: local.activeId });
          } else if (result.generation !== local.generation)
            setError("云端有不同版本，本机修改已保留；先导出备份，再读取云端，避免覆盖");
          else install(local);
        } else if (compact) {
          const merged = mergeCompactWithCloud(compact, cloud, owner);
          partialLibrary.current = false;
          install(merged.state);
          if (merged.conflict) setError("云端有不同版本，本机修改已保留；先导出备份，再读取云端，避免覆盖");
        } else if (!local.dirty)
          install({
            library: result.library || { version: 1, owner, documents: [] },
            generation: result.generation,
            dirty: false,
            activeId: local.activeId,
          });
        else if (result.generation !== local.generation)
          setError(
            "云端有不同版本，本机修改已保留；先导出备份，再读取云端，避免覆盖"
          );
        setCloudReady(true);
      })
      .catch(e => {
        if (!cancelled) setError(`云端读取失败，本机稿保留：${e.message}`);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [owner]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (current.current.dirty || locked.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const add = (doc: EditableLayout) => {
    const old = current.current;
    const library = layoutLibrarySchema.parse({
      ...old.library,
      documents: [...old.library.documents, doc],
    });
    install({ ...old, library, dirty: true, activeId: doc.id });
    setPageIndex(0);
    if(doc.publication)setAutoPublicationId(doc.id);
    setOpen(true);
  };
  useEffect(() => {
    if (
      !ready ||
      busy ||
      !source ||
      source.owner !== owner ||
      source === sourceSeen.current
    )
      return;
    sourceSeen.current = source;
    try {
      const existing = current.current.library.documents.find(doc => doc.sourceId === source.sourceId && doc.publication?.synchronizedStarted === true);
      if (existing) {
        install({ ...current.current, activeId: existing.id });
        setOpen(true);
        setMessage("已打开这次同步生成的手册，原稿与整理进度均已保留。");
        return;
      }
      add(layoutFromSource(source));
      setMessage("已导入现有稿件，原稿保留。修改后请保存云端。");
    } catch (e) {
      setOpen(true);
      setError(e instanceof Error ? e.message : "稿件导入失败，未截断内容");
    }
  }, [source, ready, busy]);
  const doc = state.library.documents.find(d => d.id === state.activeId);
  const index = doc ? Math.min(pageIndex, doc.pages.length - 1) : 0;
  const page = doc?.pages[index];
  const update = (patch: Partial<EditableLayout>) => {
    if (!doc) return;
    const nextDoc = { ...doc, ...patch, updatedAt: new Date().toISOString() };
    install({
      ...current.current,
      dirty: true,
      library: {
        ...current.current.library,
        documents: current.current.library.documents.map(d =>
          d.id === doc.id ? nextDoc : d
        ),
      },
    });
  };
  const commitPublication = async(nextDoc:EditableLayout) => {
    const previous=current.current;
    const library=layoutLibrarySchema.parse({...previous.library,documents:previous.library.documents.map(d=>d.id===nextDoc.id?nextDoc:d)});
    install({...previous,library,dirty:true});
    const result=await cloudSave({library,expectedGeneration:previous.generation});
    if(alive.current)install({...current.current,generation:result.generation,dirty:current.current.library!==library});
    return {generation:result.generation};
  };
  useImperativeHandle(ref, () => ({
    async refineSupplement(sourceId){
      if(!ready||!cloudReady||locked.current)throw Error("原稿尚在整理，请稍候");
      const parent=current.current.library.documents.find(d=>d.sourceId===sourceId&&d.publication?.source.detailLevel==='concise'&&d.publication?.synchronizedStarted===true);
      if(!parent)throw Error("请先生成并整理原精华版，再提炼补充页");
      locked.current=true;setBusy(true);
      const stillHere=()=>alive.current&&current.current.library.documents.some(d=>d.id===parent.id&&d.publication?.manuscript===parent.publication?.manuscript);
      try{return await refineKnowledgeSupplement(parent,{
        current:()=>{if(!stillHere())throw Error("原稿已变化，请恢复原请求");return current.current.library.documents.find(d=>d.id===parent.id)!;},
        save:commitPublication,
        quote:()=>utils.editableLayout.publicationQuote.fetch({documentId:parent.id,purpose:'conversation'}),
        send:async(requestId,question,batchIndex)=>{
          const response=await withKnowledgeAdvisorRecovery(requestId,()=>streamManhuaAdvisor({requestId,question,rawQuestion:question,knowledgePublicationContext:{documentId:parent.id,batchIndex,attempt:0,purpose:'conversation'},confirmPaid:false,confirmedCredits:0},()=>undefined),()=>utils.client.auth.me.query(),stillHere);
          return response.answer;
        },
      });}finally{locked.current=false;if(alive.current)setBusy(false);}
    },
    beginNewSource() {
      sourceSeen.current = source;
      preparedRun.current = null;
      setSynchronizedRun(null);setAutoPublicationId("");
      setMessage("本次使用新资料，旧稿仅在你明确恢复后打开。");setError("");
      locked.current=false;setBusy(false);
      install({...current.current,activeId:""});
    },
    async prepare(source, waitForImages, supplementOf, options) {
      if (!ready || !cloudReady || locked.current || source.owner !== owner) throw new Error("云端稿件尚未就绪或正在整理，请稍后开始");
      const nextDoc = layoutFromSource(source);
      if (nextDoc.publication) {
        nextDoc.publication.synchronizedStarted = false;nextDoc.publication.supplementOf=supplementOf;
        if(options?.preparePresentation)nextDoc.publication.presentationRequest={id:crypto.randomUUID(),basis:"source",minSlides:15,maxSlides:20,manuscript:knowledgePresentationSourceManuscript(nextDoc.publication.source)};
      }
      const previous = current.current;
      const library = layoutLibrarySchema.parse({ ...previous.library, documents: [...previous.library.documents, nextDoc] });
      // 先保存完整底稿和全部图片任务身份，再允许任何收费请求。
      const result = await cloudSave({ library, expectedGeneration: previous.generation });
      install({ library, generation: result.generation, dirty: false, activeId: nextDoc.id });
      preparedRun.current = { documentId: nextDoc.id, waitForImages,waitForReading:options?.waitForReading,preparePresentation:options?.preparePresentation };
      setOpen(true);
      const quote = await utils.editableLayout.publicationQuote.fetch({ documentId: nextDoc.id });
      const presentation = options?.preparePresentation ? await utils.editableLayout.publicationQuote.fetch({documentId:nextDoc.id,purpose:"presentation"}) : null;
      const layoutQuote = !supplementOf ? await utils.editableLayout.publicationQuote.fetch({documentId:nextDoc.id,purpose:"conversation"}) : null;
      if(layoutQuote && nextDoc.publication){
        nextDoc.publication.automaticLayout={requestId:crypto.randomUUID(),maxCredits:layoutQuote.maxCredits};
        await commitPublication(nextDoc);
      }
      preparedRun.current.presentationCredits=presentation?.maxCredits||0;
      return { documentId: nextDoc.id, maxCredits: quote.maxCredits+(presentation?.maxCredits||0)+(layoutQuote?.maxCredits||0), estimatedCredits: quote.estimatedCredits+(presentation?.estimatedCredits||0)+(layoutQuote?.estimatedCredits||0),presentationCredits:presentation?.maxCredits||0 };
    },
    imageJobs(markdown, model, template) {
      const bodies = planKnowledgeCardPages(markdown, model).pages;
      const documents = [...current.current.library.documents].reverse();
      const found = documents.find(doc => {
        const pub = doc.publication;
        if (!pub || pub.synchronizedStarted !== true || (pub.infographicTemplateId || "") !== (template || "")) return false;
        const images = pub.source.pages.filter(page => page.imageJobId);
        return images.length === bodies.length && images.every((page, i) => page.body === bodies[i]);
      });
      return found?.publication?.source.pages.filter(page => page.imageJobId).map(page => found.publication!.imageAttempts?.[page.imageJobId!]?.jobId || found.publication!.imageReplacements?.[page.imageJobId!] || page.imageJobId!) || null;
    },
    async beginImageAttempt(originalJobId, requestId, jobId) {
      while (locked.current && alive.current) await new Promise(resolve => setTimeout(resolve, 100));
      if (!alive.current || !cloudReady) throw new Error("请先恢复云端稿件，未开始补图");
      locked.current = true;
      try {
        const previous = current.current;
        const target = [...previous.library.documents].reverse().find(doc => doc.publication?.source.pages.some(page => page.imageJobId === originalJobId) || Object.values(doc.publication?.imageAttempts || {}).some(attempt => attempt.jobId === originalJobId));
        if (!target?.publication) throw new Error("缺少原配图的云端稿件，未开始补图");
        const pub = target.publication;
        const root = pub.source.pages.find(page => page.imageJobId === originalJobId)?.imageJobId || Object.entries(pub.imageAttempts || {}).find(([, attempt]) => attempt.jobId === originalJobId)?.[0];
        if (!root || (pub.imageAttempts?.[root]?.jobId || root) !== originalJobId) throw new Error("补图尝试已变化，请恢复当前任务");
        const next = { ...target, publication: { ...pub, imageAttempts: { ...pub.imageAttempts, [root]: { requestId, jobId } } } };
        const library = layoutLibrarySchema.parse({ ...previous.library, documents: previous.library.documents.map(doc => doc.id === target.id ? next : doc) });
        const saved = await cloudSave({ library, expectedGeneration: previous.generation });
        install({ library, generation: saved.generation, dirty: false, activeId: target.id });
      } finally { locked.current = false; }
    },
    async attachImage(originalJobId, replacementJobId, resume) {
      while (locked.current && alive.current) await new Promise(resolve => setTimeout(resolve, 100));
      if (!alive.current) throw new Error("页面已离开，补图已保留，请重新读取云稿");
      locked.current = true;
      try {
        const previous = current.current;
        const target = [...previous.library.documents].reverse().find(doc => doc.publication?.source.pages.some(page => page.imageJobId === originalJobId) || Object.values(doc.publication?.imageAttempts || {}).some(attempt => attempt.jobId === originalJobId) || Object.values(doc.publication?.imageReplacements || {}).includes(originalJobId));
        if (!target?.publication) throw new Error("缺少原稿，补图已保留，请先恢复云稿");
        const pub = target.publication;
        const root = pub.source.pages.find(page => page.imageJobId === originalJobId)?.imageJobId || Object.entries(pub.imageAttempts || {}).find(([, attempt]) => attempt.jobId === originalJobId)?.[0] || Object.entries(pub.imageReplacements || {}).find(([, job]) => job === originalJobId)?.[0];
        if (!root) throw new Error("补图原稿身份不匹配");
        const next = root === replacementJobId ? target : { ...target, publication: { ...pub, imageReplacements: { ...pub.imageReplacements, [root]: replacementJobId } } };
        const library = layoutLibrarySchema.parse({ ...previous.library, documents: previous.library.documents.map(doc => doc.id === target.id ? next : doc) });
        const saved = await cloudSave({ library, expectedGeneration: previous.generation });
        install({ library, generation: saved.generation, dirty: false, activeId: target.id });
        setSynchronizedRun(null);
        if (resume) { setAutoPublicationId(target.id); setAutoStartToken(token => token + 1); setOpen(true); }
      } finally { locked.current = false; }
    },
    async start(documentId, authorizedCredits) {
      const pending = preparedRun.current;
      if (!pending || pending.documentId !== documentId) throw new Error("同步稿件已变化，未开始生成");
      const previous = current.current;
      const child=previous.library.documents.find(d=>d.id===documentId),parentId=child?.publication?.supplementOf?.documentId;
      const parent=previous.library.documents.find(d=>d.id===parentId);
      if(parentId&&(!parent?.publication||parent.publication.supplementDocumentId&&parent.publication.supplementDocumentId!==documentId))throw Error("本册已有补图批次，请恢复原补充稿");
      const library = layoutLibrarySchema.parse({ ...previous.library, documents: previous.library.documents.map(doc => doc.id === documentId ? { ...doc, publication: { ...doc.publication!, synchronizedStarted: true, billing:{version:"interior-pages-v1",confirmed:true} } } : doc.id===parentId?{...doc,publication:{...doc.publication!,supplementDocumentId:documentId}}:doc) });
      const saved = await cloudSave({ library, expectedGeneration: previous.generation });
      install({ library, generation: saved.generation, dirty: false, activeId: documentId });
      setSynchronizedRun({ ...pending, authorizedCredits:Math.max(0,authorizedCredits-(pending.presentationCredits||0)) });
      setAutoPublicationId(documentId);
      preparedRun.current = null;
    },
  }));
  const editPage = (patch: Partial<EditableLayout["pages"][number]>) => {
    if (doc)
      update({
        pages: doc.pages.map((p, i) => (i === index ? { ...p, ...patch } : p)),
      });
  };
  const action = async (run: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "操作失败，原稿已保留");
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const save = () =>
    action(async () => {
      const captured = current.current;
      layoutLibrarySchema.parse(captured.library);
      const result = await cloudSave({
        library: captured.library,
        expectedGeneration: captured.generation,
      });
      if (!alive.current) return;
      install({
        ...current.current,
        generation: result.generation,
        dirty: current.current.library !== captured.library,
      });
      setMessage(
        `云端已保存 · ${new Date(result.updatedAt).toLocaleString("zh-CN")}`
      );
    });
  const restore = () =>
    action(async () => {
      if (
        current.current.dirty &&
        !window.confirm(
          "读取云端将替换当前本机修改。请先导出稿件备份。确定继续？"
        )
      )
        return;
      const result = await utils.editableLayout.get.fetch();
      if (!alive.current) return;
      if (result.library && result.library.owner !== owner)
        throw new Error("云端稿件账号不匹配，未读取");
      partialLibrary.current = false;
      legacyInMemory.current = false;
      install({
        library: result.library || { version: 1, owner, documents: [] },
        generation: result.generation,
        dirty: false,
        activeId: "",
      });
      setCloudReady(true);
      setPageIndex(0);
      setMessage(result.library ? "已读取云端完整稿件" : "云端尚无排版稿");
    });
  const backup = () =>
    downloadLayoutBlob(
      new Blob([JSON.stringify(current.current.library, null, 2)], {
        type: "application/json",
      }),
      "排版稿件备份.json"
    );
  const importBackup = (file: File) =>
    action(async () => {
      if (file.size > 64 * 1024 * 1024) throw new Error("备份超过64MB，未读取");
      const library = layoutLibrarySchema.parse(JSON.parse(await file.text()));
      if (library.owner !== owner) throw new Error("备份属于其他账号，未导入");
      const incoming = library.documents.map(d => ({
        ...d,
        id: crypto.randomUUID(),
        ...(d.publication ? {publication:{...d.publication,requestId:crypto.randomUUID(),conversation:undefined,layoutConversationId:undefined,supplementOf:undefined,supplementDocumentId:undefined,completedBatches:0,parallel:undefined,attempts:{},review:undefined,confirmedManuscript:undefined}} : {}),
      }));
      const merged = layoutLibrarySchema.parse({
        ...current.current.library,
        documents: [...current.current.library.documents, ...incoming],
      });
      install({
        ...current.current,
        library: merged,
        activeId: incoming[0]?.id || current.current.activeId,
        dirty: true,
      });
      setPageIndex(0);
      setMessage("备份已作为独立稿件导入，已有稿件保留");
    });
  let preview = "";
  if (doc) {
    try {
      preview = buildLayoutHtml(doc, {}, true).replace(
        "</head>",
        `<style>.page{display:none}.page:nth-of-type(${index + 1}){display:block}</style></head>`
      );
    } catch {
      /* 编辑中的空标题保留，导出时校验。 */
    }
  }
  return (
    <section
      id="editable-layout-studio"
      className="mb-5 rounded-2xl border border-[#ddbc87]/40 bg-[#181521] p-4 text-white"
      aria-label="可编辑排版与导出"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-[#edd4ac]">{compact ? "图文知识手册" : "排版与导出"}</h3>
          <p className={compact ? "hidden" : "text-xs text-gray-400"}>
            图文知识手册 · 自动整理与排版 · 云端保存恢复 · HTML / PDF
          </p>
        </div>
        <button className={button} onClick={() => setOpen(!open)}>
          {open
            ? "收起排版"
            : `打开稿件库（${state.library.documents.length}）`}
        </button>
      </div>
      {readingView && <div className="mt-3">{readingView}</div>}
      {(() => {
        const finished = state.library.documents
          .filter(d => d.publication?.review && d.publication.confirmedManuscript && d.publication.confirmedManuscript === d.publication.manuscript)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
        if (!finished.length) return null;
        return (
          <div className="mt-3 rounded-xl border border-[#d7e6c4]/25 bg-[rgba(215,230,196,0.06)] p-3" aria-label="已成册手册">
            <p className="text-sm font-semibold text-[#d7e6c4]">已成册的手册 · 直接取云端成品，不重新生图、不重复扣费</p>
            <ul className="mt-2 space-y-2">
              {finished.map(d => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{d.title} <span className="text-xs text-gray-400">· {new Date(d.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {d.pages.length} 章</span></span>
                  <span className="flex gap-2">
                    <button type="button" className={button} disabled={Boolean(finishedDownloading) || state.dirty} onClick={() => void downloadFinished(d.id)}>
                      {finishedDownloading === d.id ? "正在取成品…" : "下载成品 PDF"}
                    </button>
                    <button type="button" className={button} disabled={busy} onClick={() => { install({ ...current.current, activeId: d.id }); setPageIndex(0); setOpen(true); }}>打开稿件</button>
                  </span>
                </li>
              ))}
            </ul>
            {!open && message && <p role="status" className="mt-2 text-xs text-emerald-200">{message}</p>}
            {!open && error && <p role="alert" className="mt-2 text-xs text-rose-200">{sanitizePlatformUserMessage(error)}</p>}
          </div>
        );
      })()}
      {open && (
        <div className="mt-4 space-y-4">
          {!ready && <p role="status">正在读取稿件…</p>}
          <details open={!compact}>
            <summary className="mb-2 cursor-pointer text-sm text-[#edd4ac]">稿件保存与备份{state.dirty ? " · 有修改尚未保存云端" : ""}</summary>
          <div className="flex flex-wrap gap-2">
            <button
              className={button}
              disabled={!ready || !cloudReady || busy || !state.dirty}
              onClick={() => void save()}
            >
              保存云端
            </button>
            <button
              className={button}
              disabled={!ready || busy}
              onClick={() => void restore()}
            >
              读取云端
            </button>
            <button
              className={button}
              disabled={!ready || busy}
              onClick={backup}
            >
              导出稿件备份
            </button>
            <label className={button}>
              导入备份
              <input
                aria-label="导入排版备份"
                type="file"
                accept=".json,application/json"
                className="hidden"
                disabled={!ready || busy}
                onChange={e => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void importBackup(f);
                }}
              />
            </label>
            <span className="self-center text-xs text-amber-100">
              {state.dirty ? "有修改尚未保存云端" : "无未保存修改"}
            </span>
          </div>
          </details>
          {message && (
            <p role="status" className="text-sm text-emerald-200">
              {message}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-rose-200">
              {sanitizePlatformUserMessage(error)}
            </p>
          )}
              <label className="block text-sm">
                恢复已保存稿件
                <select
                  aria-label="选择排版稿件"
                  className={field}
                  value={doc?.id || ""}
                  disabled={busy}
                  onChange={e => {
                    install({ ...current.current, activeId: e.target.value });
                    setPageIndex(0);
                  }}
                >
                  <option value="">不引用旧稿；选择稿件后恢复</option>
                  {state.library.documents.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.title} · {new Date(d.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}{d.publication?.review && d.publication.confirmedManuscript === d.publication.manuscript ? " · 已成册" : ""}
                    </option>
                  ))}
                </select>
              </label>
          {!doc ? (
            <p className="text-sm text-gray-300">
              当前未引用旧资料。本次整理内容就绪后自动呈现；如需使用旧稿，请在上方明确选择恢复。
            </p>
          ) : (
            <fieldset disabled={!ready || (busy && !doc.publication)} className="space-y-4">
              {doc.publication ? <KnowledgePublicationPanel compact={compact} key={doc.id} doc={doc} commit={commitPublication}
                onChange={next=>update(next)} onPagination={onPagination} onSupplement={onSupplement} onBusy={value=>{locked.current=value;setBusy(value);}} autoStart={doc.id===autoPublicationId} autoStartToken={autoStartToken}
                preauthorizedCredits={synchronizedRun?.documentId === doc.id ? synchronizedRun.authorizedCredits : undefined}
                waitForReading={synchronizedRun?.documentId === doc.id ? synchronizedRun.waitForReading : undefined}
                autoPreparePresentation={synchronizedRun?.documentId === doc.id && synchronizedRun.preparePresentation}
                preauthorizedPresentationCredits={synchronizedRun?.documentId === doc.id ? synchronizedRun.presentationCredits : undefined}
                waitForImages={synchronizedRun?.documentId === doc.id ? synchronizedRun.waitForImages : undefined}/>:<>
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-3">
                  <label className="block text-sm">
                    稿件标题
                    <input
                      aria-label="排版稿标题"
                      className={field}
                      value={doc.title}
                      maxLength={500}
                      onChange={e => update({ title: e.target.value })}
                    />
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <label>
                      画幅
                      <select
                        aria-label="排版画幅"
                        className={field}
                        value={doc.aspect}
                        onChange={e =>
                          update({
                            aspect: e.target.value as EditableLayout["aspect"],
                          })
                        }
                      >
                        <option>3:4</option>
                        <option>9:16</option>
                        <option>1:1</option>
                      </select>
                    </label>
                    <label>
                      风格
                      <select
                        aria-label="排版风格"
                        className={field}
                        value={doc.theme}
                        onChange={e =>
                          update({
                            theme: e.target.value as EditableLayout["theme"],
                          })
                        }
                      >
                        <option value="paper">暖纸</option>
                        <option value="ink">深墨</option>
                        <option value="sage">青叶</option>
                      </select>
                    </label>
                    <label>
                      字号
                      <input
                        aria-label="排版字号"
                        className={field}
                        type="number"
                        min={18}
                        max={36}
                        value={doc.fontSize}
                        onChange={e => {
                          const n = Number(e.target.value);
                          if (n >= 18 && n <= 36)
                            update({ fontSize: Math.round(n) });
                        }}
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {doc.pages.map((p, i) => (
                      <button
                        key={p.id}
                        className={button}
                        aria-pressed={i === index}
                        onClick={() => setPageIndex(i)}
                      >
                        第{i + 1}页
                      </button>
                    ))}
                  </div>
                  {page && (
                    <>
                      <label className="block">
                        本页标题
                        <input
                          aria-label="本页标题"
                          className={field}
                          value={page.headline}
                          maxLength={500}
                          onChange={e => editPage({ headline: e.target.value })}
                        />
                      </label>
                      <label className="block">
                        本页正文
                        <textarea
                          aria-label="本页正文"
                          className={field}
                          rows={9}
                          value={page.body}
                          maxLength={50000}
                          onChange={e => editPage({ body: e.target.value })}
                        />
                      </label>
                      {page.imageUrl && (
                        <div className="rounded-xl border border-white/15 p-3">
                          <img
                            src={
                              layoutImageSchema.safeParse(page.imageUrl).success
                                ? page.imageUrl
                                : undefined
                            }
                            alt="本页原有配图"
                            className="max-h-48 max-w-full"
                          />
                          <select
                            aria-label="配图位置"
                            className={field}
                            value={page.imagePlacement}
                            onChange={e =>
                              editPage({
                                imagePlacement: e.target.value as
                                  | "above"
                                  | "below",
                              })
                            }
                          >
                            <option value="above">图片在文字上方</option>
                            <option value="below">图片在文字下方</option>
                          </select>
                          <button
                            className={button}
                            onClick={() => editPage({ imageUrl: "" })}
                          >
                            移除本页配图
                          </button>
                        </div>
                      )}
                      <details className="text-sm">
                        <summary>替换配图</summary>
                        <label>
                          图片地址
                          <input
                            aria-label="本页配图地址"
                            className={field}
                            value={page.imageUrl}
                            onChange={e =>
                              editPage({ imageUrl: e.target.value })
                            }
                          />
                        </label>
                      </details>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className={button}
                          disabled={index === 0}
                          onClick={() => {
                            const pages = [...doc.pages];
                            [pages[index - 1], pages[index]] = [
                              pages[index],
                              pages[index - 1],
                            ];
                            update({ pages });
                            setPageIndex(index - 1);
                          }}
                        >
                          上移本页
                        </button>
                        <button
                          className={button}
                          disabled={index === doc.pages.length - 1}
                          onClick={() => {
                            const pages = [...doc.pages];
                            [pages[index + 1], pages[index]] = [
                              pages[index],
                              pages[index + 1],
                            ];
                            update({ pages });
                            setPageIndex(index + 1);
                          }}
                        >
                          下移本页
                        </button>
                        <button
                          className={button}
                          disabled={doc.pages.length >= 100}
                          onClick={() => {
                            update({
                              pages: [
                                ...doc.pages,
                                {
                                  id: crypto.randomUUID(),
                                  headline: "新页",
                                  body: "",
                                  imageUrl: "",
                                  imagePlacement: "below",
                                },
                              ],
                            });
                            setPageIndex(doc.pages.length);
                          }}
                        >
                          新增一页
                        </button>
                        <button
                          className={button}
                          disabled={doc.pages.length <= 1}
                          onClick={() => {
                            if (
                              window.confirm("移除当前页？原始稿件不受影响。")
                            ) {
                              update({
                                pages: doc.pages.filter((_, i) => i !== index),
                              });
                              setPageIndex(Math.max(0, index - 1));
                            }
                          }}
                        >
                          移除本页
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <div>
                  <p className="mb-2 text-xs text-gray-400">
                    排版预览 · 长内容自动延长页面，不裁掉正文。
                  </p>
                  <iframe
                    title="排版预览"
                    sandbox="allow-same-origin"
                    srcDoc={preview}
                    className="h-[650px] w-full rounded-xl border-0 bg-white"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["html", "png", "pdf"] as const).map(format => (
                  <button
                    key={format}
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const exact = editableLayoutSchema.parse(doc);
                        const blob = await exportEditableLayout(exact, format);
                        downloadLayoutBlob(
                          blob,
                          `${exact.title}.${format === "png" ? "zip" : format}`
                        );
                        setMessage(
                          `已导出${format === "png" ? "逐页PNG压缩包" : format.toUpperCase()} · ${exact.pages.length}页`
                        );
                      })
                    }
                  >
                    {busy
                      ? "处理中…"
                      : format === "html"
                        ? "导出可编辑HTML"
                        : format === "png"
                          ? "导出逐页PNG"
                          : "导出PDF"}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400">
                HTML包含完整文字和配图，可离线改字；PNG/PDF为排版成品。已生成图片中的文字仍属于图片，不能单独改字。
              </p>
              </>}
            </fieldset>
          )}
        </div>
      )}
    </section>
  );
});
export default EditableLayoutStudio;
