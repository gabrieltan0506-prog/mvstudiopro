import type { Express } from "express";
import multer from "multer";
import fs from "node:fs/promises";
import path from "node:path";
import { sdk } from "../_core/sdk";
import {
  photoTempDir,
  photoTempName,
  photoTempExpires,
  photoTempUrl,
  ensurePhotoTempSpace,
  cleanupPhotoTemp,
  schedulePhotoTempRemoval,
  mirrorPhotoTemp,
  PHOTO_TEMP_MAX_BYTES,
} from "../services/photoTemporaryMedia";

export function registerPhotoTemporaryMedia(app: Express) {
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, done) => done(null, photoTempDir()),
      filename: (_req, _file, done) => done(null, photoTempName("upload")),
    }),
    limits: { fileSize: PHOTO_TEMP_MAX_BYTES, files: 1, fields: 1 },
  }).single("file");
  app.get("/api/photo-media/:name", async (req, res) => {
    const name = req.params.name;
    const expires = photoTempExpires(name);
    if (!expires || name.endsWith(".upload")) return void res.sendStatus(404);
    if (expires <= Date.now())
      return void res
        .status(410)
        .send("临时文件已到期并删除，请在生成后12小时内下载");
    if (req.query.download)
      res.attachment(
        String(req.query.download)
          .replace(/[^a-zA-Z0-9._-]/g, "_")
          .slice(0, 100)
      );
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(path.join(photoTempDir(), name), error => {
      if (error && !res.headersSent) res.sendStatus(404);
    });
  });
  app.post("/api/photo-media/upload", async (req, res) => {
    try {
      await sdk.authenticateRequest(req);
    } catch {
      return void res.status(401).json({ error: "请先登录" });
    }
    try {
      await ensurePhotoTempSpace();
    } catch {
      return void res.status(503).json({ error: "暂存空间繁忙，请稍后重试" });
    }
    upload(req, res, async error => {
      const file = req.file;
      if (error || !file)
        return void res
          .status(400)
          .json({ error: "上传失败，视频不能超过512MB" });
      try {
        const image = file.mimetype.startsWith("image/");
        if (!image && !file.mimetype.startsWith("video/"))
          throw new Error("请选择图片或视频");
        if (image && file.size > 30_000_000)
          throw new Error("照片不能超过30MB");
        let ext = "mp4";
        if (image) {
          const meta = await (await import("sharp"))
            .default(file.path)
            .metadata();
          if (!["png", "jpeg", "webp"].includes(meta.format || ""))
            throw new Error("请使用PNG、JPG或WebP图片");
          ext = meta.format === "jpeg" ? "jpg" : meta.format!;
        } else {
          ext =
            /\.(mp4|mov|webm|m4v)$/i
              .exec(file.originalname)?.[1]
              .toLowerCase() || "mp4";
        }
        const name = file.filename.replace(/upload$/, ext);
        await fs.rename(file.path, path.join(photoTempDir(), name));
        schedulePhotoTempRemoval(name);
        res.json({
          url: photoTempUrl(name),
          expiresAt: new Date(photoTempExpires(name)).toISOString(),
        });
      } catch (e) {
        await fs.unlink(file.path).catch(() => {});
        res
          .status(400)
          .json({ error: e instanceof Error ? e.message : "上传失败" });
      }
    });
  });
  app.post("/api/photo-media/cache", async (req, res) => {
    let user;
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      return void res.status(401).json({ error: "请先登录" });
    }
    try {
      if (!["image", "video", "pdf"].includes(req.body.kind))
        throw new Error("媒体类型无效");
      let source = String(req.body.url || "");
      // 知识卡历史签名可能已过期；只为本人的成品目录刷新服务端读链。
      if (
        source.includes("generated/platform_knowledge_card/") ||
        source.includes("generated%2Fplatform_knowledge_card%2F")
      ) {
        const { getGcsBucketName, signGsUriV4ReadUrl } = await import(
          "../services/gcs.js"
        );
        const { resolveKnowledgeCardImageObjectName } = await import(
          "../services/knowledgeCardPdfExport.js"
        );
        const bucket = getGcsBucketName();
        const object = resolveKnowledgeCardImageObjectName(
          source,
          bucket,
          user.id
        );
        // PDF有独立归属目录，同样不能借下载接口访问其他用户成品。
        let pdfObject: string | null = null;
        if (req.body.kind === "pdf") {
          const u = new URL(source);
          const candidate = decodeURIComponent(u.pathname).replace(/^\//, "");
          const prefix = `${bucket}/generated/platform_knowledge_card/pdf/u${user.id}/`;
          if (
            u.hostname === "storage.googleapis.com" &&
            candidate.startsWith(prefix) &&
            !candidate.includes("..")
          )
            pdfObject = candidate.slice(bucket.length + 1);
        }
        if (object || pdfObject) {
          source = signGsUriV4ReadUrl(`gs://${bucket}/${object || pdfObject}`, 600);
        } else {
          const pathname = decodeURIComponent(new URL(source).pathname);
          if (/generated\/platform_knowledge_card\/(?:pdf\/)?u\d+\//.test(pathname)) {
            return void res.status(403).json({ error: "只能下载本人生成的知识卡" });
          }
          // 旧卡没有归属前缀：只使用用户已持有且仍有效的原读链，不扩大签名权限。
        }
      }
      res.json(await mirrorPhotoTemp(source, req.body.kind));
    } catch (e) {
      res
        .status(400)
        .json({ error: e instanceof Error ? e.message : "临时下载准备失败" });
    }
  });
  void cleanupPhotoTemp().catch(e =>
    console.error("[photoTemp] 启动清理失败", e.code)
  );
  const timer = setInterval(
    () =>
      void cleanupPhotoTemp().catch(e =>
        console.error("[photoTemp] 清理失败", e.code)
      ),
    30_000
  );
  timer.unref();
  return () => clearInterval(timer);
}
