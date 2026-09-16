import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  archiveBridgeFileToGcs,
  bridgeMimeFor,
  bridgeRelPath,
  buildBridgeMediaUrl,
  ensureBridgeCopyFromGcs,
  resolveSafeBridgeReadPath,
  writeBridgeFile,
  writeBridgeFileFromUrl,
} from "./flyEditBridge.js";

describe("flyEditBridge", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-"));
    process.env.MANHUA_BRIDGE_DIR = dir;
  });
  afterEach(async () => {
    delete process.env.MANHUA_BRIDGE_DIR;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("相对路径三段且净化；穿越/绝对/反斜杠/多段一律拒", () => {
    expect(bridgeRelPath({ ns: "world", id: "mw_ab/../x", name: "scene 500k.spz" })).toBe("world/mw_ab_.._x/scene_500k.spz");
    expect(resolveSafeBridgeReadPath("world/mw_1/pano.jpg")).toMatchObject({ ok: true, relPath: "world/mw_1/pano.jpg" });
    for (const bad of ["", "../x/y", "/etc/passwd", "world\\x\\y", "world/x", "a/b/c/d", "world/../../x/y"]) {
      expect(resolveSafeBridgeReadPath(bad).ok).toBe(false);
    }
  });

  it("MIME 按后缀；未知走 octet-stream", () => {
    expect(bridgeMimeFor("a.spz")).toBe("application/octet-stream");
    expect(bridgeMimeFor("a.glb")).toBe("model/gltf-binary");
    expect(bridgeMimeFor("A.JPG")).toBe("image/jpeg");
    expect(bridgeMimeFor("x.weird")).toBe("application/octet-stream");
  });

  it("公开地址走 /api/jobs?op=manhuaBridgeMedia，不带签名", () => {
    expect(buildBridgeMediaUrl("world/mw_1/pano.jpg")).toBe("https://mvstudiopro.com/api/jobs?op=manhuaBridgeMedia&relPath=world%2Fmw_1%2Fpano.jpg");
  });

  it("写入原子落盘并可按安全路径读回；从 URL 拉取限大小", async () => {
    const w = await writeBridgeFile({ ns: "world", id: "mw_1", name: "pano.jpg" }, Buffer.from("abc"));
    expect(w.relPath).toBe("world/mw_1/pano.jpg");
    const safe = resolveSafeBridgeReadPath(w.relPath);
    expect(safe.ok && (await fs.readFile(safe.abs, "utf8"))).toBe("abc");
    const fetchImpl = async () => new Response(Buffer.from("0123456789"), { status: 200 });
    await expect(writeBridgeFileFromUrl({ ns: "world", id: "mw_1", name: "c.glb" }, "https://u", { maxBytes: 4, fetchImpl })).rejects.toThrow("bridge_file_too_large");
    const ok = await writeBridgeFileFromUrl({ ns: "world", id: "mw_1", name: "c.glb" }, "https://u", { fetchImpl });
    expect(ok.bytes).toBe(10);
    await expect(writeBridgeFileFromUrl({ ns: "w", id: "i", name: "n.bin" }, "https://u", { fetchImpl: async () => new Response("x", { status: 404 }) })).rejects.toThrow("bridge_fetch_http_404");
  });

  it("GCS→Fly：卷上没有才下载，有则命中缓存；Fly→GCS 归档回 gs://", async () => {
    let downloads = 0;
    const download = async () => {
      downloads += 1;
      return Buffer.from("spz-bytes");
    };
    const ref = { ns: "world", id: "mw_2", name: "scene-500k.spz" };
    expect(await ensureBridgeCopyFromGcs(ref, "gs://b/o.spz", { download })).toEqual({ relPath: "world/mw_2/scene-500k.spz", fromCache: false });
    expect(await ensureBridgeCopyFromGcs(ref, "gs://b/o.spz", { download })).toEqual({ relPath: "world/mw_2/scene-500k.spz", fromCache: true });
    expect(downloads).toBe(1);
    const uploaded: Array<{ objectName: string; contentType?: string; bytes: number }> = [];
    const archived = await archiveBridgeFileToGcs("world/mw_2/scene-500k.spz", "manhua-world/u1/mw_2/scene-500k.spz", {
      upload: (async (p: { objectName: string; buffer: Buffer; contentType?: string }) => {
        uploaded.push({ objectName: p.objectName, contentType: p.contentType, bytes: p.buffer.byteLength });
        return { gcsUri: `gs://bucket/${p.objectName}` };
      }) as never,
    });
    expect(archived).toEqual({ gcsUri: "gs://bucket/manhua-world/u1/mw_2/scene-500k.spz", bytes: 9 });
    expect(uploaded[0]).toMatchObject({ objectName: "manhua-world/u1/mw_2/scene-500k.spz", contentType: "application/octet-stream" });
    await expect(archiveBridgeFileToGcs("../x/y", "o")).rejects.toThrow("bridge_invalid_rel_path");
  });
});
