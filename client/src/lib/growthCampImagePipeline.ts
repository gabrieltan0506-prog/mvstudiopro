import { createJob, pollJobUntilTerminal } from "@/lib/jobs";
import type { GrowthAnalysisScores, GrowthCampModel } from "@shared/growth";

export const GROWTH_CAMP_ANALYSIS_MODEL: GrowthCampModel = "gpt-5.5";

export const GROWTH_CAMP_IMAGE_PIPELINE_DEBUG_NOTE =
  "PNG/JPG GCS 直传 → growth_analyze_images Job → analyzeGrowthCampImagesJob（GPT-5.5 视觉 + 商业战略）";

export type PlatformImageAsset = {
  id: string;
  file: File;
  fileName: string;
  mimeType: string;
  size: number;
  previewUrl: string | null;
  ready: boolean;
  readError?: string;
};

export type ImageUploadRecord = {
  fileName: string;
  gcsUri?: string;
  status: string;
  error?: string;
};

export type ImagePipelineDebugState = {
  upload?: { status?: string; progress?: number };
  assets?: ImageUploadRecord[];
  dispatch?: {
    route?: string;
    modelName?: string;
    mode?: string;
    status?: string;
  };
  job?: { jobId?: string; status?: string; pollCount?: number };
  analysis?: {
    status?: string;
    provider?: unknown;
    model?: unknown;
    fallback?: unknown;
    primaryError?: string;
    imageCount?: number;
    error?: string;
  };
};

export function isGrowthCampImageFile(file: File): boolean {
  return /^image\/(png|jpeg|jpg)$/i.test(file.type) || /\.(png|jpe?g)$/i.test(file.name);
}

export function normalizeGrowthCampImageMime(file: File): "image/png" | "image/jpeg" | null {
  if (file.type === "image/png" || /\.png$/i.test(file.name)) return "image/png";
  if (/^image\/jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name)) return "image/jpeg";
  return null;
}

export function newPlatformImageAssetId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

export async function uploadFileToSignedUrl(params: {
  file: File;
  uploadUrl: string;
  headers?: Record<string, string>;
  onProgress: (percent: number) => void;
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", params.uploadUrl, true);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.max(1, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      params.onProgress(percent);
    };

    xhr.onerror = () => reject(new Error("GCS 直传失败，请检查网络后重试"));
    xhr.onabort = () => reject(new Error("GCS 直传已中断"));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(xhr.responseText || `GCS 直传失败 (${xhr.status})`));
        return;
      }
      resolve();
    };

    xhr.setRequestHeader("Content-Type", params.file.type || "application/octet-stream");
    for (const [key, value] of Object.entries(params.headers || {})) {
      if (!value) continue;
      xhr.setRequestHeader(key, value);
    }
    xhr.send(params.file);
  });
}

type SignedUrlMutation = (input: {
  fileName: string;
  mimeType: string;
  objectName?: string;
}) => Promise<{
  uploadUrl: string;
  requiredHeaders?: Record<string, string>;
  gcsUri?: string;
}>;

export type RunGrowthCampImageAnalysisParams = {
  assets: PlatformImageAsset[];
  context?: string;
  userId?: string;
  modelName?: GrowthCampModel;
  mode?: "GROWTH" | "REMIX";
  getSignedUploadUrl: SignedUrlMutation;
  onUploadProgress?: (percent: number, assetIndex: number) => void;
  onDebugUpdate?: (patch: ImagePipelineDebugState | ((prev: ImagePipelineDebugState) => ImagePipelineDebugState)) => void;
};

export type GrowthCampImageAnalysisOutcome = {
  analysis: GrowthAnalysisScores;
  debug: Record<string, unknown>;
  imageMeta?: {
    fileUrls?: string[];
    imageCount?: number;
    provider?: string;
    model?: string;
    fallback?: boolean;
  };
};

function mergeDebug(
  onDebugUpdate: RunGrowthCampImageAnalysisParams["onDebugUpdate"],
  patch: ImagePipelineDebugState | ((prev: ImagePipelineDebugState) => ImagePipelineDebugState),
) {
  onDebugUpdate?.(patch);
}

export async function runGrowthCampImageAnalysis(
  params: RunGrowthCampImageAnalysisParams,
): Promise<GrowthCampImageAnalysisOutcome> {
  const {
    assets,
    context,
    userId,
    modelName = GROWTH_CAMP_ANALYSIS_MODEL,
    mode = "GROWTH",
    getSignedUploadUrl,
    onUploadProgress,
    onDebugUpdate,
  } = params;

  if (!assets.length) {
    throw new Error("请先上传 PNG 或 JPG 图片");
  }
  if (assets.some((a) => !a.ready)) {
    throw new Error("仍有图片未就绪，请稍候或移除失败项后重试");
  }

  const imageInputs: Array<{ gcsUri: string; mimeType: string; fileName: string }> = [];
  const imageUploadRecords: ImageUploadRecord[] = assets.map((asset) => ({
    fileName: asset.fileName,
    status: "pending",
  }));

  mergeDebug(onDebugUpdate, {
    upload: { status: "uploading", progress: 0 },
    assets: imageUploadRecords,
  });

  for (let ii = 0; ii < assets.length; ii++) {
    const asset = assets[ii]!;
    const mime = normalizeGrowthCampImageMime(asset.file) || asset.mimeType;
    const safeName = asset.fileName.replace(/[^a-z0-9._-]/gi, "-").replace(/-{2,}/g, "-");
    try {
      const signed = await getSignedUploadUrl({
        fileName: asset.fileName,
        mimeType: mime,
        objectName: `growth-camp/images/${Date.now()}-${ii}-${safeName}`,
      });
      await uploadFileToSignedUrl({
        file: asset.file,
        uploadUrl: signed.uploadUrl,
        headers: signed.requiredHeaders,
        onProgress: (percent) => {
          onUploadProgress?.(percent, ii);
          mergeDebug(onDebugUpdate, (prev) => ({
            ...prev,
            upload: { status: "uploading", progress: percent },
          }));
        },
      });
      if (!signed.gcsUri) {
        throw new Error("图片上传完成但未返回 GCS 地址");
      }
      imageUploadRecords[ii] = {
        fileName: asset.fileName,
        gcsUri: signed.gcsUri,
        status: "done",
      };
      imageInputs.push({
        gcsUri: signed.gcsUri,
        mimeType: mime,
        fileName: asset.fileName,
      });
      mergeDebug(onDebugUpdate, (prev) => ({
        ...prev,
        upload: {
          status: ii + 1 >= assets.length ? "done" : "uploading",
          progress: Math.round(((ii + 1) / assets.length) * 100),
        },
        assets: [...imageUploadRecords],
      }));
    } catch (uploadError: unknown) {
      imageUploadRecords[ii] = {
        fileName: asset.fileName,
        status: "failed",
        error: uploadError instanceof Error ? uploadError.message : String(uploadError),
      };
      mergeDebug(onDebugUpdate, (prev) => ({
        ...prev,
        upload: { status: "failed", progress: Math.round((ii / assets.length) * 100) },
        assets: [...imageUploadRecords],
      }));
      throw uploadError;
    }
  }

  const analysisRunId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  mergeDebug(onDebugUpdate, (prev) => ({
    ...prev,
    dispatch: {
      route: "growth_analyze_images",
      modelName,
      mode,
      status: "creating_job",
    },
  }));

  const { jobId } = await createJob({
    type: "video",
    userId: userId ? String(userId) : "",
    input: {
      action: "growth_analyze_images",
      params: {
        images: imageInputs,
        context: context?.trim() || undefined,
        modelName,
        mode,
        analysisRunId,
      },
    },
  });

  let pollCount = 0;
  mergeDebug(onDebugUpdate, (prev) => ({
    ...prev,
    dispatch: {
      route: "growth_analyze_images",
      modelName,
      mode,
      status: "dispatched",
    },
    job: { jobId, status: "queued", pollCount: 0 },
  }));

  const job = await pollJobUntilTerminal(jobId, {
    maxWaitMs: 12 * 60_000,
    onPoll: () => {
      pollCount += 1;
      mergeDebug(onDebugUpdate, (prev) => ({
        ...prev,
        job: { jobId, status: "polling", pollCount },
      }));
    },
  });

  if (job.status === "failed") {
    mergeDebug(onDebugUpdate, (prev) => ({
      ...prev,
      job: { jobId, status: "failed", pollCount },
      analysis: { status: "failed", error: String(job.error || "图片分析失败") },
    }));
    throw new Error(String(job.error || "图片分析失败"));
  }

  const jobDebug = (job.output?.debug as Record<string, unknown>) || {};
  mergeDebug(onDebugUpdate, (prev) => ({
    ...prev,
    job: { jobId, status: "completed", pollCount },
    analysis: {
      status: "completed",
      provider: jobDebug.provider,
      model: jobDebug.model,
      fallback: jobDebug.fallback,
      primaryError: typeof jobDebug.primaryError === "string" ? jobDebug.primaryError : undefined,
      imageCount: (jobDebug.imageCount as number | undefined) ?? imageInputs.length,
    },
  }));

  const analysis = job.output?.analysis as GrowthAnalysisScores | undefined;
  if (!analysis) {
    throw new Error("图片分析完成但未返回结果");
  }

  return {
    analysis,
    debug: jobDebug,
    imageMeta: job.output?.imageMeta as GrowthCampImageAnalysisOutcome["imageMeta"],
  };
}
