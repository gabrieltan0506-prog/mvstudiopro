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

/** 导出分段池：按段数动态并发（≤16），每段自行捕获错误。 */
async function knowledgeExportPool(count: number, worker: (index: number) => Promise<void>) {
  const lanes = Array.from({ length: knowledgeStageConcurrency(count, { max: 16 }) }, () => "pdf" as const);
  await runKnowledgeStaggeredPool(Array.from({ length: count }, (_, i) => i), { lanes, staggerMs: 0, worker: async i => { await worker(i); } });
}


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
export async function exportKnowledgePublication(
  owner:number,documentId:string,generation:string,overrides:Partial<typeof real>={}
):Promise<KnowledgePublicationExport>{
  const deps={...real,...overrides};
  const { loadKnowledgeBookLayoutView } = await import("./knowledgeBookLayout");
  const {doc,review,receipt,prefix}=await loadKnowledgeBookLayoutView(owner,documentId,generation,deps);
  if(doc.publication?.supplementOf && doc.publication.billing)return exportKnowledgePublication(owner,doc.publication.supplementOf.documentId,generation,overrides);
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
      const prefetched = new Map<number, Promise<Awaited<ReturnType<typeof deps.image>>>>();
      await knowledgeExportPool(doc.pages.length, async index => {
        const url = doc.pages[index]!.imageUrl;
        if (url) { const p = deps.image(url); prefetched.set(index, p); await p.catch(() => undefined); }
      });
      for (const [index, page] of Array.from(doc.pages.entries())) {
        let embedded = "";
        if (page.imageUrl) {
          const image = await (prefetched.get(index) ?? deps.image(page.imageUrl));
          if (expected.get(page.imageUrl) !== image.sha256)
            throw new Error(`第${index + 1}页配图已变化，未导出旧审校版本`);
          embedded = `data:${image.mimeType};base64,${image.buffer.toString("base64")}`;
        }
        const section = knowledgePublicationChapter(
            doc,
            review,
            index,
            embedded
          ),
          bytes = Buffer.byteLength(section);
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
          } catch {
            counts[index]=0;
            failures.push(index + 1);
          }
        });
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
          } catch {
            failures.push(index + 1);
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
  const task = run().finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}
