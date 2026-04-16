import { Router } from "express";
import { nanoid } from "nanoid";
import { storagePut } from "./storage";

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

export default uploadRouter;
