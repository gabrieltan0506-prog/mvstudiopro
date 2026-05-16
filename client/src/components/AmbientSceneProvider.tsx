import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  deriveAmbientWeatherKind,
  getAmbientImageUrls,
  getAmbientTimeSegment,
  getHourInTimeZone,
  type AmbientTimeSegment,
  type AmbientWeatherKind,
} from "@/lib/ambientSceneBackgrounds";
import { reverseGeocodeShortLabel } from "@/lib/reverseGeocode";
import {
  clearManualLocation,
  loadManualLocation,
  saveManualLocation,
  type LocationSourceMode,
  type ManualLocationStored,
} from "@/lib/locationOverride";
import { matchSpokenOrTypedLocation } from "@/lib/matchLocationFromText";

type Wx = { temp: number; code: number; label: string; lat: number; lon: number };

function codeLabel(code: number): string {
  if (code === 0) return "晴";
  if ([1, 2, 3].includes(code)) return "多云";
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return "雨";
  if ([71, 73, 75].includes(code)) return "雪";
  if ([95, 96, 99].includes(code)) return "雷雨";
  return "阴";
}

const CAROUSEL_MS = 180000;
/** 天氣實況 fetch 上限，避免 open‑meteo 拖住首屏後續體感 */
const OPEN_METEO_WX_TIMEOUT_MS = 3000;

async function fetchOpenMeteoWx(lat: number, lon: number, signal?: AbortSignal): Promise<Wx> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`天气接口 ${res.status}`);
  const j = await res.json();
  return {
    lat,
    lon,
    temp: Math.round(Number(j?.current?.temperature_2m) * 10) / 10,
    code: Number(j?.current?.weather_code ?? 0),
    label: codeLabel(Number(j?.current?.weather_code ?? 0)),
  };
}

async function fetchOpenMeteoWxWithTimeout(lat: number, lon: number, ms: number): Promise<Wx> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetchOpenMeteoWx(lat, lon, c.signal);
  } finally {
    clearTimeout(t);
  }
}

export type AmbientSceneContextValue = {
  now: Date;
  wxLocal: Wx | null;
  geo: { lat: number; lon: number } | null;
  geoErr: string | null;
  /**
   * 仍保留於 context：`true` 表示儀表板 tRPC 無需再等待「定位握手」即可請求。
   * （歷史欄位名未改，避免大範圍重構。）
   */
  geoAttemptDone: boolean;
  /** 天氣／逆地理／GPS 等非關鍵路徑是否在背景載入 */
  isLocating: boolean;
  placeLabel: string | null;
  /** 當前天氣／路況／新聞所用的座標來源 */
  locationSource: LocationSourceMode;
  /** 手動選點時非空；device 模式為 null */
  manualLocation: ManualLocationStored | null;
  timeSegment: AmbientTimeSegment;
  weatherKind: AmbientWeatherKind;
  ambientUrls: readonly string[];
  bgIdx: number;
  motionOk: boolean;
  browserTimeZone: string;
  /** 重新請求瀏覽器定位（僅 device 模式有意義；手動模式下會提示先切回定位） */
  requestLocation: () => Promise<void>;
  /** 套用目錄或接口解析後的座標（寫入 localStorage） */
  applyManualLocation: (spec: ManualLocationStored) => void;
  /** 清除手動覆寫並重新走設備定位 */
  revertToDeviceLocation: () => void;
  /** 語音或文字：目錄＋Open‑Meteo 解析；成功則套用 */
  applyLocationFromSpeechOrText: (text: string) => Promise<{ ok: boolean; message: string }>;
};

const AmbientSceneContext = createContext<AmbientSceneContextValue | null>(null);

export function useAmbientScene(): AmbientSceneContextValue {
  const ctx = useContext(AmbientSceneContext);
  if (!ctx) {
    throw new Error("useAmbientScene 必須在 <AmbientSceneProvider> 內使用");
  }
  return ctx;
}

export function AmbientSceneProvider({ children }: { children: React.ReactNode }) {
  const initialManual = loadManualLocation();
  const [now, setNow] = useState(() => new Date());
  const [wxLocal, setWxLocal] = useState<Wx | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [geo, setGeo] = useState<{ lat: number; lon: number } | null>(() =>
    initialManual ? { lat: initialManual.lat, lon: initialManual.lon } : null,
  );
  /** 固定放行 tRPC／首屏，不與 GPS handshake 串行 */
  const geoAttemptDone = true;
  const [isLocating, setIsLocating] = useState(true);
  const [placeLabel, setPlaceLabel] = useState<string | null>(() =>
    initialManual ? `${initialManual.provinceName} — ${initialManual.cityName}（手动）` : null,
  );
  const [locationSource, setLocationSource] = useState<LocationSourceMode>(() =>
    initialManual ? "manual" : "device",
  );
  const [manualLocation, setManualLocation] = useState<ManualLocationStored | null>(() => initialManual);
  const [gpsNonce, setGpsNonce] = useState(0);

  const [motionOk, setMotionOk] = useState(true);
  const browserTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);

  const hourInDisplayZone = useMemo(
    () => getHourInTimeZone(now, browserTimeZone),
    [now, browserTimeZone],
  );
  const timeSegment = useMemo(() => getAmbientTimeSegment(hourInDisplayZone), [hourInDisplayZone]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setMotionOk(!mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /** 手動城市：不依賴 GPS，直接取 Open‑Meteo 實況 */
  useEffect(() => {
    if (locationSource !== "manual" || !manualLocation) return;
    let cancelled = false;
    setIsLocating(true);
    setGeoErr(null);
    const { lat, lon } = manualLocation;
    setGeo({ lat, lon });
    setPlaceLabel(`${manualLocation.provinceName} — ${manualLocation.cityName}（手动）`);
    (async () => {
      try {
        const wx = await fetchOpenMeteoWxWithTimeout(lat, lon, OPEN_METEO_WX_TIMEOUT_MS);
        if (!cancelled) {
          setWxLocal(wx);
          setGeoErr(null);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setWxLocal(null);
          setGeoErr(e instanceof Error ? e.message : "天气不可用");
        }
      } finally {
        if (!cancelled) setIsLocating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locationSource, manualLocation]);

  /** 設備 GPS */
  useEffect(() => {
    if (locationSource !== "device") return;
    let cancelled = false;
    (async () => {
      setIsLocating(true);
      setGeoErr(null);
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          if (!navigator.geolocation) {
            reject(new Error("浏览器未提供定位"));
            return;
          }
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15_000,
            maximumAge: 0,
          });
        });
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        if (!cancelled) setGeo({ lat, lon });
        /** 逆地理不阻塞天氣載入 */
        void reverseGeocodeShortLabel(lat, lon).then((label) => {
          if (!cancelled) setPlaceLabel(label);
        });
        try {
          const wx = await fetchOpenMeteoWxWithTimeout(lat, lon, OPEN_METEO_WX_TIMEOUT_MS);
          if (!cancelled) {
            setWxLocal(wx);
            setGeoErr(null);
          }
        } catch (e: unknown) {
          if (!cancelled) {
            setWxLocal(null);
            setGeoErr(e instanceof Error ? e.message : "天气不可用");
          }
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setWxLocal(null);
          setGeoErr(e instanceof Error ? e.message : "定位或天气不可用");
          setPlaceLabel(null);
          setGeo(null);
        }
      } finally {
        if (!cancelled) setIsLocating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locationSource, gpsNonce]);

  const weatherKind: AmbientWeatherKind = useMemo(() => {
    if (wxLocal) return deriveAmbientWeatherKind(wxLocal.label, wxLocal.code);
    return "cloudy";
  }, [wxLocal]);

  const ambientUrls = useMemo(
    () => getAmbientImageUrls(timeSegment, weatherKind),
    [timeSegment, weatherKind],
  );

  const [bgIdx, setBgIdx] = useState(0);
  useEffect(() => {
    setBgIdx(0);
  }, [ambientUrls]);

  useEffect(() => {
    if (ambientUrls.length <= 1) return;
    const t = setInterval(() => setBgIdx((i) => (i + 1) % ambientUrls.length), CAROUSEL_MS);
    return () => clearInterval(t);
  }, [ambientUrls]);

  const applyManualLocation = useCallback((spec: ManualLocationStored) => {
    saveManualLocation(spec);
    setManualLocation(spec);
    setLocationSource("manual");
  }, []);

  const revertToDeviceLocation = useCallback(() => {
    clearManualLocation();
    setManualLocation(null);
    setLocationSource("device");
    setGpsNonce((n) => n + 1);
  }, []);

  const requestLocation = useCallback(async () => {
    if (locationSource === "manual") {
      setGeoErr("当前为手动位置；请先点「设备GPS」再刷新浏览器定位。");
      return;
    }
    setIsLocating(true);
    setGeoErr(null);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error("浏览器未提供定位"));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15_000,
          maximumAge: 0,
        });
      });
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      setGeo({ lat, lon });
      void reverseGeocodeShortLabel(lat, lon).then((label) => setPlaceLabel(label));
      try {
        const wx = await fetchOpenMeteoWxWithTimeout(lat, lon, OPEN_METEO_WX_TIMEOUT_MS);
        setWxLocal(wx);
        setGeoErr(null);
      } catch (e: unknown) {
        setWxLocal(null);
        setGeoErr(e instanceof Error ? e.message : "天气不可用");
      }
    } catch (e: unknown) {
      setWxLocal(null);
      setGeoErr(e instanceof Error ? e.message : "定位或天气不可用");
      setPlaceLabel(null);
      setGeo(null);
    } finally {
      setIsLocating(false);
    }
  }, [locationSource]);

  const applyLocationFromSpeechOrText = useCallback(
    async (text: string) => {
      const spec = await matchSpokenOrTypedLocation(text);
      if (!spec) {
        return {
          ok: false,
          message:
            "未识别到目的地。可直接说「广东省深圳市」，或带意图如「想查深圳的天气和路况」；目录外的地名会尝试在线搜索。",
        };
      }
      applyManualLocation(spec);
      return {
        ok: true,
        message: `天气 / 路况 / 新闻将按「${spec.provinceName} — ${spec.cityName}」展示（与本人 GPS 无关，除非点「设备 GPS」恢复）。`,
      };
    },
    [applyManualLocation],
  );

  const value = useMemo<AmbientSceneContextValue>(
    () => ({
      now,
      wxLocal,
      geo,
      geoErr,
      geoAttemptDone,
      isLocating,
      placeLabel,
      locationSource,
      manualLocation,
      timeSegment,
      weatherKind,
      ambientUrls,
      bgIdx,
      motionOk,
      browserTimeZone,
      requestLocation,
      applyManualLocation,
      revertToDeviceLocation,
      applyLocationFromSpeechOrText,
    }),
    [
      now,
      wxLocal,
      geo,
      geoErr,
      geoAttemptDone,
      isLocating,
      placeLabel,
      locationSource,
      manualLocation,
      timeSegment,
      weatherKind,
      ambientUrls,
      bgIdx,
      motionOk,
      browserTimeZone,
      requestLocation,
      applyManualLocation,
      revertToDeviceLocation,
      applyLocationFromSpeechOrText,
    ],
  );

  return <AmbientSceneContext.Provider value={value}>{children}</AmbientSceneContext.Provider>;
}
