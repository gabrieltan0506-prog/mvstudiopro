import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request, Response } from "express";
import { signGsUriV4ReadUrl } from "./gcs.js";

const ROOT = join(tmpdir(), "mvs-audio-preview-cache");
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_CACHE_BYTES = 256 * 1024 * 1024;
const TTL_MS = 24 * 60 * 60 * 1000;
const pending = new Map<string, Promise<string>>();

function mediaType(uri: string): string {
  const name = uri.toLowerCase();
  if (name.endsWith(".mp3")) return "audio/mpeg";
  if (name.endsWith(".m4a")) return "audio/mp4";
  if (name.endsWith(".aac")) return "audio/aac";
  if (name.endsWith(".ogg") || name.endsWith(".opus")) return "audio/ogg";
  return "audio/wav";
}

async function prune(protect: string): Promise<void> {
  const rows = await Promise.all((await readdir(ROOT)).filter(name => /^[a-f0-9]{64}$/.test(name)).map(async name => {
    const path = join(ROOT, name);
    const info = await stat(path).catch(() => null);
    return info ? { path, size: info.size, mtime: info.mtimeMs } : null;
  }));
  const files = rows.filter((row): row is NonNullable<typeof row> => Boolean(row));
  let total = files.reduce((sum, row) => sum + row.size, 0);
  for (const row of files.sort((a, b) => a.mtime - b.mtime)) {
    if (row.path === protect) continue;
    if (Date.now() - row.mtime <= TTL_MS && total <= MAX_CACHE_BYTES) continue;
    await unlink(row.path).catch(() => {});
    total -= row.size;
  }
}

async function ensureAudio(uri: string): Promise<string> {
  const key = createHash("sha256").update(uri).digest("hex");
  const path = join(ROOT, key);
  await mkdir(ROOT, { recursive: true, mode: 0o700 });
  const existing = await stat(path).catch(() => null);
  if (existing && existing.size > 0 && Date.now() - existing.mtimeMs < TTL_MS) return path;
  const running = pending.get(key);
  if (running) return running;
  if (pending.size >= 4) throw new Error("audio cache busy");
  const task = (async () => {
    const upstream = await fetch(signGsUriV4ReadUrl(uri, 300), { signal: AbortSignal.timeout(60_000) });
    if (upstream.status === 404 || upstream.status === 410) throw new Error("audio source missing");
    if (!upstream.ok || !upstream.body) throw new Error(`audio upstream ${upstream.status}`);
    if (Number(upstream.headers.get("content-length") || 0) > MAX_FILE_BYTES) throw new Error("audio exceeds cache limit");
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_FILE_BYTES) throw new Error("audio exceeds cache limit");
        chunks.push(value);
      }
    } finally {
      if (size > MAX_FILE_BYTES) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (!size) throw new Error("empty audio");
    const temporary = `${path}.${process.pid}.part`;
    try {
      await writeFile(temporary, Buffer.concat(chunks, size), { mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    await prune(path);
    return path;
  })().finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}

export async function serveManhuaAudioFromFly(req: Request, res: Response, uri: string): Promise<void> {
  const path = await ensureAudio(uri);
  const { size } = await stat(path);
  const range = String(req.headers.range || "").trim();
  let start = 0;
  let end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) { res.status(416).set("Content-Range", `bytes */${size}`).end(); return; }
    if (match[1]) {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : end;
    } else {
      const suffix = Number(match[2]);
      if (!Number.isSafeInteger(suffix) || suffix <= 0) {
        res.status(416).set("Content-Range", `bytes */${size}`).end(); return;
      }
      start = Math.max(0, size - suffix);
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) {
      res.status(416).set("Content-Range", `bytes */${size}`).end(); return;
    }
    end = Math.min(end, size - 1);
    res.status(206).set("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  res.set("Cache-Control", "private, no-store");
  res.set("Content-Type", mediaType(uri));
  res.set("Accept-Ranges", "bytes");
  res.set("Content-Length", String(end - start + 1));
  const stream = createReadStream(path, { start, end });
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}
