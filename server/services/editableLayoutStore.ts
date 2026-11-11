import { validateKnowledgeImageReplacements } from "./knowledgePublicationImages";
import {
  layoutLibrarySchema,
  type LayoutLibrary,
} from "../../shared/editableLayout";
import {
  downloadGcsObjectVersioned,
  getGcsBucketName,
  statGcsObjectVersion,
  uploadBufferToGcs,
  signGsUriV4ReadUrl,
} from "./gcs";
import { KnowledgeTtlCache } from "./knowledgePublicationCache";
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
type StoreDeps = {
  read: (params: { gcsUri: string }) => Promise<{ buffer: Buffer; generation: string }>;
  write: typeof uploadBufferToGcs;
  /** 提供时启用按 generation 的进程内缓存：先取元数据，同版本不再下载整库。 */
  stat?: (params: { gcsUri: string }) => Promise<{ generation: string }>;
};
const real: StoreDeps = { read: downloadGcsObjectVersioned, write: uploadBufferToGcs, stat: statGcsObjectVersion };
/**
 * 云稿整库原文缓存（键 = 对象地址 + generation，地址本身按账号区分，不会跨用户）。
 * 1110 实测本机库 330 万字符：报价、排版输入、预览、导出、每次保存前的旧版核对都要整库下载一次。
 * generation 变化即换键；容量与过期双上限；超大库不进缓存。
 */
export const layoutLibraryBufferCache = new KnowledgeTtlCache<{ buffer: Buffer; generation: string }>(8, 5 * 60_000);
const LIBRARY_CACHE_MAX_BYTES = 16 * 1024 * 1024;
const libraryCacheKey = (gcsUri: string, generation: string) => `${gcsUri}#${generation}`;
/** 并发保存可能在metadata与body读取之间替换旧generation；只重读同一稿件，不重放写入。 */
async function readCurrentLayoutVersion(gcsUri: string, deps: StoreDeps) {
  if (deps.stat) {
    const { generation } = await deps.stat({ gcsUri });
    const key = libraryCacheKey(gcsUri, generation);
    const hit = layoutLibraryBufferCache.peek(key);
    if (hit) return hit;
  }
  const value = await readCurrentLayoutVersionUncached(gcsUri, deps);
  if (deps.stat && value.buffer.length <= LIBRARY_CACHE_MAX_BYTES) layoutLibraryBufferCache.set(libraryCacheKey(gcsUri, value.generation), { buffer: value.buffer, generation: value.generation });
  return value;
}
async function readCurrentLayoutVersionUncached(gcsUri: string, deps: StoreDeps) {
  for (let attempt = 0; ; attempt++) {
    try { return await deps.read({ gcsUri }); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== "gcs_download_failed:404" || attempt >= 2) throw error;
    }
  }
}
/** 本人配图归属解析结果（账号 + 地址 → 规范地址）；对象归属不会在短时间内改变。 */
export const layoutMediaOwnershipCache = new KnowledgeTtlCache<string>(4000, 10 * 60_000);
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
    const resolved = new Map<string, string>();
    const ownershipKey = (url: string) => `${owner}|${url}`;
    // 每次保存都要核验全部配图归属；已核验过的地址直接复用，只有新地址才加载本人产物清单。
    for (const page of candidates) {
      const key = ownershipKey(page.imageUrl);
      const hit = resolved.has(page.imageUrl) ? undefined : layoutMediaOwnershipCache.peek(key);
      if (hit) resolved.set(page.imageUrl, await hit);
    }
    if (candidates.some(page => !resolved.has(page.imageUrl))) {
      const {
        resolveRegisteredPostProdMediaSource,
        loadSucceededJobOutputSources,
      } = await import("./postProdMediaSource");
      const sources = await loadSucceededJobOutputSources(
        String(owner),
        getGcsBucketName()
      );
      const context = { jobObjects: sources.objects, jobUrls: sources.urls };
      for (const page of candidates) {
        if (!resolved.has(page.imageUrl)) {
          const canonical = await resolveRegisteredPostProdMediaSource(
            { userId: String(owner), source: page.imageUrl },
            undefined,
            context
          );
          resolved.set(page.imageUrl, canonical);
          layoutMediaOwnershipCache.set(ownershipKey(page.imageUrl), canonical);
        }
      }
    }
    for (const page of candidates) page.imageUrl = resolved.get(page.imageUrl)!;
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
/** 只取当前云稿 generation（元数据请求，不下载整库）；不存在为 "0"。供缓存命中前核对版本未变。 */
export async function currentLayoutGeneration(owner: number, stat: NonNullable<StoreDeps["stat"]> = statGcsObjectVersion) {
  try { return (await stat({ gcsUri: `gs://${getGcsBucketName()}/${objectName(owner)}` })).generation; }
  catch (e) {
    if (e instanceof Error && e.message === "gcs_stat_failed:404") return "0";
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
  (await import("./knowledgePublicationBilling")).validateKnowledgeBillingTransition(priorLibrary,library);
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
    // 刚写入的整库就是该 generation 的原文：紧随其后的排版输入/预览/导出读取不必再下载。
    if (deps.stat && buffer.length <= LIBRARY_CACHE_MAX_BYTES)
      layoutLibraryBufferCache.set(libraryCacheKey(`gs://${getGcsBucketName()}/${objectName(owner)}`, String(result.generation)), { buffer, generation: String(result.generation) });
    return { generation: result.generation, updatedAt };
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("gcs_upload_failed:412:"))
      throw new LayoutConflict();
    throw e;
  }
}
