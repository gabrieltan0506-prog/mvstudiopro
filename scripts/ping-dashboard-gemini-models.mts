/**
 * 本機驗證儀表板用 Gemini 模型是否仍可用（讀 .env.local / .env 的 GEMINI_API_KEY）。
 * 用法：npx tsx scripts/ping-dashboard-gemini-models.mts
 */
import { config } from "dotenv";
import { GoogleGenAI } from "@google/genai";

config({ path: ".env.local" });
config({ path: ".env" });

const MODELS_TO_TRY = ["gemini-2.0-flash", "gemini-2.0-flash-001", "gemini-2.5-flash"] as const;

async function main() {
  const key = String(process.env.GEMINI_API_KEY ?? "").trim();
  if (!key || !key.startsWith("AIza") || key.length < 30) {
    console.error(
      "請在 .env.local 設定有效的 GEMINI_API_KEY（通常以 AIza 開頭）。目前值非典型 API key，無法測試。",
    );
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey: key });

  for (const model of MODELS_TO_TRY) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: "Reply with exactly: PONG" }] }],
        config: { maxOutputTokens: 16, temperature: 0 },
      });
      const text = String((response as { text?: string })?.text ?? "").trim();
      console.log(`OK   ${model}  -> ${JSON.stringify(text.slice(0, 60))}`);
    } catch (e) {
      console.log(`FAIL ${model} -> ${(e as Error).message}`);
    }
  }
}

await main();
