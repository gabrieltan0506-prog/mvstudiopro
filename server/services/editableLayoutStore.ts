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
const media = {
  async normalize(owner: number, library: LayoutLibrary) {
    const candidates = library.documents
      .flatMap(d => d.pages)
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
    const value = await deps.read({
      gcsUri: `gs://${getGcsBucketName()}/${name}`,
    });
    const envelope = JSON.parse(value.buffer.toString("utf8"));
    if (envelope.format !== "editable-layout-v1" || envelope.owner !== owner)
      throw new Error("云端排版稿身份无法校验");
    const library = layoutLibrarySchema.parse(envelope.library);
    if (library.owner !== String(owner)) throw new Error("排版稿账号不匹配");
    // 只有已通过本人产物归属校验的对象才以gs://落盘；读取时按对象重新签名。
    for (const doc of library.documents)
      for (const page of doc.pages)
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
  const updatedAt = new Date().toISOString();
  const buffer = Buffer.from(
    JSON.stringify({ format: "editable-layout-v1", owner, updatedAt, library })
  );
  if (buffer.length > 8 * 1024 * 1024)
    throw new Error("排版稿超过8MB，请导出备份后精简；未截断或覆盖");
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
