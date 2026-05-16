import React, { useEffect, useMemo, useState } from "react";
import { useAmbientScene } from "@/components/AmbientSceneProvider";

function weatherCodeLabel(code: number): string {
  if ([0].includes(code)) return "晴";
  if ([1, 2, 3].includes(code)) return "少云";
  if ([45, 48].includes(code)) return "雾";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "雨";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "雪";
  if ([95, 96, 99].includes(code)) return "雷雨";
  return "多云";
}

function formatLocalTime(d: Date, timeZone: string): string {
  return d.toLocaleString("zh-CN", {
    timeZone,
    weekday: "short",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 首页轻量展示：浏览器本地时区时间 + Open‑Meteo 当前天气（与 AmbientSceneProvider 共用一次定位）。
 */
export default function HomeWeatherClock() {
  const { wxLocal, geo, geoErr, geoAttemptDone, placeLabel, browserTimeZone, requestLocation } =
    useAmbientScene();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const locationHint = useMemo(() => {
    if (placeLabel) return placeLabel;
    if (geo) return `${geo.lat.toFixed(2)}°, ${geo.lon.toFixed(2)}°`;
    return null;
  }, [placeLabel, geo]);

  const showWeather = wxLocal && !geoErr;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 14,
        background: "rgba(8,8,20,0.45)",
        border: "1px solid rgba(255,255,255,0.10)",
        color: "rgba(255,255,255,0.88)",
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      <span style={{ color: "#a5b4fc" }}>本地时间</span>
      <span>{formatLocalTime(now, browserTimeZone)}</span>
      {showWeather ? (
        <>
          <span style={{ width: 1, height: 14, background: "rgba(255,255,255,0.15)" }} />
          <span style={{ color: "#7dd3fc" }}>
            {weatherCodeLabel(wxLocal.code)} · {wxLocal.temp}°C
          </span>
          {locationHint ? (
            <span style={{ fontWeight: 600, color: "rgba(255,255,255,0.45)", fontSize: 12 }}>
              {locationHint}
            </span>
          ) : null}
        </>
      ) : geoErr || (geoAttemptDone && !wxLocal) ? (
        <span
          role="button"
          tabIndex={0}
          style={{
            fontWeight: 600,
            color: "rgba(255,255,255,0.35)",
            fontSize: 12,
            cursor: "pointer",
            textDecoration: "underline",
          }}
          onClick={() => void requestLocation()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void requestLocation();
            }
          }}
        >
          未获取定位天气，点击重试
        </span>
      ) : (
        <span style={{ fontWeight: 600, color: "rgba(255,255,255,0.35)", fontSize: 12 }}>
          正在获取定位与天气…
        </span>
      )}
    </div>
  );
}
