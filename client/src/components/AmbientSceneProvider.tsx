import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  deriveAmbientWeatherKind,
  getAmbientImageUrls,
  getAmbientTimeSegment,
  getHourInTimeZone,
  type AmbientTimeSegment,
  type AmbientWeatherKind,
} from "@/lib/ambientSceneBackgrounds";

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

export type AmbientSceneContextValue = {
  now: Date;
  wxLocal: Wx | null;
  geo: { lat: number; lon: number } | null;
  geoErr: string | null;
  geoAttemptDone: boolean;
  /** 與時鐘展示同一時區對齊的「時段」，用於挑選底圖 */
  timeSegment: AmbientTimeSegment;
  weatherKind: AmbientWeatherKind;
  ambientUrls: readonly string[];
  bgIdx: number;
  motionOk: boolean;
  browserTimeZone: string;
  requestLocation: () => Promise<void>;
};

const AmbientSceneContext = createContext<AmbientSceneContextValue | null>(null);

export function useAmbientScene(): AmbientSceneContextValue {
  const ctx = useContext(AmbientSceneContext);
  if (!ctx) {
    throw new Error("useAmbientScene 必須在 <AmbientSceneProvider> 內使用");
  }
  return ctx;
}

/**
 * 首頁／成長營共用：定位 + Open‑Meteo、時段×天氣底圖 URL、輪播 index。
 * 路況／服務端天氣仍由 WorkAmbientPanel 內的 dashboardLive 查詢（與本 state 共用同一 queryKey · React Query 會合併請求）。
 */
export function AmbientSceneProvider({ children }: { children: React.ReactNode }) {
  const [now, setNow] = useState(() => new Date());
  const [wxLocal, setWxLocal] = useState<Wx | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [geo, setGeo] = useState<{ lat: number; lon: number } | null>(null);
  const [geoAttemptDone, setGeoAttemptDone] = useState(false);
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

  useEffect(() => {
    // 页面加载后立即尝试获取定位
    let cancelled = false;
    (async () => {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          if (!navigator.geolocation) {
            reject(new Error("浏览器未提供定位"));
            return;
          }
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false,
            timeout: 15_000,
            maximumAge: 120_000,
          });
        });
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        if (!cancelled) setGeo({ lat, lon });
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`天气接口 ${res.status}`);
        const j = await res.json();
        if (cancelled) return;
        setWxLocal({
          lat,
          lon,
          temp: Math.round(Number(j?.current?.temperature_2m) * 10) / 10,
          code: Number(j?.current?.weather_code ?? 0),
          label: codeLabel(Number(j?.current?.weather_code ?? 0)),
        });
        setGeoErr(null);
      } catch (e: unknown) {
        if (!cancelled) {
          setWxLocal(null);
          setGeoErr(e instanceof Error ? e.message : "定位或天气不可用");
        }
      } finally {
        if (!cancelled) setGeoAttemptDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const requestLocation = async () => {
    setGeoAttemptDone(false);
    setGeoErr(null);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error("浏览器未提供定位"));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 15_000,
          maximumAge: 120_000,
        });
      });
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      setGeo({ lat, lon });
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`);
      const j = await res.json();
      setWxLocal({
        lat,
        lon,
        temp: Math.round(Number(j?.current?.temperature_2m) * 10) / 10,
        code: Number(j?.current?.weather_code ?? 0),
        label: codeLabel(Number(j?.current?.weather_code ?? 0)),
      });
      setGeoErr(null);
    } catch (e: unknown) {
      setWxLocal(null);
      setGeoErr(e instanceof Error ? e.message : "定位或天气不可用");
    } finally {
      setGeoAttemptDone(true);
    }
  };

  const value = useMemo<AmbientSceneContextValue>(
    () => ({
      now,
      wxLocal,
      geo,
      geoErr,
      geoAttemptDone,
      timeSegment,
      weatherKind,
      ambientUrls,
      bgIdx,
      motionOk,
      browserTimeZone,
      requestLocation,
    }),
    [
      now,
      wxLocal,
      geo,
      geoErr,
      geoAttemptDone,
      timeSegment,
      weatherKind,
      ambientUrls,
      bgIdx,
      motionOk,
      browserTimeZone,
    ],
  );

  return <AmbientSceneContext.Provider value={value}>{children}</AmbientSceneContext.Provider>;
}
