import {assertKnowledgeInteriorConsent,settleKnowledgeInterior} from "./knowledgePublicationBilling";
import type {EditableLayout} from "../../shared/editableLayout";
import type {KnowledgeReview} from "../../shared/knowledgePublication";
import { resolveKnowledgePublicationImages } from "./knowledgePublicationImages";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, stat, rm, open, readdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readCanonicalLayoutLibrary } from "./editableLayoutStore";
import {
  knowledgeSourceDigest,
  readKnowledgeImage,
  readKnowledgePublicationReview,
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
  uploadBufferToGcs,
  uploadStreamToGcs,
} from "./gcs";
import { fetchPdfBufferFromWorker, measureKnowledgeBookletFromWorker } from "./pdfWorkerClient";
import type { KnowledgeBookletImageMode } from "../../shared/knowledgeBooklet";
import { ensureKnowledgeReviewThumbnail } from "./knowledgeReviewThumbnail";
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
async function knowledgeExportPool(count: number, worker: (index: number) => Promise<void>) {
  const lanes = Array.from({ length: knowledgeStageConcurrency(count, { max: KNOWLEDGE_EXPORT_PART_CONCURRENCY }) }, () => "pdf" as const);
  await runKnowledgeStaggeredPool(Array.from({ length: count }, (_, i) => i), { lanes, staggerMs: 0, worker: async i => { await worker(i); } });
}


/** 阅读稿 HTML 内配图签名地址的有效期：GCS V4 上限 7 天；过期后重新导出即换新地址，PDF 成品不受影响。 */
export const KNOWLEDGE_EXPORT_IMAGE_URL_TTL_SECONDS = 7 * 24 * 3600;
/** 配图传输方式标记进成品目录：改为地址引用后的成品与旧内嵌版分开存放，互不复用。 */
export const KNOWLEDGE_EXPORT_IMAGE_TRANSPORT = "url2";
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
};
const real = {
  settle: settleKnowledgeInterior,
  load: readCanonicalLayoutLibrary,
  review: readKnowledgePublicationReview,
  image: readKnowledgeImage,
  // 导出配图只以签名地址交给排版服务与阅读稿 HTML，不把图片数据内嵌进 HTML（禁 base64）。
  // 地址指向缩图派生件（长边 ≤2048 的 JPEG，审校时已生成）：排版服务入版前本就把每张图缩到长边 1200，
  // 送 13–18MB 的 4K 原图只会让并发取图超时（1110 实测 34 段有 11 段预分页失败）；缩图不可得时回退原图地址。
  imageUrl: async (uri: string) => signGsUriV4ReadUrl((await ensureKnowledgeReviewThumbnail(uri)) || uri, KNOWLEDGE_EXPORT_IMAGE_URL_TTL_SECONDS),
  pdf: fetchPdfBufferFromWorker,
  measure: measureKnowledgeBookletFromWorker,
  // 使用镜像已有poppler，按真实PDF物理页保存，不用估算页数。
  savePages: async (bytes: Buffer, save: (index:number,page:Buffer)=>Promise<void>) => {
    const folder=await mkdtemp(join(tmpdir(),'knowledge-pdf-pages-'));
    try{
      const source=join(folder,'source.pdf');await writeFile(source,bytes);
      await promisify(execFile)('pdfseparate',[source,join(folder,'page-%d.pdf')],{timeout:300000,maxBuffer:1024*1024});
      const names=(await readdir(folder)).filter(n=>/^page-\d+\.pdf$/.test(n)).sort((a,b)=>Number(a.match(/\d+/)![0])-Number(b.match(/\d+/)![0]));
      if(!names.length)throw Error('未取得PDF分页，原分片已保留');
      for(const name of names)await save(Number(name.match(/\d+/)![0])-1,await readFile(join(folder,name)));
    }finally{await rm(folder,{recursive:true,force:true});}
  },
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
 * 压缩适配（knowledgeHandbookRefit）用的派生导出：view=已在副本上压缩正文的整册视图（原稿与已确认正文不动），
 * imageModes=按实测收回跨页名额后的逐章版式，prefixTag=成品目录版本标记（与正式导出分开存放，互不复用）。
 */
export type KnowledgeDerivedExport = { view?: Awaited<ReturnType<typeof loadKnowledgePublicationExport>>; imageModes?: KnowledgeBookletImageMode[]; prefixTag?: string };
export async function exportKnowledgePublication(
  owner:number,documentId:string,generation:string,overrides:Partial<typeof real>={},derived:KnowledgeDerivedExport={}
):Promise<KnowledgePublicationExport>{
  const deps={...real,...overrides};
  const { loadKnowledgeBookLayoutView } = await import("./knowledgeBookLayout");
  // 生产调用（无注入依赖）复用同一 generation 的整册视图缓存，与预览/排版输入共用一次解析与核验。
  const {doc,review,receipt,prefix:sourcePrefix}=derived.view
    ? derived.view
    : Object.keys(overrides).length===0
    ? await loadKnowledgeBookLayoutView(owner,documentId,generation,{},{cache:true})
    : await loadKnowledgeBookLayoutView(owner,documentId,generation,deps);
  if(derived.imageModes&&derived.imageModes.length!==doc.pages.length)throw new Error("逐章版式数量与章节不一致");
  if(derived.prefixTag&&!/^[a-z0-9-]{1,64}$/.test(derived.prefixTag))throw new Error("导出目录标记无效");
  const prefix=`${sourcePrefix}-${KNOWLEDGE_EXPORT_IMAGE_TRANSPORT}${derived.prefixTag?`-${derived.prefixTag}`:""}`;
  if(doc.publication?.supplementOf && doc.publication.billing)return exportKnowledgePublication(owner,doc.publication.supplementOf.documentId,generation,overrides,derived.view?{}:derived);
  assertKnowledgeInteriorConsent(doc);
  const run = async () => {
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
    const pdfFiles: string[] = [],
      failures: number[] = [];
    const expected = new Map(receipt.sourceImages.map(p => [p.uri, p.sha256]));
    let totalImageBytes = 0;
    const flush = async () => {
      if (!chunk) return;
      const path = join(folder, `chunk-${chunks.length}.html`);
      await writeFile(path, chunk);
      chunks.push(path);
      chunk = "";
      chunkBytes = 0;
    };
    try {
      await html.writeFile(head);
      // 配图先并发取回（按页数动态并发），装配仍按页序；校验与原逻辑相同。
      // 只为核对原图指纹与体积而读取，读完即释放；图片数据不进入 HTML。
      const verifyImage = async (url: string) => { const image = await deps.image(url); return { sha256: image.sha256, bytes: image.buffer.length }; };
      const prefetched = new Map<number, ReturnType<typeof verifyImage>>();
      await knowledgeExportPool(doc.pages.length, async index => {
        const url = doc.pages[index]!.imageUrl;
        if (url) { const p = verifyImage(url); prefetched.set(index, p); await p.catch(() => undefined); }
      });
      // 每张图只签一次地址：本章配图与上一章「下篇预告」裁切条共用（预告条只引用地址，不另生成图）。
      const addresses = new Map<string, Promise<string>>();
      const addressOf = (uri: string) => { if (!addresses.has(uri)) addresses.set(uri, deps.imageUrl(uri)); return addresses.get(uri)!; };
      for (const [index, page] of Array.from(doc.pages.entries())) {
        let imageAddress = "", imageBytes = 0;
        if (page.imageUrl) {
          const image = await (prefetched.get(index) ?? verifyImage(page.imageUrl));
          if (expected.get(page.imageUrl) !== image.sha256)
            throw new Error(`第${index + 1}页配图已变化，未导出旧审校版本`);
          imageAddress = await addressOf(page.imageUrl);
          imageBytes = image.bytes;
          totalImageBytes += image.bytes;
        }
        const nextUri = doc.pages[index + 1]?.imageUrl;
        const section = knowledgePublicationChapter(
            doc,
            review,
            index,
            imageAddress,
            false,
            nextUri ? await addressOf(nextUri) : "",
            derived.imageModes?.[index]
          ),
          // 分卷仍按「正文 + 原图体积」计重，保持每卷载入排版服务的图片总量与原先一致；HTML 本身只含地址。
          bytes = Buffer.byteLength(section) + imageBytes;
        // 内部自动分卷渲染，再合成一个PDF；用户不必拆页。HTML流式落盘，不把千页图同时装进内存。
        if (chunkBytes + bytes > 48 * 1024 * 1024) await flush();
        await html.writeFile(section);
        chunk += section;
        chunkBytes += bytes;
        // 每个源页立即写检查点，不等后续章节或整册PDF完成。
        await deps.save(`${prefix}/source-pages/${index}.html`,Buffer.from(head+section+tail),'text/html;charset=utf-8');
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
      exportLog("html", { owner, document: documentId, htmlBytes, parts: chunks.length, imageBytes: totalImageBytes, ms: Date.now() - startedAt });
      // 分段先在最终字体下计数，再带全书页码渲染。只保留一段HTML在内存中。
      const counts: number[] = [];
      if (chunks.length > 1) {
        // 各段预分页互不依赖：同时计数（按段数动态并发），结果按原段序写回。
        await knowledgeExportPool(chunks.length, async index => {
          try {
            const chunkHtml = head + await readFile(chunks[index]!, "utf8") + tail;
            const count = await retryKnowledgeExportStep(() => deps.measure(chunkHtml));
            if (!Number.isSafeInteger(count) || count < 1) throw new Error("预分页结果无效");
            counts[index] = count;
          } catch (error) {
            counts[index]=0;
            failures.push(index + 1);
            exportLog("measure-failed", { owner, document: documentId, part: index + 1, reason: knowledgeExportLogReason(error) });
          }
        });
        // 并发下个别段偶发失败：对失败段逐段再补一轮，仍不过才留给下次续跑。
        for (const part of failures.splice(0)) {
          try {
            const chunkHtml = head + await readFile(chunks[part - 1]!, "utf8") + tail;
            const count = await retryKnowledgeExportStep(() => deps.measure(chunkHtml));
            if (!Number.isSafeInteger(count) || count < 1) throw new Error("预分页结果无效");
            counts[part - 1] = count;
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
        await knowledgeExportPool(chunks.length, async index => {
          const sourcePath = chunks[index]!;
          const count = counts[index];
          const offset = offsets[index]!;
          const pagination = count ? { offset, total, count } : undefined;
          const name = `${prefix}/pdf-parts/${index}${pagination ? `-${offset}-${count}-${total}` : ""}.pdf`;
          const path = join(folder, `${index}.pdf`);
          if(failures.includes(index+1))return;
          try {
            const cached = await deps.read(name);
            const bytes = cached || await retryKnowledgeExportStep(async () => deps.pdf(knowledgePublicationHead(doc.title, pagination) + await readFile(sourcePath, "utf8") + tail));
            if (bytes.length < 100 || bytes.subarray(0, 4).toString() !== "%PDF") throw new Error("导出没有返回有效PDF");
            if (!cached) await deps.save(name, bytes, "application/pdf");
            await deps.savePages(bytes,async(pageIndex,page)=>{
              const key=`${name}.pages/${pageIndex}.pdf`;
              if(!await deps.read(key))await deps.save(key,page,'application/pdf');
            });
            await writeFile(path, bytes);
            rendered[index] = path;
          } catch (error) {
            failures.push(index + 1);
            exportLog("render-failed", { owner, document: documentId, part: index + 1, reason: knowledgeExportLogReason(error) });
          }
        });
        for (const path of rendered) if (path) pdfFiles.push(path);
        failures.sort((a, b) => a - b);
      }
      if (failures.length) {
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
          next.push(target);
        }
        active = next;
        level++;
      }
      if (!active.length) throw new Error("未生成PDF内容");
      const totalPages = await deps.countPages(active[0]);
      if (!Number.isSafeInteger(totalPages) || totalPages < 1) throw new Error("手册实际总页数无效");
      const imagePages = doc.pages.filter(page => page.imageUrl).length;
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
      };
    } finally {
      await html.close().catch(() => undefined);
      await rm(folder, { recursive: true, force: true });
    }
  };
  const key = prefix;
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
