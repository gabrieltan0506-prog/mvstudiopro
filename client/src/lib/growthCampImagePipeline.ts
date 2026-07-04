import { createJob, pollJobUntilTerminal, type JobStatus } from "@/lib/jobs";
import type { GrowthAnalysisScores, GrowthCampModel } from "@shared/growth";
import { mergeGrowthAnalysesDeterministic } from "@shared/growth";

export const GROWTH_CAMP_ANALYSIS_MODEL: GrowthCampModel = "gpt-5.5";

export const GROWTH_CAMP_IMAGE_PIPELINE_DEBUG_NOTE =
  "PNG/JPG 或 MP4 GCS 直传 → growth_analyze_images / growth_analyze_video → 视觉与策略分析";

/** 单阶段（视频或图片 Job）客户端轮询上限；混传串行两阶段，总等待约为 2× */
export const GROWTH_CAMP_JOB_MAX_WAIT_MS = 20 * 60_000;

export type GrowthCampAnalysisProgressUpdate = {
  percent: number;
  phase: "upload" | "video_analyze" | "image_analyze" | "merge" | "done";
  label: string;
  detail?: string;
};

export const GROWTH_ASSET_ANALYSIS_STATUS_MESSAGES = [
  "正在上传素材到安全存储…",
  "正在识别画面构图与色彩层次…",
  "正在分析镜头节奏与视觉钩子…",
  "正在提取传播潜力与商业承接点…",
  "正在生成视觉拆解与可执行选题…",
  "正在合并多素材分析结果…",
] as const;

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
): (tick: { status: JobStatus; elapsedMs: number }) => void {
  let pollCount = 0;
  return (tick) => {
    pollCount += 1;
    mergeDebug(onDebugUpdate, (prev) => ({
      ...prev,
      job: {
        jobId,
        status: "polling",
        pollCount,
        serverStatus: tick.status,
        elapsedMs: tick.elapsedMs,
      },
    }));
  };
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
    phase: "image_analyze",
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
            phase: "image_analyze",
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
    job: { jobId, status: "queued", pollCount: 0 },
  }));

  const onGrowthPoll = growthCampPollHandler(jobId, onDebugUpdate);
  const job = await pollJobUntilTerminal(jobId, {
    maxWaitMs: GROWTH_CAMP_JOB_MAX_WAIT_MS,
    onPoll: (tick) => {
      pollCount = tick.attempt;
      onGrowthPoll(tick);
      onProgressUpdate?.({
        percent: mapPollPercent(tick.elapsedMs, GROWTH_CAMP_JOB_MAX_WAIT_MS, progressRange),
        phase: "image_analyze",
        label: tick.status === "queued" ? "图片分析排队中" : "图片视觉分析进行中",
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
    phase: "video_analyze",
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
        phase: "video_analyze",
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
    job: { jobId, status: "queued", pollCount: 0 },
  }));

  const onGrowthPoll = growthCampPollHandler(jobId, onDebugUpdate);
  const job = await pollJobUntilTerminal(jobId, {
    maxWaitMs: GROWTH_CAMP_JOB_MAX_WAIT_MS,
    onPoll: (tick) => {
      pollCount = tick.attempt;
      onGrowthPoll(tick);
      onProgressUpdate?.({
        percent: mapPollPercent(tick.elapsedMs, GROWTH_CAMP_JOB_MAX_WAIT_MS, progressRange),
        phase: "video_analyze",
        label: tick.status === "queued" ? "视频分析排队中" : "视频商业分析进行中",
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
  const runParallel = hasVideo && hasImages;
  const progressTrack = { video: 2, image: 2 };

  const emitCombinedProgress = (
    phase: GrowthCampAnalysisProgressUpdate["phase"],
    label: string,
    detail?: string,
  ) => {
    const percent = runParallel
      ? Math.round((progressTrack.video + progressTrack.image) / 2)
      : Math.max(progressTrack.video, progressTrack.image);
    onProgressUpdate?.({ percent, phase, label, detail });
  };

  const wrapProgress = (
    key: "video" | "image",
    range: ProgressRange,
    phase: GrowthCampAnalysisProgressUpdate["phase"],
  ) => ({
    progressRange: range,
    onProgressUpdate: (update: GrowthCampAnalysisProgressUpdate) => {
      progressTrack[key] = update.percent;
      emitCombinedProgress(phase, update.label, update.detail);
    },
  });

  const partials: Array<{ label: string; analysis: GrowthAnalysisScores }> = [];
  const outcomes: GrowthCampImageAnalysisOutcome[] = [];

  const runVideoTask = async () => {
    if (!hasVideo || !video) return;
    const range = runParallel ? { start: 2, end: 90 } : { start: 2, end: 92 };
    onProgressUpdate?.({
      percent: range.start,
      phase: "video_analyze",
      label: runParallel ? "并行分析参考视频" : "开始分析参考视频",
      detail: video.fileName,
    });
    const videoResult = await runGrowthCampVideoAnalysis({
      asset: video,
      context,
      userId,
      modelName,
      mode,
      getSignedUploadUrl,
      onUploadProgress: (percent) => onUploadProgress?.(percent),
      ...wrapProgress("video", range, "video_analyze"),
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
    progressTrack.video = range.end;
    emitCombinedProgress("video_analyze", "视频分析完成", video.fileName);
  };

  const runImageTask = async () => {
    if (readyImages.length === 0) return;
    const range = runParallel ? { start: 2, end: 90 } : { start: 2, end: 92 };
    onProgressUpdate?.({
      percent: range.start,
      phase: "image_analyze",
      label: runParallel ? "并行分析图片素材" : "开始分析图片素材",
      detail: `${readyImages.length} 张`,
    });
    mergeDebug(onDebugUpdate, (prev) => ({
      ...prev,
      dispatch: {
        route: "growth_analyze_images",
        modelName,
        mode,
        status: "starting",
      },
      job: undefined,
      analysis: undefined,
    }));
    const imageResult = await runGrowthCampImageAnalysis({
      assets: readyImages,
      context,
      userId,
      modelName,
      mode,
      getSignedUploadUrl,
      onUploadProgress: (percent, assetIndex) => onUploadProgress?.(percent, assetIndex),
      ...wrapProgress("image", range, "image_analyze"),
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
    progressTrack.image = range.end;
    emitCombinedProgress("image_analyze", "图片分析完成", part.label);
  };

  if (runParallel) {
    onProgressUpdate?.({
      percent: 2,
      phase: "video_analyze",
      label: "视频与图片并行分析中",
      detail: "哪份先完成就先展示结果",
    });
    await Promise.all([runVideoTask(), runImageTask()]);
  } else if (hasVideo) {
    await runVideoTask();
  } else {
    await runImageTask();
  }

  const lastOutcome = outcomes[outcomes.length - 1]!;

  if (partials.length === 1) {
    onProgressUpdate?.({
      percent: 100,
      phase: "done",
      label: "素材视觉分析完成",
    });
    return lastOutcome;
  }

  onProgressUpdate?.({
    percent: 94,
    phase: "merge",
    label: mergeStrategy === "llm" ? "合并视频与图片分析结果" : "正在汇总多素材结果",
    detail: `${partials.length} 份素材`,
  });

  const mergedAnalysis =
    mergeStrategy === "llm" && synthesizeParts
      ? await synthesizeParts(partials)
      : mergeGrowthAnalysesDeterministic(partials);

  onProgressUpdate?.({
    percent: 100,
    phase: "done",
    label: "素材视觉分析完成",
  });

  return {
    analysis: mergedAnalysis,
    debug: lastOutcome.debug || {},
    imageMeta: lastOutcome.imageMeta,
  };
}
