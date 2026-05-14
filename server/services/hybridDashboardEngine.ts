/**
 * 混合式即時資訊聚合：天氣／路況約 10 分鐘節流；即時新聞由 Gemini（+搜尋）產出並約 30 分鐘節流。
 */

/** 天氣 + 路況 + 時間（與新聞分開拉取，節奏不同） */
export interface HybridDashboardLiveData {
  currentTime: string;
  weather: HybridDashboardData["weather"];
  traffic: HybridDashboardData["traffic"];
}

/** 國內新聞 tier：前 2 條為定位周邊（省／城市群），後 3 條為全國重大；國際固定 5 條 */
export type AmbientNewsTier = "local" | "national" | "international";

export type AmbientNewsItem = {
  headline: string;
  source: string;
  tier: AmbientNewsTier;
};

export type AmbientNewsBundle = {
  domestic: AmbientNewsItem[];
  international: AmbientNewsItem[];
};

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
  /** 國內 5 + 國際 5 扁平列表（國內在前），兼容 hybridDashboard */
  news: AmbientNewsItem[];
}

const LIVE_CACHE_TTL_MS = 10 * 60 * 1000;
const NEWS_CACHE_TTL_MS = 30 * 60 * 1000;

const liveResponseCache = new Map<string, { expires: number; data: HybridDashboardLiveData }>();
const newsBundleCache = new Map<string, { expires: number; data: AmbientNewsBundle }>();

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

/** Google News RSS：近年 item 常無 <source>，標題為「…頭條… - 媒體名」；須兼容兩種格式。 */
function rssStripCdata(s: string): string {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function splitGoogleNewsTitle(rawTitle: string): { headline: string; source: string } {
  const t = rssStripCdata(rawTitle);
  const parts = t.split(/\s*-\s*/);
  if (parts.length >= 2) {
    const source = parts[parts.length - 1]!.trim();
    const headline = parts.slice(0, -1).join(" - ").trim();
    if (headline && source) return { headline, source };
  }
  return { headline: t, source: "Google News" };
}

function parseGoogleNewsRssXmlToItems(
  xmlText: string,
  maxItems: number,
  tier: AmbientNewsTier,
): AmbientNewsItem[] {
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const titleRegex = /<title>(.*?)<\/title>/;
  const sourceTagRegex = /<source[^>]*>(.*?)<\/source>/;
  const newsList: AmbientNewsItem[] = [];
  let match: RegExpExecArray | null;
  let count = 0;
  while ((match = itemRegex.exec(xmlText)) !== null && count < maxItems) {
    const itemBlock = match[1] ?? "";
    const titleMatch = titleRegex.exec(itemBlock);
    if (!titleMatch?.[1]) continue;
    const rawTitle = titleMatch[1];
    const sourceTag = sourceTagRegex.exec(itemBlock);
    let headline: string;
    let source: string;
    if (sourceTag?.[1]?.trim()) {
      headline = rssStripCdata(rawTitle);
      source = rssStripCdata(sourceTag[1]);
    } else {
      const sp = splitGoogleNewsTitle(rawTitle);
      headline = sp.headline;
      source = sp.source;
    }
    if (headline) {
      newsList.push({ headline, source: source || "媒体", tier });
      count++;
    }
  }
  return newsList;
}

async function fetchGoogleNewsRssFeed(
  url: string,
  maxItems: number,
  tier: AmbientNewsTier,
): Promise<AmbientNewsItem[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`google_news_${res.status}`);
  const xmlText = await res.text();
  return parseGoogleNewsRssXmlToItems(xmlText, maxItems, tier);
}

/** 降級：國內提要 CN + 國際提要 US（無法做省級本地切分） */
async function fetchAmbientNewsRssFallbackBundle(): Promise<AmbientNewsBundle> {
  const cnUrl = "https://news.google.com/rss/headlines?hl=zh-CN&gl=CN&ceid=CN:zh-Hans";
  const intlUrl = "https://news.google.com/rss/headlines?hl=en-US&gl=US&ceid=US:en";
  const [domestic, international] = await Promise.all([
    fetchGoogleNewsRssFeed(cnUrl, 5, "national"),
    fetchGoogleNewsRssFeed(intlUrl, 5, "international"),
  ]);
  return { domestic, international };
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

function isRoughlyMainlandChina(lat: number, lon: number): boolean {
  return lat >= 18 && lat <= 54 && lon >= 73 && lon <= 135;
}

/** 路況搜尋用：在座標基礎上給可搜關鍵字，避免只丟經緯度導致摘要空泛 */
function trafficSearchLabelFromCoords(lat: number, lon: number): string | null {
  if (!isRoughlyMainlandChina(lat, lon)) return null;
  if (lat >= 30.7 && lat <= 31.95 && lon >= 120.85 && lon <= 122.25) {
    return "上海市快速路、高架與市區主幹道";
  }
  if (lat >= 30.55 && lat <= 32.05 && lon >= 119.75 && lon <= 121.35) {
    return "蘇州市區及周邊主幹道";
  }
  if (lat >= 30.0 && lat <= 32.6 && lon >= 118.5 && lon <= 122.6) {
    return "長三角江浙滬主要城市快速路即時路況";
  }
  return `中國大陸（緯度 ${lat.toFixed(2)}°、經度 ${lon.toFixed(2)}°）附近主幹道`;
}

function newsBundleCacheKey(lat?: number, lon?: number): string {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return "no-geo";
  return `${lat.toFixed(2)}_${lon.toFixed(2)}`;
}

function safeParseAmbientNewsBundle(raw: string): AmbientNewsBundle {
  try {
    const o = JSON.parse(raw.trim()) as {
      domestic?: { headline?: string; source?: string; tier?: string }[];
      international?: { headline?: string; source?: string; tier?: string }[];
    };
    const domestic = (Array.isArray(o.domestic) ? o.domestic : [])
      .map((it) => ({
        headline: String(it?.headline ?? "").trim(),
        source: String(it?.source ?? "").trim() || "媒体",
        tier: "national" as AmbientNewsTier,
      }))
      .filter((x) => x.headline.length > 0);
    const international = (Array.isArray(o.international) ? o.international : [])
      .map((it) => ({
        headline: String(it?.headline ?? "").trim(),
        source: String(it?.source ?? "").trim() || "媒体",
        tier: "international" as const,
      }))
      .filter((x) => x.headline.length > 0);
    return { domestic, international };
  } catch {
    return { domestic: [], international: [] };
  }
}

function padNewsBundle(bundle: AmbientNewsBundle): AmbientNewsBundle {
  const fill = (arr: AmbientNewsItem[], n: number, tier: AmbientNewsTier): AmbientNewsItem[] => {
    const o = [...arr];
    while (o.length < n) o.push({ headline: "（暂无可核验来源）", source: "—", tier });
    return o.slice(0, n);
  };
  return {
    domestic: fill(bundle.domestic, 5, "national"),
    international: fill(bundle.international, 5, "international"),
  };
}

/** 前 2 條國內＝周邊（僅大陸內定位）；後 3 條＝全國；國際恒為 international */
function finalizeDomesticTiers(bundle: AmbientNewsBundle, allowLocalFirstPair: boolean): AmbientNewsBundle {
  const domestic = bundle.domestic.map((item, i) => {
    if (!allowLocalFirstPair) return { ...item, tier: "national" as const };
    if (i < 2) return { ...item, tier: "local" as const };
    return { ...item, tier: "national" as const };
  });
  const international = bundle.international.map((item) => ({ ...item, tier: "international" as const }));
  return { domestic, international };
}

async function fetchAmbientNewsViaGemini(opts: { lat?: number; lon?: number }): Promise<AmbientNewsBundle> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("missing_GEMINI_API_KEY");

  const model =
    String(
      process.env.GEMINI_DASHBOARD_NEWS_MODEL ||
        process.env.GEMINI_DASHBOARD_TRAFFIC_MODEL ||
        "gemini-2.5-flash",
    ).trim() || "gemini-2.5-flash";
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const hasGeo =
    opts.lat != null && opts.lon != null && Number.isFinite(opts.lat) && Number.isFinite(opts.lon);
  const inChina = hasGeo && isRoughlyMainlandChina(opts.lat!, opts.lon!);

  const locationBlock = hasGeo
    ? `用户浏览器定位：纬度 ${opts.lat!.toFixed(4)}、经度 ${opts.lon!.toFixed(4)}。` +
      (inChina
        ? "坐标若在中国境内：请推断省／直辖市；domestic 前 2 条必须是「本省或相邻同城圈」的即时要闻（如上海侧重江浙沪、苏州侧重江苏省），后 3 条为全国层面重大新闻。"
        : "坐标不在中国大陆：domestic 共 5 条全部为中国大陆全国要闻（勿写当地外国城市民生充数）。")
    : "未提供定位：domestic 5 条全部为全国层面中国要闻。";

  const systemInstruction =
    "你是中国新闻主编。必须用 Google 搜索今日可核验的公开报道。" +
    "只输出简体中文合法 JSON：{\"domestic\":[...5],\"international\":[...5]}。" +
    "每项 {\"headline\":\"简体短标题\",\"source\":\"媒体名\",\"tier\":\"local|national|international\"}。" +
    "domestic 正好 5 条且均为中国大陆议题；international 正好 5 条且均为境外／全球要闻。" +
    "有大陆定位时 domestic 前 2 条 tier=local（周边省区），后 3 条 tier=national；无定位或境外时 domestic 五条 tier 均为 national。" +
    "international 五条 tier 均为 international。搜不到时可用占位句但勿编造具体事实。";

  const userText = `${locationBlock} 请搜索并整理，填满 domestic 5 + international 5。`;

  type GenCfg = Record<string, unknown>;
  const baseCfg: GenCfg = {
    systemInstruction,
    responseMimeType: "application/json",
    temperature: 0.35,
    maxOutputTokens: 8192,
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
    console.warn("[dashboardNews] Gemini googleSearch 降級:", (e as Error)?.message);
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: userText }] }],
      config: baseCfg as any,
    });
    text = String((response as { text?: string })?.text ?? "").trim();
  }

  return safeParseAmbientNewsBundle(text);
}

export type DashboardNewsOpts = { lat?: number; lon?: number };

/** tRPC / 前端：結構化版塊 + 扁平列表（國內 5 + 國際 5） */
export type DashboardNewsResult = {
  domestic: AmbientNewsItem[];
  international: AmbientNewsItem[];
  news: AmbientNewsItem[];
};

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

function liveOptsKey(opts: HybridDashboardOpts): string {
  return [
    opts.timeZone?.trim() ?? "",
    opts.lat ?? "",
    opts.lon ?? "",
    opts.trafficLocation?.trim() ?? "",
    opts.weatherCity?.trim() ?? "",
  ].join("|");
}

/** 天氣 + 路況 + 當地時間；服務端約 10 分鐘快取（同參數重複請求不打 API／Gemini）。 */
export async function executeDashboardLive(opts: HybridDashboardOpts = {}): Promise<HybridDashboardLiveData> {
  const key = liveOptsKey(opts);
  const now = Date.now();
  const hit = liveResponseCache.get(key);
  if (hit && hit.expires > now) return hit.data;

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
    (hasCoords
      ? trafficSearchLabelFromCoords(lat!, lon!) ?? `座標 ${lat!.toFixed(2)}, ${lon!.toFixed(2)} 鄰近道路`
      : "未指定區域（路況為概括參考）");

  const [weatherResult, trafficResult] = await Promise.allSettled([
    (async () => {
      if (hasOwm && hasCoords) {
        try {
          return await fetchOpenWeatherByLatLon(lat!, lon!);
        } catch (e) {
          console.warn("[dashboardLive] OpenWeather(lat,lon) 失敗:", (e as Error)?.message);
        }
      }
      if (hasOwm && weatherCityOverride) {
        try {
          return await fetchOpenWeatherByCity(weatherCityOverride);
        } catch (e) {
          console.warn("[dashboardLive] OpenWeather(q) 失敗:", (e as Error)?.message);
        }
      }
      if (hasCoords) {
        return await fetchOpenMeteo(lat!, lon!);
      }
      throw new Error("no_weather_source");
    })(),
    fetchTrafficViaGemini(trafficLabel),
  ]);

  const weather: HybridDashboardData["weather"] =
    weatherResult.status === "fulfilled"
      ? weatherResult.value
      : { condition: "無法取得", temperature: "—", humidity: "—", source: "unavailable" };

  const traffic: HybridDashboardData["traffic"] =
    trafficResult.status === "fulfilled"
      ? trafficResult.value
      : { summary: "路況資料暫時無法取得（請確認 GEMINI_API_KEY）", congestedAreas: [] };

  const data: HybridDashboardLiveData = {
    currentTime: getPreciseLocalTime(timeZone),
    weather,
    traffic,
  };

  liveResponseCache.set(key, { expires: now + LIVE_CACHE_TTL_MS, data });
  if (liveResponseCache.size > 200) {
    const staleKeys: string[] = [];
    liveResponseCache.forEach((v, k) => {
      if (v.expires <= now) staleKeys.push(k);
    });
    for (const k of staleKeys) liveResponseCache.delete(k);
  }

  return data;
}

function flattenNewsBundle(bundle: AmbientNewsBundle): AmbientNewsItem[] {
  return [...bundle.domestic, ...bundle.international];
}

/** 即時新聞：Gemini（+ 搜尋）為主；依定位 key 約 30 分鐘快取。失敗時降級 Google News RSS（無省級細分）。 */
export async function executeDashboardNews(opts: DashboardNewsOpts = {}): Promise<DashboardNewsResult> {
  const now = Date.now();
  const cacheKey = newsBundleCacheKey(opts.lat, opts.lon);
  const cached = newsBundleCache.get(cacheKey);
  if (cached && cached.expires > now) {
    const b = cached.data;
    return { domestic: b.domestic, international: b.international, news: flattenNewsBundle(b) };
  }

  const hasGeo =
    opts.lat != null && opts.lon != null && Number.isFinite(opts.lat) && Number.isFinite(opts.lon);
  const allowLocalFirstPair = hasGeo && isRoughlyMainlandChina(opts.lat!, opts.lon!);

  let bundle: AmbientNewsBundle = { domestic: [], international: [] };
  let fromGemini = false;
  try {
    bundle = await fetchAmbientNewsViaGemini(opts);
    fromGemini = true;
  } catch (e) {
    console.warn("[dashboardNews] Gemini 失敗，降級 RSS:", (e as Error)?.message);
    try {
      bundle = await fetchAmbientNewsRssFallbackBundle();
      fromGemini = false;
    } catch (e2) {
      console.warn("[dashboardNews] RSS 失敗:", (e2 as Error)?.message);
      bundle = { domestic: [], international: [] };
    }
  }

  bundle = padNewsBundle(bundle);
  const allowLocal = Boolean(fromGemini && allowLocalFirstPair);
  bundle = finalizeDomesticTiers(bundle, allowLocal);

  newsBundleCache.set(cacheKey, { expires: now + NEWS_CACHE_TTL_MS, data: bundle });
  if (newsBundleCache.size > 200) {
    const staleKeys: string[] = [];
    newsBundleCache.forEach((v, k) => {
      if (v.expires <= now) staleKeys.push(k);
    });
    for (const k of staleKeys) newsBundleCache.delete(k);
  }

  return {
    domestic: bundle.domestic,
    international: bundle.international,
    news: flattenNewsBundle(bundle),
  };
}

/** 單次全量；新聞與天氣路況各自沿用上方快取邏輯。 */
export async function executeHybridDashboardPipeline(opts: HybridDashboardOpts = {}): Promise<HybridDashboardData> {
  const [live, newsResult] = await Promise.all([
    executeDashboardLive(opts),
    executeDashboardNews({ lat: opts.lat, lon: opts.lon }),
  ]);
  return { ...live, news: newsResult.news };
}
