/**
 * /canvas 链路 API 探针：文案 / 整理 / 多图视觉 / 图片 / 视频。
 *
 * 用法：
 *   CANVAS_PROBE_BASE_URL=https://www.mvstudiopro.com pnpm exec tsx scripts/probe-canvas-apis.mts
 *   CANVAS_PROBE_BASE_URL=http://127.0.0.1:3000 pnpm exec tsx scripts/probe-canvas-apis.mts
 *
 * 可选：
 *   CANVAS_PROBE_SKIP_VIDEO=1   跳过视频（较慢/较贵）
 *   CANVAS_PROBE_SKIP_IMAGE=1   跳过图片
 *   CANVAS_PROBE_TIMEOUT_MS=120000
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

const BASE = String(process.env.CANVAS_PROBE_BASE_URL || "https://www.mvstudiopro.com")
  .trim()
  .replace(/\/$/, "");
const TIMEOUT_MS = Math.max(15_000, Number(process.env.CANVAS_PROBE_TIMEOUT_MS || 120_000) || 120_000);
const SKIP_VIDEO = /^(1|true|yes)$/i.test(String(process.env.CANVAS_PROBE_SKIP_VIDEO || ""));
const SKIP_IMAGE = /^(1|true|yes)$/i.test(String(process.env.CANVAS_PROBE_SKIP_IMAGE || ""));

type ProbeResult = {
  name: string;
  ok: boolean;
  ms: number;
  status?: number;
  detail: string;
};

const results: ProbeResult[] = [];

function trunc(s: unknown, n = 280): string {
  const t = typeof s === "string" ? s : JSON.stringify(s);
  if (!t) return "";
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; ok: boolean; json: any; text: string; ms: number }> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...init, signal: ctrl.signal, redirect: "follow" });
    const text = await resp.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { _nonJson: true, preview: text.slice(0, 200) };
    }
    return { status: resp.status, ok: resp.ok, json, text, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

function record(name: string, ok: boolean, ms: number, detail: string, status?: number) {
  results.push({ name, ok, ms, status, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name} (${ms}ms${status != null ? ` http=${status}` : ""}) ${detail}`);
}

async function probeGeminiScript() {
  const name = "文案·geminiScript（Vertex 3.1 Pro）";
  const r = await fetchJson(`${BASE}/api/google?op=geminiScript`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "用一句话写小红书封面钩子：每天十碗饭反而瘦十斤。只输出那一句。",
      model: "gemini-3.1-pro-preview",
    }),
  });
  const text = String(r.json?.raw?.candidates?.[0]?.content?.parts?.[0]?.text || r.json?.text || "").trim();
  const ok = r.ok && Boolean(r.json?.ok) && text.length > 0;
  record(name, ok, r.ms, ok ? trunc(text, 120) : trunc(r.json?.error || r.json || r.text), r.status);
}

async function probeOptimizeCopyViaTrpcShape() {
  /**
   * 画布「整理文案 / GPT 文案」走 tRPC optimizeCustomCopy，需登录。
   * 这里用同源 HTTP 探测：若无 cookie 会 401，仍可确认路由是否存活。
   */
  const name = "文案·optimizeCustomCopy（tRPC，画布 GPT 路径）";
  const r = await fetchJson(`${BASE}/api/trpc/mvAnalysis.optimizeCustomCopy?batch=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      "0": {
        json: {
          sourceText: "封面钩子：每天十碗饭反而瘦十斤。请整理成可发布短文。",
          optimizationBrief: "整理为结构化 Markdown",
        },
      },
    }),
  });
  const errMsg = String(
    r.json?.[0]?.error?.json?.message ||
      r.json?.error?.message ||
      r.json?.message ||
      r.text ||
      "",
  );
  // 未登录算「路由可达但需鉴权」；JSON 解析炸了才是真坏
  const authBlocked = /UNAUTHORIZED|未登录|登录|FORBIDDEN|401/i.test(errMsg) || r.status === 401;
  const looksJsonBomb = /Unexpected token|is not valid JSON|An error o/i.test(errMsg + r.text);
  const ok = authBlocked || (r.ok && !looksJsonBomb && !r.json?._nonJson);
  record(
    name,
    ok && !looksJsonBomb,
    r.ms,
    looksJsonBomb
      ? `JSON 炸裂：${trunc(errMsg || r.text)}`
      : authBlocked
        ? `路由可达，需登录（预期）：${trunc(errMsg, 160)}`
        : trunc(errMsg || r.json || r.text),
    r.status,
  );
}

async function probeCanvasVisionMarkdown() {
  const name = "整理·canvasVisionMarkdown（多图视觉）";
  // 用一张公开小图；若拉取失败，接口应返回可读错误而非非 JSON
  const r = await fetchJson(`${BASE}/api/google?op=canvasVisionMarkdown`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "用两句中文描述图片内容。",
      images: [
        {
          url: "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_92x30dp.png",
          mimeType: "image/png",
        },
      ],
      model: "gemini-3.1-pro-preview",
    }),
  });
  const md = String(r.json?.markdown || "").trim();
  const ok = r.ok && Boolean(r.json?.ok) && md.length > 0;
  record(name, ok, r.ms, ok ? trunc(md, 160) : trunc(r.json?.error || r.json?.message || r.json || r.text), r.status);
}

async function probeNanoImage() {
  const name = "图片·nanoImage（Nano Banana 2 / Flash）";
  const r = await fetchJson(`${BASE}/api/google?op=nanoImage&tier=flash&model=gemini-3.1-flash-image-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "竖版封面：一只网球在阳光下发球，干净背景，无文字",
      aspectRatio: "9:16",
      imageSize: "1K",
      tier: "flash",
      model: "gemini-3.1-flash-image-preview",
      numberOfImages: 1,
    }),
  });
  const urls = Array.isArray(r.json?.imageUrls) ? r.json.imageUrls : [];
  const ok = r.ok && Boolean(r.json?.ok) && urls.length > 0;
  record(
    name,
    ok,
    r.ms,
    ok ? `urls=${urls.length} ${trunc(urls[0], 120)}` : trunc(r.json?.error || r.json?.message || r.json || r.text),
    r.status,
  );
  return ok ? String(urls[0]) : "";
}

async function probeLegacyWorkflowSceneImageWrongPath() {
  const name = "图片·旧路径 workflowGenerateSceneImage（应失败：需 workflowId）";
  const r = await fetchJson(`${BASE}/api/jobs?op=workflowGenerateSceneImage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scenePrompt: "tennis serve portrait cover, bright daylight, no text",
      imageModel: "gpt-image-1",
      sceneCount: 1,
      aspectRatio: "9:16",
    }),
  });
  const expectsWorkflowId = /workflowId is required/i.test(String(r.json?.message || r.json?.error || r.text));
  // 此探针刻意验证「旧画布路径打错 API」；expectsWorkflowId=true 即诊断成立
  record(
    name,
    expectsWorkflowId,
    r.ms,
    expectsWorkflowId
      ? "诊断确认：旧 canvas 路径打到工作流 API（缺 workflowId）"
      : trunc(r.json || r.text),
    r.status,
  );
}

async function probeCanvasGptImage2() {
  const name = "图片·canvasGptImage2（画布 GPT-Image 新路径）";
  const r = await fetchJson(`${BASE}/api/jobs?op=canvasGptImage2`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "bright tennis serve portrait cover, clean background, no text",
      aspectRatio: "9:16",
    }),
  });
  const url = String(r.json?.imageUrl || "").trim();
  const ok = r.ok && Boolean(r.json?.ok) && url.length > 0;
  record(name, ok, r.ms, ok ? trunc(url, 120) : trunc(r.json?.error || r.json?.message || r.json || r.text), r.status);
}

async function probeBananaOrFalImage() {
  const name = "图片·bananaGenerate/falImage（jobs 备用）";
  const r = await fetchJson(`${BASE}/api/jobs?op=bananaGenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "bright tennis serve portrait, no text",
      aspectRatio: "9:16",
    }),
  });
  const urls = Array.isArray(r.json?.imageUrls) ? r.json.imageUrls : [];
  const ok =
    r.ok &&
    (Boolean(r.json?.imageUrl) || Boolean(r.json?.url) || Array.isArray(r.json?.images) || urls.length > 0);
  record(name, ok, r.ms, trunc(r.json?.error || r.json?.message || r.json || r.text), r.status);
}

async function probeOmniCreate() {
  const name = "视频·omniInteractionCreate（Gemini Omni Flash）";
  const r = await fetchJson(`${BASE}/api/google?op=omniInteractionCreate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "A person serves a tennis ball in bright sunlight, cinematic, 2 seconds feel",
      task: "text_to_video",
      aspectRatio: "9:16",
      durationSeconds: 4,
    }),
  });
  const id = String(r.json?.id || "").trim();
  const ok = r.ok && Boolean(r.json?.ok) && id.length > 0;
  record(
    name,
    ok,
    r.ms,
    ok ? `id=${id} model=${r.json?.model || "?"}` : trunc(r.json?.message || r.json?.error || r.json || r.text),
    r.status,
  );
  return ok ? id : "";
}

async function probeOmniGet(interactionId: string) {
  const name = "视频·omniInteractionGet（轮询一次）";
  const r = await fetchJson(
    `${BASE}/api/google?op=omniInteractionGet&interactionId=${encodeURIComponent(interactionId)}`,
  );
  const status = String(r.json?.status || "");
  const ok = r.ok && Boolean(r.json?.ok);
  record(
    name,
    ok,
    r.ms,
    ok
      ? `status=${status} videoUrl=${r.json?.videoUrl ? "yes" : "no"} failed=${Boolean(r.json?.failed)}`
      : trunc(r.json?.message || r.json?.error || r.json || r.text),
    r.status,
  );
}

async function probeSeedance(imageUrl?: string) {
  const name = "视频·seedanceI2V（EvoLink / fal）";
  const r = await fetchJson(`${BASE}/api/jobs?op=seedanceI2V`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "Cinematic tennis serve, stable camera, bright daylight",
      imageUrl: imageUrl || undefined,
      resolution: "720p",
      aspectRatio: "9:16",
      duration: 5,
      generateAudio: false,
      preferEvolink: true,
    }),
  });
  const ok = r.ok && Boolean(r.json?.videoUrl || r.json?.ok);
  record(
    name,
    ok,
    r.ms,
    ok
      ? `provider=${r.json?.provider || "?"} ${trunc(r.json?.videoUrl, 100)}`
      : trunc(r.json?.error || r.json?.message || r.json || r.text),
    r.status,
  );
}

async function main() {
  console.log(`\n=== Canvas API Probe ===\nBASE=${BASE}\nTIMEOUT_MS=${TIMEOUT_MS}\n`);

  await probeGeminiScript();
  await probeOptimizeCopyViaTrpcShape();
  await probeCanvasVisionMarkdown();

  let imageUrl = "";
  if (!SKIP_IMAGE) {
    await probeLegacyWorkflowSceneImageWrongPath();
    await probeCanvasGptImage2();
    imageUrl = await probeNanoImage();
    await probeBananaOrFalImage();
  } else {
    console.log("[SKIP] images");
  }

  if (!SKIP_VIDEO) {
    const omniId = await probeOmniCreate();
    if (omniId) await probeOmniGet(omniId);
    await probeSeedance(imageUrl || undefined);
  } else {
    console.log("[SKIP] video");
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== Summary: ${passed}/${results.length} passed ===`);
  if (failed.length) {
    console.log("\nFailed:");
    for (const f of failed) {
      console.log(` - ${f.name}: ${f.detail}`);
    }
  }

  const omni = results.find((r) => r.name.includes("omniInteractionCreate"));
  if (omni && !omni.ok && /thinkingLevel|thinking_level/i.test(omni.detail)) {
    console.log("\nROOT CAUSE HINT: Omni 视频 generation_config 须用 thinking_level（snake_case）。");
  }
  const seedance = results.find((r) => r.name.includes("seedanceI2V"));
  if (seedance && !seedance.ok && /ROUTER_EXTERNAL|An error o/i.test(seedance.detail)) {
    console.log("\nROOT CAUSE HINT: Seedance 被网关/Fly 超时打断（非 JSON），需缩短任务或修代理超时。");
  }

  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("probe crashed:", e);
  process.exit(1);
});
