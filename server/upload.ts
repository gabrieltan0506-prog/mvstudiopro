import { Router } from "express";
import { nanoid } from "nanoid";
import { storagePut } from "./storage";
import { uploadBufferToGcs } from "./services/gcs";

const uploadRouter = Router();
const MB = 1024 * 1024;
const DEFAULT_UPLOAD_MAX_BYTES = 600 * MB;
const MAX_UPLOAD_BYTES = Math.max(10 * MB, Number(process.env.UPLOAD_MAX_BYTES || DEFAULT_UPLOAD_MAX_BYTES) || DEFAULT_UPLOAD_MAX_BYTES);

async function parseMultipartFile(req: any) {
  const request = new Request("http://local/upload", {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: req,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new Error("No file found");
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length) {
    throw new Error("Uploaded file is empty");
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    const error = new Error(`File too large: ${buffer.length}`);
    (error as any).statusCode = 413;
    throw error;
  }

  const filename = file.name || "upload";
  const ext = filename.includes(".") ? filename.split(".").pop() || "bin" : "bin";
  const mimeType = file.type || "application/octet-stream";

  return {
    buffer,
    filename,
    ext,
    mimeType,
  };
}

async function handleUpload(req: any, res: any, keyPrefix: string, fallbackBaseName: string) {
  try {
    const { buffer, filename, ext, mimeType } = await parseMultipartFile(req);
    const key = `${keyPrefix}/${nanoid(12)}.${ext || fallbackBaseName}`;
    const { url } = await storagePut(key, buffer, mimeType);
    res.json({ url, key });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Upload failed");
    const statusCode = Number((error as any)?.statusCode || 500);
    console.error(`[Upload ${keyPrefix}] Error:`, error);
    res.status(statusCode).json({ error: statusCode === 413 ? "Upload too large" : message || "Upload failed" });
  }
}

uploadRouter.post("/api/upload", async (req, res) => {
  return handleUpload(req, res, "uploads", "bin");
});

uploadRouter.post("/api/upload-image", async (req, res) => {
  return handleUpload(req, res, "idol-3d", "png");
});

// Platform QA file upload — stores to GCS and returns gs:// fileUri
// Used by the PlatformPage QA multimodal flow. Files are temporary and
// deleted by the background QA job after analysis completes.
//
// ⚠️ Bucket 名称走 env：原来写死的 `mv-studio-pro-user-uploads-255451353515`
// 桶其实不存在（404 / The specified bucket does not exist），导致 GodView 上传失败。
// 现在按优先级回退：GCS_USER_UPLOAD_BUCKET → GCS_PDF_EXPORT_BUCKET → VERTEX_GCS_BUCKET，
// 最差情况下复用已经 deploy 在 fly 上的 vertex-video-temp 桶（也是公开读桶）。
const PLATFORM_QA_BUCKET =
  process.env.GCS_USER_UPLOAD_BUCKET ||
  process.env.GCS_PDF_EXPORT_BUCKET ||
  process.env.VERTEX_GCS_BUCKET ||
  "mv-studio-pro-vertex-video-temp";
const PLATFORM_QA_MAX_BYTES = 20 * 1024 * 1024; // 20MB for images/PDFs

uploadRouter.post("/api/platform/upload", async (req: any, res: any) => {
  try {
    const request = new Request("http://local/upload", {
      method: req.method,
      headers: req.headers as HeadersInit,
      body: req,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return res.status(400).json({ error: "No file found in request" });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (!buffer.length) {
      return res.status(400).json({ error: "Uploaded file is empty" });
    }
    if (buffer.length > PLATFORM_QA_MAX_BYTES) {
      return res.status(413).json({ error: "File too large (max 20MB)" });
    }

    const filename = file.name || "attachment";
    const ext = filename.includes(".") ? filename.split(".").pop() || "bin" : "bin";
    const mimeType = file.type || "application/octet-stream";
    const objectName = `platform-qa/${Date.now()}-${nanoid(8)}.${ext}`;

    await uploadBufferToGcs({
      objectName,
      buffer,
      contentType: mimeType,
      bucket: PLATFORM_QA_BUCKET,
    });

    const fileUri = `gs://${PLATFORM_QA_BUCKET}/${objectName}`;
    console.log(`[platform/upload] uploaded to ${fileUri} (${buffer.length} bytes)`);

    return res.json({ fileUri, mimeType, objectName });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error || "Upload failed");
    console.error("[platform/upload] error:", msg);
    return res.status(500).json({ error: msg });
  }
});

// ── 半月刊补充资料上传 → GCS，返回公开 HTTPS URL + gs:// URI ──────────────────
// 同上：env-driven，fallback 到 fly 上现实存在的 vertex-video-temp 桶。
const MAGAZINE_SUPP_BUCKET =
  process.env.GCS_USER_UPLOAD_BUCKET ||
  process.env.GCS_PDF_EXPORT_BUCKET ||
  process.env.VERTEX_GCS_BUCKET ||
  "mv-studio-pro-vertex-video-temp";
const MAGAZINE_SUPP_MAX_BYTES = 100 * 1024 * 1024; // 100MB

uploadRouter.post("/api/magazine/upload", async (req: any, res: any) => {
  try {
    const request = new Request("http://local/upload", {
      method: req.method,
      headers: req.headers as HeadersInit,
      body: req,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return res.status(400).json({ error: "No file found" });

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!buffer.length) return res.status(400).json({ error: "Empty file" });
    if (buffer.length > MAGAZINE_SUPP_MAX_BYTES) return res.status(413).json({ error: "File too large (max 100MB)" });

    const filename = file.name || "attachment";
    const ext = filename.includes(".") ? filename.split(".").pop()! : "bin";
    const mimeType = file.type || "application/octet-stream";
    const objectName = `magazine-supplements/${Date.now()}-${nanoid(8)}.${ext}`;

    const { gcsUri } = await uploadBufferToGcs({ objectName, buffer, contentType: mimeType, bucket: MAGAZINE_SUPP_BUCKET });

    // ⚠️ 关键修复（2026-04-29 plan-create 400 "Cannot fetch content from the provided URL"）：
    //
    // 旧实现用 getPublicGcsHttpsUrl() 返回 https://storage.googleapis.com/{bucket}/{obj}，
    // 这要求 bucket 设公开读权限。但 fallback 用的 mv-studio-pro-vertex-video-temp 是
    // Vertex 临时桶 / 私有桶 → Deep Research API fetch 时 403 → 报 invalid_request。
    //
    // 改为 V4 signed read URL（72 小时过期），鉴权放在 query string 里，Deep Research
    // API 拿到链接直接能 GET，不依赖 bucket public ACL。
    const { Storage } = await import("@google-cloud/storage");
    const credsRaw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
    const storage = credsRaw
      ? (() => {
          const c = JSON.parse(credsRaw);
          return new Storage({
            projectId: c.project_id,
            credentials: { client_email: c.client_email, private_key: c.private_key },
          });
        })()
      : new Storage();
    const fileRef = storage.bucket(MAGAZINE_SUPP_BUCKET).file(objectName);
    const [signedUrl] = await fileRef.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 72 * 60 * 60 * 1000, // 72 小时
    });

    console.log(`[magazine/upload] ${filename} → ${gcsUri} (${buffer.length} bytes, signed-read 72h)`);
    return res.json({ url: signedUrl, gcsUri, mimeType, name: filename });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err || "Upload failed");
    console.error("[magazine/upload] error:", msg);
    return res.status(500).json({ error: msg });
  }
});

export default uploadRouter;
