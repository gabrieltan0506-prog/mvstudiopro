import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getCredits } from "../credits";
import { cancelConversionJob, conversionAhead, enqueueConversionJob, freeConversionQuota, getConversionJob, listConversionJobs, type ConversionJob } from "../jobs/fileConversionRepository";
import { heavyWorkerSplitEnabled } from "../jobs/workerRole";
import { createGcsSignedUploadUrl, getGcsBucketName, inspectGcsObjectBounded, signGcsObjectPathV4ReadUrl, statGcsObjectVersion } from "../services/gcs";
import { conversionDay, fileConversionIpHash } from "../services/fileConversionIp";
import { assertConversionSource, conversionBilling, conversionSourcePrefix, FILE_CONVERSION_FORMATS, FILE_CONVERSION_PRICING, FILE_CONVERSION_FREE_MAX_BYTES, validateConversionFile, type FileConversionLane, type FileConversionRequest } from "../../shared/fileConversion";

const identity = z.object({ id: z.string().regex(/^conv_[a-f0-9]{59}$/) });
const laneSchema = z.enum(["free", "paid"]);
async function owned(id: string, userId: string) {
  const row = await getConversionJob(id);
  if (!row || row.userId !== userId || row.input.kind !== "file_conversion") throw new TRPCError({ code: "NOT_FOUND", message: "文件转换任务不存在" });
  return row;
}
async function view(row: ConversionJob) {
  return { id: row.id, status: row.status, phase: row.input.phase, lane: row.lane, formatId: row.input.formatId,
    fileName: row.input.source.fileName, updatedAt: row.updatedAt, ahead: await conversionAhead(row),
    result: row.status === "succeeded" ? row.output : undefined,
    error: row.status === "refund_pending" ? "转换未完成，积分退回处理中；请保留原任务，不要重复提交。" : row.status === "failed" ? row.error || "转换未完成，原文件保留；免费名额或积分将原路返还。" : undefined };
}
function validateLane(lane: FileConversionLane, bytes: number) {
  if (lane === "free" && bytes > FILE_CONVERSION_FREE_MAX_BYTES) throw new TRPCError({ code: "BAD_REQUEST", message: "免费转换每个原文件最多 3 MB，请选择付费转换。" });
  if (lane === "paid" && (!heavyWorkerSplitEnabled() || !FILE_CONVERSION_PRICING.standardCredits || !FILE_CONVERSION_PRICING.scanCreditsPerMb)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "付费转换费率尚未开放，不会扣除积分。" });
}
export const fileConversionRouter = router({
  formats: protectedProcedure.query(() => ({ formats: FILE_CONVERSION_FORMATS, available: true,
    paidAvailable: heavyWorkerSplitEnabled() && !!FILE_CONVERSION_PRICING.standardCredits && !!FILE_CONVERSION_PRICING.scanCreditsPerMb,
    pricing: FILE_CONVERSION_PRICING, freeMaxBytes: FILE_CONVERSION_FREE_MAX_BYTES })),
  quota: protectedProcedure.query(async ({ ctx }) => { const day = conversionDay(); return freeConversionQuota(String(ctx.user.id), fileConversionIpHash(ctx.req, day), day); }),
  upload: protectedProcedure.input(z.object({ fileName: z.string().min(1).max(180), bytes: z.number().int().positive(), formatId: z.string(), lane: laneSchema })).mutation(async ({ ctx, input }) => {
    validateConversionFile(input.formatId, input.fileName, input.bytes); validateLane(input.lane, input.bytes);
    if (input.lane === "free") fileConversionIpHash(ctx.req, conversionDay());
    else if ((await getCredits(ctx.user.id)).totalAvailable < FILE_CONVERSION_PRICING.standardCredits!) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "积分不足，请充值后使用付费转换。" });
    return createGcsSignedUploadUrl({ objectName: `${conversionSourcePrefix(ctx.user.id)}${randomUUID()}`, contentType: "application/octet-stream", expiresInMinutes: 15 });
  }),
  inspect: protectedProcedure.input(z.object({ objectName: z.string().max(240), fileName: z.string().min(1).max(180), bytes: z.number().int().positive(), formatId: z.string(), lane: laneSchema })).mutation(async ({ ctx, input }) => {
    const userId = String(ctx.user.id), day = conversionDay();
    const source = { objectName: input.objectName, fileName: input.fileName, bytes: input.bytes, sha256: "", generation: "0" };
    assertConversionSource(source, userId, input.formatId, true); validateLane(input.lane, input.bytes);
    const ipHash = input.lane === "free" ? fileConversionIpHash(ctx.req, day) : undefined;
    const gcsUri = `gs://${getGcsBucketName()}/${source.objectName}`;
    const version = await statGcsObjectVersion({ gcsUri, signal: AbortSignal.timeout(30_000) });
    if (!Number.isSafeInteger(version.byteLength) || !version.byteLength || version.byteLength !== source.bytes) throw new TRPCError({ code: "BAD_REQUEST", message: "上传文件的实际大小不符，请重新选择原文件。" });
    source.generation = version.generation; validateLane(input.lane, version.byteLength);
    if (input.lane === "free") {
      // 小文件只流式校验大小/摘要，不解析、渲染或OCR；防伪造大小绕过额度与3MB门槛。
      const checked = await inspectGcsObjectBounded({ gcsUri, generation: source.generation, maxBytes: FILE_CONVERSION_FREE_MAX_BYTES });
      if (checked.byteLength !== source.bytes) throw new TRPCError({ code: "BAD_REQUEST", message: "原文件在检查时发生变化，请重新选择。" });
      source.sha256 = checked.sha256;
    } else if ((await getCredits(ctx.user.id)).totalAvailable < FILE_CONVERSION_PRICING.standardCredits!) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "积分不足，请充值后使用付费转换。" });
    const request: FileConversionRequest = { kind: "file_conversion", phase: "inspect", formatId: input.formatId, source, lane: input.lane, day, ...(ipHash ? { ipHash } : {}) };
    return enqueueConversionJob(userId, request);
  }),
  convert: protectedProcedure.input(identity.extend({ confirmedCredits: z.number().int().min(0) })).mutation(async ({ ctx, input }) => {
    const row = await owned(input.id, String(ctx.user.id));
    const request = row.input, outcome = row.output;
    if (row.status !== "succeeded" || request.phase !== "inspect" || outcome?.type !== "inspection") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "请先完成文件检查，再确认本次内容与费用。" });
    const quote = conversionBilling(outcome.source.bytes, outcome.billing.needsOcr, request.lane);
    if (!quote.available || quote.credits === null || quote.credits !== input.confirmedCredits) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "本次报价不可用或已变化，请重新检查；未扣积分。" });
    validateLane(request.lane, outcome.source.bytes);
    assertConversionSource(outcome.source, String(ctx.user.id), request.formatId);
    // settled是服务端结算标记，不进入请求身份或下一转换任务。
    const { settled: _settled, ...immutable } = request as FileConversionRequest & { settled?: boolean };
    const day = conversionDay();
    return enqueueConversionJob(String(ctx.user.id), { ...immutable, day,
      ...(request.lane === "free" ? { ipHash: fileConversionIpHash(ctx.req, day) } : {}),
      source: outcome.source, phase: "convert", quote: { credits: quote.credits, pricingVersion: quote.pricingVersion } });
  }),
  status: protectedProcedure.input(identity).query(async ({ ctx, input }) => view(await owned(input.id, String(ctx.user.id)))),
  history: protectedProcedure.query(async ({ ctx }) => Promise.all((await listConversionJobs(String(ctx.user.id))).map(view))),
  cancel: protectedProcedure.input(identity).mutation(async ({ ctx, input }) => { await cancelConversionJob(await owned(input.id, String(ctx.user.id))); return { ok: true }; }),
  download: protectedProcedure.input(identity).mutation(async ({ ctx, input }) => {
    const row = await owned(input.id, String(ctx.user.id)); const result = row.output;
    if (row.status !== "succeeded" || result?.type !== "converted" || !result.objectName.startsWith(`file-conversion/u${ctx.user.id}/results/${row.id}/`)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "文件尚未可下载" });
    return { url: signGcsObjectPathV4ReadUrl(getGcsBucketName(), result.objectName, 600), fileName: result.fileName };
  }),
});
