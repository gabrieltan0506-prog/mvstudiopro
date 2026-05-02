/**
 * 戰略智庫封面生圖：優先 Imagen Ultra（全維度 ~10 次/分鐘），超額或失敗時走 gemini-3-pro-image-preview。
 * 待 Test Lab 驗證 Ultra 穩定後，將此分支合入 main（見 wip/followup-strategic-cover-imagen）。
 */
import fs from "fs/promises";
import path from "path";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 請求體裡帶的別名；Vertex 實際 ID 由 /api/google 用 VERTEX_IMAGE_MODEL_ULTRA 展開 */
export const IMAGEN_ULTRA_MODEL_ALIAS = "imagen-4.0-ultra";

const RATE_FILE =
  process.env.IMAGEN_ULTRA_RATE_GATE_FILE || "/data/growth/imagen-ultra-rate-gate.json";
const WINDOW_MS = 60_000;
const MAX_STARTS_PER_WINDOW = 10;

type GateState = { starts: number[] } | { lastCallAt: number };

let fileLock: Promise<void> = Promise.resolve();

async function withFileLock<T>(fn: () => Promise<T>): Promise<T> {
  let unlock!: () => void;
  const slot = new Promise<void>((r) => {
    unlock = r;
  });
  const prev = fileLock;
  fileLock = prev.then(() => slot);
  await prev;
  try {
    return await fn();
  } finally {
    unlock();
  }
}

function normalizeStarts(state: GateState | Record<string, unknown>): number[] {
  const s = state as Record<string, unknown>;
  if (Array.isArray(s.starts)) {
    return (s.starts as unknown[])
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
      .sort((a, b) => a - b);
  }
  const last = s.lastCallAt;
  if (typeof last === "number" && last > 0) return [last];
  return [];
}

async function readGate(): Promise<GateState> {
  try {
    const raw = await fs.readFile(RATE_FILE, "utf-8");
    return JSON.parse(raw) as GateState;
  } catch {
    return { starts: [] };
  }
}

async function writeGate(starts: number[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(RATE_FILE), { recursive: true });
    await fs.writeFile(RATE_FILE, JSON.stringify({ starts }));
  } catch (e: any) {
    console.warn("[imagenUltraGate] write failed:", e?.message);
  }
}

/**
 * 在 60s 滑窗內若已有 10 次 Ultra 嘗試，回 false（改走 fallback，不占用配額）。
 * 否則記錄一次並回 true。
 */
export async function tryAcquireImagenUltraSlot(label: string): Promise<boolean> {
  return withFileLock(async () => {
    const now = Date.now();
    let starts = normalizeStarts(await readGate()).filter((t) => now - t < WINDOW_MS);
    if (starts.length >= MAX_STARTS_PER_WINDOW) {
      console.log(
        `[imagenUltraGate] 已满 ${MAX_STARTS_PER_WINDOW} 次/60s，跳过 Ultra · ${label}`,
      );
      return false;
    }
    starts = [...starts, Date.now()].sort((a, b) => a - b);
    await writeGate(starts);
    return true;
  });
}

function isRateLimitError(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes("429") || m.includes("rate") || m.includes("quota") || m.includes("resource_exhausted");
}

async function fetchVercelNanoImage(
  vercelBaseUrl: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<string> {
  const base = vercelBaseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/api/google?op=nanoImage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`nanoImage_${res.status}: ${errText.slice(0, 240)}`);
  }
  const j: any = await res.json();
  if (!j?.imageUrl) throw new Error(`nanoImage_empty: ${JSON.stringify(j).slice(0, 200)}`);
  return String(j.imageUrl);
}

export type GeminiProImageKeyFn = (prompt: string) => Promise<string>;

/**
 * 異步封面：先 Ultra（若本分鐘窗內未滿 10 次且呼叫未 429），再 Vertex / Nano Pro，再 API Key。
 */
export async function generateStrategicReportCoverImageUrl(opts: {
  prompt: string;
  vercelBaseUrl: string;
  jobId: string;
  geminiApiKeyImage: GeminiProImageKeyFn;
}): Promise<string | undefined> {
  const { prompt, vercelBaseUrl, jobId, geminiApiKeyImage } = opts;
  let cover: string | undefined;

  const ultraBody = {
    prompt,
    tier: "pro",
    aspectRatio: "9:16",
    model: IMAGEN_ULTRA_MODEL_ALIAS,
    imageSize: "2K",
  };
  const vertexProBody = {
    prompt,
    tier: "pro",
    aspectRatio: "9:16",
    model: "gemini-3-pro-image-preview",
    imageSize: "2K",
  };

  const canUltra = await tryAcquireImagenUltraSlot(`job=${jobId}`);
  if (canUltra) {
    try {
      cover = await fetchVercelNanoImage(vercelBaseUrl, ultraBody, 120_000);
      console.log(`[strategicCover] ✅ Imagen Ultra 9:16 jobId=${jobId}`);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.warn(`[strategicCover] Ultra 失败 jobId=${jobId}: ${msg}`);
      if (isRateLimitError(msg)) {
        console.warn(`[strategicCover] Ultra 疑似限流，改走 gemini-3-pro-image-preview jobId=${jobId}`);
      }
    }
  }

  for (let i = 1; i <= 3 && !cover; i++) {
    try {
      cover = await fetchVercelNanoImage(vercelBaseUrl, vertexProBody, 70_000);
      console.log(
        `[strategicCover] ✅ Vertex Nano Pro 9:16 第 ${i}/3 次 jobId=${jobId}`,
      );
    } catch (e: any) {
      console.warn(`[strategicCover] Vertex Pro 第 ${i}/3 次失败 jobId=${jobId}: ${e?.message ?? e}`);
      if (i < 3) await sleep(2000);
    }
  }

  for (let i = 1; i <= 3 && !cover; i++) {
    try {
      cover = await geminiApiKeyImage(prompt);
      console.log(
        `[strategicCover] ✅ Gemini API key Pro 9:16 第 ${i}/3 次 jobId=${jobId}`,
      );
    } catch (e: any) {
      console.warn(
        `[strategicCover] Gemini API key 第 ${i}/3 次失败 jobId=${jobId}: ${e?.message ?? e}`,
      );
      if (i < 3) await sleep(2000);
    }
  }

  if (!cover) {
    console.warn(`[strategicCover] 全部失败 thumbnailUrl=NULL jobId=${jobId}`);
  }
  return cover;
}
