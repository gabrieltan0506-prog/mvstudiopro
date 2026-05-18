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

/** 底图轮播切换间隔（与 WorkAmbientPanel／GlobalAmbientBackdrop 文案「约 30s」一致） */
const CAROUSEL_MS = 30_000;

async function fetchOpenMeteoWx(lat: number, lon: number): Promise<Wx> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`;
  const res = await fetch(url);
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

export type AmbientSceneContextValue = {
  now: Date;
  wxLocal: Wx | null;
  geo: { lat: number; lon: number } | null;
  geoErr: string | null;
  geoAttemptDone: boolean;
  placeLabel: string | null;
  /** 当前天气／路况／新闻所用的座标来源 */
  locationSource: LocationSourceMode;
  /** 手动选点时非空；device 模式为 null */
  manualLocation: ManualLocationStored | null;
  timeSegment: AmbientTimeSegment;
  weatherKind: AmbientWeatherKind;
  ambientUrls: readonly string[];
  bgIdx: number;
  motionOk: boolean;
  browserTimeZone: string;
  /** 重新请求浏览器定位（仅 device 模式有意义；手动模式下会提示先切回定位） */
  requestLocation: () => Promise<void>;
  /** 套用目录或接口解析后的座标（写入 localStorage） */
  applyManualLocation: (spec: ManualLocationStored) => void;
  /** 清除手动覆写并重新走设备定位 */
  revertToDeviceLocation: () => void;
  /** 语音或文字：目录＋Open‑Meteo 解析；成功则套用 */
  applyLocationFromSpeechOrText: (text: string) => Promise<{ ok: boolean; message: string }>;
};

const AmbientSceneContext = createContext<AmbientSceneContextValue | null>(null);

export function useAmbientScene(): AmbientSceneContextValue {
  const ctx = useContext(AmbientSceneContext);
  if (!ctx) {
    throw new Error("useAmbientScene 必须在 <AmbientSceneProvider> 内使用");
  }
  return ctx;
}

export function AmbientSceneProvider({ children }: { children: React.ReactNode }) {
  const initialManual = loadManualLocation();
  const [now, setNow] = useState(() => new Date());
  const [wxLocal, setWxLocal] = useState<Wx | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [geo, setGeo] = useState<{ lat: number; lon: number } | null>(null);
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  const [geoAttemptDone, setGeoAttemptDone] = useState(false);
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

  /** 手动城市：不依赖 GPS，直接取 Open‑Meteo 实况 */
  useEffect(() => {
    if (locationSource !== "manual" || !manualLocation) return;
    let cancelled = false;
    (async () => {
      setGeoAttemptDone(false);
      setGeoErr(null);
      const { lat, lon } = manualLocation;
      setGeo({ lat, lon });
      setPlaceLabel(`${manualLocation.provinceName} — ${manualLocation.cityName}（手动）`);
      try {
        const wx = await fetchOpenMeteoWx(lat, lon);
        if (cancelled) return;
        setWxLocal(wx);
        setGeoErr(null);
      } catch (e: unknown) {
        if (!cancelled) {
          setWxLocal(null);
          setGeoErr(e instanceof Error ? e.message : "天气不可用");
        }
      } finally {
        if (!cancelled) setGeoAttemptDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locationSource, manualLocation]);

  /** 设备 GPS */
  useEffect(() => {
    if (locationSource !== "device") return;
    let cancelled = false;
    (async () => {
      setGeoAttemptDone(false);
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
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`;
        const [label, res] = await Promise.all([reverseGeocodeShortLabel(lat, lon), fetch(url)]);
        if (!cancelled) setPlaceLabel(label);
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
          setPlaceLabel(null);
        }
      } finally {
        if (!cancelled) setGeoAttemptDone(true);
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
    setGeoAttemptDone(false);
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
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`;
      const [label, res] = await Promise.all([reverseGeocodeShortLabel(lat, lon), fetch(url)]);
      setPlaceLabel(label);
      if (!res.ok) throw new Error(`天气接口 ${res.status}`);
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
      setPlaceLabel(null);
    } finally {
      setGeoAttemptDone(true);
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
