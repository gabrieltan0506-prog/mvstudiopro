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
  console.log("[manhua-factory-probe] 文本三段可用（故事→角色→节拍）");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
