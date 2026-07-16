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
const TIMEOUT_MS = Math.max(15_000, Number(process.env.CANVAS_PROBE_TIMEOUT_MS || 120_000) || 120_000);

async function fetchJson(url: string, body: unknown) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
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
  const bible = await fetchJson(`${BASE}/api/google?op=geminiScript`, {
    prompt: biblePrompt,
    model: "gemini-3.1-pro-preview",
  });
  const bibleText = extractGeminiText(bible.json);
  const bibleOk = bible.ok && Boolean(bible.json?.ok) && bibleText.length >= 40;
  console.log(
    `[${bibleOk ? "PASS" : "FAIL"}] 工厂·角色卡 (${bible.ms}ms http=${bible.status}) ${bibleText.slice(0, 160)}`,
  );
  if (!bibleOk) process.exit(1);

  const beatsPrompt = `${MANHUA_DRAMA_DEFAULT_PROMPTS.episode_beats}\n\n【上游角色】\n${bibleText.slice(0, 2000)}\n\n【上游故事】\n${storyText.slice(0, 1200)}`;
  const beats = await fetchJson(`${BASE}/api/google?op=geminiScript`, {
    prompt: beatsPrompt,
    model: "gemini-3.1-pro-preview",
  });
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
  );
  const urls = Array.isArray(keyArt.json?.imageUrls) ? keyArt.json.imageUrls : [];
  const keyArtOk = keyArt.ok && Boolean(keyArt.json?.ok) && urls.length > 0;
  console.log(
    `[${keyArtOk ? "PASS" : "FAIL"}] 工厂·关键静帧 (${keyArt.ms}ms http=${keyArt.status}) ${
      keyArtOk ? String(urls[0]).slice(0, 120) : String(keyArt.json?.error || keyArt.text).slice(0, 200)
    }`,
  );
  if (!keyArtOk) process.exit(1);

  console.log("[manhua-factory-probe] 五段可用（故事→角色→节拍→反推→静帧）");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
