/**
 * 一次性驗證：Open‑Meteo、OpenWeather（若有 key）、Gemini（dashboard 用模型）
 * 執行：npx tsx scripts/verify-ambient-apis-once.mts
 * 不會將任何 secret 印到 stdout。
 */
import dotenv from "dotenv";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

const TAIPEI = { lat: 25.033, lon: 121.565 };

function ok(name: string, detail: string) {
  console.log(`[OK] ${name}: ${detail}`);
}
function bad(name: string, detail: string) {
  console.log(`[FAIL] ${name}: ${detail}`);
}
function skip(name: string, detail: string) {
  console.log(`[SKIP] ${name}: ${detail}`);
}

async function main() {
  // 1) Open‑Meteo（與前端 / 後端無 key 路徑一致）
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${TAIPEI.lat}&longitude=${TAIPEI.lon}` +
      `&current=temperature_2m,weather_code&timezone=auto`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      bad("Open‑Meteo", `HTTP ${res.status}`);
    } else {
      const j = (await res.json()) as { current?: { temperature_2m?: number } };
      const t = j?.current?.temperature_2m;
      ok("Open‑Meteo", `current.temp ≈ ${t ?? "?"}`);
    }
  } catch (e) {
    bad("Open‑Meteo", (e as Error).message);
  }

  // 2) OpenWeather（僅在 OPENWEATHER_API_KEY 存在時）
  const owm = String(process.env.OPENWEATHER_API_KEY || "").trim();
  if (!owm) {
    skip("OpenWeather", "未設定 OPENWEATHER_API_KEY（可選；無則後端走 Open‑Meteo）");
  } else {
    try {
      const q = encodeURIComponent("Taipei");
      const url = `https://api.openweathermap.org/data/2.5/weather?q=${q}&appid=${owm}&units=metric&lang=zh_cn`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        bad("OpenWeather", `HTTP ${res.status}`);
      } else {
        const j = (await res.json()) as { name?: string; main?: { temp?: number } };
        ok("OpenWeather", `${j.name ?? "?"} ${j.main?.temp ?? "?"}°C`);
      }
    } catch (e) {
      bad("OpenWeather", (e as Error).message);
    }
  }

  // 3) Gemini（與 hybridDashboardEngine 相同套件）
  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!geminiKey) {
    bad("Gemini", "未設定 GEMINI_API_KEY");
    return;
  }

  const model =
    String(
      process.env.GEMINI_DASHBOARD_NEWS_MODEL ||
        process.env.GEMINI_DASHBOARD_TRAFFIC_MODEL ||
        "gemini-2.5-flash",
    ).trim() || "gemini-2.5-flash";

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: geminiKey });
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: '只回一個單詞 "PONG"，不要其它說明。' }] }],
      config: { maxOutputTokens: 16, temperature: 0 },
    });
    const text = String((response as { text?: string })?.text ?? "").trim().slice(0, 80);
    if (!text) {
      bad("Gemini", "空回應");
    } else {
      ok("Gemini", `model=${model} reply=${JSON.stringify(text)}`);
    }
  } catch (e) {
    bad("Gemini", (e as Error).message);
  }
}

await main();
