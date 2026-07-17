/**
 * Seedance 成片探针（贵 · **默认关**）。
 *
 * 默认只打印说明并 exit 0，不花额度：
 *   pnpm run manhua:seedance-probe
 *
 * 真打一枪（走 Fly/线上 jobs，密钥在远端）：
 *   CANVAS_PROBE_SEEDANCE=1 pnpm run manhua:seedance-probe
 *   CANVAS_PROBE_SEEDANCE=1 CANVAS_PROBE_IMAGE_URL=https://... pnpm run manhua:seedance-probe
 *
 * 默认档：2.0-mini · 5s · 480p（shared/seedanceEvolinkModels.ts）
 * 全价：CANVAS_PROBE_SEEDANCE_VERSION=2.0 CANVAS_PROBE_SEEDANCE_QUALITY=720p CANVAS_PROBE_SEEDANCE_DURATION=15
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import {
  SEEDANCE_PROBE_DEFAULT_DURATION_SEC,
  SEEDANCE_PROBE_DEFAULT_QUALITY,
  resolveSeedanceProbeDefaults,
} from "../shared/seedanceEvolinkModels.ts";
import { MANHUA_DRAMA_DEFAULT_PROMPTS } from "../shared/videoReversePrompt.ts";

const ENABLED = String(process.env.CANVAS_PROBE_SEEDANCE || "").trim() === "1";
const BASE = String(
  process.env.CANVAS_PROBE_SEEDANCE_BASE ||
    process.env.LONG_JOBS_API_ORIGIN ||
    process.env.CANVAS_PROBE_BASE_URL ||
    "https://www.mvstudiopro.com",
)
  .trim()
  .replace(/\/$/, "");

async function fetchJson(url: string, body: unknown, timeoutMs: number) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
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

if (!ENABLED) {
  console.log("[seedance-probe] SKIP（默认关，不烧额度）");
  console.log("  开启：CANVAS_PROBE_SEEDANCE=1 pnpm run manhua:seedance-probe");
  console.log(
    `  默认档：2.0-mini · ${SEEDANCE_PROBE_DEFAULT_DURATION_SEC}s · ${SEEDANCE_PROBE_DEFAULT_QUALITY}`,
  );
  console.log("  需公网图：CANVAS_PROBE_IMAGE_URL=https://...");
  console.log("  也可：CANVAS_PROBE_SEEDANCE=1 pnpm run manhua:probe（六段）");
  process.exit(0);
}

const imageUrl = String(process.env.CANVAS_PROBE_IMAGE_URL || "").trim();
if (!imageUrl) {
  console.error("[seedance-probe] FAIL：已开启但缺少 CANVAS_PROBE_IMAGE_URL");
  process.exit(1);
}

const probeDefaults = resolveSeedanceProbeDefaults({
  version: process.env.CANVAS_PROBE_SEEDANCE_VERSION,
  quality: process.env.CANVAS_PROBE_SEEDANCE_QUALITY,
  duration: process.env.CANVAS_PROBE_SEEDANCE_DURATION,
});
const version = probeDefaults.version;
const resolution = probeDefaults.quality;
const duration = probeDefaults.duration;
const timeoutMs = Math.max(
  60_000,
  Number(process.env.CANVAS_PROBE_SEEDANCE_TIMEOUT_MS || 600_000) || 600_000,
);
const prompt =
  String(process.env.CANVAS_PROBE_SEEDANCE_PROMPT || "").trim() ||
  `${MANHUA_DRAMA_DEFAULT_PROMPTS.seedance_clip}\nslow push, face readable, soft emotion`;

console.log(
  `[seedance-probe] RUN ${version} ${duration}s ${resolution} base=${BASE} image=${imageUrl.slice(0, 80)}`,
);

const clip = await fetchJson(
  `${BASE}/api/jobs?op=seedanceI2V`,
  {
    prompt,
    imageUrl,
    version,
    resolution,
    aspectRatio: "9:16",
    duration,
    generateAudio: true,
    preferEvolink: true,
  },
  timeoutMs,
);

const videoUrl = String(clip.json?.videoUrl || "").trim();
const ok = clip.ok && Boolean(videoUrl);
console.log(
  `[${ok ? "PASS" : "FAIL"}] Seedance (${version} ${duration}s ${resolution}, ${clip.ms}ms http=${clip.status}) ${
    ok ? videoUrl.slice(0, 140) : String(clip.json?.error || clip.text).slice(0, 240)
  }`,
);
process.exit(ok ? 0 : 1);
