import type { Express } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { sdk } from "../_core/sdk";
import { isGcsTransferUrl } from "../../shared/gcsTransfer";

/** 必须在body parser前注册，直接流式转发，避免大文件驻内存。 */
export function registerGcsTransfer(app: Express) {
  app.all("/api/gcs-transfer", async (req, res) => {
    if (!["GET", "PUT", "HEAD"].includes(req.method))
      return void res.sendStatus(405);
    try {
      await sdk.authenticateRequest(req);
    } catch {
      return void res.status(401).json({ error: "请先登录" });
    }
    const source = typeof req.query.url === "string" ? req.query.url : "";
    if (!isGcsTransferUrl(source))
      return void res.status(400).json({ error: "GCS地址无效" });
    // 只转发调用方持有的权限；不借服务端凭证读取或覆盖其他对象。
    const headers = new Headers({ "accept-encoding": "identity" });
    for (const [key, value] of Object.entries(req.headers)) {
      if (
        typeof value === "string" &&
        (["content-type", "content-length", "range", "if-range"].includes(
          key
        ) ||
          key.startsWith("x-goog-"))
      )
        headers.set(key, value);
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 30 * 60_000);
    const disconnected = () => {
      if (!res.writableFinished) abort.abort();
    };
    req.once("aborted", disconnected);
    res.once("close", disconnected);
    try {
      if (req.aborted || res.destroyed) throw new Error("disconnected");
      const upstream = await fetch(source, {
        method: req.method,
        headers,
        redirect: "error",
        signal: abort.signal,
        ...(req.method === "PUT"
          ? { body: Readable.toWeb(req), duplex: "half" }
          : {}),
      } as RequestInit);
      res.status(upstream.status);
      if (req.method === "GET" && upstream.ok) {
        let filename = "download";
        try {
          filename = decodeURIComponent(
            new URL(source).pathname.split("/").pop() || filename
          );
        } catch {}
        res.attachment(filename.replace(/[\\/\r\n]/g, "_").slice(0, 180));
      }
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      for (const key of [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "etag",
      ]) {
        const value = upstream.headers.get(key);
        if (value) res.setHeader(key, value);
      }
      if (upstream.body)
        await pipeline(
          Readable.fromWeb(
            upstream.body as import("node:stream/web").ReadableStream
          ),
          res
        );
      else res.end();
    } catch {
      if (!res.headersSent && !res.destroyed)
        res.status(502).json({ error: "文件转发失败，请稍后重试" });
      else if (!res.destroyed) res.destroy();
    } finally {
      clearTimeout(timer);
      req.off("aborted", disconnected);
      res.off("close", disconnected);
    }
  });
}
