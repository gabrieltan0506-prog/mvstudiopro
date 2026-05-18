/**
 * 环境底图轮播：图片落在 `client/public/ambient/{photoId}.jpg`（由脚本拉取，运行时只读同源）。
 * - 首次：pnpm run ambient:fetch-images
 * - 每日增量更新（超过 24h 则重下）：pnpm run ambient:fetch-images:daily
 * - 强制全部重下：pnpm run ambient:fetch-images:refresh
 * 未拉取前本地 404 时，可设 VITE_AMBIENT_IMAGE_CDN=1 临时走 Unsplash CDN（仅兜底）。
 */

export type AmbientTimeSegment = "dawn" | "day" | "dusk" | "lateNight";
export type AmbientWeatherKind = "clear" | "cloudy" | "rain" | "thunder" | "snow" | "fog";

function localAmbientPath(photoId: string): string {
  return `/ambient/${photoId}.jpg`;
}

function cdnAmbient(photoId: string): string {
  const raw = photoId.startsWith("photo-") ? photoId.slice("photo-".length) : photoId;
  return `https://images.unsplash.com/photo-${raw}?auto=format&fit=crop&w=1920&q=80`;
}

function ambientAssetUrl(photoId: string): string {
  if (import.meta.env.VITE_AMBIENT_IMAGE_CDN === "1") {
    return cdnAmbient(photoId);
  }
  return localAmbientPath(photoId);
}

/** 各时段 + 天气对应 2～4 张轮播 */
const BACKGROUNDS: Record<string, readonly string[]> = {
  "dawn-clear": [
    ambientAssetUrl("photo-1469474968028-56623f02e42e"),
    ambientAssetUrl("photo-1500382017468-9049fed747ef"),
    ambientAssetUrl("photo-1472214103451-9374bd1c798e"),
  ],
  "dawn-cloudy": [
    ambientAssetUrl("photo-1501594907352-04cda38ebc29"),
    ambientAssetUrl("photo-1519681393784-d120267933ba"),
    ambientAssetUrl("photo-1464822759023-fed622ff2c3b"),
  ],
  "dawn-rain": [ambientAssetUrl("photo-1527482797697-8795b05a13fe"), ambientAssetUrl("photo-1433086966358-54859d0ed716")],
  "dawn-thunder": [ambientAssetUrl("photo-1507525428034-b723cf961d3e"), ambientAssetUrl("photo-1464822759023-fed622ff2c3b")],
  "dawn-snow": [ambientAssetUrl("photo-1483921020237-2ff51e8e4b22"), ambientAssetUrl("photo-1527482797697-8795b05a13fe")],
  "dawn-fog": [ambientAssetUrl("photo-1470071459604-3b5ec3a7fe05"), ambientAssetUrl("photo-1472214103451-9374bd1c798e")],

  "day-clear": [
    ambientAssetUrl("photo-1506905925346-21bda4d32df4"),
    ambientAssetUrl("photo-1472214103451-9374bd1c798e"),
    ambientAssetUrl("photo-1464822759023-fed622ff2c3b"),
  ],
  "day-cloudy": [
    ambientAssetUrl("photo-1519681393784-d120267933ba"),
    ambientAssetUrl("photo-1501594907352-04cda38ebc29"),
    ambientAssetUrl("photo-1472214103451-9374bd1c798e"),
  ],
  "day-rain": [ambientAssetUrl("photo-1433086966358-54859d0ed716"), ambientAssetUrl("photo-1527482797697-8795b05a13fe")],
  "day-thunder": [ambientAssetUrl("photo-1464822759023-fed622ff2c3b"), ambientAssetUrl("photo-1507525428034-b723cf961d3e")],
  "day-snow": [ambientAssetUrl("photo-1527482797697-8795b05a13fe"), ambientAssetUrl("photo-1483921020237-2ff51e8e4b22")],
  "day-fog": [ambientAssetUrl("photo-1470071459604-3b5ec3a7fe05"), ambientAssetUrl("photo-1501594907352-04cda38ebc29")],

  "dusk-clear": [
    ambientAssetUrl("photo-1500382017468-9049fed747ef"),
    ambientAssetUrl("photo-1501594907352-04cda38ebc29"),
    ambientAssetUrl("photo-1483921020237-2ff51e8e4b22"),
  ],
  "dusk-cloudy": [
    ambientAssetUrl("photo-1470071459604-3b5ec3a7fe05"),
    ambientAssetUrl("photo-1501594907352-04cda38ebc29"),
    ambientAssetUrl("photo-1500382017468-9049fed747ef"),
  ],
  "dusk-rain": [ambientAssetUrl("photo-1470071459604-3b5ec3a7fe05"), ambientAssetUrl("photo-1527482797697-8795b05a13fe")],
  "dusk-thunder": [ambientAssetUrl("photo-1507525428034-b723cf961d3e"), ambientAssetUrl("photo-1464822759023-fed622ff2c3b")],
  "dusk-snow": [ambientAssetUrl("photo-1483921020237-2ff51e8e4b22"), ambientAssetUrl("photo-1527482797697-8795b05a13fe")],
  "dusk-fog": [ambientAssetUrl("photo-1470071459604-3b5ec3a7fe05"), ambientAssetUrl("photo-1470071459604-3b5ec3a7fe05")],

  "lateNight-clear": [
    ambientAssetUrl("photo-1506905925346-21bda4d32df4"),
    ambientAssetUrl("photo-1472214103451-9374bd1c798e"),
    ambientAssetUrl("photo-1507525428034-b723cf961d3e"),
  ],
  "lateNight-cloudy": [
    ambientAssetUrl("photo-1472214103451-9374bd1c798e"),
    ambientAssetUrl("photo-1501594907352-04cda38ebc29"),
    ambientAssetUrl("photo-1506905925346-21bda4d32df4"),
  ],
  "lateNight-rain": [ambientAssetUrl("photo-1527482797697-8795b05a13fe"), ambientAssetUrl("photo-1472214103451-9374bd1c798e")],
  "lateNight-thunder": [ambientAssetUrl("photo-1464822759023-fed622ff2c3b"), ambientAssetUrl("photo-1507525428034-b723cf961d3e")],
  "lateNight-snow": [ambientAssetUrl("photo-1483921020237-2ff51e8e4b22"), ambientAssetUrl("photo-1506905925346-21bda4d32df4")],
  "lateNight-fog": [ambientAssetUrl("photo-1470071459604-3b5ec3a7fe05"), ambientAssetUrl("photo-1472214103451-9374bd1c798e")],
};

const DEFAULT_FALLBACK = [
  ambientAssetUrl("photo-1472214103451-9374bd1c798e"),
  ambientAssetUrl("photo-1519681393784-d120267933ba"),
  ambientAssetUrl("photo-1506905925346-21bda4d32df4"),
];

/** 取指定 IANA 时区在该瞬间的小时（0–23），供底图「时段」与时钟显示时区对齐 */
export function getHourInTimeZone(d: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hour12: false,
    }).formatToParts(d);
    const hour = parts.find((p) => p.type === "hour")?.value;
    const h = hour != null ? parseInt(hour, 10) : NaN;
    const norm = h === 24 ? 0 : h;
    if (Number.isFinite(norm) && norm >= 0 && norm <= 23) return norm;
  } catch {
    /* fall through */
  }
  return d.getHours();
}

/** 凌晨 0–5 · 白天 6–16 · 傍晚 17–19 · 深夜 20–23 */
export function getAmbientTimeSegment(hour: number): AmbientTimeSegment {
  if (hour >= 0 && hour < 6) return "dawn";
  if (hour >= 6 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "lateNight";
}

export function segmentLabelZh(seg: AmbientTimeSegment): string {
  switch (seg) {
    case "dawn":
      return "凌晨";
    case "day":
      return "白天";
    case "dusk":
      return "傍晚";
    case "lateNight":
      return "深夜";
    default:
      return "";
  }
}

/** 与 Open‑Meteo WMO weather_code 对齐（见 WorkAmbientPanel codeLabel） */
export function deriveAmbientWeatherKind(
  conditionText: string,
  wxCode?: number | null,
): AmbientWeatherKind {
  if (wxCode != null && Number.isFinite(wxCode)) {
    const c = Number(wxCode);
    if ([95, 96, 99].includes(c)) return "thunder";
    if ([71, 73, 75].includes(c)) return "snow";
    if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(c)) return "rain";
    if ([45, 48].includes(c)) return "fog";
    if ([1, 2, 3].includes(c)) return "cloudy";
    if (c === 0) return "clear";
  }
  const t = conditionText.trim();
  if (/雷|thunder/i.test(t)) return "thunder";
  if (/雪|snow/i.test(t)) return "snow";
  if (/雨|rain|drizzle|shower/i.test(t)) return "rain";
  if (/雾|雾|fog|mist/i.test(t)) return "fog";
  if (/云|云|阴|多云|多云|cloud/i.test(t)) return "cloudy";
  if (/晴|clear|sunny/i.test(t)) return "clear";
  return "cloudy";
}

export function getAmbientImageUrls(segment: AmbientTimeSegment, weather: AmbientWeatherKind): string[] {
  const key = `${segment}-${weather}` as keyof typeof BACKGROUNDS;
  const list = BACKGROUNDS[key];
  if (list?.length) return [...list];
  const alt = BACKGROUNDS[`${segment}-cloudy`];
  if (alt?.length) return [...alt];
  return [...DEFAULT_FALLBACK];
}
