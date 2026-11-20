import {assertKnowledgeInteriorConsent,settleKnowledgeInterior} from "./knowledgePublicationBilling";
import type {EditableLayout} from "../../shared/editableLayout";
import type {KnowledgeReview} from "../../shared/knowledgePublication";
import { resolveKnowledgePublicationImages } from "./knowledgePublicationImages";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, stat, rm, open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readCanonicalLayoutLibrary } from "./editableLayoutStore";
import {
  knowledgeImageFingerprintName,
  knowledgeSourceDigest,
  parseKnowledgeImageFingerprint,
  readKnowledgeImage,
  readKnowledgePublicationReview,
  recordKnowledgeImageFingerprint,
  validateKnowledgeImageReceipts,
} from "./knowledgePublicationAdvisor";
import {
  parseKnowledgeManuscript,
  validateKnowledgeReview,
} from "../../shared/knowledgePublication";
import {
  KNOWLEDGE_PUBLICATION_LAYOUT_VERSION,
  knowledgePublicationHead,
  knowledgePublicationChapter,
} from "../../shared/knowledgePublicationHtml";
import {
  downloadGcsObjectVersioned,
  getGcsBucketName,
  signGsUriV4ReadUrl,
  statGcsObjectVersion,
  uploadBufferToGcs,
  uploadStreamToGcs,
} from "./gcs";
import { fetchPdfBufferFromWorker, measureKnowledgeBookletDetailsFromWorker, type KnowledgeBookletMeasure } from "./pdfWorkerClient";
import { auditKnowledgeExportSegments, readKnowledgeLayoutAuditSummary, type KnowledgeLayoutAuditSummary } from "../../shared/knowledgeLayoutAudit";
import { stripKnowledgeBookletWatermark, type KnowledgeBookletImageMode } from "../../shared/knowledgeBooklet";
import { ensureKnowledgeReviewThumbnail } from "./knowledgeReviewThumbnail";
import { ensureKnowledgeExportImage, type KnowledgeExportImage } from "./knowledgeExportImage";
import { KNOWLEDGE_EXPORT_PDF_NOTICE_BYTES, knowledgeExportJpegQuality, knowledgeExportReserveBytes, type KnowledgeExportJpegQuality } from "../../shared/knowledgeExportCapacity";
import { knowledgeStageConcurrency, runKnowledgeStaggeredPool } from "../../shared/knowledgeConcurrency";

/** pdf-worker 的瞬时故障（部署/重启打断 Puppeteer 页面、网关 5xx、连接中断）：同一输入原地重试一次即可，不算段失败。 */
export const isTransientKnowledgePdfWorkerError = (error: unknown) =>
  /detached Frame|Execution context was destroyed|Target closed|Session closed|Navigating frame was detached|Protocol error|pdf-worker returned 5\d\d|ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|fetch failed|aborted|timeout/i
    .test(error instanceof Error ? `${error.message} ${String((error as any).code ?? "")}` : String(error ?? ""));

/** 渲染/计页步骤：瞬时故障最多重试 retries 次（默认 1），其他错误原样抛出交段级处理。 */
export async function retryKnowledgeExportStep<T>(step: () => Promise<T>, options: { retries?: number; sleep?: (ms: number) => Promise<void>; isTransient?: (error: unknown) => boolean; onRetry?: (error: unknown, attempt: number) => void } = {}): Promise<T> {
  const retries = Math.max(0, options.retries ?? 1);
  const isTransient = options.isTransient ?? isTransientKnowledgePdfWorkerError;
  const sleep = options.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try { return await step(); }
    catch (error) {
      if (attempt >= retries || !isTransient(error)) throw error;
      options.onRetry?.(error, attempt + 1);
      await sleep(1500 * (attempt + 1));
    }
  }
}

/** 导出分段池：按段数动态并发（≤8，排版服务每路要取图、排版、打印，16 路实测互相拖到超时），每段自行捕获错误。 */
export const KNOWLEDGE_EXPORT_PART_CONCURRENCY = 8;
/**
 * 成品渲染用原图（1121）时的分段并发：每段要让排版服务取一张 13–18MB 的 4K 原图，8 路同时取图曾超时（1110：34 段 11 段失败），
 * 段内原图超过 KNOWLEDGE_EXPORT_LARGE_IMAGE_BYTES 时渲染降到 4 路、瞬时故障多重试一次；预分页仍用缩图、保持 8 路。
 */
export const KNOWLEDGE_EXPORT_ORIGINAL_RENDER_CONCURRENCY = 4;
export const KNOWLEDGE_EXPORT_LARGE_IMAGE_BYTES = 4 * 1024 * 1024;
async function knowledgeExportPool(count: number, worker: (index: number) => Promise<void>, max = KNOWLEDGE_EXPORT_PART_CONCURRENCY) {
  const lanes = Array.from({ length: knowledgeStageConcurrency(count, { max }) }, () => "pdf" as const);
  await runKnowledgeStaggeredPool(Array.from({ length: count }, (_, i) => i), { lanes, staggerMs: 0, worker: async i => { await worker(i); } });
}


/** 阅读稿 HTML 内配图签名地址的有效期：GCS V4 上限 7 天；过期后重新导出即换新地址，PDF 成品不受影响。 */
export const KNOWLEDGE_EXPORT_IMAGE_URL_TTL_SECONDS = 7 * 24 * 3600;
/**
 * 配图传输方式标记进成品目录：改为地址引用后的成品与旧内嵌版分开存放，互不复用。
 * orig1（1121 站长「图片质量不要压缩」）：成品改用原图像素原样入版；与 url2（2048 缩图入版）的成品与分片分开存放，
 * 旧成品不被当成新成品复用、也不删除；结算按稿件结算键幂等，换目录不重复扣费。
 */
export const KNOWLEDGE_EXPORT_IMAGE_TRANSPORT = "full";
/**
 * full-q<质量>（1121 站长定「原像素 + 高品质 JPEG 95，PDF 最多 280MB」）：成品图为原像素 JPEG 派生件，目录带质量档，
 * 不同质量档、旧 url2、上一版 orig1（PNG 原字节）的成品与分片互不复用、都不删除；结算按稿件结算键幂等。
 */
export const knowledgeExportQualityTag = (quality: number) => `${KNOWLEDGE_EXPORT_IMAGE_TRANSPORT}-q${quality}`;
/** 派生件编码并发（每张 4K 解码约 33MB、CPU 1–2 秒；服务端曾因多图并发 OOM，保守 2 路）。 */
export const KNOWLEDGE_EXPORT_IMAGE_ENCODE_CONCURRENCY = 2;
const exportLog = (event: string, fields: Record<string, string | number | undefined>) =>
  console.log(`[knowledgeExport] ${event} ${Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join(" ")}`);
/** 日志只留业务原因：去掉地址与签名，截断。 */
export const knowledgeExportLogReason = (error: unknown) =>
  String(error instanceof Error ? error.message : error ?? "").replace(/(?:https?|gs):\/\/\S+/g, "[地址]").slice(0, 300);

const inflight = new Map<string, Promise<KnowledgePublicationExport>>();
export type KnowledgePublicationExport = {
  htmlUrl: string;
  pdfUrl?: string;
  htmlBytes: number;
  pdfBytes?: number;
  chapters: number;
  imagePages?: number;
  totalPages?: number;
  pdfError?: string;
  billing?: Awaited<ReturnType<typeof settleKnowledgeInterior>>;
  /** 成品配图 JPEG 质量档与配图总字节（1121 起；旧成品清单没有）。 */
  imageQuality?: number;
  imageBytes?: number;
  /** 版面审查（只提示，不拦截下载）；旧成品清单没有此字段。 */
  layoutAudit?: KnowledgeLayoutAuditSummary;
};
/** 预分页结果：旧注入/旧排版服务只给页数，新版带逐章细节（含版面测量）。 */
const measuredOf = (value: number | KnowledgeBookletMeasure): { count: number; booklets?: KnowledgeBookletMeasure["booklets"] } =>
  typeof value === "number" ? { count: value } : { count: value?.pages, booklets: Array.isArray(value?.booklets) ? value.booklets : undefined };
const real = {
  settle: settleKnowledgeInterior,
  /**
   * 成品是否打宣传水印（站长 2026-11-21）：一般用户照打；付费用户（沿用全站既有的付费判定 resolveWatermark：
   * 付费角色或有过正式加值）不打。站长/督导账号自己出的手册用于宣传，照打。
   */
  watermark: async (owner: number): Promise<boolean> => {
    const { resolveUserTier, resolveWatermark } = await import("./tier-provider-routing");
    if (await resolveUserTier(owner, false) === "supervisor") return true;
    return resolveWatermark(owner, false);
  },
  load: readCanonicalLayoutLibrary,
  review: readKnowledgePublicationReview,
  image: readKnowledgeImage,
  /** 配图当前版本元数据（一次元数据请求，不下载内容）。 */
  imageVersion: async (uri: string) => { const v = await statGcsObjectVersion({ gcsUri: uri }); return { generation: v.generation, crc32c: v.crc32c, byteLength: v.byteLength }; },
  /** 读审校/上次导出记下的版本指纹；没有返回 null。 */
  imageFingerprint: async (uri: string, generation: string): Promise<unknown> => {
    try { return JSON.parse((await downloadGcsObjectVersioned({ gcsUri: `gs://${getGcsBucketName()}/${knowledgeImageFingerprintName(uri, generation)}` })).buffer.toString("utf8")); }
    catch (e) { if (e instanceof Error && e.message === "gcs_stat_failed:404") return null; throw e; }
  },
  /** 下载核对后补记指纹（条件创建，只建不改）。 */
  recordImage: (uri: string, image: Awaited<ReturnType<typeof readKnowledgeImage>>) => recordKnowledgeImageFingerprint(uri, image),
  // 导出配图只以签名地址交给排版服务与阅读稿 HTML，不把图片数据内嵌进 HTML（禁 base64）。
  // 【1121 起只用于预分页测量】成品渲染与阅读稿 HTML 改用 originalImageUrl（原图）。以下为当初用缩图的原因，测量仍适用：
  // 地址指向缩图派生件（长边 ≤2048、q85 的 JPEG，审校时已生成）：信息图带 data-pdf-max-dim=2048 标记，
  // 排版服务对未超上限的外链 JPEG 不重编码、原字节入版（2026-11-11 起不再压到 1200），故 2048 派生件即最终入版像素；
  // 送 13–18MB 的 4K 原图只会让并发取图超时（1110 实测 34 段有 11 段预分页失败），且排版服务仍会缩回 2048；缩图不可得时回退原图地址。
  imageUrl: async (uri: string) => signGsUriV4ReadUrl((await ensureKnowledgeReviewThumbnail(uri)) || uri, KNOWLEDGE_EXPORT_IMAGE_URL_TTL_SECONDS),
  /** 成品配图派生件：原像素 JPEG（质量档由容量估算定），失败即抛错，不回退缩图。 */
  exportImage: (uri: string, quality: number): Promise<KnowledgeExportImage> => ensureKnowledgeExportImage(uri, quality),
  /** 成品（PDF 渲染与阅读稿 HTML）用的派生件签名地址：不经缩图，排版服务按 data-pdf-original 原字节入版。 */
  originalImageUrl: async (uri: string) => signGsUriV4ReadUrl(uri, KNOWLEDGE_EXPORT_IMAGE_URL_TTL_SECONDS),
  pdf: fetchPdfBufferFromWorker,
  // 预分页同时带回逐章细节；排版服务未更新时 booklets 为空 → 版面审查记为未审查，不影响导出。
  measure: measureKnowledgeBookletDetailsFromWorker as (html: string) => Promise<number | KnowledgeBookletMeasure>,
  countPages: async (path: string) => {
    const { stdout } = await promisify(execFile)("pdfinfo", [path], {
      timeout: 30000, maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: "C" },
    });
    const count = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1]);
    if (!Number.isSafeInteger(count) || count < 1) throw new Error("无法读取手册实际总页数，请重试导出");
    return count;
  },
  read: async (name: string) => {
    try {
      return (
        await downloadGcsObjectVersioned({
          gcsUri: `gs://${getGcsBucketName()}/${name}`,
        })
      ).buffer;
    } catch (e) {
      if (e instanceof Error && e.message === "gcs_stat_failed:404")
        return null;
      throw e;
    }
  },
  save: async (name: string, buffer: Buffer, contentType: string) => {
    await uploadBufferToGcs({ objectName: name, buffer, contentType });
  },
  file: async (name: string, path: string, contentType: string) => {
    const size = (await stat(path)).size;
    await uploadStreamToGcs({
      objectName: name,
      stream: Readable.toWeb(
        createReadStream(path)
      ) as ReadableStream<Uint8Array>,
      contentLength: size,
      contentType,
    });
    return size;
  },
  sign: (name: string) =>
    signGsUriV4ReadUrl(`gs://${getGcsBucketName()}/${name}`, 3600),
  merge: async (paths: string[], target: string) => {
    await promisify(execFile)("pdfunite", [...paths, target], {
      timeout: 300000,
      maxBuffer: 1024 * 1024,
    });
  },
};
export async function loadKnowledgePublicationExport(
  owner: number,
  documentId: string,
  generation: string,
  overrides: Partial<typeof real> = {},
  includeSupplement = false,
  allowCurrentManuscript = false
): Promise<{doc:EditableLayout;review:KnowledgeReview;receipt:Awaited<ReturnType<typeof readKnowledgePublicationReview>>;prefix:string}> {
  const deps = {...real, ...overrides};
  const loaded = await deps.load(owner);
  if (loaded.generation !== generation)
    throw new Error("云稿版本已变化，请先读取当前稿件；未导出旧稿");
  let doc = loaded.library?.documents.find(d => d.id === documentId),
    pub = doc?.publication;
  if (
    !doc ||
    !pub?.review ||
    (!allowCurrentManuscript && (!pub.confirmedManuscript || pub.confirmedManuscript !== pub.manuscript))
  )
    throw new Error("请先确认图文阅读稿后再导出");
  pub.source = await resolveKnowledgePublicationImages(owner, pub.source, undefined, undefined, pub.imageReplacements);
  const accepted = parseKnowledgeManuscript(
    allowCurrentManuscript ? pub.manuscript : pub.confirmedManuscript!,
    pub.source.pages.map(p => p.id)
  );
  if (allowCurrentManuscript) doc = {...doc,title:accepted.title,pages:accepted.pages.map(p=>({...doc!.pages.find(old=>old.id===p.id)!,...p}))};
  if (
    accepted.title !== doc.title ||
    accepted.pages.some(
      (p, i) =>
        p.id !== doc.pages[i]?.id ||
        p.body !== doc.pages[i]?.body ||
        p.headline !== doc.pages[i]?.headline
    ) ||
    doc.pages.length !== accepted.pages.length
  )
    throw new Error("确认稿与保存内容不一致，未导出混合版本");
  if (doc.pages.some((p, i) => p.imageUrl !== pub.source.pages[i].imageUrl))
    throw new Error("确认稿配图与原审校不一致，请保留原配图");
  const receipt = await deps.review(owner, documentId, pub.requestId);
  validateKnowledgeImageReceipts(pub.source, receipt.sourceImages);
  const review = validateKnowledgeReview(
    receipt.report,
    pub.source,
    knowledgeSourceDigest(pub.source)
  );
  // 客户端可以修改正文，不能抹掉模型发现的图内疑点或伪造“已审校”。
  if (
    JSON.stringify(review) !==
    JSON.stringify(
      validateKnowledgeReview(pub.review, pub.source, review.sourceDigest)
    )
  )
    throw new Error("图文审校回执不一致，请重新取回原结果");
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        KNOWLEDGE_PUBLICATION_LAYOUT_VERSION,
        pub.infographicTemplateId,
        pub.designMode,
        accepted,
        review,
        receipt.sourceImages,
      ])
    )
    .digest("hex");
  const prefix = `knowledge-publications/user-${owner}/${documentId}/exports/${digest}`;
  if(includeSupplement&&pub.supplementDocumentId){
    const child=loaded.library?.documents.find(d=>d.id===pub.supplementDocumentId);
    if(child?.publication?.supplementOf?.documentId!==doc.id||child.publication.supplementDocumentId)throw Error("补充稿归属不一致，未导出混合版本");
    const extra=await loadKnowledgePublicationExport(owner,child.id,generation,{...deps,load:async()=>loaded},false,allowCurrentManuscript);
    const imageCount=extra.doc.pages.filter(p=>p.imageUrl).length;
    if(imageCount<1||imageCount>8)throw Error("补充稿图片数量必须为1至8张");
    if(new Set([...doc.pages,...extra.doc.pages].map(p=>p.id)).size!==doc.pages.length+extra.doc.pages.length)throw Error("补充稿页号与原册重复");
    const combinedReview={...review,pages:[...review.pages,...extra.review.pages]};
    const combinedDoc={...doc,pages:[...doc.pages,...extra.doc.pages]};
    const combinedReceipt={...receipt,sourceImages:[...receipt.sourceImages,...extra.receipt.sourceImages]};
    const combinedHash=createHash("sha256").update(JSON.stringify([prefix,extra.prefix])).digest("hex");
    return {doc:combinedDoc,review:combinedReview,receipt:combinedReceipt,prefix:`knowledge-publications/user-${owner}/${documentId}/exports/${combinedHash}`};
  }
  return {doc,review,receipt,prefix};
}
/**
 * 导出分项进度（1121）：大书导出几分钟内只看到一个不动的步骤，用户以为卡住。
 * done/total = 已得到 PDF 的段数 / 总段数（复用的已完成分片直接计入 done），整个导出过程中只增不减；
 * phase/label 说明当前在做什么（用户可读中文，不含模型/供应商/通道名）。只在进程内上报，不写持久记录，
 * 不参与成品目录摘要、分片命名、结算与租约。
 */
export type KnowledgeExportProgress = {
  phase: "prepare" | "measure" | "render" | "merge" | "finishing" | "partial" | "waiting";
  done: number;
  total: number;
  /** 复用的已完成分片段数（已计入 done）。 */
  reused?: number;
  /** 本次未完成的段数（部分完成时如实停在实际位置）。 */
  failed?: number;
  label: string;
};
export type KnowledgeExportProgressListener = (progress: KnowledgeExportProgress) => void;
/**
 * 压缩适配（knowledgeHandbookRefit）用的派生导出：view=已在副本上压缩正文的整册视图（原稿与已确认正文不动），
 * imageModes=按实测收回跨页名额后的逐章版式，prefixTag=成品目录版本标记（与正式导出分开存放，互不复用）。
 */
export type KnowledgeDerivedExport = { view?: Awaited<ReturnType<typeof loadKnowledgePublicationExport>>; imageModes?: KnowledgeBookletImageMode[]; prefixTag?: string };
export async function exportKnowledgePublication(
  owner:number,documentId:string,generation:string,overrides:Partial<typeof real>={},derived:KnowledgeDerivedExport={},onProgress?:KnowledgeExportProgressListener
):Promise<KnowledgePublicationExport>{
  const deps={...real,...overrides};
  // 进度回调出错不得影响导出本身。
  const report=(progress:KnowledgeExportProgress)=>{try{onProgress?.(progress);}catch{/* 只影响显示 */}};
  const { loadKnowledgeBookLayoutView } = await import("./knowledgeBookLayout");
  // 生产调用（无注入依赖）复用同一 generation 的整册视图缓存，与预览/排版输入共用一次解析与核验。
  const {doc,review,receipt,prefix:sourcePrefix}=derived.view
    ? derived.view
    : Object.keys(overrides).length===0
    ? await loadKnowledgeBookLayoutView(owner,documentId,generation,{},{cache:true})
    : await loadKnowledgeBookLayoutView(owner,documentId,generation,deps);
  if(derived.imageModes&&derived.imageModes.length!==doc.pages.length)throw new Error("逐章版式数量与章节不一致");
  if(derived.prefixTag&&!/^[a-z0-9-]{1,64}$/.test(derived.prefixTag))throw new Error("导出目录标记无效");
  // 只注入了读图（旧测试/派生调用）而未注入水印判定时按「打水印」处理，不触达真实数据库。
  const watermark = "watermark" in overrides || !("image" in overrides) ? await deps.watermark(owner) : true;
  const unmark = (html: string) => watermark ? html : stripKnowledgeBookletWatermark(html);
  // 无水印成品与有水印成品分目录存放（-nowm），互不复用。
  const prefixFor=(quality:number)=>`${sourcePrefix}-${knowledgeExportQualityTag(quality)}${watermark?"":"-nowm"}${derived.prefixTag?`-${derived.prefixTag}`:""}`;
  // 画质档由用户在稿件上选定（publication.exportOptions.imageQuality，缺省 0.95）；不同档的成品分目录存放、互不复用。
  const imageQuality: KnowledgeExportJpegQuality = knowledgeExportJpegQuality(doc.publication?.exportOptions?.imageQuality);
  const inflightKey=prefixFor(imageQuality);
  if(doc.publication?.supplementOf && doc.publication.billing)return exportKnowledgePublication(owner,doc.publication.supplementOf.documentId,generation,overrides,derived.view?{}:derived,onProgress);
  assertKnowledgeInteriorConsent(doc);
  const run = async (): Promise<KnowledgePublicationExport> => {
    const prefix = prefixFor(imageQuality);
    const manifest = await deps.read(`${prefix}/manifest.json`);
    if (manifest) {
      const saved = JSON.parse(manifest.toString("utf8"));
      if (saved.pdfBytes) {
        if (!Number.isSafeInteger(saved.totalPages) || saved.totalPages < 1) {
          // 历史成品只读取原PDF补计页数，不重做模型或排版。
          const bytes = await deps.read(`${prefix}/阅读稿.pdf`);
          if (!bytes) throw new Error("原PDF暂时无法读取，未显示推测页数");
          const folder = await mkdtemp(join(tmpdir(), "knowledge-page-count-"));
          try {
            const path = join(folder, "original.pdf");
            await writeFile(path, bytes);
            saved.totalPages = await deps.countPages(path);
            if (!Number.isSafeInteger(saved.totalPages) || saved.totalPages < 1) throw new Error("手册实际总页数无效");
            await deps.save(`${prefix}/manifest.json`, Buffer.from(JSON.stringify(saved)), "application/json");
          } finally {
            await rm(folder, { recursive: true, force: true });
          }
        }
        const billing=await deps.settle(owner,doc,saved.totalPages,doc.pages.filter(page=>page.imageUrl).length);
        return {
          billing,
          htmlUrl: deps.sign(`${prefix}/阅读稿.html`),
          pdfUrl: deps.sign(`${prefix}/阅读稿.pdf`),
          htmlBytes: saved.htmlBytes,
          pdfBytes: saved.pdfBytes,
          chapters: doc.pages.length,
          imagePages: doc.pages.filter(page => page.imageUrl).length,
          totalPages: saved.totalPages,
          ...(Number.isSafeInteger(saved.imageQuality) ? { imageQuality: saved.imageQuality } : {}),
          ...(Number.isSafeInteger(saved.imageBytes) ? { imageBytes: saved.imageBytes } : {}),
          ...(saved.layoutAudit ? { layoutAudit: readKnowledgeLayoutAuditSummary(saved.layoutAudit) } : {}),
        };
      }
    }
    const folder = await mkdtemp(join(tmpdir(), "knowledge-publication-"));
    const htmlPath = join(folder, "publication.html"),
      html = await open(htmlPath, "w");
    const head = knowledgePublicationHead(doc.title),
      tail = "</body></html>";
    let chunk = "",
      chunkBytes = 0;
    const chunks: string[] = [];
    /** 与 chunks 同序的预分页测量稿：同一版式、图换成缩图（宽高比相同），只量版面不出成品。 */
    const measureChunks: string[] = [];
    let measureChunk = "";
    let maxImageBytes = 0;
    const pdfFiles: string[] = [],
      failures: number[] = [];
    const expected = new Map(receipt.sourceImages.map(p => [p.uri, p.sha256]));
    let totalImageBytes = 0;
    const flush = async () => {
      if (!chunk) return;
      const path = join(folder, `chunk-${chunks.length}.html`);
      await writeFile(path, chunk);
      const measurePath = join(folder, `chunk-${chunks.length}.measure.html`);
      await writeFile(measurePath, measureChunk);
      chunks.push(path);
      measureChunks.push(measurePath);
      chunk = "";
      measureChunk = "";
      chunkBytes = 0;
    };
    try {
      await html.writeFile(head);
      // 配图先并发取回（按页数动态并发），装配仍按页序；校验与原逻辑相同。
      // 只为核对原图指纹与体积而读取，读完即释放；图片数据不进入 HTML。
      // 1119 提速：先比对元数据——当前 generation / crc32c / 字节数与审校或上次导出记下的指纹一致、且指纹 sha256 等于审校回执，
      // 即确认原图未变，体积取自同一记录（与下载所得字节数相同，分卷与成品不变），不再下载 4K 原图。
      // 无指纹（旧回执/旧成品）、元数据不符、指纹与回执不符或取元数据出错：一律走原下载核对路径，下载后补记指纹。
      // 注入了读图却没注入元数据/指纹读取（旧测试与派生调用）时不走元数据路径，避免触达真实存储。
      const metadataPath = !("image" in overrides) || ("imageVersion" in overrides && "imageFingerprint" in overrides);
      const verifyByMetadata = async (url: string) => {
        if (!metadataPath) return undefined;
        try {
          const current = await deps.imageVersion(url);
          if (!current.generation || !Number.isSafeInteger(current.byteLength)) return undefined;
          const fp = parseKnowledgeImageFingerprint(await deps.imageFingerprint(url, current.generation), url, current.generation);
          if (!fp || fp.byteLength !== current.byteLength || (fp.crc32c ?? "") !== (current.crc32c ?? "") || fp.sha256 !== expected.get(url)) return undefined;
          return { sha256: fp.sha256, bytes: fp.byteLength };
        } catch { return undefined; }
      };
      let metadataHits = 0, downloads = 0;
      const verifyImage = async (url: string) => {
        const hit = await verifyByMetadata(url);
        if (hit) { metadataHits++; return hit; }
        downloads++;
        const image = await deps.image(url);
        if (metadataPath) await Promise.resolve(deps.recordImage(url, image)).catch(() => undefined);
        return { sha256: image.sha256, bytes: image.buffer.length };
      };
      const prefetched = new Map<number, ReturnType<typeof verifyImage>>();
      // 每章单独成段，段数 = 章数（下方逐章 flush）。
      const segments = doc.pages.length;
      const imageTotal = doc.pages.filter(page => page.imageUrl).length;
      let imagesChecked = 0;
      report({ phase: "prepare", done: 0, total: segments, label: imageTotal ? `核对配图 0/${imageTotal} 张` : "生成阅读稿" });
      await knowledgeExportPool(doc.pages.length, async index => {
        const url = doc.pages[index]!.imageUrl;
        if (url) {
          const p = verifyImage(url); prefetched.set(index, p); await p.catch(() => undefined);
          report({ phase: "prepare", done: 0, total: segments, label: `核对配图 ${++imagesChecked}/${imageTotal} 张` });
        }
      });
      // 排版前容量：先按原图字节估算选质量档，再按该档生成全部派生件、用实际字节核对；超限逐档下调（已生成各档保留不删），
      // 到最低档仍超即报业务错误，不排版、不出超限成品。像素永不缩小。
      report({ phase: "prepare", done: 0, total: segments, label: "正在估算成品容量…" });
      const imageIndexes = doc.pages.map((page, index) => page.imageUrl ? index : -1).filter(index => index >= 0);
      const verifiedBytes = new Map<string, number>();
      for (const index of imageIndexes) {
        const url = doc.pages[index]!.imageUrl;
        const image = await (prefetched.get(index) ?? verifyImage(url));
        if (expected.get(url) !== image.sha256) throw new Error(`第${index + 1}页配图已变化，未导出旧审校版本`);
        verifiedBytes.set(url, image.bytes);
      }
      const uniqueUris = Array.from(new Set(imageIndexes.map(index => doc.pages[index]!.imageUrl)));
      const reserveBytes = knowledgeExportReserveBytes(segments);
      // 只注入了读图（旧测试/派生调用）而未注入派生件生成时：成品沿用原图地址与已核对的体积，不触达真实存储。
      const exportImageOf = "exportImage" in overrides || !("image" in overrides)
        ? deps.exportImage
        : async (uri: string, quality: number): Promise<KnowledgeExportImage> => ({ uri, bytes: verifiedBytes.get(uri) ?? 0, width: 0, height: 0, quality });
      // 按用户选定的画质生成全部派生件（原像素，只编码一次、永久保留）；体积超过提示线也照常导出，只记提示，不拦截、不自动降档。
      const exportImages = new Map<string, KnowledgeExportImage>();
      let prepared = 0;
      report({ phase: "prepare", done: 0, total: segments, label: `正在准备高清配图 0/${uniqueUris.length}（画质 ${imageQuality / 100}，原像素）` });
      await knowledgeExportPool(uniqueUris.length, async i => {
        exportImages.set(uniqueUris[i]!, await exportImageOf(uniqueUris[i]!, imageQuality));
        report({ phase: "prepare", done: 0, total: segments, label: `正在准备高清配图 ${++prepared}/${uniqueUris.length}（画质 ${imageQuality / 100}，原像素）` });
      }, KNOWLEDGE_EXPORT_IMAGE_ENCODE_CONCURRENCY);
      if (exportImages.size !== uniqueUris.length) throw new Error("成品高清配图未全部生成，未导出");
      // 同一张图在全书只嵌一次的前提不成立（每章一段、各段各嵌），按出现次数计。
      const actualImageBytes = imageIndexes.reduce((sum, index) => sum + exportImages.get(doc.pages[index]!.imageUrl)!.bytes, 0);
      if (actualImageBytes + reserveBytes > KNOWLEDGE_EXPORT_PDF_NOTICE_BYTES) exportLog("capacity-over-notice", { owner, document: documentId, quality: imageQuality, imageBytes: actualImageBytes, reserveBytes });
      exportLog("capacity", { owner, document: documentId, quality: imageQuality, imageBytes: actualImageBytes, reserveBytes });
      report({ phase: "prepare", done: 0, total: segments, label: "生成阅读稿" });
      // 每张图只签一次地址：本章配图与上一章「下篇预告」裁切条共用（预告条只引用地址，不另生成图）。
      const addresses = new Map<string, Promise<string>>();
      const addressOf = (uri: string) => { if (!addresses.has(uri)) addresses.set(uri, deps.imageUrl(uri)); return addresses.get(uri)!; };
      // 只注入了缩图地址的旧测试/派生调用：成品也用同一注入（不触达真实签名）。
      const originalOf = "imageUrl" in overrides && !("originalImageUrl" in overrides) ? deps.imageUrl : deps.originalImageUrl;
      const originals = new Map<string, Promise<string>>();
      // 成品地址 = 派生件（原像素 JPEG）的签名地址。
      const originalAddressOf = (uri: string) => { if (!originals.has(uri)) originals.set(uri, originalOf(exportImages.get(uri)?.uri ?? uri)); return originals.get(uri)!; };
      for (const [index, page] of Array.from(doc.pages.entries())) {
        let imageAddress = "", measureAddress = "", imageBytes = 0;
        if (page.imageUrl) {
          const image = await (prefetched.get(index) ?? verifyImage(page.imageUrl));
          if (expected.get(page.imageUrl) !== image.sha256)
            throw new Error(`第${index + 1}页配图已变化，未导出旧审校版本`);
          imageAddress = await originalAddressOf(page.imageUrl);
          measureAddress = await addressOf(page.imageUrl);
          // 体积按成品实际入版的派生件计（渲染取图并发据此判定）。
          imageBytes = exportImages.get(page.imageUrl)?.bytes ?? image.bytes;
          maxImageBytes = Math.max(maxImageBytes, imageBytes);
          totalImageBytes += imageBytes;
        }
        const nextUri = doc.pages[index + 1]?.imageUrl;
        const section = unmark(knowledgePublicationChapter(
            doc,
            review,
            index,
            imageAddress,
            false,
            nextUri ? await originalAddressOf(nextUri) : "",
            derived.imageModes?.[index],
            true
          )),
          measureSection = knowledgePublicationChapter(doc, review, index, measureAddress, false, nextUri ? await addressOf(nextUri) : "", derived.imageModes?.[index]),
          // 分卷仍按「正文 + 原图体积」计重，保持每卷载入排版服务的图片总量与原先一致；HTML 本身只含地址。
          bytes = Buffer.byteLength(section) + imageBytes;
        // 内部自动分卷渲染，再合成一个PDF；用户不必拆页。HTML流式落盘，不把千页图同时装进内存。
        if (chunkBytes + bytes > 48 * 1024 * 1024) await flush();
        await html.writeFile(section);
        chunk += section;
        measureChunk += measureSection;
        chunkBytes += bytes;
        // 每章单独成段（逐章预分页与渲染）。原先这里另存 source-pages/<章>.html：2026-11-19 全仓（server/client/shared/scripts/
        // probes/pdf-worker/.github 与全部测试）检索确认无任何读取方（导出续做只读 manifest.json 与 pdf-parts/ 分片），已停写；已存对象不删。
        await flush();
      }
      await html.writeFile(tail);
      await html.close();
      await flush();
      const htmlBytes = await deps.file(
        `${prefix}/阅读稿.html`,
        htmlPath,
        "text/html;charset=utf-8"
      );
      exportLog("html", { owner, document: documentId, htmlBytes, parts: chunks.length, imageBytes: totalImageBytes, imageMetadataHits: metadataHits, imageDownloads: downloads, ms: Date.now() - startedAt });
      // 分段先在最终字体下计数，再带全书页码渲染。只保留一段HTML在内存中。
      const counts: number[] = [];
      const measured: ReturnType<typeof measuredOf>[] = [];
      let measuredDone = 0;
      if (chunks.length > 1) {
        report({ phase: "measure", done: 0, total: chunks.length, label: `测量各段版面 0/${chunks.length} 段` });
        // 各段预分页互不依赖：同时计数（按段数动态并发），结果按原段序写回。
        await knowledgeExportPool(chunks.length, async index => {
          try {
            const chunkHtml = head + await readFile(measureChunks[index]!, "utf8") + tail;
            const result = measuredOf(await retryKnowledgeExportStep(() => deps.measure(chunkHtml)));
            const count = result.count;
            if (!Number.isSafeInteger(count) || count < 1) throw new Error("预分页结果无效");
            counts[index] = count;
            measured[index] = result;
            report({ phase: "measure", done: 0, total: chunks.length, label: `测量各段版面 ${++measuredDone}/${chunks.length} 段` });
          } catch (error) {
            counts[index]=0;
            failures.push(index + 1);
            exportLog("measure-failed", { owner, document: documentId, part: index + 1, reason: knowledgeExportLogReason(error) });
          }
        });
        // 并发下个别段偶发失败：对失败段逐段再补一轮，仍不过才留给下次续跑。
        const remeasure = failures.splice(0).sort((a, b) => a - b);
        if (remeasure.length) report({ phase: "measure", done: 0, total: chunks.length, label: `测量各段版面 ${measuredDone}/${chunks.length} 段，补测 ${remeasure.length} 段` });
        for (const part of remeasure) {
          try {
            const chunkHtml = head + await readFile(measureChunks[part - 1]!, "utf8") + tail;
            const result = measuredOf(await retryKnowledgeExportStep(() => deps.measure(chunkHtml)));
            const count = result.count;
            if (!Number.isSafeInteger(count) || count < 1) throw new Error("预分页结果无效");
            counts[part - 1] = count;
            measured[part - 1] = result;
            report({ phase: "measure", done: 0, total: chunks.length, label: `测量各段版面 ${++measuredDone}/${chunks.length} 段` });
          } catch (error) {
            failures.push(part);
            exportLog("measure-failed-again", { owner, document: documentId, part, reason: knowledgeExportLogReason(error) });
          }
        }
      }
      // 全册计页成功后才打印；缺段时的临时总页数会污染页脚和分片缓存身份。
      if (!failures.length) {
        const total = counts.reduce((a, b) => a + b, 0);
        // 页码偏移由全部计数先定，再各段同时渲染（按段数动态并发）；合并仍按原段序。
        const offsets = counts.map((_, i) => counts.slice(0, i).reduce((a, b) => a + (b || 0), 0));
        const rendered: (string | undefined)[] = new Array(chunks.length);
        const largeImages = maxImageBytes > KNOWLEDGE_EXPORT_LARGE_IMAGE_BYTES;
        let renderedDone = 0, reused = 0;
        const renderLabel = () => `渲染各段 PDF ${renderedDone}/${chunks.length} 段${reused ? `（复用已完成 ${reused} 段）` : ""}`;
        report({ phase: "render", done: 0, total: chunks.length, reused: 0, label: renderLabel() });
        const renderPart = async (index: number) => {
          const sourcePath = chunks[index]!;
          const count = counts[index];
          const offset = offsets[index]!;
          const pagination = count ? { offset, total, count } : undefined;
          const name = `${prefix}/pdf-parts/${index}${pagination ? `-${offset}-${count}-${total}` : ""}.pdf`;
          const path = join(folder, `${index}.pdf`);
          const cached = await deps.read(name);
          const bytes = cached || await retryKnowledgeExportStep(async () => deps.pdf(knowledgePublicationHead(doc.title, pagination) + await readFile(sourcePath, "utf8") + tail), { retries: largeImages ? 2 : 1 });
          if (bytes.length < 100 || bytes.subarray(0, 4).toString() !== "%PDF") throw new Error("导出没有返回有效PDF");
          if (!cached) await deps.save(name, bytes, "application/pdf");
          // 逐页 PDF（<分片>.pdf.pages/<页>.pdf）已停写（站长 2026-11-20 定）：全仓检索无读取方；它只是对已得分片的拆页另存，
          // 不参与计页（预分页 measure 与成品 pdfinfo）与页码（offset/total 由 counts 定），去掉后合并输入与整册 PDF 不变；已存对象不删。
          await writeFile(path, bytes);
          rendered[index] = path;
          renderedDone++;
          if (cached) reused++;
          report({ phase: "render", done: renderedDone, total: chunks.length, reused, label: renderLabel() });
        };
        await knowledgeExportPool(chunks.length, async index => {
          if(failures.includes(index+1))return;
          try {
            await renderPart(index);
          } catch (error) {
            failures.push(index + 1);
            exportLog("render-failed", { owner, document: documentId, part: index + 1, reason: knowledgeExportLogReason(error) });
          }
        }, largeImages ? KNOWLEDGE_EXPORT_ORIGINAL_RENDER_CONCURRENCY : KNOWLEDGE_EXPORT_PART_CONCURRENCY);
        for (const path of rendered) if (path) pdfFiles.push(path);
        failures.sort((a, b) => a - b);
      }
      if (failures.length) {
        const pdfDone = pdfFiles.length;
        report({ phase: "partial", done: pdfDone, total: chunks.length, failed: failures.length,
          label: pdfDone ? `PDF 已完成 ${pdfDone}/${chunks.length} 段，${failures.length} 段未完成，可继续生成` : `${failures.length} 段版面测量未完成，可继续生成` });
        await deps.save(
          `${prefix}/manifest.json`,
          Buffer.from(JSON.stringify({ htmlBytes, failedPdfParts: failures })),
          "application/json"
        );
        return {
          htmlUrl: deps.sign(`${prefix}/阅读稿.html`),
          htmlBytes,
          chapters: doc.pages.length,
          pdfError: counts.some(count => count === 0)
            ? `HTML已保存，PDF有${failures.length}段预分页未完成；未开始本次打印，可继续原任务`
            : `HTML已保存，PDF有${failures.length}段未完成；可继续生成PDF，已成功部分会复用`,
        };
      }
      report({ phase: "merge", done: pdfFiles.length, total: chunks.length, label: "合并整册 PDF" });
      let active = pdfFiles,
        level = 0;
      // 有界合并，避免操作系统参数过长；仅删除本次临时副本，不清理云端回执与原图。
      while (active.length > 1) {
        const next: string[] = [];
        for (let i = 0; i < active.length; i += 24) {
          const group = active.slice(i, i + 24);
          if (group.length === 1) {
            next.push(group[0]);
            continue;
          }
          const target = join(folder, `merged-${level}-${i}.pdf`);
          await deps.merge(group, target);
          // 1121 原图成品体积大（估 0.7–1.5GB/本）：合并完即删本组的本地临时副本，临时盘峰值从约 3 份整册降到约 2 份；
          // 云端分片（pdf-parts/）与回执不动。
          await Promise.all(group.map(path => rm(path, { force: true })));
          next.push(target);
        }
        active = next;
        level++;
      }
      if (!active.length) throw new Error("未生成PDF内容");
      report({ phase: "finishing", done: pdfFiles.length, total: chunks.length, label: "版面审查并保存成品" });
      const totalPages = await deps.countPages(active[0]);
      if (!Number.isSafeInteger(totalPages) || totalPages < 1) throw new Error("手册实际总页数无效");
      const imagePages = doc.pages.filter(page => page.imageUrl).length;
      // 版面审查：只用预分页已带回的测量，不另发请求；单段（未预分页）、缺数据或审查出错都记为未审查。
      let layoutAudit: KnowledgeLayoutAuditSummary = { checked: false };
      try {
        if (measured.length === chunks.length && chunks.length > 1) {
          const offsets = counts.map((_, i) => counts.slice(0, i).reduce((a, b) => a + (b || 0), 0));
          layoutAudit = auditKnowledgeExportSegments(measured, offsets);
          if (layoutAudit.checked && measured.reduce((n, m) => n + (m?.count || 0), 0) !== totalPages) layoutAudit = { checked: false };
        }
      } catch { layoutAudit = { checked: false }; }
      exportLog("layout-audit", { owner, document: documentId, checked: layoutAudit.checked ? 1 : 0, issues: layoutAudit.checked ? layoutAudit.issueCount : undefined });
      const pdfBytes = await deps.file(
        `${prefix}/阅读稿.pdf`,
        active[0],
        "application/pdf"
      );
      await deps.save(
        `${prefix}/manifest.json`,
        Buffer.from(
          JSON.stringify({
            htmlBytes,
            pdfBytes,
            chapters: doc.pages.length,
            imagePages,
            totalPages,
            sourceDigest: review.sourceDigest,
            imageQuality,
            imageBytes: actualImageBytes,
            layoutAudit,
          })
        ),
        "application/json"
      );
      const billing=await deps.settle(owner,doc,totalPages,imagePages);
      return {
        billing,
        htmlUrl: deps.sign(`${prefix}/阅读稿.html`),
        pdfUrl: deps.sign(`${prefix}/阅读稿.pdf`),
        htmlBytes,
        pdfBytes,
        chapters: doc.pages.length,
        imagePages,
        totalPages,
        layoutAudit,
        imageQuality,
        imageBytes: actualImageBytes,
      };
    } finally {
      await html.close().catch(() => undefined);
      await rm(folder, { recursive: true, force: true });
    }
  };
  const key = inflightKey;
  if (inflight.has(key)) return inflight.get(key)!;
  const startedAt = Date.now();
  exportLog("start", { owner, document: documentId, chapters: doc.pages.length, images: doc.pages.filter(page => page.imageUrl).length });
  const task = run().then(result => {
    exportLog(result.pdfUrl ? "done" : "partial", { owner, document: documentId, ms: Date.now() - startedAt, totalPages: result.totalPages, imagePages: result.imagePages, htmlBytes: result.htmlBytes, pdfBytes: result.pdfBytes, reason: result.pdfError });
    return result;
  }, error => {
    exportLog("failed", { owner, document: documentId, ms: Date.now() - startedAt, reason: knowledgeExportLogReason(error) });
    throw error;
  }).finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}
