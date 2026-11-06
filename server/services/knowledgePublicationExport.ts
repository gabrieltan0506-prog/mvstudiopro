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
      for (const [index, page] of Array.from(doc.pages.entries())) {
        let embedded = "";
        if (page.imageUrl) {
          const image = await deps.image(page.imageUrl);
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
        for (const [index, path] of Array.from(chunks.entries())) {
          try {
            const count = await deps.measure(head + await readFile(path, "utf8") + tail);
            if (!Number.isSafeInteger(count) || count < 1) throw new Error("预分页结果无效");
            counts.push(count);
          } catch {
            failures.push(index + 1);
          }
        }
      }
      if (!failures.length) {
        const total = counts.reduce((a, b) => a + b, 0);
        let offset = 0;
        for (const [index, sourcePath] of Array.from(chunks.entries())) {
          const count = counts[index];
          const pagination = count ? { offset, total, count } : undefined;
          const name = `${prefix}/pdf-parts/${index}${pagination ? `-${offset}-${count}-${total}` : ""}.pdf`;
          const path = join(folder, `${index}.pdf`);
          try {
            const cached = await deps.read(name);
            const bytes = cached || await deps.pdf(knowledgePublicationHead(doc.title, pagination) + await readFile(sourcePath, "utf8") + tail);
            if (bytes.length < 100 || bytes.subarray(0, 4).toString() !== "%PDF") throw new Error("导出没有返回有效PDF");
            if (!cached) await deps.save(name, bytes, "application/pdf");
            await writeFile(path, bytes);
            pdfFiles.push(path);
          } catch {
            failures.push(index + 1);
          }
          offset += count || 0;
        }
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
          pdfError: `HTML已保存，PDF有${failures.length}段未完成；可继续生成PDF，已成功部分会复用`,
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
