/**
 * 统一调用 Cloud Run pdf-worker，供同步 tRPC 与异步 jobs 共用。
 */
const DEFAULT_PROXY_MS = 3_400_000;

export function getPdfWorkerFetchTimeoutMs(): number {
  return Number(process.env.PDF_PROXY_FETCH_TIMEOUT_MS) || DEFAULT_PROXY_MS;
}

export async function fetchPdfBufferFromWorker(html: string, token?: string): Promise<Buffer> {
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
      body: JSON.stringify({ html, token: token ?? "" }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`pdf-worker returned ${res.status}: ${errBody.slice(0, 240)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timeoutId);
  }
}
