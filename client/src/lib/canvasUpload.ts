import type { CanvasUploadedAsset } from "./canvasTypes";
import { resolveOmniMaterialUrl, uploadFileToSignedUrl } from "./omniCanvasApi";

/** 并行上传路数：GCS 直传 + 签名 URL 并发 */
export const CANVAS_UPLOAD_CONCURRENCY = 10;

type SignedUrlMutation = (input: {
  fileName: string;
  mimeType: string;
  objectName?: string;
}) => Promise<{
  uploadUrl: string;
  requiredHeaders?: Record<string, string>;
  gcsUri?: string;
}>;

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let done = 0;
  const pool = Math.max(1, Math.min(concurrency, items.length));

  async function runWorker() {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i]!, i);
      done += 1;
      onProgress?.(done, items.length);
    }
  }

  await Promise.all(Array.from({ length: pool }, () => runWorker()));
  return results;
}

function canvasAssetId(index: number) {
  return `canvas-asset-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function uploadOneCanvasAsset(params: {
  file: File;
  index: number;
  getSignedUploadUrl: SignedUrlMutation;
}): Promise<CanvasUploadedAsset> {
  const { file, index, getSignedUploadUrl } = params;
  const kind = file.type.startsWith("video/") ? "video" : "image";
  const safeName = file.name.replace(/[^a-z0-9._-]/gi, "-");
  const mimeType = file.type || (kind === "video" ? "video/mp4" : "image/png");

  const signed = await getSignedUploadUrl({
    fileName: file.name,
    mimeType,
    objectName: `canvas/${kind}/${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}-${safeName}`,
  });

  await uploadFileToSignedUrl({
    file,
    uploadUrl: signed.uploadUrl,
    headers: signed.requiredHeaders,
  });

  if (!signed.gcsUri) throw new Error(`上传失败：${file.name}`);

  const readUrl = await resolveOmniMaterialUrl(signed.gcsUri);
  const previewUrl = kind === "image" ? URL.createObjectURL(file) : readUrl;

  return {
    id: canvasAssetId(index),
    url: readUrl,
    previewUrl,
    fileName: file.name,
    gcsUri: signed.gcsUri,
  };
}

export type CanvasBatchUploadResult = {
  assets: CanvasUploadedAsset[];
  failed: Array<{ fileName: string; error: string }>;
};

export async function uploadCanvasFilesParallel(params: {
  files: File[];
  getSignedUploadUrl: SignedUrlMutation;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<CanvasBatchUploadResult> {
  const { files, getSignedUploadUrl, concurrency = CANVAS_UPLOAD_CONCURRENCY, onProgress } = params;
  const settled = await mapWithConcurrency(
    files,
    concurrency,
    async (file, index) => {
      try {
        const asset = await uploadOneCanvasAsset({ file, index, getSignedUploadUrl });
        return { ok: true as const, asset };
      } catch (e: unknown) {
        return {
          ok: false as const,
          fileName: file.name,
          error: e instanceof Error ? e.message : "上传失败",
        };
      }
    },
    onProgress,
  );

  const assets: CanvasUploadedAsset[] = [];
  const failed: Array<{ fileName: string; error: string }> = [];
  for (const row of settled) {
    if (row.ok) assets.push(row.asset);
    else failed.push({ fileName: row.fileName, error: row.error });
  }
  return { assets, failed };
}
