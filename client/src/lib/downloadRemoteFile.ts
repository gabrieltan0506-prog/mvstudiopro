/**
 * 直接下载远端产物（成片 mp4 / 静帧图）。
 *
 * 不能只写 <a download>：产物是 GCS 签名地址，跨域时 download 属性会被浏览器
 * 忽略，点了变成跳走播放，用户以为按钮坏了。所以先抓成 blob 再下，拿得到
 * 文件名也拿得到进度可控性。
 *
 * 抓不到就退回开新标签页——签名过期或 CORS 没开时至少还能右键另存，
 * 而不是点了毫无反应。
 */

export type DownloadRemoteFileResult = {
  ok: boolean;
  /** fallback=抓不到，已开新标签页让用户自己存 */
  via: "blob" | "fallback";
};

/** 从 URL 猜个像样的文件名；签名参数不能进文件名 */
export function guessRemoteFileName(url: string, fallbackBase: string): string {
  const clean = String(url || "").split(/[?#]/)[0] || "";
  const tail = clean.slice(clean.lastIndexOf("/") + 1).trim();
  if (tail && /\.[a-z0-9]{2,5}$/i.test(tail)) return decodeURIComponent(tail);
  const ext = /\.(mp4|webm|mov)$/i.test(clean)
    ? "mp4"
    : /\.(png|jpe?g|webp)$/i.test(clean)
      ? "png"
      : "";
  const base = String(fallbackBase || "download").replace(/[\\/:*?"<>|]+/g, "_");
  return ext ? `${base}.${ext}` : base;
}

export async function downloadRemoteFile(
  url: string,
  fileNameBase: string,
): Promise<DownloadRemoteFileResult> {
  const src = String(url || "").trim();
  if (!/^https?:\/\//i.test(src)) throw new Error("下载地址无效");
  const filename = guessRemoteFileName(src, fileNameBase);
  try {
    const resp = await fetch(src);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 立刻 revoke 会让 Safari 下到半路断掉，给一段缓冲
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return { ok: true, via: "blob" };
  } catch {
    window.open(src, "_blank", "noopener,noreferrer");
    return { ok: false, via: "fallback" };
  }
}
