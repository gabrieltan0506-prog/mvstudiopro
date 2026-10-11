import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CodeMotionProject } from "../../shared/codeMotion";
import type { CodeMotionRevisionChange } from "../../shared/codeMotionRevision";
import type { CodeMotionVideo } from "../../shared/codeMotionVideo";
import { fetchPostProdSourceToFile, runMediaTool } from "./postProduction";
import { codeMotionProductionDigest } from "./codeMotionProductionGrant";
import { codeMotionStorage, type CodeMotionStoreDeps } from "./codeMotionStore";
import { codeMotionVideoDurationMatches } from "./codeMotionVideoDuration";
import { MIN_REFERENCE_VIDEO_PIXELS } from "./seedanceReferenceVideoSize";
import { codeMotionProductionAudioFingerprint } from "./codeMotionProductionAudio";
import type { CodeMotionRevisionPrice } from "./codeMotionRevisionPricing";
import { prepareCodeMotionEditReference, type EditProviderReference } from "./codeMotionRevisionEditReference";
export type CodeMotionEditSource = {
  parentProjectId: string;
  asset: CodeMotionVideo["assets"][number];
  clip: CodeMotionVideo["clips"][number];
  width: number;
  height: number;
  inputDuration: number;
  rawDuration?: number;
  providerReference?: EditProviderReference;
};
export const REVISION_EDIT_RATE = Object.freeze({
  version: "evolink-seedance25-edit-720p-2026-10-10",
  source: "https://evolink.ai/seedance-2-5",
  usdPerInputOutputSecond: 0.18,
  contentFilter: false,
  contentFilterMultiplier: 1.1,
  usdToCny: 7.2,
  cnyPerCredit: 0.65,
  markup: 2,
});
export const FREE_REVISION_EDIT_RATE = Object.freeze({
  version: "evolink-seedance20-free-edit-2026-10-10",
  source:
    "https://evolink.ai/docs/en/api-manual/video-series/seedance2.0/seedance-2.0-reference-to-video",
  customerCredits: 0,
  providerCostVerified: false,
});
export function editVideoCost(inputDuration: number, outputDuration: number) {
  if (
    ![inputDuration, outputDuration].every(
      n => Number.isFinite(n) && n > 0
    )
  )
    throw Error("原片编辑缺少有效计费用量");
  const billableOutputSeconds = Math.ceil((outputDuration - 1e-8) * 10) / 10;
  const billableInputSeconds = Math.max(inputDuration, billableOutputSeconds);
  const costUsd = Number(
    (
      (billableInputSeconds + billableOutputSeconds) *
      REVISION_EDIT_RATE.usdPerInputOutputSecond *
      REVISION_EDIT_RATE.contentFilterMultiplier
    ).toFixed(8)
  );
  return {
    costUsd,
    credits: Math.ceil(
      (costUsd * REVISION_EDIT_RATE.usdToCny * 2) /
        REVISION_EDIT_RATE.cnyPerCredit
    ),
    billableInputSeconds,
    billableOutputSeconds,
  };
}
export async function inspectCodeMotionEditVideo(uri: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "ink-edit-inspect-"));
  try {
    const file = path.join(dir, "source.mp4"),
      signal = AbortSignal.timeout(90000);
    await fetchPostProdSourceToFile(uri, file, {
      signal,
      maxBytes: 150_000_000,
    });
    const bytes = await readFile(file);
    const raw = await runMediaTool(
      "ffprobe",
      ["-v", "error", "-show_format", "-show_streams", "-of", "json", file],
      signal
    );
    const data = JSON.parse(raw.stdout),
      stream = data.streams?.find(
        (s: { codec_type: string }) => s.codec_type === "video"
      );
    if (!stream) throw Error("原片缺少视频轨");
    return {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      duration: Number(stream.duration ?? data.format?.duration),
      width: Number(stream.width),
      height: Number(stream.height),
      raw: raw.stdout,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function priceCodeMotionVideoEdit(
  userId: string,
  project: CodeMotionProject,
  change: CodeMotionRevisionChange,
  tier: "free" | "paid",
  storage: CodeMotionStoreDeps = codeMotionStorage
): Promise<CodeMotionRevisionPrice> {
  const scene = project.plan?.scenes[change.index];
  if (
    !scene ||
    !change.motionPrompt ||
    !Number.isInteger(scene.duration) ||
    scene.duration < 4 ||
    scene.duration > 5
  )
    throw Error("原片修改仅支持一个4–5秒镜头");
  const at = project
    .plan!.scenes.slice(0, change.index)
    .reduce((n, s) => n + s.duration, 0);
  const clip = project.plan?.codeVideo?.clips.find(
    c =>
      Math.abs(c.at - at) < 1e-6 &&
      Math.abs(c.duration - scene.duration) < 1e-6 &&
      c.sourceStartSec === 0
  );
  const asset = project.plan?.codeVideo?.assets.find(
    a => a.id === clip?.assetId
  );
  if (!clip || !asset || asset.durationSec !== scene.duration)
    throw Error(
      "本镜尚无完整已采用原片；本次修改仅支持已有4–5秒原片，不会重新生成代替编辑"
    );
  const { assertCodeMotionProductionVideos } = await import(
    "./codeMotionProductionVideo"
  );
  await assertCodeMotionProductionVideos(
    userId,
    project.id,
    { version: 1, assets: [asset], clips: [clip] },
    storage
  );
  const probe = await inspectCodeMotionEditVideo(asset.videoUri);
  if (
    probe.sha256 !== asset.sha256 ||
    !codeMotionVideoDurationMatches(probe.duration, asset.durationSec)
  )
    throw Error("原片指纹或时长已变化，未占用修改次数");
  if (
    !Number.isSafeInteger(probe.width) ||
    !Number.isSafeInteger(probe.height) ||
    probe.width < 1 ||
    probe.height < 1
  )
    throw Error("原片尺寸无法确认");
  if (
    tier === "paid" &&
    probe.width * probe.height < MIN_REFERENCE_VIDEO_PIXELS
  )
    throw Error(
      "原片尺寸低于2.5编辑门槛；尚未报价高清放大，不提交或占用修改次数"
    );
  const providerReference = await prepareCodeMotionEditReference(userId, project.id, asset.videoUri, probe, scene.duration, tier, storage);
  const inputDuration = providerReference?.duration ?? probe.duration;
  const source: CodeMotionEditSource = {
    parentProjectId: project.id,
    asset,
    clip,
    width: probe.width,
    height: probe.height,
    inputDuration,
    rawDuration: probe.duration,
    ...(providerReference ? { providerReference } : {}),
  };
  const maximum = editVideoCost(
    inputDuration,
    Math.max(scene.duration, inputDuration)
  );
  const sourceIds = new Set(
    (project.plan?.audioTimeline || [])
      .filter(c => c.at < at + scene.duration && c.at + c.duration > at)
      .map(c => c.sourceId)
  );
  const audioUrls = (project.brief.audios || [])
    .filter(a => sourceIds.has(a.id))
    .map(a => a.gcsUri);
  const shot = {
    sceneIndex: change.index,
    at,
    duration: scene.duration,
    prompt: change.motionPrompt,
    model: tier === "paid" ? "seedance-2.5" : "seedance-2.0",
    version: tier === "paid" ? ("2.5" as const) : ("2.0" as const),
    resolution: tier === "paid" ? ("720p" as const) : ("480p" as const),
    mode:
      tier === "paid"
        ? ("video_edit" as const)
        : ("reference_to_video" as const),
    imageUrls: [],
    videoUrls: [providerReference?.videoUri ?? asset.videoUri],
    audioUrls,
    ...(audioUrls.length
      ? {
          audioFingerprint: codeMotionProductionAudioFingerprint(
            project,
            at,
            scene.duration
          ),
        }
      : {}),
    credits: tier === "paid" ? maximum.credits : 0,
    missing: [],
    editSource: source,
  };
  const value = {
    rate: tier === "paid" ? REVISION_EDIT_RATE : FREE_REVISION_EDIT_RATE,
    costUsd: tier === "paid" ? maximum.costUsd : 0,
    credits: shot.credits,
    shot,
    basis:
      tier === "paid"
        ? ("published_rate_measured_units" as const)
        : ("free_allowance" as const),
  };
  return {
    ...value,
    fingerprint: codeMotionProductionDigest({
      projectId: project.id,
      ...value,
    }),
  };
}
/** Re-read the immutable ledger source and its bytes before provider submission; no paid normalization. */
export async function verifyCodeMotionEditSource(
  userId: string,
  source: CodeMotionEditSource
) {
  const { assertCodeMotionProductionVideos } = await import(
    "./codeMotionProductionVideo"
  );
  await assertCodeMotionProductionVideos(userId, source.parentProjectId, {
    version: 1,
    assets: [source.asset],
    clips: [source.clip],
  });
  const probe = await inspectCodeMotionEditVideo(source.asset.videoUri);
  if (
    probe.sha256 !== source.asset.sha256 ||
    probe.duration !== (source.rawDuration ?? source.inputDuration) ||
    probe.width !== source.width ||
    probe.height !== source.height
  )
    throw Error("原片已变化，未提交编辑");
  if (source.providerReference) {
    const ref = source.providerReference, derived = await inspectCodeMotionEditVideo(ref.videoUri);
    if (ref.rawUri !== source.asset.videoUri || ref.rawSha256 !== probe.sha256 || ref.rawDuration !== probe.duration || derived.sha256 !== ref.sha256 || derived.duration !== source.inputDuration || derived.width !== ref.width || derived.height !== ref.height)
      throw Error("编辑参考片与已确认原片不一致，未提交编辑");
  }
  return probe;
}
