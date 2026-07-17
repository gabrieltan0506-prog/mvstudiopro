/**
 * 漫剧工厂探针：先测文本段（故事 brief），写一段就验一段。
 *
 *   pnpm exec tsx scripts/probe-manhua-factory.mts
 *   CANVAS_PROBE_BASE_URL=http://127.0.0.1:3000 pnpm exec tsx scripts/probe-manhua-factory.mts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { MANHUA_DRAMA_DEFAULT_PROMPTS } from "../shared/videoReversePrompt.ts";

const BASE = String(process.env.CANVAS_PROBE_BASE_URL || "https://www.mvstudiopro.com")
  .trim()
  .replace(/\/$/, "");
const TIMEOUT_MS = Math.max(15_000, Number(process.env.CANVAS_PROBE_TIMEOUT_MS || 180_000) || 180_000);
const IMAGE_TIMEOUT_MS = Math.max(
  TIMEOUT_MS,
  Number(process.env.CANVAS_PROBE_IMAGE_TIMEOUT_MS || 240_000) || 240_000,
);

async function fetchJson(url: string, body: unknown, timeoutMs = TIMEOUT_MS) {
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

function isTransientProbeHttp(status: number) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/** 角色卡等文本段：对瞬时 5xx/429 有限次退避（对齐工厂 isTransientFactoryError） */
async function fetchJsonWithBackoff(
  url: string,
  body: unknown,
  opts?: { timeoutMs?: number; label?: string; maxAttempts?: number },
) {
  const maxAttempts = Math.max(1, opts?.maxAttempts ?? 3);
  let last = await fetchJson(url, body, opts?.timeoutMs);
  for (let attempt = 1; attempt < maxAttempts && isTransientProbeHttp(last.status); attempt += 1) {
    const wait = 1200 * attempt;
    console.warn(
      `[manhua-factory-probe] ${opts?.label || "step"} http=${last.status} → 退避 ${wait}ms 后重试 ${attempt + 1}/${maxAttempts}`,
    );
    await new Promise((r) => setTimeout(r, wait));
    last = await fetchJson(url, body, opts?.timeoutMs);
  }
  return last;
}

function extractGeminiText(json: any): string {
  return String(
    json?.raw?.candidates?.[0]?.content?.parts?.[0]?.text || json?.text || "",
  ).trim();
}

async function main() {
  console.log(`[manhua-factory-probe] BASE=${BASE}`);

  const storyPrompt = `${MANHUA_DRAMA_DEFAULT_PROMPTS.story_brief}\n题材：星际车站离别，青涩校园情侣。`;
  const story = await fetchJson(`${BASE}/api/google?op=geminiScript`, {
    prompt: storyPrompt,
    model: "gemini-3.1-pro-preview",
  });
  const storyText = extractGeminiText(story.json);
  const storyOk = story.ok && Boolean(story.json?.ok) && storyText.length >= 40;
  console.log(
    `[${storyOk ? "PASS" : "FAIL"}] 工厂·故事 brief (${story.ms}ms http=${story.status}) ${storyText.slice(0, 160)}`,
  );
  if (!storyOk) {
    console.error(story.json?.error || story.text.slice(0, 300));
    process.exit(1);
  }

  const biblePrompt = `${MANHUA_DRAMA_DEFAULT_PROMPTS.character_bible}\n\n【上游故事】\n${storyText.slice(0, 2000)}`;
  const bible = await fetchJsonWithBackoff(
    `${BASE}/api/google?op=geminiScript`,
    {
      prompt: biblePrompt,
      model: "gemini-3.1-pro-preview",
    },
    { label: "工厂·角色卡", maxAttempts: 3 },
  );
  const bibleText = extractGeminiText(bible.json);
  const bibleOk = bible.ok && Boolean(bible.json?.ok) && bibleText.length >= 40;
  console.log(
    `[${bibleOk ? "PASS" : "FAIL"}] 工厂·角色卡 (${bible.ms}ms http=${bible.status}) ${bibleText.slice(0, 160)}`,
  );
  if (!bibleOk) {
    console.error(bible.json?.error || bible.text.slice(0, 300));
    process.exit(1);
  }

  const beatsPrompt = `${MANHUA_DRAMA_DEFAULT_PROMPTS.episode_beats}\n\n【上游角色】\n${bibleText.slice(0, 2000)}\n\n【上游故事】\n${storyText.slice(0, 1200)}`;
  const beats = await fetchJsonWithBackoff(
    `${BASE}/api/google?op=geminiScript`,
    {
      prompt: beatsPrompt,
      model: "gemini-3.1-pro-preview",
    },
    { label: "工厂·节拍", maxAttempts: 3 },
  );
  const beatsText = extractGeminiText(beats.json);
  const beatsOk = beats.ok && Boolean(beats.json?.ok) && beatsText.length >= 40;
  console.log(
    `[${beatsOk ? "PASS" : "FAIL"}] 工厂·节拍 (${beats.ms}ms http=${beats.status}) ${beatsText.slice(0, 160)}`,
  );

  if (!beatsOk) process.exit(1);

  // 第四段：无片反推（与画布工厂同逻辑：无帧时走 geminiScript 编导分镜表）
  const reversePrompt = [
    "你是影视拉片与 AI 视频提示词编译器。没有参考帧时，请仅根据用户节拍补全输出。",
    "硬规则：只输出 Markdown；成稿禁止导演名/片名；只写景别运镜光影微动。",
    "## 一句话摘要",
    "## 分镜表",
    "## Seedance / I2V 微动提示词（每镜一句）",
    "## 可复制总提示（首镜）",
    "",
    MANHUA_DRAMA_DEFAULT_PROMPTS.video_reverse,
    "",
    `【上游节拍】\n${beatsText.slice(0, 3000)}`,
  ].join("\n");
  const reverse = await fetchJson(`${BASE}/api/google?op=geminiScript`, {
    prompt: reversePrompt,
    model: "gemini-3.1-pro-preview",
  });
  const reverseText = extractGeminiText(reverse.json);
  const reverseOk =
    reverse.ok &&
    Boolean(reverse.json?.ok) &&
    reverseText.length >= 80 &&
    (/分镜|景别|运镜|Seedance|微动/i.test(reverseText));
  console.log(
    `[${reverseOk ? "PASS" : "FAIL"}] 工厂·无片反推 (${reverse.ms}ms http=${reverse.status}) ${reverseText.slice(0, 160)}`,
  );
  if (!reverseOk) {
    console.error(reverse.json?.error || reverse.text.slice(0, 400));
    process.exit(1);
  }

  // 第五段：关键静帧（Nano Banana）——用反推摘要作 prompt
  const keyArtPrompt =
    `${MANHUA_DRAMA_DEFAULT_PROMPTS.key_art}\n` +
    reverseText.split("\n").slice(0, 12).join("\n").slice(0, 800);
  let keyArtOk = false;
  let keyArtDetail = "";
  try {
    const keyArt = await fetchJson(
      `${BASE}/api/google?op=nanoImage&tier=flash&model=gemini-3.1-flash-image-preview`,
      {
        prompt: keyArtPrompt,
        aspectRatio: "9:16",
        imageSize: "1K",
        tier: "flash",
        model: "gemini-3.1-flash-image-preview",
        numberOfImages: 1,
      },
      IMAGE_TIMEOUT_MS,
    );
    const urls = Array.isArray(keyArt.json?.imageUrls) ? keyArt.json.imageUrls : [];
    keyArtOk = keyArt.ok && Boolean(keyArt.json?.ok) && urls.length > 0;
    keyArtDetail = keyArtOk
      ? String(urls[0]).slice(0, 120)
      : String(keyArt.json?.error || keyArt.text).slice(0, 200);
    console.log(
      `[${keyArtOk ? "PASS" : "FAIL"}] 工厂·关键静帧 (${keyArt.ms}ms http=${keyArt.status}) ${keyArtDetail}`,
    );
  } catch (e: unknown) {
    keyArtDetail = e instanceof Error ? e.message : String(e);
    console.log(`[FAIL] 工厂·关键静帧 (exception) ${keyArtDetail.slice(0, 200)}`);
  }
  if (!keyArtOk) process.exit(1);

  // 第六段（可选）：Seedance 2.0 Mini · 默认 5s·480p（廉价探针）
  //   CANVAS_PROBE_SEEDANCE=1 pnpm run manhua:probe
  //   全价档：CANVAS_PROBE_SEEDANCE_VERSION=2.0 CANVAS_PROBE_SEEDANCE_QUALITY=720p CANVAS_PROBE_SEEDANCE_DURATION=15
  let seedanceVideoUrl = "";
  if (String(process.env.CANVAS_PROBE_SEEDANCE || "").trim() === "1") {
    const seedanceBase = String(
      process.env.CANVAS_PROBE_SEEDANCE_BASE || process.env.LONG_JOBS_API_ORIGIN || BASE,
    )
      .trim()
      .replace(/\/$/, "");
    const motionHint =
      reverseText
        .match(/##\s*可复制总提示[^\n]*\n+([\s\S]*?)(?=\n##|\n*$)/i)?.[1]
        ?.trim()
        .slice(0, 400) || reverseText.slice(0, 400);
    const seedancePrompt = `${MANHUA_DRAMA_DEFAULT_PROMPTS.seedance_clip}\n${motionHint}`;
    const imageUrl = keyArtDetail;
    const version = String(process.env.CANVAS_PROBE_SEEDANCE_VERSION || "2.0-mini").trim() || "2.0-mini";
    const resolution = String(process.env.CANVAS_PROBE_SEEDANCE_QUALITY || "480p").trim() || "480p";
    const duration = Number(process.env.CANVAS_PROBE_SEEDANCE_DURATION || 5) || 5;
    const SEEDANCE_TIMEOUT_MS = Math.max(
      IMAGE_TIMEOUT_MS,
      Number(process.env.CANVAS_PROBE_SEEDANCE_TIMEOUT_MS || 600_000) || 600_000,
    );
    try {
      const clip = await fetchJson(
        `${seedanceBase}/api/jobs?op=seedanceI2V`,
        {
          prompt: seedancePrompt,
          imageUrl,
          version,
          resolution,
          aspectRatio: "9:16",
          duration,
          generateAudio: true,
          preferEvolink: true,
        },
        SEEDANCE_TIMEOUT_MS,
      );
      const videoUrl = String(clip.json?.videoUrl || "").trim();
      seedanceVideoUrl = videoUrl;
      const clipOk = clip.ok && Boolean(videoUrl);
      console.log(
        `[${clipOk ? "PASS" : "FAIL"}] 工厂·SeedanceMini (${version} ${duration}s ${resolution}, ${clip.ms}ms http=${clip.status}) ${
          clipOk ? videoUrl.slice(0, 120) : String(clip.json?.error || clip.text).slice(0, 200)
        }`,
      );
      if (!clipOk) process.exit(1);
      console.log("[manhua-factory-probe] 六段可用（含 Seedance Mini）");
    } catch (e: unknown) {
      console.log(
        `[FAIL] 工厂·SeedanceMini (exception) ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`,
      );
      process.exit(1);
    }
  } else {
    console.log(
      "[manhua-factory-probe] 五段可用；Seedance Mini 设 CANVAS_PROBE_SEEDANCE=1（默认 5s/480p/2.0-mini）",
    );
  }

  // 第七段（可选）：Gemini Omni video edit · 只用 GEMINI_API_KEY
  //   CANVAS_PROBE_OMNI_EDIT=1 pnpm run manhua:probe
  //   可附带 CANVAS_PROBE_OMNI_VIDEO_URL=... 或接上一段 Seedance 成片
  if (String(process.env.CANVAS_PROBE_OMNI_EDIT || "").trim() === "1") {
    const omniBase = String(process.env.CANVAS_PROBE_OMNI_BASE || BASE).trim().replace(/\/$/, "");
    const editPrompt =
      String(process.env.CANVAS_PROBE_OMNI_EDIT_PROMPT || "").trim() ||
      "Keep the same character identity. Slightly intensify eye emotion and add a gentle push-in camera move. Do not change costume.";
    const videoUrl =
      String(process.env.CANVAS_PROBE_OMNI_VIDEO_URL || "").trim() || seedanceVideoUrl;
    const OMNI_TIMEOUT_MS = Math.max(
      IMAGE_TIMEOUT_MS,
      Number(process.env.CANVAS_PROBE_OMNI_TIMEOUT_MS || 600_000) || 600_000,
    );
    try {
      const created = await fetchJson(
        `${omniBase}/api/google?op=omniInteractionCreate`,
        {
          prompt: editPrompt,
          task: "edit_video",
          videoUrl: videoUrl || undefined,
          aspectRatio: "9:16",
          durationSeconds: 5,
        },
        120_000,
      );
      const interactionId = String(created.json?.id || "").trim();
      if (!created.ok || !interactionId) {
        console.log(
          `[FAIL] 工厂·OmniEdit create (${created.ms}ms http=${created.status}) ${String(created.json?.message || created.json?.error || created.text).slice(0, 200)}`,
        );
        process.exit(1);
      }
      console.log(`[PASS] 工厂·OmniEdit create id=${interactionId.slice(0, 48)}`);

      // poll get
      const started = Date.now();
      let finalUrl = "";
      while (Date.now() - started < OMNI_TIMEOUT_MS) {
        const polled = await fetchJson(
          `${omniBase}/api/google?op=omniInteractionGet`,
          { interactionId },
          60_000,
        );
        const status = String(polled.json?.status || "").toLowerCase();
        finalUrl = String(polled.json?.videoUrl || "").trim();
        if (finalUrl || status === "completed" || status === "failed" || status === "cancelled") {
          const ok = Boolean(finalUrl) && status !== "failed";
          console.log(
            `[${ok ? "PASS" : "FAIL"}] 工厂·OmniEdit poll (${polled.ms}ms status=${status}) ${finalUrl.slice(0, 120) || String(polled.json?.error || polled.text).slice(0, 160)}`,
          );
          if (!ok) process.exit(1);
          break;
        }
        await new Promise((r) => setTimeout(r, 4000));
      }
      if (!finalUrl) {
        console.log("[FAIL] 工厂·OmniEdit timeout");
        process.exit(1);
      }
      console.log("[manhua-factory-probe] 七段可用（含 Omni video edit · GEMINI_API_KEY）");
    } catch (e: unknown) {
      console.log(
        `[FAIL] 工厂·OmniEdit (exception) ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`,
      );
      process.exit(1);
    }
  } else {
    console.log(
      "[manhua-factory-probe] Omni edit 设 CANVAS_PROBE_OMNI_EDIT=1（GEMINI_API_KEY；可配 CANVAS_PROBE_OMNI_VIDEO_URL）",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
