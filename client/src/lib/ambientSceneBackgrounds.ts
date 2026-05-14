/**
 * 環境底圖輪播：Unsplash License（https://unsplash.com/license）可免費使用，建議保留攝影師頁鏈接作致謝。
 * 圖片放在同源 `public/ambient/{photoId}.jpg`，由根目錄 `pnpm run ambient:fetch-images` 一次性拉取，運行時不再請求外網。
 */

export type AmbientTimeSegment = "dawn" | "day" | "dusk" | "lateNight";
export type AmbientWeatherKind = "clear" | "cloudy" | "rain" | "thunder" | "snow" | "fog";

/** `photoId` 形如 `photo-1469474968028-56623f02e42e`，對應 `client/public/ambient/{photoId}.jpg` */
function localAmbient(photoId: string): string {
  return `/ambient/${photoId}.jpg`;
}

/** 各時段 + 天氣對應 2～4 張輪播 */
const BACKGROUNDS: Record<string, readonly string[]> = {
  "dawn-clear": [
    localAmbient("photo-1469474968028-56623f02e42e"),
    localAmbient("photo-1500382017468-9049fed747ef"),
    localAmbient("photo-1472214103451-9374bd1c798e"),
  ],
  "dawn-cloudy": [
    localAmbient("photo-1501594907352-04cda38ebc29"),
    localAmbient("photo-1519681393784-d120267933ba"),
    localAmbient("photo-1464822759023-fed622ff2c3b"),
  ],
  "dawn-rain": [localAmbient("photo-1527482797697-8795b05a13fe"), localAmbient("photo-1433086966358-54859d0ed716")],
  "dawn-thunder": [localAmbient("photo-1507525428034-b723cf961d3e"), localAmbient("photo-1464822759023-fed622ff2c3b")],
  "dawn-snow": [localAmbient("photo-1483921020237-2ff51e8e4b22"), localAmbient("photo-1527482797697-8795b05a13fe")],
  "dawn-fog": [localAmbient("photo-1470071459604-3b5ec3a7fe05"), localAmbient("photo-1472214103451-9374bd1c798e")],

  "day-clear": [
    localAmbient("photo-1506905925346-21bda4d32df4"),
    localAmbient("photo-1472214103451-9374bd1c798e"),
    localAmbient("photo-1464822759023-fed622ff2c3b"),
  ],
  "day-cloudy": [
    localAmbient("photo-1519681393784-d120267933ba"),
    localAmbient("photo-1501594907352-04cda38ebc29"),
    localAmbient("photo-1472214103451-9374bd1c798e"),
  ],
  "day-rain": [localAmbient("photo-1433086966358-54859d0ed716"), localAmbient("photo-1527482797697-8795b05a13fe")],
  "day-thunder": [localAmbient("photo-1464822759023-fed622ff2c3b"), localAmbient("photo-1507525428034-b723cf961d3e")],
  "day-snow": [localAmbient("photo-1527482797697-8795b05a13fe"), localAmbient("photo-1483921020237-2ff51e8e4b22")],
  "day-fog": [localAmbient("photo-1470071459604-3b5ec3a7fe05"), localAmbient("photo-1501594907352-04cda38ebc29")],

  "dusk-clear": [
    localAmbient("photo-1500382017468-9049fed747ef"),
    localAmbient("photo-1501594907352-04cda38ebc29"),
    localAmbient("photo-1483921020237-2ff51e8e4b22"),
  ],
  "dusk-cloudy": [
    localAmbient("photo-1470071459604-3b5ec3a7fe05"),
    localAmbient("photo-1501594907352-04cda38ebc29"),
    localAmbient("photo-1500382017468-9049fed747ef"),
  ],
  "dusk-rain": [localAmbient("photo-1470071459604-3b5ec3a7fe05"), localAmbient("photo-1527482797697-8795b05a13fe")],
  "dusk-thunder": [localAmbient("photo-1507525428034-b723cf961d3e"), localAmbient("photo-1464822759023-fed622ff2c3b")],
  "dusk-snow": [localAmbient("photo-1483921020237-2ff51e8e4b22"), localAmbient("photo-1527482797697-8795b05a13fe")],
  "dusk-fog": [localAmbient("photo-1470071459604-3b5ec3a7fe05"), localAmbient("photo-1470071459604-3b5ec3a7fe05")],

  "lateNight-clear": [
    localAmbient("photo-1506905925346-21bda4d32df4"),
    localAmbient("photo-1472214103451-9374bd1c798e"),
    localAmbient("photo-1507525428034-b723cf961d3e"),
  ],
  "lateNight-cloudy": [
    localAmbient("photo-1472214103451-9374bd1c798e"),
    localAmbient("photo-1501594907352-04cda38ebc29"),
    localAmbient("photo-1506905925346-21bda4d32df4"),
  ],
  "lateNight-rain": [localAmbient("photo-1527482797697-8795b05a13fe"), localAmbient("photo-1472214103451-9374bd1c798e")],
  "lateNight-thunder": [localAmbient("photo-1464822759023-fed622ff2c3b"), localAmbient("photo-1507525428034-b723cf961d3e")],
  "lateNight-snow": [localAmbient("photo-1483921020237-2ff51e8e4b22"), localAmbient("photo-1506905925346-21bda4d32df4")],
  "lateNight-fog": [localAmbient("photo-1470071459604-3b5ec3a7fe05"), localAmbient("photo-1472214103451-9374bd1c798e")],
};

const DEFAULT_FALLBACK = [
  localAmbient("photo-1472214103451-9374bd1c798e"),
  localAmbient("photo-1519681393784-d120267933ba"),
  localAmbient("photo-1506905925346-21bda4d32df4"),
];

/** 取指定 IANA 時區在該瞬間的小時（0–23），供底圖「時段」與時鐘顯示時區對齊 */
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

/** 與 Open‑Meteo WMO weather_code 對齊（見 WorkAmbientPanel codeLabel） */
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
  if (/霧|雾|fog|mist/i.test(t)) return "fog";
  if (/云|雲|阴|多雲|多云|cloud/i.test(t)) return "cloudy";
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
