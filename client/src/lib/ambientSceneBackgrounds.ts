/**
 * 環境底圖輪播：Unsplash License（https://unsplash.com/license）可免費使用，建議保留攝影師頁鏈接作致謝。
 * 依「時段 × 天氣」挑選風景／天空類照片，供 WorkAmbientPanel 輪播。
 */

export type AmbientTimeSegment = "dawn" | "day" | "dusk" | "lateNight";
export type AmbientWeatherKind = "clear" | "cloudy" | "rain" | "thunder" | "snow" | "fog";

/** w=1920 固定寬度減少布局抖動；fit=crop 便于卡片 cover */
function u(path: string): string {
  return `https://images.unsplash.com/${path}?auto=format&fit=crop&w=1920&q=82`;
}

/** 各時段 + 天氣對應 2～4 張輪播 */
const BACKGROUNDS: Record<string, readonly string[]> = {
  "dawn-clear": [
    u("photo-1470252649378-f06924637f27"),
    u("photo-1500382017468-9049fed747ef"),
    u("photo-1472214103451-9374bd1c798e"),
  ],
  "dawn-cloudy": [
    u("photo-1495616811223-4d98c7a376c0"),
    u("photo-1534081163281-759092828d76"),
    u("photo-1464822759023-fed622ff2c3b"),
  ],
  "dawn-rain": [u("photo-1527482797697-8795b05a13fe"), u("photo-1515694346930-2443052bab3c")],
  "dawn-thunder": [u("photo-1446776811953-b23d57bd21ae"), u("photo-1527482937786-660b73044c35")],
  "dawn-snow": [u("photo-1483921020237-2ff51e8e4b22"), u("photo-1491002052544-bbf384cdf947")],
  "dawn-fog": [u("photo-1470071459604-3b5ec3a7fe05"), u("photo-1472214103451-9374bd1c798e")],

  "day-clear": [
    u("photo-1506905925346-21bda4d32df4"),
    u("photo-1472214103451-9374bd1c798e"),
    u("photo-1464822759023-fed622ff2c3b"),
  ],
  "day-cloudy": [
    u("photo-1534081163281-759092828d76"),
    u("photo-1495616811223-4d98c7a376c0"),
    u("photo-1517483000871-1dbf64a6e1b6"),
  ],
  "day-rain": [u("photo-1515694346930-2443052bab3c"), u("photo-1527482797697-8795b05a13fe")],
  "day-thunder": [u("photo-1527482937786-660b73044c35"), u("photo-1446776811953-b23d57bd21ae")],
  "day-snow": [u("photo-1491002052544-bbf384cdf947"), u("photo-1483921020237-2ff51e8e4b22")],
  "day-fog": [u("photo-1470071459604-3b5ec3a7fe05"), u("photo-1495616811223-4d98c7a376c0")],

  "dusk-clear": [
    u("photo-1518834347036-8028062b6f4e"),
    u("photo-1495616811223-4d98c7a376c0"),
    u("photo-1507600617569-84c2a6666a88"),
  ],
  "dusk-cloudy": [
    u("photo-1507608616759-54f48f0af692"),
    u("photo-1495616811223-4d98c7a376c0"),
    u("photo-1518834347036-8028062b6f4e"),
  ],
  "dusk-rain": [u("photo-1507608616759-54f48f0af692"), u("photo-1527482797697-8795b05a13fe")],
  "dusk-thunder": [u("photo-1446776811953-b23d57bd21ae"), u("photo-1527482937786-660b73044c35")],
  "dusk-snow": [u("photo-1483921020237-2ff51e8e4b22"), u("photo-1491002052544-bbf384cdf947")],
  "dusk-fog": [u("photo-1470071459604-3b5ec3a7fe05"), u("photo-1507608616759-54f48f0af692")],

  "lateNight-clear": [
    u("photo-1419242902214-272b3f66ee7b"),
    u("photo-1517483000871-1dbf64a6e1b6"),
    u("photo-1446776811953-b23d57bd21ae"),
  ],
  "lateNight-cloudy": [
    u("photo-1517483000871-1dbf64a6e1b6"),
    u("photo-1495616811223-4d98c7a376c0"),
    u("photo-1419242902214-272b3f66ee7b"),
  ],
  "lateNight-rain": [u("photo-1527482797697-8795b05a13fe"), u("photo-1517483000871-1dbf64a6e1b6")],
  "lateNight-thunder": [u("photo-1527482937786-660b73044c35"), u("photo-1446776811953-b23d57bd21ae")],
  "lateNight-snow": [u("photo-1483921020237-2ff51e8e4b22"), u("photo-1419242902214-272b3f66ee7b")],
  "lateNight-fog": [u("photo-1470071459604-3b5ec3a7fe05"), u("photo-1517483000871-1dbf64a6e1b6")],
};

const DEFAULT_FALLBACK = [
  u("photo-1472214103451-9374bd1c798e"),
  u("photo-1534081163281-759092828d76"),
  u("photo-1419242902214-272b3f66ee7b"),
];

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
