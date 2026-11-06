import { validateKnowledgeImageReplacements } from "./knowledgePublicationImages";
import {
  layoutLibrarySchema,
  type LayoutLibrary,
} from "../../shared/editableLayout";
import {
  downloadGcsObjectVersioned,
  getGcsBucketName,
  uploadBufferToGcs,
  signGsUriV4ReadUrl,
} from "./gcs";
export class LayoutConflict extends Error {
  constructor() {
    super("云端排版稿已变化，未覆盖；请导出本机备份后读取云端稿件");
  }
}
const objectName = (owner: number) => {
  if (!Number.isSafeInteger(owner) || owner <= 0)
    throw new Error("需要有效登录账号");
  return `editable-layouts/user-${owner}/library.json`;
};
const real = { read: downloadGcsObjectVersioned, write: uploadBufferToGcs };
/** 并发保存可能在metadata与body读取之间替换旧generation；只重读同一稿件，不重放写入。 */
async function readCurrentLayoutVersion(gcsUri: string, deps: typeof real) {
  for (let attempt = 0; ; attempt++) {
    try { return await deps.read({ gcsUri }); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== "gcs_download_failed:404" || attempt >= 2) throw error;
    }
  }
}
const media = {
  async normalize(owner: number, library: LayoutLibrary) {
    for (const doc of library.documents) {
      if (!doc.publication) continue;
      for (const page of [...doc.pages, ...doc.publication.source.pages])
        if (page.imageUrl && !/^gs:\/\/|^https:\/\/storage\.googleapis\.com\//.test(page.imageUrl))
          throw new Error("知识卡审校仅支持本人已保存的配图，请先恢复原成品");
    }
    const candidates = library.documents
      .flatMap(d => [...d.pages, ...(d.publication?.source.pages || [])])
      .filter(p =>
        /^gs:\/\/|^https:\/\/storage\.googleapis\.com\//.test(p.imageUrl)
      );
    if (!candidates.length) return;
    const {
      resolveRegisteredPostProdMediaSource,
      loadSucceededJobOutputSources,
    } = await import("./postProdMediaSource");
    const sources = await loadSucceededJobOutputSources(
      String(owner),
      getGcsBucketName()
    );
    const context = { jobObjects: sources.objects, jobUrls: sources.urls };
    const resolved = new Map<string, string>();
    for (const page of candidates) {
      if (!resolved.has(page.imageUrl))
        resolved.set(
          page.imageUrl,
          await resolveRegisteredPostProdMediaSource(
            { userId: String(owner), source: page.imageUrl },
            undefined,
            context
          )
        );
      page.imageUrl = resolved.get(page.imageUrl)!;
    }
  },
  sign: (source: string) => signGsUriV4ReadUrl(source, 7 * 24 * 3600),
};
export async function readLayoutLibrary(
  owner: number,
  deps = real,
  mediaDeps = media
) {
  const name = objectName(owner);
  try {
    const value = await readCurrentLayoutVersion(`gs://${getGcsBucketName()}/${name}`, deps);
    const envelope = JSON.parse(value.buffer.toString("utf8"));
    if (envelope.format !== "editable-layout-v1" || envelope.owner !== owner)
      throw new Error("云端排版稿身份无法校验");
    const library = layoutLibrarySchema.parse(envelope.library);
    if (library.owner !== String(owner)) throw new Error("排版稿账号不匹配");
    // 只有已通过本人产物归属校验的对象才以gs://落盘；读取时按对象重新签名。
    for (const doc of library.documents)
      for (const page of [...doc.pages, ...(doc.publication?.source.pages || [])])
        if (page.imageUrl.startsWith("gs://"))
          page.imageUrl = mediaDeps.sign(page.imageUrl);
    return {
      library,
      generation: value.generation,
      updatedAt: String(envelope.updatedAt),
    };
  } catch (e) {
    if (e instanceof Error && e.message === "gcs_stat_failed:404")
      return { library: null, generation: "0", updatedAt: null };
    throw e;
  }
}
/** 服务端审校使用稳定对象地址；签名刷新不改变原稿摘要或请求指纹。 */
export function readCanonicalLayoutLibrary(owner: number, deps = real) {
  return readLayoutLibrary(owner, deps, { ...media, sign: source => source });
}
export async function writeLayoutLibrary(
  owner: number,
  raw: LayoutLibrary,
  generation: string,
  deps = real,
  mediaDeps = media
) {
  const library = layoutLibrarySchema.parse(raw);
  if (library.owner !== String(owner))
    throw new Error("排版稿账号不匹配，未写入");
  if (!/^\d+$/.test(generation)) throw new LayoutConflict();
  await mediaDeps.normalize(owner, library);
  let priorLibrary: LayoutLibrary | undefined;
  if (generation !== "0") {
    const prior = await readCurrentLayoutVersion(`gs://${getGcsBucketName()}/${objectName(owner)}`, deps);
    if (prior.generation !== generation) throw new LayoutConflict();
    const before = layoutLibrarySchema.parse(JSON.parse(prior.buffer.toString("utf8")).library);
    priorLibrary = before;
    for (const doc of library.documents) {
      const old = before.documents.find(d => d.id === doc.id);
      if (doc.publication) await validateKnowledgeImageReplacements(owner, old?.publication, doc.publication);
      if (JSON.stringify(old?.publication?.conversation) !== JSON.stringify(doc.publication?.conversation)) {
        const { validateKnowledgeConversationTransition } = await import("./knowledgeConversationAdvisor");
        await validateKnowledgeConversationTransition(owner,old,doc);
      }
      if (!old) continue;
      if(old.publication?.presentationRequest && doc.publication?.presentationRequest) {
        const {validateKnowledgePresentationRetryTransition}=await import('./knowledgePresentationRetry');
        await validateKnowledgePresentationRetryTransition(owner,old,doc);
      }
      if (old.publication && doc.publication) {
        const oldParallel = old.publication.parallel, parallel = doc.publication.parallel;
        if (oldParallel && (!parallel || oldParallel.completed.some(i => !parallel.completed.includes(i)) ||
            Object.entries(oldParallel.channels).some(([i, channel]) => parallel.channels[i] !== channel)))
          throw new Error("已分配通道或已完成批次不能删除、改派；请恢复原任务");
        const { validateKnowledgePublicationRetryTransition } = await import("./knowledgePublicationRetry");
        await validateKnowledgePublicationRetryTransition(owner, old, doc);
      }
      if (Boolean(old.publication) !== Boolean(doc.publication) || (old.publication && doc.publication &&
          (JSON.stringify(old.publication.source) !== JSON.stringify(doc.publication.source) ||
           old.publication.requestId !== doc.publication.requestId ||
           old.publication.inputFingerprint !== doc.publication.inputFingerprint)))
        throw new Error("知识卡原稿快照不能覆盖，请保留原稿并另建新稿");
    }
  }
  if (generation === "0") {
    for (const doc of library.documents) {
      if (doc.publication) await validateKnowledgeImageReplacements(owner, undefined, doc.publication);
      if (doc.publication?.conversation?.length) {
        const { validateKnowledgeConversationTransition } = await import("./knowledgeConversationAdvisor");
        await validateKnowledgeConversationTransition(owner,undefined,doc);
      }
    }
  }
  if(library.documents.some(d=>d.publication?.supplementOf||d.publication?.supplementDocumentId)||priorLibrary?.documents.some(d=>d.publication?.supplementOf||d.publication?.supplementDocumentId)){
    await (await import("./knowledgeSupplement")).validateKnowledgeSupplements(owner,priorLibrary,library);
  }
  if (library.documents.some(d => d.publication?.layoutConversationId || d.publication?.conversation?.some(t => t.request.action === "layout"))) {
    await (await import("./knowledgeBookLayout")).validateKnowledgeBookLayoutTransition(owner, priorLibrary, library);
  }
  const updatedAt = new Date().toISOString();
  const buffer = Buffer.from(
    JSON.stringify({ format: "editable-layout-v1", owner, updatedAt, library })
  );
  if (buffer.length > 64 * 1024 * 1024)
    throw new Error("排版库超过64MB，本次未截断或覆盖；原稿与审校回执保留，请联系支持处理存储容量");
  try {
    const result = await deps.write({
      objectName: objectName(owner),
      buffer,
      contentType: "application/json",
      ifGenerationMatch: generation,
    });
    if (!result.generation) throw new Error("保存缺少版本回执，请读取云端核对");
    return { generation: result.generation, updatedAt };
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("gcs_upload_failed:412:"))
      throw new LayoutConflict();
    throw e;
  }
}
