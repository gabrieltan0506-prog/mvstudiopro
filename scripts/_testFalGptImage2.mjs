/**
 * Smoke test: fal REST `POST https://fal.run/openai/gpt-image-2` (no GCS).
 *
 * Usage from repo root:
 *   node scripts/_testFalGptImage2.mjs
 *   node scripts/_testFalGptImage2.mjs "ASCII English prompt only"
 *
 * Reads `.env.local`: FAL_API_KEY or FAL_KEY (must be ASCII; no smart quotes).
 */
import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env.local"), quiet: true });

const key = String(process.env.FAL_API_KEY || process.env.FAL_KEY || "").trim();
if (!key || !/^[\x21-\x7e]+$/.test(key)) {
  console.error("Missing or non-ASCII FAL_API_KEY / FAL_KEY (check .env.local, strip quotes/BOM).");
  process.exit(1);
}

const promptRaw = process.argv.slice(2).join(" ").trim();
const prompt =
  promptRaw && /^[\x20-\x7E]+$/.test(promptRaw)
    ? promptRaw
    : "Minimal abstract vertical gradient dark blue to violet, no text, no letters.";

const body = {
  prompt,
  image_size: { width: 1024, height: 1536 },
  quality: "high",
  num_images: 1,
  output_format: "jpeg",
};

console.log("POST https://fal.run/openai/gpt-image-2");
console.log("prompt:", prompt.slice(0, 100) + (prompt.length > 100 ? "…" : ""));

const res = await fetch("https://fal.run/openai/gpt-image-2", {
  method: "POST",
  headers: {
    Authorization: `Key ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const text = await res.text();
let json;
try {
  json = JSON.parse(text);
} catch {
  console.error("Non-JSON response", res.status, text.slice(0, 500));
  process.exit(1);
}

if (!res.ok) {
  console.error("HTTP", res.status, JSON.stringify(json).slice(0, 800));
  process.exit(1);
}

const url = json?.images?.[0]?.url ?? json?.image?.url ?? json?.data?.images?.[0]?.url;
if (!url) {
  console.error("No image URL in body:", JSON.stringify(json).slice(0, 1200));
  process.exit(1);
}

console.log("OK");
console.log("image url:", url);
