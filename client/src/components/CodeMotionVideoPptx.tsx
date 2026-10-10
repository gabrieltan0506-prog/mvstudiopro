import { useState } from "react";
import { buildVideoPptx } from "@shared/htmlPptVideo";
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
export default function CodeMotionVideoPptx({ videoUrl, title, orientation }: { videoUrl: string; title: string; orientation: "landscape" | "portrait" }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function download() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(videoUrl, { credentials: "include", signal: AbortSignal.timeout(120_000) });
      if (!response.ok || !response.body) throw new Error("视频暂时无法读取，请刷新原任务后重试");
      if (Number(response.headers.get("content-length")) > MAX_VIDEO_BYTES) { await response.body.cancel(); throw new Error("视频超过本次PPT嵌入的80MB上限，请下载MP4使用"); }
      const reader = response.body.getReader(), parts: ArrayBuffer[] = []; let size = 0;
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > MAX_VIDEO_BYTES) { await reader.cancel(); throw new Error("视频超过本次PPT嵌入的80MB上限，请下载MP4使用"); } parts.push(new Uint8Array(part.value).buffer); }
      const video = new Blob(parts, { type: "video/mp4" });
      const header = new Uint8Array(await video.slice(0, 12).arrayBuffer());
      if (String.fromCharCode(...Array.from(header.slice(4, 8))) !== "ftyp") throw new Error("取得的文件不是可识别MP4，未导出PPT");
      const videoData = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("视频载入失败")); reader.readAsDataURL(video); });
      const blob = await buildVideoPptx({ title, videoData, orientation });
      const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `${title.replace(/[\\/:*?"<>|]/g, "-") || "映刻"}-视频演示.pptx`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) { setError(e instanceof Error ? e.message : "导出未完成，原视频保留"); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2"><button type="button" disabled={busy} onClick={() => void download()} className="rounded-xl border border-stone-300 px-4 py-2 text-sm disabled:opacity-50">{busy ? "正在打包视频…" : "导出含此视频的PPT"}</button><p className="text-xs text-stone-500">免费打包已生成的完整视频，不重复制作。PPT内的视频保留动效，内部文字与图形不能逐项编辑；播放支持以演示软件为准。</p>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</div>;
}
