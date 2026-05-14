import React, { useEffect, useMemo, useState } from "react";

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

/** 演示用国内 / 国际简讯（接入通讯社或新闻 API 后可替换）。 */
const DEMO_CN = [
  "国常会部署深入实施「两重」建设，支持稳投资扩内需",
  "多部委就平台经济常态化监管发布年度工作要点",
  "主要城市二手房成交环比回升，市场信心逐步修复",
  "人工智能算力基础设施专项规划公开征求意见",
  "夏粮主产区收购进度快于常年，农情总体稳定",
];

const DEMO_INTL = [
  "Global central banks signal data‑dependent stance on rates",
  "Major cloud providers expand regional AI accelerator capacity",
  "Energy markets weigh summer demand outlook against inventory builds",
  "Cross‑border e‑commerce platforms update seller compliance toolkit",
  "Space agencies outline next‑gen low‑orbit broadband milestones",
];

/**
 * 工作页（成长营）环境概览：天气、时间、演示级新闻与路况占位。
 * 路况/精细地址需合规地图服务密钥，此处仅提供架构与占位。
 */
export default function WorkAmbientPanel() {
  const [now, setNow] = useState(() => new Date());
  const [wx, setWx] = useState<Wx | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);

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
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=Asia%2FShanghai`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`天气接口 ${res.status}`);
        const j = await res.json();
        if (cancelled) return;
        setWx({
          lat,
          lon,
          temp: Math.round(Number(j?.current?.temperature_2m) * 10) / 10,
          code: Number(j?.current?.weather_code ?? 0),
          label: codeLabel(Number(j?.current?.weather_code ?? 0)),
        });
        setGeoErr(null);
      } catch (e: any) {
        if (!cancelled) {
          setWx(null);
          setGeoErr(e?.message || "定位或天气不可用");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const bg =
    wx?.label.includes("雨")
      ? "linear-gradient(135deg,rgba(30,58,138,0.35),rgba(15,23,42,0.92))"
      : pod === "evening"
        ? "linear-gradient(135deg,rgba(180,83,9,0.25),rgba(30,27,75,0.9))"
        : pod === "night"
          ? "linear-gradient(135deg,rgba(49,46,129,0.35),rgba(15,23,42,0.95))"
          : "linear-gradient(135deg,rgba(14,165,233,0.18),rgba(15,23,42,0.92))";

  return (
    <div
      className="mb-6 overflow-hidden rounded-3xl border border-white/10 text-white shadow-[0_20px_60px_rgba(0,0,0,0.35)]"
      style={{ background: bg }}
    >
      <div className="grid gap-4 p-5 md:grid-cols-[1.1fr_0.9fr]">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">工作环境概览</div>
          <div className="mt-2 text-2xl font-black tracking-tight">
            {now.toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
              weekday: "long",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
          {wx ? (
            <div className="mt-3 text-sm text-white/80">
              当前天气：<span className="font-bold text-sky-200">{wx.label}</span> ·{" "}
              <span className="tabular-nums">{wx.temp}°C</span>
              <span className="ml-2 text-white/45 text-xs">
                （{wx.lat.toFixed(2)}°, {wx.lon.toFixed(2)}°）
              </span>
            </div>
          ) : (
            <div className="mt-3 text-sm text-white/55">{geoErr || "正在获取定位天气…"}</div>
          )}
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4 text-xs leading-relaxed text-white/60">
            <div className="font-bold text-amber-200/90">路况示意（占位）</div>
            <p className="mt-2">
              真实拥堵热力需接入高德 / Mapbox 等地图服务并配置密钥。当前展示版式供产品联调用；上线前请替换为签名的路况瓦片或
              Directions API。
            </p>
            <div className="mt-3 grid h-28 place-items-center rounded-xl border border-dashed border-white/20 text-white/35">
              地图轮播区 · 待密钥
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-300/90">国内简讯（演示）</div>
            <ul className="mt-2 space-y-2 text-[13px] leading-snug text-white/78">
              {DEMO_CN.map((t) => (
                <li key={t}>· {t}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-sky-300/90">国际简讯（演示）</div>
            <ul className="mt-2 space-y-2 text-[13px] leading-snug text-white/78">
              {DEMO_INTL.map((t) => (
                <li key={t}>· {t}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
