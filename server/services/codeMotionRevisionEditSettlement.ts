import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CanvasVideoTaskRecord } from "./canvasVideoTask";
import type { CodeMotionRevisionPrice } from "./codeMotionRevisionPricing";
import { codeMotionStorage } from "./codeMotionStore";
import { codeMotionProductionDigest } from "./codeMotionProductionGrant";
import {
  inspectCodeMotionEditVideo,
  editVideoCost,
} from "./codeMotionRevisionEdit";
import { runMediaTool } from "./postProduction";
import { codeMotionVideoDurationMatches } from "./codeMotionVideoDuration";
import { codeMotionVideoAssetSchema } from "../../shared/codeMotionVideo";
import { getGcsBucketName, uploadBufferToGcsIfAbsent } from "./gcs";
import { registerCanvasMediaOwner } from "./canvasMediaOwnership";

/** Measured published-rate settlement, not a claim of provider-account/invoice debit. */
export async function settleCodeMotionVideoEdit(
  task: CanvasVideoTaskRecord,
  quote: CodeMotionRevisionPrice,
  rawReceipt: string,
  outputVideoUrl?: string
) {
  const slot = task.inkProduction!,
    source = quote.shot.editSource!;
  if (
    !task.evolinkTaskId ||
    task.engine !==
      (quote.shot.version === "2.0"
        ? "seedance20-evolink"
        : "seedance25-evolink")
  )
    throw Error("编辑实际通道与确认合同不一致");
  const base = `code-motion/u${task.userId}/production/${slot.projectId}/video-evidence/${slot.index}/`;
  const name = `${base}cost-settlement.json`,
    old = await codeMotionStorage.read(name);
  if (old) {
    const prior = JSON.parse(old.body.toString());
    if (
      prior.taskId !== task.taskId ||
      prior.quoteFingerprint !== quote.fingerprint ||
      prior.creditsReserved !== task.creditsCharged
    )
      throw Error("编辑结算身份不一致");
    return;
  }
  let measurement;
  const measured = await codeMotionStorage.read(
    `${base}edit-output-measurement.json`
  );
  if (measured) measurement = JSON.parse(measured.body.toString());
  else {
    if (!outputVideoUrl) throw Error("编辑原始产物尚未归档，费用待核对");
    measurement = {
      taskId: task.taskId,
      providerTaskId: task.evolinkTaskId,
      videoUrl: outputVideoUrl,
      ...(await inspectCodeMotionEditVideo(outputVideoUrl)),
    };
    try {
      await codeMotionStorage.write(
        `${base}edit-output-measurement.json`,
        Buffer.from(JSON.stringify(measurement)),
        "0"
      );
    } catch (error) {
      if (
        !(await codeMotionStorage.read(`${base}edit-output-measurement.json`))
      )
        throw error;
      return settleCodeMotionVideoEdit(task, quote, rawReceipt, outputVideoUrl);
    }
  }
  if (
    measurement.taskId !== task.taskId ||
    measurement.providerTaskId !== task.evolinkTaskId ||
    !Number.isFinite(measurement.duration) || measurement.duration <= 0
  )
    throw Error("编辑产物测量回执不一致");
  const free = quote.shot.version === "2.0";
  const actual = free
    ? {
        credits: 0,
        costUsd: null,
        billableInputSeconds: source.inputDuration,
        billableOutputSeconds: measurement.duration,
      }
    : editVideoCost(source.inputDuration, measurement.duration);
  const pendingCost = actual.credits > task.creditsCharged;
  const delta = Math.max(0, task.creditsCharged - actual.credits);
  const refundKey = `ink-edit-delta/${task.taskId}`;
  if (task.creditsCharged > 0) {
    const { readActiveJob, markSettlementPending } = await import(
      "./paidJobLedger"
    );
    const hold = await readActiveJob(task.taskId, "canvasVideo");
    if (!hold || ["refunded", "refund_pending"].includes(hold.status))
      throw Error("原扣款账本状态需核对，未退差额或标记结算");
    if (!(await markSettlementPending(task.taskId, "canvasVideo")))
      throw Error("成功账本尚未封存，不退差额");
    const sealed = await readActiveJob(task.taskId, "canvasVideo");
    if (!sealed || !["settled", "settlement_pending"].includes(sealed.status))
      throw Error("成功账本状态未确认");
  }
  if (delta > 0) {
    if (!task.deduct) throw Error("差额退款缺少原扣款来源，保留待结算");
    const { refundCreditsForDeductAmount } = await import("../credits");
    await refundCreditsForDeductAmount(
      task.userId,
      `原片编辑实际用量差额 [${refundKey}]`,
      {
        ...task.deduct,
        success: true,
        cost: delta,
        remainingBalance: -1,
      } as Parameters<typeof refundCreditsForDeductAmount>[2],
      task.label,
      { refundKey }
    );
  }
  const receipt = {
    version: 1,
    taskId: task.taskId,
    providerTaskId: task.evolinkTaskId,
    provider: "evolink",
    mode: quote.shot.mode,
    quoteFingerprint: quote.fingerprint,
    basis: quote.basis,
    rate: quote.rate,
    inputSha256: source.asset.sha256,
    providerInputSha256: source.providerReference?.sha256 ?? source.asset.sha256,
    inputNormalization: source.providerReference ?? null,
    inputDuration: source.inputDuration,
    outputSha256: measurement.sha256,
    measuredOutputSeconds: measurement.duration,
    ...actual,
    creditsReserved: task.creditsCharged,
    creditsRefunded: delta,
    creditsCharged: task.creditsCharged - delta,
    creditsRequiredByMeasuredUnits: actual.credits,
    refundKey: delta ? refundKey : null,
    providerReceiptSha256: codeMotionProductionDigest(rawReceipt),
    status: free ? "free_allowance" : pendingCost ? "pending_cost" : "settled",
    providerDebitVerified: false,
  };
  const body = Buffer.from(JSON.stringify(receipt));
  try {
    await codeMotionStorage.write(name, body, "0");
  } catch (error) {
    const winner = await codeMotionStorage.read(name);
    if (!winner || !winner.body.equals(body)) throw error;
  }
}

/** Preserve raw media; the formal adoption path holds the last real frame to the nominal timeline. */
export async function adoptCodeMotionEditedVideo(
  userId: string,
  projectId: string,
  taskId: string,
  rawUri: string,
  file: string,
  duration: number,
  target: number,
  dir: string
) {
  if (!Number.isFinite(duration) || duration <= 0)
    throw Error("编辑片缺少有效视频时长，未采用");
  const rawBytes = await readFile(file),
    rawSha256 = createHash("sha256").update(rawBytes).digest("hex");
  let videoUri = rawUri,
    sha256 = rawSha256;
  const heldSeconds = Math.max(0, target - duration);
  if (duration < target - 0.001) {
    const normalized = path.join(dir, "edit-hold.mp4"),
      signal = AbortSignal.timeout(120000);
    await runMediaTool(
      "ffmpeg",
      [
        "-y",
        "-nostdin",
        "-i",
        file,
        "-map",
        "0:v:0",
        "-an",
        "-vf",
        `tpad=stop_mode=clone:stop_duration=${heldSeconds},fps=30,trim=duration=${target},setpts=PTS-STARTPTS`,
        "-frames:v",
        String(Math.round(target * 30)),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        normalized,
      ],
      signal
    );
    const probe = JSON.parse(
      (
        await runMediaTool(
          "ffprobe",
          [
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            normalized,
          ],
          signal
        )
      ).stdout
    );
    const stream = probe.streams?.find(
      (s: { codec_type: string }) => s.codec_type === "video"
    );
    if (
      !stream ||
      !codeMotionVideoDurationMatches(
        Number(stream.duration ?? probe.format?.duration),
        target
      )
    )
      throw Error("编辑片末帧补足未通过时长验证");
    const bytes = await readFile(normalized);
    sha256 = createHash("sha256").update(bytes).digest("hex");
    const objectName = `post-prod/${userId}/code-motion/${projectId}/edited-video/${sha256}.mp4`;
    await uploadBufferToGcsIfAbsent({
      objectName,
      buffer: bytes,
      contentType: "video/mp4",
      signal,
    });
    const owner = await registerCanvasMediaOwner({
      objectPath: objectName,
      ownerUserId: Number(userId),
      source: "code-motion-video-edit",
    });
    if (owner !== "created" && owner !== "alreadyOwned")
      throw Error("编辑产物归属尚未登记");
    videoUri = `gs://${getGcsBucketName()}/${objectName}`;
  }
  const asset = codeMotionVideoAssetSchema.parse({
    id: taskId,
    videoUri,
    sha256,
    durationSec: target,
  });
  const evidence = {
    taskId,
    rawUri,
    rawSha256,
    rawDuration: duration,
    normalizedUri: videoUri,
    normalizedSha256: sha256,
    nominalDuration: target,
    heldSeconds,
    method: heldSeconds > 0.001 ? "hold-last-frame" : "original",
    audio: "original-timeline-only",
  };
  const name = `code-motion/u${userId}/production/${projectId}/video-sources/${taskId}.edit.json`,
    body = Buffer.from(JSON.stringify(evidence));
  try {
    await codeMotionStorage.write(name, body, "0");
  } catch (error) {
    const prior = await codeMotionStorage.read(name);
    if (!prior || !prior.body.equals(body)) throw error;
  }
  return asset;
}
