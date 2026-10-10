import type { CodeMotionProject } from "../../shared/codeMotion";
import type { CodeMotionRevisionChange } from "../../shared/codeMotionRevision";
import {
  codeMotionProductionDigest,
  assertCodeMotionProductionSlot,
  type CodeMotionProductionSlot,
} from "./codeMotionProductionGrant";
import {
  planCodeMotionProductionVideo,
  type CodeMotionProductionVideoShot,
} from "./codeMotionProductionVideo";
import { codeMotionStorage } from "./codeMotionStore";
import { getCodeMotionRevisionPrice } from "./codeMotionRevision";
import type { CanvasVideoTaskRecord } from "./canvasVideoTask";

/** Official fixed-duration 720p contract. Provider credits are never platform credits. */
export const REVISION_VIDEO_RATE = Object.freeze({
  version: "evolink-seedance25-720p-2026-10-10",
  source: "https://evolink.ai/seedance-2-5",
  usdPerOutputSecond: 0.296,
  contentFilter: false,
  contentFilterMultiplier: 1.1,
  usdToCny: 7.2,
  cnyPerCredit: 0.65,
  markup: 2,
});
export type CodeMotionRevisionPrice = {
  fingerprint: string;
  rate: typeof REVISION_VIDEO_RATE;
  costUsd: number;
  credits: number;
  shot: CodeMotionProductionVideoShot;
  basis: "published_rate_fixed_units";
};
export function revisionVideoCost(duration: number) {
  if (!Number.isInteger(duration) || duration < 4 || duration > 5)
    throw new Error("动作修改仅支持4–5秒镜头");
  const costUsd = Number(
    (
      duration *
      REVISION_VIDEO_RATE.usdPerOutputSecond *
      REVISION_VIDEO_RATE.contentFilterMultiplier
    ).toFixed(8)
  );
  return {
    costUsd,
    credits: Math.ceil(
      (costUsd * REVISION_VIDEO_RATE.usdToCny * REVISION_VIDEO_RATE.markup) /
        REVISION_VIDEO_RATE.cnyPerCredit
    ),
  };
}
export async function priceCodeMotionRevision(
  project: CodeMotionProject,
  change: CodeMotionRevisionChange
): Promise<CodeMotionRevisionPrice> {
  const scene = project.plan?.scenes[change.index];
  if (!scene || !change.motionPrompt)
    throw new Error("请选择镜头并说明需要的动作");
  // Never silently omit the user's video reference or trigger an unquoted WaveSpeed upscale.
  if (scene.production?.referenceVideoIds?.length)
    throw new Error(
      "此镜包含视频参考：尚未纳入局部修改完整成本报价，未提交、未扣费；可使用已有图像和音轨的镜头"
    );
  const draft = structuredClone(project);
  draft.plan!.scenes[change.index] = {
    ...scene,
    heading: change.heading,
    body: change.body,
    production: {
      imagePrompt: scene.production?.imagePrompt || scene.heading,
      ...scene.production,
      motion: "natural",
      videoPrompt: change.motionPrompt,
    },
  };
  const shot = planCodeMotionProductionVideo(draft, "paid").find(
    s => s.sceneIndex === change.index
  )!;
  if (shot.missing.length) throw new Error(shot.missing.join("；"));
  const cost = revisionVideoCost(shot.duration);
  shot.credits = cost.credits;
  const value = {
    rate: REVISION_VIDEO_RATE,
    ...cost,
    shot,
    basis: "published_rate_fixed_units" as const,
  };
  return {
    ...value,
    fingerprint: codeMotionProductionDigest({
      projectId: project.id,
      ...value,
    }),
  };
}
export async function codeMotionRevisionCharge(
  userId: string,
  slot: CodeMotionProductionSlot
) {
  const grant = await assertCodeMotionProductionSlot(userId, slot);
  const quote = await getCodeMotionRevisionPrice(userId, slot.projectId);
  if (
    !quote ||
    grant.revision?.mode !== "paid_video" ||
    slot.kind !== "video" ||
    slot.index !== quote.shot.sceneIndex ||
    slot.digest !== codeMotionProductionDigest(quote.shot)
  )
    throw new Error("局部修改扣费缺少一致的已确认报价");
  if (
    quote.credits !== revisionVideoCost(quote.shot.duration).credits ||
    quote.shot.videoUrls.length
  )
    throw new Error("局部修改价格合同不一致");
  return quote.credits;
}
export async function persistCodeMotionRevisionTerminal(
  task: CanvasVideoTaskRecord,
  receipt: { status: number; body: string }
) {
  if (
    !task.inkProduction ||
    !(await getCodeMotionRevisionPrice(
      String(task.userId),
      task.inkProduction.projectId
    ))
  )
    return;
  const name = `code-motion/u${task.userId}/production/${task.inkProduction.projectId}/video-evidence/${task.inkProduction.index}/terminal-raw.json`;
  const value = Buffer.from(
    JSON.stringify({
      taskId: task.taskId,
      providerTaskId: task.evolinkTaskId,
      httpStatus: receipt.status,
      body: receipt.body,
    })
  );
  try {
    await codeMotionStorage.write(name, value, "0");
  } catch (error) {
    if (!(await codeMotionStorage.read(name))) throw error;
  }
}
export async function settleCodeMotionRevisionCost(
  task: CanvasVideoTaskRecord
) {
  const slot = task.inkProduction;
  if (!slot) return;
  const quote = await getCodeMotionRevisionPrice(
    String(task.userId),
    slot.projectId
  );
  if (!quote) return;
  const credits = await codeMotionRevisionCharge(String(task.userId), slot);
  if (task.creditsCharged !== credits || task.duration !== quote.shot.duration)
    throw new Error("局部修改结算金额不一致，保留任务待核对");
  const base = `code-motion/u${task.userId}/production/${slot.projectId}/video-evidence/${slot.index}/`;
  const raw =
    (await codeMotionStorage.read(`${base}terminal-raw.json`)) ||
    (await codeMotionStorage.read(`${base}submit-raw.json`));
  if (!raw) throw new Error("供应商成功回执尚未保存，保留任务待核对");
  const envelope = JSON.parse(raw.body.toString()),
    response =
      typeof envelope.body === "string" ? JSON.parse(envelope.body) : envelope;
  if (
    !["completed", "succeeded", "success"].includes(
      String(response.status || "").toLowerCase()
    ) ||
    (envelope.taskId && envelope.taskId !== task.taskId)
  )
    throw new Error("供应商回执尚未确认本任务成功，保留任务待核对");
  const receipt = {
    version: 1,
    taskId: task.taskId,
    providerTaskId: task.evolinkTaskId,
    quoteFingerprint: quote.fingerprint,
    basis: quote.basis,
    rate: quote.rate,
    acceptedOutputSeconds: task.duration,
    videoReferenceSeconds: 0,
    audioAdditionalUsd: 0,
    costUsd: quote.costUsd,
    markup: 2,
    creditsCharged: credits,
    providerReceiptSha256: codeMotionProductionDigest(raw.body.toString()),
    status: "settled",
  };
  const name = `${base}cost-settlement.json`,
    body = Buffer.from(JSON.stringify(receipt));
  try {
    await codeMotionStorage.write(name, body, "0");
  } catch (error) {
    const old = await codeMotionStorage.read(name);
    if (!old || !old.body.equals(body)) throw error;
  }
}
