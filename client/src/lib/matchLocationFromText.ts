import { CHINA_PROVINCES } from "./chinaLocationCatalog";
import type { ManualLocationStored } from "./locationOverride";

type GeoHit = {
  name: string;
  latitude: number;
  longitude: number;
  country_code?: string;
  admin1?: string;
};

function norm(s: string): string {
  return s.replace(/\s+/g, "").trim();
}

function stripAdminSuffix(s: string): string {
  return s
    .replace(/省$/, "")
    .replace(/市$/, "")
    .replace(/自治区$/, "")
    .replace(/特别行政区$/, "")
    .replace(/壮族|回族|维吾尔/, "");
}

/** 「朝陽區」「浦東新區」→ 便于匹配語音「朝陽」「浦東」 */
function placeBareName(name: string): string {
  return name
    .replace(/新区$/, "")
    .replace(/区$/, "")
    .replace(/县$/, "")
    .replace(/市$/, "")
    .trim();
}

/** 目錄最長詞匹配（適合語音輸出含城市名） */
export function matchLocationFromCatalog(text: string): ManualLocationStored | null {
  const t = norm(text);
  if (!t) return null;
  let best: { spec: ManualLocationStored; score: number } | null = null;
  for (const p of CHINA_PROVINCES) {
    for (const c of p.cities) {
      const cityBare = stripAdminSuffix(c.name);
      const bare = placeBareName(c.name);
      const aliases = [c.name, cityBare, bare]
        .map((x) => x.trim())
        .filter((x) => x.length >= 2)
        .filter((x, i, a) => a.indexOf(x) === i);
      for (const a of aliases) {
        if (a.length >= 2 && t.includes(a)) {
          const score = a.length * 10 + (t.indexOf(a) === 0 ? 2 : 0);
          const spec: ManualLocationStored = {
            v: 1,
            provinceId: p.id,
            provinceName: p.name,
            cityName: c.name,
            lat: c.lat,
            lon: c.lon,
          };
          if (!best || score > best.score) best = { spec, score };
        }
      }
    }
    const pBare = stripAdminSuffix(p.name);
    const provinceHints = [p.name, pBare].filter((x, i, a) => a.indexOf(x) === i && x.length >= 2);
    for (const hint of provinceHints) {
      if (t.includes(hint)) {
        const cap = p.cities[0];
        if (cap) {
          const score = hint.length * 3;
          const spec: ManualLocationStored = {
            v: 1,
            provinceId: p.id,
            provinceName: p.name,
            cityName: cap.name,
            lat: cap.lat,
            lon: cap.lon,
          };
          if (!best || score > best.score) best = { spec, score };
        }
        break;
      }
    }
  }
  return best?.spec ?? null;
}

const ALLOW_CC = new Set(["CN", "HK", "MO", "TW"]);
const OPEN_METEO_GEOCODE_TIMEOUT_MS = 2000;

/** Open‑Meteo Geocoding，補齊目錄未收錄的縣市／口語地名 */
export async function matchLocationFromOpenMeteo(text: string): Promise<ManualLocationStored | null> {
  const q = text.trim();
  if (!q) return null;
  const url =
    `/api/ext/open-meteo?name=${encodeURIComponent(q)}` + `&count=12&language=zh&format=json`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPEN_METEO_GEOCODE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { credentials: "omit", signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const j = (await res.json()) as { results?: GeoHit[] };
    const hits = Array.isArray(j.results) ? j.results : [];
    const hit = hits.find((r) => ALLOW_CC.has(String(r.country_code || "").toUpperCase()));
    if (!hit) return null;
    const admin = String(hit.admin1 || "").trim();
    const cc = String(hit.country_code || "").toUpperCase();
    const provinceName =
      admin ||
      (cc === "HK" ? "香港特别行政区" : cc === "MO" ? "澳门特别行政区" : cc === "TW" ? "台湾省" : "中国");
    return {
      v: 1,
      provinceId: `geo:${cc}`,
      provinceName,
      cityName: String(hit.name || q).trim() || q,
      lat: hit.latitude,
      lon: hit.longitude,
    };
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

export function expandVoiceLocationCandidates(raw: string): string[] {
  const seen = new Set<string>();
  const addOne = (s: string) => {
    const n = norm(s).replace(/[。.!！？?；;]+/g, "");
    if (n.length >= 2) seen.add(n);
  };

  addOne(raw);
  let base = norm(raw).replace(/[。.!！？?；;]+/g, "");
  addOne(base);

  let stripped = base
    .replace(/^(请|麻烦|帮忙|帮我|帮我把|把|将|给)+/, "")
    .replace(/(谢谢|多谢|好的|好吧|啊|呢|吧|嗯|哈)+$/g, "");
  addOne(stripped);

  const intentRes = [
    stripped.replace(/^(我要|我想|我想把|麻烦把|请把|请帮我)/, ""),
    ...[
      /(?:^|[，,])(?:我在|现在在|当前在|人?在|定位到?|切换到?|改成|改到|设为|设置成|换到|要去)(?:了|在|为|到)?(.+)$/,
      /^位置(?:是|在)?(.+)$/,
      /^手动(?:选|选一下|定位)?(.+)$/,
      /^天气(?:在|改成)?(.+)$/,
      /^路况(?:在|改成)?(.+)$/,
      // 「人在上海想关心深圳」：查／想知道／看 + 地名 + 天气|路况|新闻（capture 用贪婪避免 (.+?) 与可选「的」产生空匹配）
      /(?:查|查询|查查|看看|想看|想听|想了解一下?|想知道|想了解|了解下|帮我查|帮我看看?|给我查|打听)(?:一下)?(.+)(?:的)?(?:天气|气温|路况|交通|塞车|拥堵|新闻|要闻|即时|当地|那边)/,
      /(?:我想|我要|麻烦您?)?(?:知道|了解|查|看|听听)(?:一下)?(.+)(?:的)?(?:天气|气温|路况|交通|新闻|要闻|即时)/,
      /(?:参照|按照|以|用|关注)(.+?)(?:的)?(?:天气|路况|新闻)/,
      /(.+?)(?:那里|那边|当地)(?:的)?(?:天气|路况|新闻)(?:怎样|如何|怎么样|咋样)?/,
      /^(?:切|换)(?:到|成|为)(.+)$/,
    ]
      .map((re) => stripped.match(re)?.[1]?.trim())
      .filter((x): x is string => Boolean(x && x.length >= 2)),
  ];
  for (const part of intentRes) addOne(part);

  for (const part of stripped.split(/[，,、\/]+/).map((p) => norm(p)).filter(Boolean)) {
    addOne(part);
  }

  return Array.from(seen).sort((a, b) => b.length - a.length);
}

export async function matchSpokenOrTypedLocation(text: string): Promise<ManualLocationStored | null> {
  const candidates = expandVoiceLocationCandidates(text);
  for (const c of candidates) {
    const fromCat = matchLocationFromCatalog(c);
    if (fromCat) return fromCat;
  }
  const forApi = candidates.filter((c) => c.length <= 80).slice(0, 10);
  for (const c of forApi) {
    try {
      const hit = await matchLocationFromOpenMeteo(c);
      if (hit) return hit;
    } catch {
      /**/
    }
  }
  return null;
}
