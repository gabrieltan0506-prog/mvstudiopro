import { Router } from "express";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";

const uploadRouter = Router();

uploadRouter.post("/api/upload", async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      const body = Buffer.concat(chunks);
      // Parse multipart form data manually (simple version)
      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("multipart/form-data")) {
        res.status(400).json({ error: "Expected multipart/form-data" });
        return;
      }
      const boundary = contentType.split("boundary=")[1];
      if (!boundary) {
        res.status(400).json({ error: "No boundary found" });
        return;
      }

      const boundaryBuffer = Buffer.from(`--${boundary}`);
      const parts = [];
      let start = body.indexOf(boundaryBuffer) + boundaryBuffer.length;

      while (start < body.length) {
        const nextBoundary = body.indexOf(boundaryBuffer, start);
        if (nextBoundary === -1) break;
        parts.push(body.subarray(start, nextBoundary));
        start = nextBoundary + boundaryBuffer.length;
      }

      if (parts.length === 0) {
        res.status(400).json({ error: "No file found" });
        return;
      }

      const part = parts[0];
      const headerEnd = part.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        res.status(400).json({ error: "Malformed part" });
        return;
      }

      const headers = part.subarray(0, headerEnd).toString();
      const fileData = part.subarray(headerEnd + 4, part.length - 2); // trim trailing \r\n

      // Extract filename
      const filenameMatch = headers.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] || "upload";
      const ext = filename.split(".").pop() || "bin";

      // Detect content type
      const ctMatch = headers.match(/Content-Type:\s*(.+)/i);
      const fileMime = ctMatch?.[1]?.trim() || "application/octet-stream";

      const key = `uploads/${nanoid(12)}.${ext}`;
      const { url } = await storagePut(key, fileData, fileMime);
      res.json({ url, key });
    });
  } catch (error) {
    console.error("[Upload] Error:", error);
    res.status(500).json({ error: "Upload failed" });
  }
});

export default uploadRouter;
