import { assertCodeMotionProductionSlot, type CodeMotionProductionSlot } from "./codeMotionProductionGrant";
import { TRPCError } from "@trpc/server";
import {
  createJob as createJobRecord,
  getJobByIdStrict,
  listManhuaBgmJobsForUser,
} from "../jobs/repository";
import {
  manhuaBgmBriefSchema,
  buildManhuaBgmJobInput,
  isSameManhuaBgmSubmission,
  type ManhuaBgmBriefPayload,
} from "../jobs/manhuaBgmJobInput";
import { isBgmV6Model } from "../../shared/manhuaBgmBrief";
import { isTtapiSunoReady } from "./ttapiSunoMusic";
import { signGsUriV4ReadUrl } from "./gcs";

export function buildManhuaBgmJobResponse(
  job: Awaited<ReturnType<typeof listManhuaBgmJobsForUser>>[number]
) {
  const rawInput =
    job.input && typeof job.input === "object" && !Array.isArray(job.input)
      ? (job.input as Record<string, unknown>)
      : {};
  const params =
    rawInput.params &&
    typeof rawInput.params === "object" &&
    !Array.isArray(rawInput.params)
      ? (rawInput.params as Record<string, unknown>)
      : {};
  const brief = manhuaBgmBriefSchema.safeParse(params.brief);
  const rawOutput =
    job.output && typeof job.output === "object" && !Array.isArray(job.output)
      ? (job.output as Record<string, unknown>)
      : {};
  const terminal =
    rawOutput.terminalOutput &&
    typeof rawOutput.terminalOutput === "object" &&
    !Array.isArray(rawOutput.terminalOutput)
      ? (rawOutput.terminalOutput as Record<string, unknown>)
      : rawOutput;
  const variants = Array.isArray(terminal.variants)
    ? terminal.variants.flatMap(rawVariant => {
        if (
          !rawVariant ||
          typeof rawVariant !== "object" ||
          Array.isArray(rawVariant)
        )
          return [];
        const variant = rawVariant as Record<string, unknown>;
        const gcsUri = String(variant.gcsUri || "").trim();
        const index = Number(variant.index);
        if (
          !gcsUri.startsWith("gs://") ||
          !Number.isInteger(index) ||
          index < 0
        )
          return [];
        return [
          {
            index,
            gcsUri,
            previewUrl: signGsUriV4ReadUrl(gcsUri, 24 * 3600),
            bytes: Math.max(0, Number(variant.bytes) || 0),
            durationSec:
              Number(variant.durationSec) > 0
                ? Number(variant.durationSec)
                : null,
            sha256: typeof variant.sha256 === "string" ? variant.sha256 : null,
            musicId:
              typeof variant.musicId === "string" ? variant.musicId : null,
            structure:
              variant.structure &&
              typeof variant.structure === "object" &&
              !Array.isArray(variant.structure)
                ? variant.structure
                : null,
          },
        ];
      })
    : [];
  return {
    jobId: job.id,
    status: job.status,
    error: job.error,
    titleZh: brief.success ? brief.data.title : "漫剧配乐",
    durationSec: brief.success ? brief.data.duration : 0,
    briefDigest: String(params.briefDigest || terminal.briefDigest || ""),
    missingVariants:
      Number.isSafeInteger(terminal.missingVariants) &&
      Number(terminal.missingVariants) > 0
        ? Number(terminal.missingVariants)
        : 0,
    variants,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

/** 共用正式Suno領單：保留原任務身份、歸屬及內容一致性檢查。 */
export async function queueManhuaBgm(
  userId: string,
  input: { billingRequestId: string; brief: ManhuaBgmBriefPayload; productionSlot?: CodeMotionProductionSlot }
) {
  const v6Model = isBgmV6Model(input.brief.model);
  if (!v6Model) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Suno v5.5 已下架，请改选 v6",
    });
  }
  if (!isTtapiSunoReady()) {
    // 没有兜底：用户拍板不拿 v5.5 当次货兜底，通道没配就明说
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Suno v6 通道未配置（TTAPI_KEY），请联系管理员",
    });
  }
  const jobInput = buildManhuaBgmJobInput(input);
  if (input.productionSlot) {
    const slot = input.productionSlot;
    if (slot.kind !== "bgm" || slot.requestId !== input.billingRequestId || slot.digest !== jobInput.params.briefDigest) throw new Error("制作步骤与配乐内容不一致");
    await assertCodeMotionProductionSlot(userId, slot);
  }
  const jobId = `bgm_${input.billingRequestId.replace(/-/g, "")}`;
  try {
    await createJobRecord({
      id: jobId,
      userId: userId,
      type: "audio",
      provider: `ttapi:${input.brief.model}`,
      input: jobInput,
    });
  } catch (error) {
    const existing = await getJobByIdStrict(jobId).catch(() => null);
    if (
      !existing ||
      existing.type !== "audio" ||
      String(existing.userId) !== userId ||
      !isSameManhuaBgmSubmission(existing.input, jobInput)
    ) {
      console.error("[manhua-bgm] create job failed:", error);
      throw new TRPCError({
        code: "CONFLICT",
        message: "本次配乐确认未能建立，请刷新后重新确认",
      });
    }
    return buildManhuaBgmJobResponse(existing);
  }
  const created = await getJobByIdStrict(jobId);
  if (!created) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "配乐任务写入后无法读取",
    });
  }
  return buildManhuaBgmJobResponse(created);
}
