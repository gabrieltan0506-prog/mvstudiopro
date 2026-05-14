import React, { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";

type Wx = { temp: number; code: number; label: string; lat: number; lon: number };

function codeLabel(code: number): string {
  if (code === 0) return "晴";
  if ([1, 2, 3].includes(code)) return "多云";
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return "雨";
  if ([71, 73, 75].includes(code)) return "雪";
  if ([95, 96, 99].includes(code)) return "雷雨";
  return "阴";
}

function partOfDay(hour: number): "morning" | "afternoon" | "evening" | "night" {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 20) return "evening";
  return "night";
}

/**
 * 工作页（成长营）环境概览：混合式聚合（服务端）：时间、天气（OpenWeather 或 Open‑Meteo）、
 * Google News TW RSS、路況（Gemini + 可選 googleSearch）。
 */
export default function WorkAmbientPanel() {
  const [now, setNow] = useState(() => new Date());
  const [wxLocal, setWxLocal] = useState<Wx | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [geo, setGeo] = useState<{ lat: number; lon: number } | null>(null);

  const pod = useMemo(() => partOfDay(now.getHours()), [now]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
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
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=Asia%2FShanghai`;
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
      } catch (e: any) {
        if (!cancelled) {
          setWxLocal(null);
          setGeoErr(e?.message || "定位或天气不可用");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dash = trpc.ambient.hybridDashboard.useQuery(
    {
      timeZone: "Asia/Taipei",
      lat: geo?.lat,
      lon: geo?.lon,
    },
    {
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  );

  const bg =
    wxLocal?.label.includes("雨")
      ? "linear-gradient(135deg,rgba(30,58,138,0.35),rgba(15,23,42,0.92))"
      : pod === "evening"
        ? "linear-gradient(135deg,rgba(180,83,9,0.25),rgba(30,27,75,0.9))"
        : pod === "night"
          ? "linear-gradient(135deg,rgba(49,46,129,0.35),rgba(15,23,42,0.95))"
          : "linear-gradient(135deg,rgba(14,165,233,0.18),rgba(15,23,42,0.92))";

  const serverWx = dash.data?.weather;
  const showServerWx = serverWx && serverWx.source !== "unavailable";

  return (
    <div
      className="mb-6 overflow-hidden rounded-3xl border border-white/10 text-white shadow-[0_20px_60px_rgba(0,0,0,0.35)]"
      style={{ background: bg }}
    >
      <div className="grid gap-4 p-5 md:grid-cols-[1.1fr_0.9fr]">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">工作环境概览</div>
          <div className="mt-2 text-2xl font-black tracking-tight">
            {dash.data?.currentTime || now.toLocaleString("zh-CN", { timeZone: "Asia/Taipei", weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </div>
          {showServerWx ? (
            <div className="mt-3 text-sm text-white/80">
              天氣（{serverWx.source === "openweather" ? "OpenWeather" : "Open‑Meteo"}）：{" "}
              <span className="font-bold text-sky-200">{serverWx.condition}</span> ·{" "}
              <span className="tabular-nums">{serverWx.temperature}</span>
              <span className="ml-2 text-white/55">濕度 {serverWx.humidity}</span>
            </div>
          ) : wxLocal ? (
            <div className="mt-3 text-sm text-white/80">
              定位天氣（Open‑Meteo）：<span className="font-bold text-sky-200">{wxLocal.label}</span> ·{" "}
              <span className="tabular-nums">{wxLocal.temp}°C</span>
              <span className="ml-2 text-white/45 text-xs">
                （{wxLocal.lat.toFixed(2)}°, {wxLocal.lon.toFixed(2)}°）
              </span>
            </div>
          ) : (
            <div className="mt-3 text-sm text-white/55">{geoErr || dash.isLoading ? "正在聚合環境資料…" : "天氣暫不可用"}</div>
          )}
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4 text-xs leading-relaxed text-white/75">
            <div className="font-bold text-amber-200/90">即時路況（Gemini）</div>
            {dash.isLoading ? (
              <p className="mt-2 text-white/50">載入中…</p>
            ) : dash.data?.traffic ? (
              <>
                <p className="mt-2">{dash.data.traffic.summary}</p>
                {dash.data.traffic.congestedAreas.length > 0 ? (
                  <ul className="mt-2 list-inside list-disc space-y-1 text-white/65">
                    {dash.data.traffic.congestedAreas.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-white/50">暫無資料</p>
            )}
            {dash.isError ? <p className="mt-2 text-rose-300/90">路況載入失敗，請稍後重試</p> : null}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-1">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 sm:col-span-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-300/90">台灣頭條（Google News RSS）</div>
            {dash.isLoading ? (
              <p className="mt-2 text-[13px] text-white/50">載入中…</p>
            ) : dash.data?.news?.length ? (
              <ul className="mt-2 space-y-2 text-[13px] leading-snug text-white/78">
                {dash.data.news.map((n) => (
                  <li key={`${n.source}-${n.headline.slice(0, 24)}`}>
                    · <span className="text-white/85">{n.headline}</span>
                    <span className="block pl-2 text-[11px] text-white/45">{n.source}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[13px] text-white/50">暫無新聞條目</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
