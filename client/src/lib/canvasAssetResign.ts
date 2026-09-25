/**
 * 出片前统一重签上传件签名链。
 *
 * 画布上传件（block.uploadedAssets[*].url）是 60 分钟有效的 GCS 签名链；
 * refImageUrl / editFusionUrls / refVideoUrl / seedance25RefVideoUrls /
 * seedance25RefAudioUrls 里存的也是同一串字符串。上传与提交之间隔太久，
 * 供应商下载时链接已过期（0908 EvoLink「input media could not be downloaded」）。
 *
 * 这里在组请求之前，把每一条命中上传件（且带 gcsUri）的 URL 按 gcsUri 重签一次：
 * - 同一 gcsUri 只签一次（memo），数组保序；
 * - 重签失败退回原链，绝不因此挡出片。
 */
import type { CanvasBlock, CanvasUploadedAsset } from "./canvasTypes";
import { resolveCanvasMaterialUrl } from "./omniCanvasApi";
import { gsUriFromSignedGcsUrl } from "@shared/manhuaMultiview";

export type CanvasAssetSigner = (gcsUri: string) => Promise<string>;

/** 生图请求的库图不一定在 uploadedAssets 内；提交前逐张重签，失败时不建立付费任务。 */
export async function resignCanvasImageEditReferences(
  refs: { refImageUrl: string; referenceImageUrls: readonly string[]; maskUrl?: string },
  sign: CanvasAssetSigner = resolveCanvasMaterialUrl,
): Promise<{ refImageUrl: string; referenceImageUrls: string[]; maskUrl?: string }> {
  const pending = new Map<string, Promise<string>>();
  const refresh = async (url: string): Promise<string> => {
    const gcsUri = gsUriFromSignedGcsUrl(url);
    // 公开 GCS 对象可直接使用；只处理会到期的签名链接。
    if (!gcsUri || !/[?&](?:X-Goog-Signature|Signature)=/i.test(url)) return url;
    let task = pending.get(gcsUri);
    if (!task) {
      task = (async () => {
        try {
          const fresh = String(await sign(gcsUri) || "").trim();
          if (gsUriFromSignedGcsUrl(fresh) !== gcsUri) throw new Error("signed_object_mismatch");
          return fresh;
        } catch {
          throw new Error("参考图临时链接续签失败，未提交生图任务。请稍后重试。");
        }
      })();
      pending.set(gcsUri, task);
    }
    return task;
  };
  const [refImageUrl, referenceImageUrls, maskUrl] = await Promise.all([
    refresh(refs.refImageUrl),
    Promise.all(refs.referenceImageUrls.map(refresh)),
    refs.maskUrl ? refresh(refs.maskUrl) : Promise.resolve(undefined),
  ]);
  return { refImageUrl, referenceImageUrls, ...(maskUrl ? { maskUrl } : {}) };
}

export type CanvasAssetResigner = {
  /** 单条：命中上传件则换新签名，否则原样返回（含 undefined / 空串）。 */
  one<T extends string | undefined>(url: T): Promise<T>;
  /** 数组：逐条替换、保序；不去重（去重由调用方按业务决定）。 */
  many(urls: readonly string[]): Promise<string[]>;
  /** 已重签过的 gcsUri → 新链（供把 uploadedAssets 副本同步成新链）。 */
  fresh(gcsUri: string | undefined): string | undefined;
};

function stripQuery(url: string): string {
  const i = url.indexOf("?");
  return i >= 0 ? url.slice(0, i) : url;
}

/** 同一上传件：字符串全等，或都是 http(s) 且去掉签名参数后路径一致（旧签名/新签名互认）。 */
function sameAssetUrl(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (!/^https?:\/\//i.test(a) || !/^https?:\/\//i.test(b)) return false;
  return stripQuery(a) === stripQuery(b);
}

export function findCanvasUploadedAssetByUrl(
  assets: readonly CanvasUploadedAsset[] | null | undefined,
  url: string | undefined,
): CanvasUploadedAsset | undefined {
  const target = String(url || "").trim();
  if (!target) return undefined;
  return (assets || []).find(
    (a) => sameAssetUrl(target, a.url) || sameAssetUrl(target, a.previewUrl),
  );
}

export function createCanvasAssetResigner(
  assets: readonly CanvasUploadedAsset[] | null | undefined,
  options: { sign?: CanvasAssetSigner; log?: (msg: string) => void } = {},
): CanvasAssetResigner {
  const sign = options.sign || resolveCanvasMaterialUrl;
  const log = options.log || ((msg: string) => console.warn(msg));
  const pending = new Map<string, Promise<string | undefined>>();
  const done = new Map<string, string>();

  const signOnce = (gcsUri: string): Promise<string | undefined> => {
    const hit = pending.get(gcsUri);
    if (hit) return hit;
    const p = (async () => {
      try {
        const fresh = String((await sign(gcsUri)) || "").trim();
        if (!/^https?:\/\//i.test(fresh)) throw new Error("签名返回非 https 链接");
        done.set(gcsUri, fresh);
        return fresh;
      } catch (err) {
        log(
          `[canvasAssetResign] resign failed · fallback to stored url · ${gcsUri.slice(0, 96)} · ${
            err instanceof Error ? err.message.slice(0, 120) : "unknown"
          }`,
        );
        return undefined;
      }
    })();
    pending.set(gcsUri, p);
    return p;
  };

  const one = async <T extends string | undefined>(url: T): Promise<T> => {
    const raw = String(url || "").trim();
    if (!raw) return url;
    const asset = findCanvasUploadedAssetByUrl(assets, raw);
    const gcsUri = String(asset?.gcsUri || "").trim();
    if (!gcsUri) return url;
    const fresh = await signOnce(gcsUri);
    return (fresh || url) as T;
  };

  return {
    one,
    many: async (urls) => {
      const out: string[] = [];
      for (const u of urls) out.push((await one(u)) ?? u);
      return out;
    },
    fresh: (gcsUri) => (gcsUri ? done.get(gcsUri) : undefined),
  };
}

/**
 * 返回一份浅拷贝：节点上引用上传件的字段全部换成新签名链；
 * uploadedAssets 副本里被重签过的条目 url 同步成新链，保证后续按 `a.url === refVideoUrl`
 * 判 kind 的逻辑仍能命中。原节点对象不改。
 */
export async function resignCanvasBlockUploadedReferences(
  block: CanvasBlock,
  resigner: CanvasAssetResigner,
): Promise<CanvasBlock> {
  const assets = block.uploadedAssets || [];
  if (!assets.some((a) => a.gcsUri)) return block;
  const [refImageUrl, refVideoUrl, editMaskUrl, editFusionUrls, seedance25RefVideoUrls, seedance25RefAudioUrls] =
    await Promise.all([
      resigner.one(block.refImageUrl),
      resigner.one(block.refVideoUrl),
      resigner.one(block.editMaskUrl),
      block.editFusionUrls ? resigner.many(block.editFusionUrls) : Promise.resolve(undefined),
      block.seedance25RefVideoUrls ? resigner.many(block.seedance25RefVideoUrls) : Promise.resolve(undefined),
      block.seedance25RefAudioUrls ? resigner.many(block.seedance25RefAudioUrls) : Promise.resolve(undefined),
    ]);
  const uploadedAssets = assets.map((a) => {
    const fresh = resigner.fresh(a.gcsUri);
    return fresh && fresh !== a.url ? { ...a, url: fresh } : a;
  });
  return {
    ...block,
    ...(block.refImageUrl !== undefined ? { refImageUrl } : {}),
    ...(block.refVideoUrl !== undefined ? { refVideoUrl } : {}),
    ...(block.editMaskUrl !== undefined ? { editMaskUrl } : {}),
    ...(editFusionUrls ? { editFusionUrls } : {}),
    ...(seedance25RefVideoUrls ? { seedance25RefVideoUrls } : {}),
    ...(seedance25RefAudioUrls ? { seedance25RefAudioUrls } : {}),
    uploadedAssets,
  };
}
