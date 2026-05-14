/**
 * 混合式即時資訊聚合：結構化資料走 API / RSS，路況語意總結走 Gemini（可選 Google Search 工具）。
 * 部署：Vercel / Node 18+；並行 Promise.allSettled，單路失敗可降級。
 */

export interface HybridDashboardData {
  currentTime: string;
  weather: {
    condition: string;
    temperature: string;
    humidity: string;
    source: "openweather" | "open-meteo" | "unavailable";
  };
  traffic: {
    summary: string;
    congestedAreas: string[];
  };
  news: { headline: string; source: string }[];
}

function getPreciseLocalTime(timeZone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    return formatter.format(new Date());
  } catch {
    return new Date().toISOString();
  }
}

function openMeteoCodeLabel(code: number): string {
  if (code === 0) return "晴";
  if ([1, 2, 3].includes(code)) return "多云";
  if ([45, 48].includes(code)) return "雾";
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return "雨";
  if ([71, 73, 75].includes(code)) return "雪";
  if ([95, 96, 99].includes(code)) return "雷雨";
  return "阴";
}

async function fetchOpenWeatherByCity(city: string): Promise<HybridDashboardData["weather"]> {
  const apiKey = String(process.env.OPENWEATHER_API_KEY || "").trim();
  if (!apiKey) throw new Error("missing_OPENWEATHER_API_KEY");
  const url =
    `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}` +
    `&appid=${apiKey}&units=metric&lang=zh_cn`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`openweather_${res.status}`);
  const data = (await res.json()) as {
    weather?: { description?: string }[];
    main?: { temp?: number; humidity?: number };
  };
  return {
    condition: data.weather?.[0]?.description || "未知",
    temperature: `${Math.round(Number(data.main?.temp ?? 0))}°C`,
    humidity: `${data.main?.humidity ?? "—"}%`,
    source: "openweather",
  };
}

/** OpenWeather 依 GPS 座標（與瀏覽器定位一致，不寫死城市） */
async function fetchOpenWeatherByLatLon(lat: number, lon: number): Promise<HybridDashboardData["weather"]> {
  const apiKey = String(process.env.OPENWEATHER_API_KEY || "").trim();
  if (!apiKey) throw new Error("missing_OPENWEATHER_API_KEY");
  const url =
    `https://api.openweathermap.org/data/2.5/weather?lat=${encodeURIComponent(String(lat))}` +
    `&lon=${encodeURIComponent(String(lon))}&appid=${apiKey}&units=metric&lang=zh_cn`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`openweather_${res.status}`);
  const data = (await res.json()) as {
    weather?: { description?: string }[];
    main?: { temp?: number; humidity?: number };
  };
  return {
    condition: data.weather?.[0]?.description || "未知",
    temperature: `${Math.round(Number(data.main?.temp ?? 0))}°C`,
    humidity: `${data.main?.humidity ?? "—"}%`,
    source: "openweather",
  };
}

async function fetchOpenMeteo(lat: number, lon: number): Promise<HybridDashboardData["weather"]> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,weather_code&timezone=auto`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`openmeteo_${res.status}`);
  const j = (await res.json()) as {
    current?: { temperature_2m?: number; relative_humidity_2m?: number; weather_code?: number };
  };
  const code = Number(j?.current?.weather_code ?? 0);
  const temp = Number(j?.current?.temperature_2m ?? 0);
  const hum = j?.current?.relative_humidity_2m;
  return {
    condition: openMeteoCodeLabel(code),
    temperature: `${Math.round(temp * 10) / 10}°C`,
    humidity: hum != null ? `${hum}%` : "—",
    source: "open-meteo",
  };
}

async function fetchGoogleNewsTw(): Promise<HybridDashboardData["news"]> {
  const url = "https://news.google.com/rss/headlines?hl=zh-TW&gl=TW&ceid=TW:zh-Hant";
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`google_news_${res.status}`);
  const xmlText = await res.text();
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const titleRegex = /<title>(.*?)<\/title>/;
  const sourceRegex = /<source[^>]*>(.*?)<\/source>/;
  const newsList: HybridDashboardData["news"] = [];
  let match: RegExpExecArray | null;
  let count = 0;
  while ((match = itemRegex.exec(xmlText)) !== null && count < 3) {
    const itemBlock = match[1];
    const titleMatch = titleRegex.exec(itemBlock);
    const sourceMatch = sourceRegex.exec(itemBlock);
    if (titleMatch && sourceMatch) {
      const cleanTitle = titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1").trim();
      const cleanSource = sourceMatch[1].trim();
      if (cleanTitle && cleanSource) {
        newsList.push({ headline: cleanTitle, source: cleanSource });
        count++;
      }
    }
  }
  return newsList;
}

function safeParseTrafficJson(raw: string): HybridDashboardData["traffic"] {
  const fallback: HybridDashboardData["traffic"] = {
    summary: "路況資料暫時無法解析",
    congestedAreas: [],
  };
  const t = raw.trim();
  if (!t) return { ...fallback, summary: "路況資料暫時無法取得" };
  try {
    const o = JSON.parse(t) as { summary?: string; congestedAreas?: string[] };
    return {
      summary: String(o.summary || "").trim() || fallback.summary,
      congestedAreas: Array.isArray(o.congestedAreas) ? o.congestedAreas.map(String) : [],
    };
  } catch {
    const m = t.match(/\{[\s\S]*"summary"[\s\S]*\}/);
    if (m) {
      try {
        const o = JSON.parse(m[0]) as { summary?: string; congestedAreas?: string[] };
        return {
          summary: String(o.summary || "").trim() || fallback.summary,
          congestedAreas: Array.isArray(o.congestedAreas) ? o.congestedAreas.map(String) : [],
        };
      } catch {
        /* ignore */
      }
    }
    return { ...fallback, summary: t.slice(0, 200) };
  }
}

async function fetchTrafficViaGemini(locationLabel: string): Promise<HybridDashboardData["traffic"]> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("missing_GEMINI_API_KEY");

  const model =
    String(process.env.GEMINI_DASHBOARD_TRAFFIC_MODEL || "gemini-2.5-flash").trim() || "gemini-2.5-flash";
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const systemInstruction =
    "你是交通資訊助理。請用 Google 搜尋查詢使用者給定區域的「即時路況」與「擁堵路段」（若搜尋不可用則依常識給出保守說明並註明不確定）。" +
    "僅輸出合法 JSON：{\"summary\":\"一句話繁體中文總結\",\"congestedAreas\":[\"路段1\",\"路段2\"]}。" +
    "congestedAreas 最多 5 條，沒有則為空陣列。";

  const userText = `請查詢【${locationLabel}】現在的即時路況與主要擁堵區段。`;

  type GenCfg = Record<string, unknown>;
  const baseCfg: GenCfg = {
    systemInstruction,
    responseMimeType: "application/json",
    temperature: 0.3,
    maxOutputTokens: 4096,
  };

  let text = "";
  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: userText }] }],
      config: { ...baseCfg, tools: [{ googleSearch: {} }] } as any,
    });
    text = String((response as { text?: string })?.text ?? "").trim();
  } catch (e) {
    console.warn("[hybridDashboard] Gemini googleSearch 降級:", (e as Error)?.message);
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: userText }] }],
      config: baseCfg as any,
    });
    text = String((response as { text?: string })?.text ?? "").trim();
  }

  return safeParseTrafficJson(text);
}

export type HybridDashboardOpts = {
  /**
   * IANA 時區（應由前端傳 `Intl.DateTimeFormat().resolvedOptions().timeZone`，與使用者「當地」一致）。
   * 未傳時可用環境變數 DASHBOARD_TIMEZONE；再無則以 UTC 顯示。
   */
  timeZone?: string;
  /** 可選：OpenWeather `q=`（未定位時後台手動指定城市才需要；不再預設任何城市） */
  weatherCity?: string;
  lat?: number;
  lon?: number;
  /** 路況搜尋用區域描述（繁中） */
  trafficLocation?: string;
};

export async function executeHybridDashboardPipeline(opts: HybridDashboardOpts = {}): Promise<HybridDashboardData> {
  const timeZone =
    opts.timeZone?.trim() ||
    String(process.env.DASHBOARD_TIMEZONE || "").trim() ||
    "UTC";

  const weatherCityOverride =
    opts.weatherCity?.trim() || String(process.env.DASHBOARD_WEATHER_CITY || "").trim();

  const lat = opts.lat;
  const lon = opts.lon;
  const hasCoords = lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon);
  const hasOwm = !!String(process.env.OPENWEATHER_API_KEY || "").trim();

  const trafficLabel =
    opts.trafficLocation?.trim() ||
    (hasCoords ? `座標 ${lat!.toFixed(2)}, ${lon!.toFixed(2)} 鄰近道路` : "未指定區域（路況為概括參考）");

  const [weatherResult, newsResult, trafficResult] = await Promise.allSettled([
    (async () => {
      if (hasOwm && hasCoords) {
        try {
          return await fetchOpenWeatherByLatLon(lat!, lon!);
        } catch (e) {
          console.warn("[hybridDashboard] OpenWeather(lat,lon) 失敗:", (e as Error)?.message);
        }
      }
      if (hasOwm && weatherCityOverride) {
        try {
          return await fetchOpenWeatherByCity(weatherCityOverride);
        } catch (e) {
          console.warn("[hybridDashboard] OpenWeather(q) 失敗:", (e as Error)?.message);
        }
      }
      if (hasCoords) {
        return await fetchOpenMeteo(lat!, lon!);
      }
      throw new Error("no_weather_source");
    })(),
    fetchGoogleNewsTw(),
    fetchTrafficViaGemini(trafficLabel),
  ]);

  const weather: HybridDashboardData["weather"] =
    weatherResult.status === "fulfilled"
      ? weatherResult.value
      : { condition: "無法取得", temperature: "—", humidity: "—", source: "unavailable" };

  const news = newsResult.status === "fulfilled" ? newsResult.value : [];

  const traffic: HybridDashboardData["traffic"] =
    trafficResult.status === "fulfilled"
      ? trafficResult.value
      : { summary: "路況資料暫時無法取得（請確認 GEMINI_API_KEY）", congestedAreas: [] };

  return {
    currentTime: getPreciseLocalTime(timeZone),
    weather,
    traffic,
    news,
  };
}
