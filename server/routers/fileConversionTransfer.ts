import type { Express } from "express";
import { sdk } from "../_core/sdk";
import { validArtEvidenceSignature } from "../services/artMotionEvidence";
import { claimConversionUpload, conversionUploadByObject, finishConversionUpload } from "../jobs/fileConversionUploads";
import { getConversionJob } from "../jobs/fileConversionRepository";
import { assertConversionObject, assertConversionWebsiteVolume, CONVERSION_STORE_ROUTE, conversionSha, readConversionObject, readConversionWebsite, saveConversionObject, writeConversionWebsite, type ConversionObject } from "../services/fileConversionStorage";
import { FILE_CONVERSION_FREE_MAX_BYTES } from "../../shared/fileConversion";
import { conversionMemoryBudget } from "../services/fileConversion";
/** 实际流量超过授权即停止接收；在完整校验之前不写GCS或持久卷。 */
export async function receiveConversionBytes(stream: AsyncIterable<Uint8Array>, maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("上传长度无效");
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new Error("上传实际大小超过授权限制");
    chunks.push(Buffer.from(chunk));
  }
  if (bytes !== maxBytes) throw new Error("上传实际大小与授权不符");
  return Buffer.concat(chunks);
}
async function authorizedObject(input: ConversionObject) {
  assertConversionObject(input);
  if (input.objectName.startsWith(`file-conversion/u${input.userId}/sources/`)) {
    const upload = await conversionUploadByObject(input.objectName);
    if (!upload || upload.userId !== input.userId || !["receiving", "uploaded", "checked"].includes(upload.status)) throw new Error("上传归属无效");
    if (input.bytes !== undefined && input.bytes !== Number(upload.bytes)) throw new Error("原件长度无效");
  } else {
    const job = await getConversionJob(input.taskId || "");
    if (!job || job.userId !== input.userId || job.input.kind !== "file_conversion") throw new Error("转换任务归属无效");
    if (input.objectName.includes("/results/") && job.input.phase !== "convert") throw new Error("非转换任务不可写产物");
  }
}
export function registerFileConversionTransfer(app: Express) {
  // 必须在body parser前注册，不能让超大申报先被全量缓冲。
  app.put("/api/file-conversion/upload/:id", async (req, res) => {
    let ticket: Awaited<ReturnType<typeof claimConversionUpload>> = null;
    try {
      const user = await sdk.authenticateRequest(req);
      if (!/^[a-f0-9-]{36}$/.test(String(req.params.id))) return void res.sendStatus(400);
      ticket = await claimConversionUpload(String(req.params.id), String(user.id));
      if (!ticket) return void res.status(409).json({ error: "上传授权已使用或过期，请查询原文件" });
      const maximum = Number(ticket.bytes);
      if (maximum > (ticket.lane === "free" ? FILE_CONVERSION_FREE_MAX_BYTES : conversionMemoryBudget())) throw new Error("原文件超过当前上传资源限制");
      if (req.headers["content-length"] && Number(req.headers["content-length"]) !== maximum) throw new Error("上传实际大小与授权不符");
      const buffer = await receiveConversionBytes(req, maximum);
      const saved = await saveConversionObject({ userId: ticket.userId, objectName: ticket.objectName }, buffer, "application/octet-stream", AbortSignal.timeout(30_000));
      const source = { objectName: ticket.objectName, fileName: ticket.fileName, bytes: buffer.length, sha256: conversionSha(buffer), ...saved };
      await finishConversionUpload(ticket, source);
      res.json({ ok: true });
    } catch (error) {
      if (ticket) await finishConversionUpload(ticket, null).catch(() => undefined);
      if (!res.headersSent && !res.destroyed) {
        const sizeRejected = /上传实际大小|原文件超过|上传长度/.test(String(error));
        res.status(ticket ? sizeRejected ? 413 : 503 : 401).json({ error: ticket
          ? sizeRejected ? "上传实际大小不符或超过授权，未写入超限文件" : "上传保存暂不可用，未创建转换或扣积分"
          : "请先登录" });
      }
    }
  });
  app.get("/api/file-conversion/download/:id", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req), job = await getConversionJob(String(req.params.id));
      if (!job || job.userId !== String(user.id) || job.status !== "succeeded" || job.output?.type !== "converted") return void res.sendStatus(404);
      const result = job.output, buffer = await readConversionObject({ userId: job.userId, taskId: job.id, ...result }, AbortSignal.timeout(30_000));
      res.setHeader("Cache-Control", "private, no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
      res.type(result.mimeType).attachment(result.fileName).send(buffer);
    } catch { if (!res.headersSent) res.status(503).json({ error: "原产物保留，下载暂不可用" }); }
  });
  app.all(CONVERSION_STORE_ROUTE, async (req, res) => {
    if (!["POST", "PUT"].includes(req.method)) return void res.sendStatus(405);
    try {
      const metadata = Buffer.from(String(req.headers["x-conversion-metadata"] || ""), "base64");
      if (!validArtEvidenceSignature(process.env.JWT_SECRET || "", String(req.headers["x-art-evidence-time"] || ""), String(req.headers["x-art-evidence-signature"] || ""), metadata)) return void res.sendStatus(403);
      const input = JSON.parse(metadata.toString()) as ConversionObject;
      await authorizedObject(input); await assertConversionWebsiteVolume();
      if (req.method === "PUT") {
        const bytes = input.bytes || 0;
        if (bytes > conversionMemoryBudget()) throw new Error("降级持久化资源不足");
        const buffer = await receiveConversionBytes(req, bytes);
        await writeConversionWebsite(input, buffer);
        res.json({ bytes: buffer.length, sha256: conversionSha(buffer) });
      } else {
        const buffer = await readConversionWebsite(input);
        res.type("application/octet-stream").send(buffer);
      }
    } catch (error) { if (!res.headersSent) res.status((error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 503).json({ error: "文件未持久化或读取不可用" }); }
  });
}
