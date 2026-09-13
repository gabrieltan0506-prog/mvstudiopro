import { withLongJobsFlyDirect } from "./longJobsFlyOrigin";
export async function uploadPhotoTemporaryMedia(file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(
    withLongJobsFlyDirect("/api/photo-media/upload"),
    { method: "POST", credentials: "include", body: form }
  );
  const data = await response.json();
  if (!response.ok || !data.url) throw new Error(data.error || "上传失败");
  return {
    url: String(data.url),
    previewUrl: String(data.url),
    expiresAt: String(data.expiresAt),
  };
}
export async function cachePhotoTemporaryMedia(
  url: string,
  kind: "image" | "video" | "pdf"
) {
  const response = await fetch(
    withLongJobsFlyDirect("/api/photo-media/cache"),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, kind }),
    }
  );
  const data = await response.json();
  if (!response.ok || !data.url)
    throw new Error(data.error || "下载链接准备失败");
  return String(data.url);
}

export function triggerTemporaryDownload(url: string, filename: string) {
  const target = new URL(url, window.location.origin);
  target.searchParams.set("download", filename);
  const a = document.createElement("a");
  a.href = target.href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
