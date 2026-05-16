import React, { useEffect, useState } from "react";

type WeatherMini = {
  temp: number;
  code: number;
  label: string;
  city: string;
};

function weatherCodeLabel(code: number): string {
  if ([0].includes(code)) return "晴";
  if ([1, 2, 3].includes(code)) return "少云";
  if ([45, 48].includes(code)) return "雾";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "雨";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "雪";
  if ([95, 96, 99].includes(code)) return "雷雨";
  return "多云";
}

function formatShanghaiTime(d: Date): string {
  return d.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 首页轻量展示：本地时间（上海口径）+ Open‑Meteo 当前天气（免密钥）。
 */
export default function HomeWeatherClock() {
  const [now, setNow] = useState(() => new Date());
  const [wx, setWx] = useState<WeatherMini | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // 页面加载后立即尝试获取定位
    requestLocation();
  }, []);

  const requestLocation = async () => {
    try {
      setErr(null);
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error("no geolocation"));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 12_000,
          maximumAge: 300_000,
        });
      });
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=Asia%2FShanghai`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`weather ${res.status}`);
      const j = await res.json();
      const code = Number(j?.current?.weather_code ?? 0);
      const temp = Number(j?.current?.temperature_2m ?? 0);
      setWx({
        temp: Math.round(temp * 10) / 10,
        code,
        label: weatherCodeLabel(code),
        city: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
      });
      setErr(null);
    } catch {
      setWx(null);
      setErr("error");
    }
  };

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
      <span>{formatShanghaiTime(now)}</span>
      {wx ? (
        <>
          <span style={{ width: 1, height: 14, background: "rgba(255,255,255,0.15)" }} />
          <span style={{ color: "#7dd3fc" }}>
            {wx.label} · {wx.temp}°C
          </span>
          <span style={{ fontWeight: 600, color: "rgba(255,255,255,0.45)", fontSize: 12 }}>{wx.city}</span>
        </>
      ) : err ? (
        <span style={{ fontWeight: 600, color: "rgba(255,255,255,0.35)", fontSize: 12 }}>未获取定位天气</span>
      ) : (
        <span 
          style={{ fontWeight: 600, color: "rgba(255,255,255,0.35)", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
          onClick={requestLocation}
        >
          点击获取本地天气与定位
        </span>
      )}
    </div>
  );
}
