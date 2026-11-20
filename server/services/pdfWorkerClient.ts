import { KNOWLEDGE_BOOKLET_ORIGINAL_IMAGE_ATTR } from "../../shared/knowledgeBooklet";
/**
 * 统一调用 Cloud Run pdf-worker，供同步 tRPC 与异步 jobs 共用。
 */
const DEFAULT_PROXY_MS = 3_400_000;

export function getPdfWorkerFetchTimeoutMs(): number {
  return Number(process.env.PDF_PROXY_FETCH_TIMEOUT_MS) || DEFAULT_PROXY_MS;
}

export async function fetchPdfBufferFromWorker(html: string, token?: string): Promise<Buffer> {
  return requestPdfWorker(html, token, false) as Promise<Buffer>;
}

/** 与正式PDF使用同一字体和排版步骤，只省略最后的PDF编码。 */
export async function measureKnowledgeBookletFromWorker(html: string): Promise<number> {
  return (await requestPdfWorker(html, undefined, true) as KnowledgeBookletMeasure).pages;
}
/** 预分页逐章细节（排版服务新版才回报 booklets；旧版只有页数，booklets 为空数组）。layout=逐页版面测量（更新后的排版服务才有，缺失即「未审查」）。 */
export type KnowledgeBookletMeasure = { pages: number; booklets: { pages: number; imageModes: Record<string, string>; maxWhitespace: number; layout?: unknown[] }[] };
export async function measureKnowledgeBookletDetailsFromWorker(html: string): Promise<KnowledgeBookletMeasure> {
  return requestPdfWorker(html, undefined, true) as Promise<KnowledgeBookletMeasure>;
}

async function requestPdfWorker(html: string, token: string | undefined, measureKnowledgeBooklet: boolean): Promise<Buffer | KnowledgeBookletMeasure> {
  const cloudRunUrl = String(process.env.CLOUD_RUN_PDF_URL || "").trim();
  if (!cloudRunUrl) {
    throw new Error("CLOUD_RUN_PDF_URL env var is not set.");
  }
  const proxyUrl = cloudRunUrl.replace(/\/$/, "") + "/generate-pdf";
  const controller = new AbortController();
  const timeoutMs = getPdfWorkerFetchTimeoutMs();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html, token: token ?? "", ...(measureKnowledgeBooklet ? { measureKnowledgeBooklet: true } : {}) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`pdf-worker returned ${res.status}: ${errBody.slice(0, 240)}`);
    }
    if (measureKnowledgeBooklet) {
      const result = await res.json() as { pages?: number; booklets?: KnowledgeBookletMeasure["booklets"] };
      if (!Number.isSafeInteger(result.pages) || result.pages! < 1) throw new Error("知识书册预分页未返回有效页数");
      return { pages: result.pages!, booklets: Array.isArray(result.booklets) ? result.booklets : [] };
    }
    // 成品原图握手（2026-11-21，站长：成品图不得压缩）：请求带原图标记时，排版服务必须回报已按原图入版。
    // 排版服务与服务端分开部署；旧版排版服务不认识原图标记，会把图压到 1200 宽、JPEG 0.75——宁可本次导出失败重试，也不收下降质成品。
    if (html.includes(KNOWLEDGE_BOOKLET_ORIGINAL_IMAGE_ATTR) && res.headers.get("x-pdf-original-images") !== "1") {
      await res.arrayBuffer().catch(() => undefined);
      throw new Error("排版服务尚未更新到原图入版的版本，本次未生成成品（不接受压缩过的配图），请稍后重试");
    }
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timeoutId);
  }
}
