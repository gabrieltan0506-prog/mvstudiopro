/**
 * 动效 PPT · PPTX 导出前拉取插图（绕过浏览器对 GCS 签名 URL 的 CORS）。
 */
function hostAllowed(hostname: string): boolean {
  const h = String(hostname || "").toLowerCase();
  if (!h) return false;
  return (
    h === "storage.googleapis.com" ||
    h.endsWith(".storage.googleapis.com") ||
    h === "blob.vercel-storage.com" ||
    h.endsWith(".public.blob.vercel-storage.com") ||
    h.endsWith(".blob.vercel-storage.com") ||
    h.endsWith(".googleusercontent.com")
  );
}

export function isAllowedHtmlPptPptxImageUrl(raw: string): boolean {
  try {
    const u = new URL(String(raw || "").trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return hostAllowed(u.hostname);
  } catch {
    return false;
  }
}

export async function fetchHtmlPptPptxImageDataUrls(
  urls: string[],
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(urls.map((u) => String(u || "").trim()).filter(Boolean))).slice(
    0,
    16,
  );
  const out: Record<string, string> = {};

  await Promise.all(
    unique.map(async (url) => {
      if (!isAllowedHtmlPptPptxImageUrl(url)) {
        throw new Error("插图地址不在允许范围，无法导出");
      }
      const resp = await fetch(url, {
        headers: { "User-Agent": "mvstudiopro/html-ppt-pptx" },
        redirect: "follow",
      });
      if (!resp.ok) {
        throw new Error(`插图下载失败（${resp.status}），请重试导出`);
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      if (!buf.length) throw new Error("插图为空，请重试导出");
      if (buf.length > 12 * 1024 * 1024) throw new Error("插图过大，无法写入 PPTX");
      const mime = String(resp.headers.get("content-type") || "image/png")
        .split(";")[0]!
        .trim()
        .toLowerCase();
      const safeMime = mime.startsWith("image/") ? mime : "image/png";
      out[url] = `data:${safeMime};base64,${buf.toString("base64")}`;
    }),
  );

  return out;
}
