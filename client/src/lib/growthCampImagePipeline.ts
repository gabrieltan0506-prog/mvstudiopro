import { createJob, pollJobUntilTerminal, type JobStatus } from "@/lib/jobs";
import type { GrowthAnalysisScores, GrowthCampModel } from "@shared/growth";
import { mergeGrowthAnalysesDeterministic } from "@shared/growth";
import {
  GROWTH_CAMP_JOB_MAX_WAIT_CAP_MS,
  resolveGrowthCampJobMaxWaitMs,
} from "@shared/growthCampJobTiming";

export { resolveGrowthCampJobMaxWaitMs, GROWTH_CAMP_JOB_MAX_WAIT_CAP_MS } from "@shared/growthCampJobTiming";

/** @deprecated 使用 resolveGrowthCampJobMaxWaitMs({ durationSeconds, assetKind, platformAssetLite }) */
export const GROWTH_CAMP_JOB_MAX_WAIT_MS = GROWTH_CAMP_JOB_MAX_WAIT_CAP_MS;
/** @deprecated 使用 resolveGrowthCampJobMaxWaitMs */
export const GROWTH_CAMP_PLATFORM_ASSET_MAX_WAIT_MS = 8 * 60_000;

export const GROWTH_CAMP_ANALYSIS_MODEL: GrowthCampModel = "gpt-5.5";

export const GROWTH_CAMP_IMAGE_PIPELINE_DEBUG_NOTE =
  "Phase1 全部 GCS 直传 → Phase2 growth_analyze_video / growth_analyze_images 入队分析";

export type GrowthCampAnalysisProgressUpdate = {
  percent: number;
  phase: "upload" | "video_analyze" | "image_analyze" | "merge" | "done";
  label: string;
  detail?: string;
};

export const GROWTH_ASSET_ANALYSIS_STATUS_MESSAGES = [
  "正在一次性上传全部素材到安全存储…",
  "上传完成，正在入队云端视觉分析…",
  "正在识别画面构图与色彩层次…",
  "正在分析镜头节奏与视觉钩子…",
  "正在提取传播潜力与商业承接点…",
  "正在生成视觉拆解与可执行选题…",
  "正在汇总多素材完整报告…",
] as const;

/** 上传阶段占整体进度 5–38% */
const UPLOAD_PROGRESS = { start: 5, end: 38 } as const;
/** 分析阶段占整体进度 38–92% */
const ANALYZE_PROGRESS = { start: 38, end: 92 } as const;

type GrowthCampUploadedVideo = {
  gcsUri: string;
  mimeType: string;
  fileName: string;
  durationSeconds?: number;
};

type GrowthCampUploadedImage = {
  gcsUri: string;
  mimeType: string;
  fileName: string;
};

function mapCombinedTrackPercent(
  track: { video: number; image: number },
  hasVideo: boolean,
  hasImages: boolean,
  range: ProgressRange,
): number {
  const parts: number[] = [];
  if (hasVideo) parts.push(track.video);
  if (hasImages) parts.push(track.image);
  const avg = parts.length ? parts.reduce((sum, v) => sum + v, 0) / parts.length : 100;
  return Math.round(range.start + (avg / 100) * (range.end - range.start));
}

type ProgressRange = { start: number; end: number };

function mapUploadPercent(uploadPct: number, range: ProgressRange): number {
  const slice = (range.end - range.start) * 0.22;
  return Math.round(range.start + (uploadPct / 100) * slice);
}

function mapPollPercent(elapsedMs: number, maxWaitMs: number, range: ProgressRange): number {
  const pollStart = range.start + (range.end - range.start) * 0.22;
  const pollEnd = range.end - (range.end - range.start) * 0.03;
  const ratio = Math.min(0.96, elapsedMs / Math.max(maxWaitMs, 1));
  return Math.round(pollStart + ratio * (pollEnd - pollStart));
}

export type PlatformVideoAsset = {
  id: string;
  file: File;
  fileName: string;
  mimeType: string;
  size: number;
  previewUrl: string | null;
  durationSeconds: number;
  ready: boolean;
  readError?: string;
};

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
  job?: {
    jobId?: string;
    status?: string;
    pollCount?: number;
    serverStatus?: string;
    elapsedMs?: number;
  };
  videoJob?: {
    jobId?: string;
    status?: string;
    pollCount?: number;
    serverStatus?: string;
    elapsedMs?: number;
  };
  imageJob?: {
    jobId?: string;
    status?: string;
    pollCount?: number;
    serverStatus?: string;
    elapsedMs?: number;
  };
  videoDispatch?: { route?: string; status?: string };
  imageDispatch?: { route?: string; status?: string };
  analysis?: {
    status?: string;
    provider?: unknown;
    model?: unknown;
    fallback?: unknown;
    imageCount?: number;
    error?: string;
  };
};

export function isGrowthCampImageFile(file: File): boolean {
  return /^image\/(png|jpeg|jpg)$/i.test(file.type) || /\.(png|jpe?g)$/i.test(file.name);
}

export function isGrowthCampVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.mp4$/i.test(file.name);
}

export async function extractVideoPreview(file: File): Promise<{ previewUrl: string; durationSeconds: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    let settled = false;
    let capturedDuration = 0;

    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onerror = null;
      URL.revokeObjectURL(url);
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };

    const done = (previewUrl: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ previewUrl, durationSeconds: capturedDuration });
    };

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    video.onerror = () => fail("视频读取失败，请重试");
    video.onloadedmetadata = () => {
      const targetTime = Math.min(
        Math.max(video.duration * 0.2, 0.15),
        Math.max(0.15, video.duration - 0.15),
      );
      if (!Number.isFinite(video.duration) || video.videoWidth <= 0 || video.videoHeight <= 0) {
        fail("视频元数据读取失败，请重试");
        return;
      }
      capturedDuration = Math.round(video.duration);
      if (targetTime <= 0.16) {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          fail("视频封面生成失败，请重试");
          return;
        }
        ctx.drawImage(video, 0, 0);
        done(canvas.toDataURL("image/jpeg", 0.9));
        return;
      }
      video.currentTime = targetTime;
    };
    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        fail("视频封面生成失败，请重试");
        return;
      }
      ctx.drawImage(video, 0, 0);
      done(canvas.toDataURL("image/jpeg", 0.9));
    };
    video.load();
  });
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
  onProgressUpdate?: (update: GrowthCampAnalysisProgressUpdate) => void;
  progressRange?: ProgressRange;
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

function growthCampPollHandler(
  jobId: string,
  onDebugUpdate: RunGrowthCampImageAnalysisParams["onDebugUpdate"],
  slot: "video" | "image" | "default" = "default",
): (tick: { status: JobStatus; elapsedMs: number; attempt: number }) => void {
  let pollCount = 0;
  return (tick) => {
    pollCount = tick.attempt;
    const jobPatch = {
      jobId,
      status: tick.status === "queued" ? "queued" : "polling",
      pollCount,
      serverStatus: tick.status,
      elapsedMs: tick.elapsedMs,
    };
    mergeDebug(onDebugUpdate, (prev) => {
      if (slot === "video") {
        return { ...prev, videoJob: jobPatch, job: jobPatch };
      }
      if (slot === "image") {
        return { ...prev, imageJob: jobPatch, job: jobPatch };
      }
      return { ...prev, job: jobPatch };
    });
  };
}

function growthQueuedLabel(elapsedMs: number, kind: "视频" | "图片") {
  const sec = Math.round(elapsedMs / 1000);
  if (sec >= 120) {
    return `${kind}分析排队中（已等 ${sec}s，专用 worker 繁忙；若超过 5 分钟请联系支持）`;
  }
  if (sec >= 45) {
    return `${kind}分析排队中（已等 ${sec}s，等待 Fly growth 专用 worker 认领）`;
  }
  return `${kind}分析排队中`;
}

/** 让 React 有机会在 onPartialResult 后立刻绘制「边分析边展示」UI */
async function yieldToUiPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
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
    onProgressUpdate,
    progressRange = { start: 0, end: 100 },
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
  onProgressUpdate?.({
    percent: progressRange.start,
    phase: "upload",
    label: "准备上传图片素材",
    detail: `共 ${assets.length} 张`,
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
          const overallUpload = Math.round(((ii + percent / 100) / assets.length) * 100);
          onProgressUpdate?.({
            percent: mapUploadPercent(overallUpload, progressRange),
            phase: "upload",
            label: `上传图片 ${ii + 1}/${assets.length}`,
            detail: `${overallUpload}%`,
          });
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
  onProgressUpdate?.({
    percent: mapUploadPercent(100, progressRange),
    phase: "image_analyze",
    label: "图片分析任务已入队",
    detail: "等待云端视觉引擎…",
  });

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
    imageDispatch: { route: "growth_analyze_images", status: "dispatched" },
    imageJob: { jobId, status: "queued", pollCount: 0 },
    job: { jobId, status: "queued", pollCount: 0 },
  }));

  const onGrowthPoll = growthCampPollHandler(jobId, onDebugUpdate, "image");
  const imageMaxWaitMs = resolveGrowthCampJobMaxWaitMs({ assetKind: "image" });
  const job = await pollJobUntilTerminal(jobId, {
    maxWaitMs: imageMaxWaitMs,
    onPoll: (tick) => {
      pollCount = tick.attempt;
      onGrowthPoll(tick);
      onProgressUpdate?.({
        percent: mapPollPercent(tick.elapsedMs, imageMaxWaitMs, progressRange),
        phase: "image_analyze",
        label: tick.status === "queued"
          ? growthQueuedLabel(tick.elapsedMs, "图片")
          : "图片视觉分析进行中",
        detail: `已等待 ${Math.round(tick.elapsedMs / 1000)} 秒 · ${tick.status}`,
      });
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

export type RunGrowthCampVideoAnalysisParams = {
  asset: PlatformVideoAsset;
  context?: string;
  userId?: string;
  modelName?: GrowthCampModel;
  mode?: "GROWTH" | "REMIX";
  getSignedUploadUrl: SignedUrlMutation;
  onUploadProgress?: (percent: number) => void;
  onProgressUpdate?: (update: GrowthCampAnalysisProgressUpdate) => void;
  progressRange?: ProgressRange;
  onDebugUpdate?: (patch: ImagePipelineDebugState | ((prev: ImagePipelineDebugState) => ImagePipelineDebugState)) => void;
};

export async function runGrowthCampVideoAnalysis(
  params: RunGrowthCampVideoAnalysisParams,
): Promise<GrowthCampImageAnalysisOutcome> {
  const {
    asset,
    context,
    userId,
    modelName = GROWTH_CAMP_ANALYSIS_MODEL,
    mode = "GROWTH",
    getSignedUploadUrl,
    onUploadProgress,
    onProgressUpdate,
    progressRange = { start: 0, end: 100 },
    onDebugUpdate,
  } = params;

  if (!asset.ready) {
    throw new Error("视频未就绪，请稍候或移除后重试");
  }

  mergeDebug(onDebugUpdate, {
    upload: { status: "uploading", progress: 0 },
    dispatch: { route: "growth_analyze_video", modelName, mode, status: "uploading" },
  });
  onProgressUpdate?.({
    percent: progressRange.start,
    phase: "upload",
    label: "准备上传参考视频",
    detail: asset.fileName,
  });

  const signed = await getSignedUploadUrl({
    fileName: asset.fileName || "video.mp4",
    mimeType: asset.mimeType || "video/mp4",
  });

  await uploadFileToSignedUrl({
    file: asset.file,
    uploadUrl: signed.uploadUrl,
    headers: signed.requiredHeaders,
    onProgress: (percent) => {
      onUploadProgress?.(percent);
      onProgressUpdate?.({
        percent: mapUploadPercent(percent, progressRange),
        phase: "upload",
        label: "上传参考视频",
        detail: `${percent}%`,
      });
      mergeDebug(onDebugUpdate, (prev) => ({
        ...prev,
        upload: { status: "uploading", progress: percent },
      }));
    },
  });

  if (!signed.gcsUri) {
    throw new Error("视频上传完成但未返回 GCS 地址");
  }

  mergeDebug(onDebugUpdate, (prev) => ({
    ...prev,
    upload: { status: "done", progress: 100 },
    dispatch: { route: "growth_analyze_video", modelName, mode, status: "creating_job" },
  }));
  onProgressUpdate?.({
    percent: mapUploadPercent(100, progressRange),
    phase: "video_analyze",
    label: "视频分析任务已入队",
    detail: "等待云端视觉引擎…",
  });

  const analysisRunId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const { jobId } = await createJob({
    type: "video",
    userId: userId ? String(userId) : "",
    input: {
      action: "growth_analyze_video",
      params: {
        gcsUri: signed.gcsUri,
        mimeType: asset.mimeType || "video/mp4",
        fileName: asset.fileName,
        context: context?.trim() || undefined,
        modelName,
        mode,
        analysisRunId,
        durationSeconds: asset.durationSeconds > 0 ? asset.durationSeconds : undefined,
      },
    },
  });

  let pollCount = 0;
  mergeDebug(onDebugUpdate, (prev) => ({
    ...prev,
    dispatch: { route: "growth_analyze_video", modelName, mode, status: "dispatched" },
    videoDispatch: { route: "growth_analyze_video", status: "dispatched" },
    videoJob: { jobId, status: "queued", pollCount: 0 },
    job: { jobId, status: "queued", pollCount: 0 },
  }));

  const onGrowthPoll = growthCampPollHandler(jobId, onDebugUpdate, "video");
  const videoMaxWaitMs = resolveGrowthCampJobMaxWaitMs({
    durationSeconds: asset.durationSeconds,
    platformAssetLite: false,
    assetKind: "video",
  });
  const job = await pollJobUntilTerminal(jobId, {
    maxWaitMs: videoMaxWaitMs,
    onPoll: (tick) => {
      pollCount = tick.attempt;
      onGrowthPoll(tick);
      onProgressUpdate?.({
        percent: mapPollPercent(tick.elapsedMs, videoMaxWaitMs, progressRange),
        phase: "video_analyze",
        label: tick.status === "queued"
          ? growthQueuedLabel(tick.elapsedMs, "视频")
          : "视频商业分析进行中",
        detail: `已等待 ${Math.round(tick.elapsedMs / 1000)} 秒 · ${tick.status}`,
      });
    },
  });

  if (job.status === "failed") {
    mergeDebug(onDebugUpdate, (prev) => ({
      ...prev,
      job: { jobId, status: "failed", pollCount },
      analysis: { status: "failed", error: String(job.error || "视频分析失败") },
    }));
    throw new Error(String(job.error || "视频分析失败"));
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
    },
  }));

  const analysis = job.output?.analysis as GrowthAnalysisScores | undefined;
  if (!analysis) {
    throw new Error("视频分析完成但未返回结果");
  }

  return { analysis, debug: jobDebug };
}

export type GrowthCampPartialAnalysis = {
  id: string;
  label: string;
  kind: "video" | "image";
  analysis: GrowthAnalysisScores;
};

async function uploadGrowthCampVideoAsset(params: {
  asset: PlatformVideoAsset;
  getSignedUploadUrl: SignedUrlMutation;
  onUploadProgress?: (percent: number) => void;
  onProgressUpdate?: (update: GrowthCampAnalysisProgressUpdate) => void;
  progressRange?: ProgressRange;
  onDebugUpdate?: RunGrowthCampVideoAnalysisParams["onDebugUpdate"];
}): Promise<GrowthCampUploadedVideo> {
  const { asset, getSignedUploadUrl, onUploadProgress, onProgressUpdate, progressRange = UPLOAD_PROGRESS, onDebugUpdate } =
    params;

  mergeDebug(onDebugUpdate, {
    upload: { status: "uploading", progress: 0 },
    dispatch: { route: "growth_analyze_video", status: "uploading" },
  });

  const signed = await getSignedUploadUrl({
    fileName: asset.fileName || "video.mp4",
    mimeType: asset.mimeType || "video/mp4",
  });

  await uploadFileToSignedUrl({
    file: asset.file,
    uploadUrl: signed.uploadUrl,
    headers: signed.requiredHeaders,
    onProgress: (percent) => {
      onUploadProgress?.(percent);
      onProgressUpdate?.({
        percent: mapUploadPercent(percent, progressRange),
        phase: "upload",
        label: "上传参考视频",
        detail: `${percent}% · ${asset.fileName}`,
      });
      mergeDebug(onDebugUpdate, (prev) => ({
        ...prev,
        upload: { status: "uploading", progress: percent },
      }));
    },
  });

  if (!signed.gcsUri) {
    throw new Error("视频上传完成但未返回地址");
  }

  mergeDebug(onDebugUpdate, (prev) => ({
    ...prev,
    upload: { status: "done", progress: 100 },
  }));

  onProgressUpdate?.({
    percent: progressRange.end,
    phase: "upload",
    label: "参考视频已上传",
    detail: asset.fileName,
  });

  return {
    gcsUri: signed.gcsUri,
    mimeType: asset.mimeType || "video/mp4",
    fileName: asset.fileName,
    durationSeconds: asset.durationSeconds > 0 ? asset.durationSeconds : undefined,
  };
}

async function uploadGrowthCampImageAssets(params: {
  assets: PlatformImageAsset[];
  getSignedUploadUrl: SignedUrlMutation;
  onUploadProgress?: (percent: number, assetIndex: number) => void;
  onProgressUpdate?: (update: GrowthCampAnalysisProgressUpdate) => void;
  progressRange?: ProgressRange;
  onDebugUpdate?: RunGrowthCampImageAnalysisParams["onDebugUpdate"];
}): Promise<GrowthCampUploadedImage[]> {
  const { assets, getSignedUploadUrl, onUploadProgress, onProgressUpdate, progressRange = UPLOAD_PROGRESS, onDebugUpdate } =
    params;

  const imageInputs: GrowthCampUploadedImage[] = [];
  const imageUploadRecords: ImageUploadRecord[] = assets.map((asset) => ({
    fileName: asset.fileName,
    status: "pending",
  }));

  mergeDebug(onDebugUpdate, {
    upload: { status: "uploading", progress: 0 },
    assets: imageUploadRecords,
  });

  onProgressUpdate?.({
    percent: progressRange.start,
    phase: "upload",
    label: "上传图片素材",
    detail: `共 ${assets.length} 张`,
  });

  for (let ii = 0; ii < assets.length; ii++) {
    const asset = assets[ii]!;
    const mime = normalizeGrowthCampImageMime(asset.file) || asset.mimeType;
    const safeName = asset.fileName.replace(/[^a-z0-9._-]/gi, "-").replace(/-{2,}/g, "-");
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
        const overallUpload = Math.round(((ii + percent / 100) / assets.length) * 100);
        onProgressUpdate?.({
          percent: mapUploadPercent(overallUpload, progressRange),
          phase: "upload",
          label: `上传图片 ${ii + 1}/${assets.length}`,
          detail: `${overallUpload}%`,
        });
      },
    });
    if (!signed.gcsUri) {
      throw new Error("图片上传完成但未返回 GCS 地址");
    }
    imageUploadRecords[ii] = { fileName: asset.fileName, gcsUri: signed.gcsUri, status: "done" };
    imageInputs.push({ gcsUri: signed.gcsUri, mimeType: mime, fileName: asset.fileName });
    mergeDebug(onDebugUpdate, (prev) => ({
      ...prev,
      upload: {
        status: ii + 1 >= assets.length ? "done" : "uploading",
        progress: Math.round(((ii + 1) / assets.length) * 100),
      },
      assets: [...imageUploadRecords],
    }));
  }

  onProgressUpdate?.({
    percent: progressRange.end,
    phase: "upload",
    label: "图片素材已上传",
    detail: `${assets.length} 张`,
  });

  return imageInputs;
}

async function dispatchGrowthCampVideoAnalysisJob(params: {
  uploaded: GrowthCampUploadedVideo;
  context?: string;
  userId?: string;
  modelName?: GrowthCampModel;
  mode?: "GROWTH" | "REMIX";
  progressRange?: ProgressRange;
  maxWaitMs?: number;
  platformAssetLite?: boolean;
  onProgressUpdate?: (update: GrowthCampAnalysisProgressUpdate) => void;
  onDebugUpdate?: RunGrowthCampVideoAnalysisParams["onDebugUpdate"];
}): Promise<GrowthCampImageAnalysisOutcome> {
  const {
    uploaded,
    context,
    userId,
    modelName = GROWTH_CAMP_ANALYSIS_MODEL,
    mode = "GROWTH",
    progressRange = { start: ANALYZE_PROGRESS.start, end: ANALYZE_PROGRESS.end },
    platformAssetLite = true,
    maxWaitMs = resolveGrowthCampJobMaxWaitMs({
      durationSeconds: uploaded.durationSeconds,
      platformAssetLite,
      assetKind: "video",
    }),
    onProgressUpdate,
    onDebugUpdate,
  } = params;

  mergeDebug(onDebugUpdate, (prev) => ({
    ...prev,
    dispatch: { route: "growth_analyze_video", modelName, mode, status: "creating_job" },
  }));
  onProgressUpdate?.({
    percent: progressRange.start,
    phase: "video_analyze",
    label: "视频分析任务已入队",
    detail: uploaded.fileName,
  });

  const analysisRunId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const { jobId } = await createJob({
    type: "video",
    userId: userId ? String(userId) : "",
    input: {
      action: "growth_analyze_video",
      params: {
        gcsUri: uploaded.gcsUri,
        mimeType: uploaded.mimeType,
        fileName: uploaded.fileName,
        context: context?.trim() || undefined,
        modelName,
        mode,
        analysisRunId,
        durationSeconds: uploaded.durationSeconds,
        platformAssetLite,
      },
    },
  });

  let pollCount = 0;
  mergeDebug(onDebugUpdate, (prev) => ({
    ...prev,
    dispatch: { route: "growth_analyze_video", modelName, mode, status: "dispatched" },
    videoDispatch: { route: "growth_analyze_video", status: "dispatched" },
    videoJob: { jobId, status: "queued", pollCount: 0 },
    job: { jobId, status: "queued", pollCount: 0 },
  }));

  const onGrowthPoll = growthCampPollHandler(jobId, onDebugUpdate, "video");
  const job = await pollJobUntilTerminal(jobId, {
    maxWaitMs,
    onPoll: (tick) => {
      pollCount = tick.attempt;
      onGrowthPoll(tick);
      onProgressUpdate?.({
        percent: mapPollPercent(tick.elapsedMs, maxWaitMs, progressRange),
        phase: "video_analyze",
        label: tick.status === "queued" ? growthQueuedLabel(tick.elapsedMs, "视频") : "视频视觉分析进行中",
        detail: `已等待 ${Math.round(tick.elapsedMs / 1000)} 秒 · ${tick.status}`,
      });
    },
  });

  if (job.status === "failed") {
    mergeDebug(onDebugUpdate, (prev) => ({
      ...prev,
      job: { jobId, status: "failed", pollCount },
      analysis: { status: "failed", error: String(job.error || "视频分析失败") },
    }));
    throw new Error(String(job.error || "视频分析失败"));
  }

  const jobDebug = (job.output?.debug as Record<string, unknown>) || {};
  const analysis = job.output?.analysis as GrowthAnalysisScores | undefined;
  if (!analysis) {
    throw new Error("视频分析完成但未返回结果");
  }

  mergeDebug(onDebugUpdate, (prev) => ({
    ...prev,
    job: { jobId, status: "completed", pollCount },
    analysis: {
      status: "completed",
      provider: jobDebug.provider,
      model: jobDebug.model,
      fallback: jobDebug.fallback,
    },
  }));

  return { analysis, debug: jobDebug };
}

async function dispatchGrowthCampImageAnalysisJob(params: {
  uploaded: GrowthCampUploadedImage[];
  context?: string;
  userId?: string;
  modelName?: GrowthCampModel;
  mode?: "GROWTH" | "REMIX";
  progressRange?: ProgressRange;
  maxWaitMs?: number;
  onProgressUpdate?: (update: GrowthCampAnalysisProgressUpdate) => void;
  onDebugUpdate?: RunGrowthCampImageAnalysisParams["onDebugUpdate"];
}): Promise<GrowthCampImageAnalysisOutcome> {
  const {
    uploaded,
    context,
    userId,
    modelName = GROWTH_CAMP_ANALYSIS_MODEL,
    mode = "GROWTH",
    progressRange = { start: ANALYZE_PROGRESS.start, end: ANALYZE_PROGRESS.end },
    maxWaitMs = resolveGrowthCampJobMaxWaitMs({ assetKind: "image" }),
    onProgressUpdate,
    onDebugUpdate,
  } = params;

  mergeDebug(onDebugUpdate, (prev) => ({
    ...prev,
    dispatch: { route: "growth_analyze_images", modelName, mode, status: "creating_job" },
  }));
  onProgressUpdate?.({
    percent: progressRange.start,
    phase: "image_analyze",
    label: "图片分析任务已入队",
    detail: `${uploaded.length} 张`,
  });

  const analysisRunId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const { jobId } = await createJob({
    type: "video",
    userId: userId ? String(userId) : "",
    input: {
      action: "growth_analyze_images",
      params: {
        images: uploaded,
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
    dispatch: { route: "growth_analyze_images", modelName, mode, status: "dispatched" },
    imageDispatch: { route: "growth_analyze_images", status: "dispatched" },
    imageJob: { jobId, status: "queued", pollCount: 0 },
    job: { jobId, status: "queued", pollCount: 0 },
  }));

  const onGrowthPoll = growthCampPollHandler(jobId, onDebugUpdate, "image");
  const job = await pollJobUntilTerminal(jobId, {
    maxWaitMs,
    onPoll: (tick) => {
      pollCount = tick.attempt;
      onGrowthPoll(tick);
      onProgressUpdate?.({
        percent: mapPollPercent(tick.elapsedMs, maxWaitMs, progressRange),
        phase: "image_analyze",
        label: tick.status === "queued" ? growthQueuedLabel(tick.elapsedMs, "图片") : "图片视觉分析进行中",
        detail: `已等待 ${Math.round(tick.elapsedMs / 1000)} 秒 · ${tick.status}`,
      });
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
  const analysis = job.output?.analysis as GrowthAnalysisScores | undefined;
  if (!analysis) {
    throw new Error("图片分析完成但未返回结果");
  }

  mergeDebug(onDebugUpdate, (prev) => ({
    ...prev,
    job: { jobId, status: "completed", pollCount },
    analysis: {
      status: "completed",
      provider: jobDebug.provider,
      model: jobDebug.model,
      fallback: jobDebug.fallback,
      imageCount: (jobDebug.imageCount as number | undefined) ?? uploaded.length,
    },
  }));

  return {
    analysis,
    debug: jobDebug,
    imageMeta: job.output?.imageMeta as GrowthCampImageAnalysisOutcome["imageMeta"],
  };
}

export type RunGrowthCampAssetAnalysisParams = {
  images: PlatformImageAsset[];
  video?: PlatformVideoAsset | null;
  context?: string;
  userId?: string;
  modelName?: GrowthCampModel;
  mode?: "GROWTH" | "REMIX";
  getSignedUploadUrl: SignedUrlMutation;
  /** 默认 fast：本地确定性合并，跳过第三轮 LLM */
  mergeStrategy?: "fast" | "llm";
  synthesizeParts?: (
    parts: Array<{ label: string; analysis: GrowthAnalysisScores }>,
  ) => Promise<GrowthAnalysisScores>;
  onUploadProgress?: (percent: number, assetIndex?: number) => void;
  onProgressUpdate?: (update: GrowthCampAnalysisProgressUpdate) => void;
  onPartialResult?: (partial: GrowthCampPartialAnalysis) => void;
  onDebugUpdate?: (patch: ImagePipelineDebugState | ((prev: ImagePipelineDebugState) => ImagePipelineDebugState)) => void;
};

export async function runGrowthCampAssetAnalysis(
  params: RunGrowthCampAssetAnalysisParams,
): Promise<GrowthCampImageAnalysisOutcome> {
  const {
    images,
    video,
    context,
    userId,
    modelName = GROWTH_CAMP_ANALYSIS_MODEL,
    mode = "GROWTH",
    getSignedUploadUrl,
    mergeStrategy = "fast",
    synthesizeParts,
    onUploadProgress,
    onProgressUpdate,
    onPartialResult,
    onDebugUpdate,
  } = params;

  const readyImages = images.filter((a) => a.ready);
  const hasVideo = Boolean(video?.ready);
  if (!hasVideo && readyImages.length === 0) {
    throw new Error("请先上传 PNG/JPG 图片或 MP4 参考视频");
  }

  const hasImages = readyImages.length > 0;
  const uploadTrack = { video: 0, image: 0 };
  const analyzeTrack = { video: 0, image: 0 };

  const emitUploadProgress = (label: string, detail?: string) => {
    onProgressUpdate?.({
      percent: mapCombinedTrackPercent(uploadTrack, hasVideo, hasImages, UPLOAD_PROGRESS),
      phase: "upload",
      label,
      detail,
    });
  };

  const emitAnalyzeProgress = (
    phase: "video_analyze" | "image_analyze",
    label: string,
    detail?: string,
  ) => {
    onProgressUpdate?.({
      percent: mapCombinedTrackPercent(analyzeTrack, hasVideo, hasImages, ANALYZE_PROGRESS),
      phase,
      label,
      detail,
    });
  };

  // ── Phase 1：一次性上传全部素材（与 creator-growth-camp 一致，不在分析阶段才传） ──
  onProgressUpdate?.({
    percent: UPLOAD_PROGRESS.start,
    phase: "upload",
    label: "正在上传全部素材",
    detail: [hasVideo ? "1 个视频" : null, hasImages ? `${readyImages.length} 张图片` : null]
      .filter(Boolean)
      .join(" · "),
  });

  let uploadedVideo: GrowthCampUploadedVideo | null = null;
  let uploadedImages: GrowthCampUploadedImage[] = [];

  const uploadTasks: Promise<void>[] = [];

  if (hasVideo && video) {
    uploadTasks.push(
      uploadGrowthCampVideoAsset({
        asset: video,
        getSignedUploadUrl,
        onUploadProgress: (percent) => {
          uploadTrack.video = percent;
          emitUploadProgress("上传参考视频", `${percent}%`);
          onUploadProgress?.(percent);
        },
        onProgressUpdate: (update) => {
          uploadTrack.video = update.percent;
          onProgressUpdate?.(update);
        },
        onDebugUpdate,
      }).then((result) => {
        uploadedVideo = result;
        uploadTrack.video = 100;
      }),
    );
  }

  if (hasImages) {
    uploadTasks.push(
      uploadGrowthCampImageAssets({
        assets: readyImages,
        getSignedUploadUrl,
        onUploadProgress: (percent, assetIndex) => {
          uploadTrack.image = percent;
          emitUploadProgress(`上传图片 ${assetIndex + 1}/${readyImages.length}`, `${percent}%`);
          onUploadProgress?.(percent, assetIndex);
        },
        onProgressUpdate: (update) => {
          uploadTrack.image = update.percent;
          onProgressUpdate?.(update);
        },
        onDebugUpdate,
      }).then((result) => {
        uploadedImages = result;
        uploadTrack.image = 100;
      }),
    );
  }

  await Promise.all(uploadTasks);

  onProgressUpdate?.({
    percent: UPLOAD_PROGRESS.end,
    phase: "upload",
    label: "全部素材已上传",
    detail: "开始云端视觉分析…",
  });

  // ── Phase 2：上传完成后再入队分析（视频与图片 Job 可并行） ──
  const partials: Array<{ label: string; analysis: GrowthAnalysisScores }> = [];
  const outcomes: GrowthCampImageAnalysisOutcome[] = [];

  const runVideoAnalyzeTask = async () => {
    if (!uploadedVideo || !video) return;
    analyzeTrack.video = ANALYZE_PROGRESS.start;
    emitAnalyzeProgress("video_analyze", "开始分析参考视频", video.fileName);

    const videoResult = await dispatchGrowthCampVideoAnalysisJob({
      uploaded: uploadedVideo,
      context,
      userId,
      modelName,
      mode,
      platformAssetLite: true,
      progressRange: { start: ANALYZE_PROGRESS.start, end: ANALYZE_PROGRESS.end },
      onProgressUpdate: (update) => {
        analyzeTrack.video = update.percent;
        emitAnalyzeProgress("video_analyze", update.label, update.detail);
      },
      onDebugUpdate,
    });

    const part = { label: video.fileName || "参考视频", analysis: videoResult.analysis };
    partials.push(part);
    outcomes.push(videoResult);
    onPartialResult?.({
      id: video.id,
      label: part.label,
      kind: "video",
      analysis: part.analysis,
    });
    await yieldToUiPaint();
    analyzeTrack.video = ANALYZE_PROGRESS.end;
    emitAnalyzeProgress("video_analyze", "视频分析完成", video.fileName);
  };

  const runImageAnalyzeTask = async () => {
    if (uploadedImages.length === 0) return;
    analyzeTrack.image = ANALYZE_PROGRESS.start;
    emitAnalyzeProgress("image_analyze", "开始分析图片素材", `${uploadedImages.length} 张`);

    const imageResult = await dispatchGrowthCampImageAnalysisJob({
      uploaded: uploadedImages,
      context,
      userId,
      modelName,
      mode,
      progressRange: { start: ANALYZE_PROGRESS.start, end: ANALYZE_PROGRESS.end },
      onProgressUpdate: (update) => {
        analyzeTrack.image = update.percent;
        emitAnalyzeProgress("image_analyze", update.label, update.detail);
      },
      onDebugUpdate,
    });

    const part = {
      label: readyImages.length === 1 ? readyImages[0]!.fileName || "图片" : `图片×${readyImages.length}`,
      analysis: imageResult.analysis,
    };
    partials.push(part);
    outcomes.push(imageResult);
    onPartialResult?.({
      id: readyImages[0]!.id,
      label: part.label,
      kind: "image",
      analysis: part.analysis,
    });
    await yieldToUiPaint();
    analyzeTrack.image = ANALYZE_PROGRESS.end;
    emitAnalyzeProgress("image_analyze", "图片分析完成", part.label);
  };

  const taskErrors: string[] = [];

  const runAnalyzeTasks = async () => {
    if (hasVideo && hasImages) {
      onProgressUpdate?.({
        percent: ANALYZE_PROGRESS.start,
        phase: "video_analyze",
        label: "上传已完成，视频与图片并行分析",
        detail: "哪份先完成就先展示先行摘要",
      });
      const [videoSettled, imageSettled] = await Promise.allSettled([
        runVideoAnalyzeTask(),
        runImageAnalyzeTask(),
      ]);
      if (videoSettled.status === "rejected") {
        taskErrors.push(
          videoSettled.reason instanceof Error ? videoSettled.reason.message : String(videoSettled.reason),
        );
      }
      if (imageSettled.status === "rejected") {
        taskErrors.push(
          imageSettled.reason instanceof Error ? imageSettled.reason.message : String(imageSettled.reason),
        );
      }
      return;
    }
    if (hasVideo) {
      try {
        await runVideoAnalyzeTask();
      } catch (err: unknown) {
        taskErrors.push(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    try {
      await runImageAnalyzeTask();
    } catch (err: unknown) {
      taskErrors.push(err instanceof Error ? err.message : String(err));
    }
  };

  await runAnalyzeTasks();

  if (partials.length === 0) {
    throw new Error(taskErrors[0] || "素材分析失败");
  }

  const partialFailureNote = taskErrors.length ? taskErrors.join("；") : undefined;
  const lastOutcome = outcomes[outcomes.length - 1]!;

  if (partials.length === 1) {
    onProgressUpdate?.({
      percent: 100,
      phase: "done",
      label: partialFailureNote ? "部分素材分析完成" : "素材视觉分析完成",
      detail: partialFailureNote,
    });
    return {
      ...lastOutcome,
      debug: {
        ...(lastOutcome.debug || {}),
        partialFailure: partialFailureNote,
      },
    };
  }

  onProgressUpdate?.({
    percent: 94,
    phase: "merge",
    label: mergeStrategy === "llm" ? "合并视频与图片分析结果" : "正在汇总完整报告",
    detail: `${partials.length} 份素材${partialFailureNote ? "（部分失败）" : ""}`,
  });

  const mergedAnalysis =
    mergeStrategy === "llm" && synthesizeParts
      ? await synthesizeParts(partials)
      : mergeGrowthAnalysesDeterministic(partials);

  onProgressUpdate?.({
    percent: 100,
    phase: "done",
    label: partialFailureNote ? "部分素材分析完成" : "素材视觉分析完成",
    detail: partialFailureNote,
  });

  return {
    analysis: mergedAnalysis,
    debug: {
      ...(lastOutcome.debug || {}),
      partialFailure: partialFailureNote,
    },
    imageMeta: lastOutcome.imageMeta,
  };
}
