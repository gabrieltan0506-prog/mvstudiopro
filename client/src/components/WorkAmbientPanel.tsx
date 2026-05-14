import React from "react";
import { trpc } from "@/lib/trpc";
import {
  segmentLabelZh,
  type AmbientTimeSegment,
  type AmbientWeatherKind,
} from "@/lib/ambientSceneBackgrounds";
import "./work-ambient-scene.css";
import { GlobalMascotAssistant } from "@/components/GlobalMascotAssistant";
import { useAmbientScene } from "@/components/AmbientSceneProvider";

function AmbientMediaCard({
  urls,
  activeIndex,
  timeSegment,
  weatherKind,
  motionOk,
  label,
  children,
}: {
  urls: readonly string[];
  activeIndex: number;
  timeSegment: AmbientTimeSegment;
  weatherKind: AmbientWeatherKind;
  motionOk: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const showSun =
    motionOk && weatherKind === "clear" && (timeSegment === "day" || timeSegment === "dusk");
  const showClouds = motionOk && (weatherKind === "clear" || weatherKind === "cloudy");
  const showRain = motionOk && (weatherKind === "rain" || weatherKind === "thunder");
  const showLightning = motionOk && weatherKind === "thunder";
  const showSnow = motionOk && weatherKind === "snow";
  const showStars =
    motionOk && weatherKind === "clear" && (timeSegment === "lateNight" || timeSegment === "dawn");
  const showFog = motionOk && weatherKind === "fog";

  const snowStyle: React.CSSProperties = {
    backgroundImage: `radial-gradient(1.8px 1.8px at 10% 10%, rgba(255,255,255,0.95), transparent),
      radial-gradient(1.5px 1.5px at 72% 38%, rgba(255,255,255,0.85), transparent),
      radial-gradient(1.2px 1.2px at 40% 82%, rgba(255,255,255,0.75), transparent)`,
    backgroundSize: "140px 140px, 190px 190px, 220px 220px",
  };

  return (
    <div
      className={`relative min-h-[260px] overflow-hidden rounded-2xl border border-white/20 shadow-[0_24px_70px_rgba(0,0,0,0.45)] lg:min-h-[300px] ${motionOk ? "ambient-motion-ok" : ""}`}
    >
      {urls.map((url, i) => (
        <div
          key={`bg-${url.slice(-24)}-${i}`}
          className="absolute inset-0 bg-cover bg-center transition-opacity duration-[1.25s] ease-out"
          style={{ backgroundImage: `url(${url})`, opacity: i === activeIndex ? 1 : 0 }}
          aria-hidden
        />
      ))}
      <div
        className="absolute inset-0 bg-gradient-to-br from-slate-950/88 via-slate-950/55 to-indigo-950/40"
        aria-hidden
      />
      {showFog ? (
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_35%_65%,rgba(255,255,255,0.16),transparent_58%)] opacity-75 mix-blend-screen"
          aria-hidden
        />
      ) : null}
      {showClouds ? (
        <>
          <div
            className="ambient-cloud-layer pointer-events-none absolute -left-[22%] top-[6%] h-[42%] w-[85%] rounded-[50%] bg-white/14 blur-3xl"
            aria-hidden
          />
          <div
            className="ambient-cloud-layer pointer-events-none absolute -right-[12%] top-[24%] h-[34%] w-[70%] rounded-[50%] bg-slate-200/12 blur-3xl [animation-delay:-8s]"
            aria-hidden
          />
        </>
      ) : null}
      {showSun ? (
        <div
          className="pointer-events-none absolute -right-[14%] -top-[20%] h-[clamp(5.5rem,30vw,12rem)] w-[clamp(5.5rem,30vw,12rem)]"
          aria-hidden
        >
          <div className="ambient-sun-ray absolute inset-0 rounded-full bg-[conic-gradient(from_200deg_at_50%_50%,rgba(253,224,71,0.42),transparent_40%,rgba(254,243,199,0.22),transparent_72%)] opacity-85 blur-sm" />
          <div className="ambient-sun-disk absolute left-[17%] top-[17%] h-[66%] w-[66%] rounded-full bg-gradient-to-br from-amber-100 via-yellow-300 to-amber-500 shadow-[0_0_72px_rgba(253,224,71,0.55)]" />
        </div>
      ) : null}
      {showRain ? (
        <div
          className="ambient-rain-layer pointer-events-none absolute inset-0 opacity-[0.42] mix-blend-screen"
          style={{
            backgroundImage:
              "repeating-linear-gradient(106deg, transparent, transparent 6px, rgba(255,255,255,0.13) 6px, rgba(255,255,255,0.13) 7px)",
          }}
          aria-hidden
        />
      ) : null}
      {showLightning ? (
        <div
          className="ambient-lightning-flash pointer-events-none absolute inset-0 bg-white/28 mix-blend-overlay"
          aria-hidden
        />
      ) : null}
      {showSnow ? (
        <div
          className="ambient-snow-layer pointer-events-none absolute inset-0 opacity-[0.38] mix-blend-screen"
          style={snowStyle}
          aria-hidden
        />
      ) : null}
      {showStars ? (
        <div
          className="ambient-star-field pointer-events-none absolute inset-0 opacity-45 [background-image:radial-gradient(1px_1px_at_12%_18%,rgba(255,255,255,0.95),transparent),radial-gradient(1px_1px_at_62%_28%,rgba(255,255,255,0.9),transparent),radial-gradient(1px_1px_at_88%_76%,rgba(255,255,255,0.8),transparent)] [background-size:110px_110px,170px_170px,200px_200px]"
          aria-hidden
        />
      ) : null}

      <div className="relative z-10 flex h-full flex-col justify-between p-6 md:p-8">
        <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/55">{label}</div>
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}

/**
 * 工作页（成长营）环境概览：天氣／路況約 10 分鐘、新聞約 30 分鐘；時間與天氣為獨立大图卡片並共用時段×天氣主題輪播底圖（Unsplash）+ CSS 動效。
 */
export default function WorkAmbientPanel() {
  const {
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
  } = useAmbientScene();

  const dash = trpc.ambient.dashboardLive.useQuery(
    {
      timeZone: browserTimeZone,
      lat: geo?.lat,
      lon: geo?.lon,
    },
    {
      enabled: geoAttemptDone,
      staleTime: 10 * 60_000,
      refetchInterval: 10 * 60_000,
      refetchOnWindowFocus: false,
    },
  );

  const serverWx = dash.data?.weather;
  const newsQ = trpc.ambient.dashboardNews.useQuery(
    { lat: geo?.lat, lon: geo?.lon },
    {
      staleTime: 30 * 60_000,
      refetchInterval: 30 * 60_000,
      refetchOnWindowFocus: false,
    },
  );

  const domesticNews = newsQ.data?.domestic ?? [];
  const internationalNews = newsQ.data?.international ?? [];
  const localTierNews = domesticNews.filter((n) => n.tier === "local");
  const nationalDomesticNews = domesticNews.filter((n) => n.tier === "national");

  const timeHHmm = now.toLocaleTimeString("zh-CN", {
    timeZone: browserTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const dateZh = now.toLocaleDateString("zh-CN", {
    timeZone: browserTimeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const serverTimeFallback =
    dash.data?.currentTime ||
    now.toLocaleString("zh-CN", {
      timeZone: browserTimeZone,
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <>
      <div className="mb-6 space-y-4 text-white">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
        <AmbientMediaCard
          urls={ambientUrls}
          activeIndex={bgIdx}
          timeSegment={timeSegment}
          weatherKind={weatherKind}
          motionOk={motionOk}
          label={`當地時間 · ${segmentLabelZh(timeSegment)}（與天氣卡片同步輪播底圖）`}
        >
          <div className="mt-4">
            <div className="text-5xl font-black tabular-nums tracking-tight drop-shadow-md md:text-6xl">
              {timeHHmm}
            </div>
            <div className="mt-3 text-lg font-semibold text-white/88 drop-shadow">{dateZh}</div>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-white/55">
              服務端同步：
              <span className="text-white/70">{serverTimeFallback}</span>
            </p>
          </div>
        </AmbientMediaCard>

        <div className="relative flex min-h-[200px] items-center justify-center py-4 lg:min-h-[260px] lg:py-0">
          <GlobalMascotAssistant variant="embedded" />
        </div>

        <AmbientMediaCard
          urls={ambientUrls}
          activeIndex={bgIdx}
          timeSegment={timeSegment}
          weatherKind={weatherKind}
          motionOk={motionOk}
          label="天氣實況（底圖約 9s 輪播 · 資料約 10 分鐘更新）"
        >
          <div className="mt-4">
            {serverWx && serverWx.source !== "unavailable" ? (
              <>
                <div className="text-5xl font-black tabular-nums drop-shadow-md md:text-6xl">
                  {serverWx.temperature}
                </div>
                <div className="mt-3 text-xl font-bold text-sky-100 drop-shadow">
                  {serverWx.condition}
                </div>
                <div className="mt-2 text-sm text-white/60">
                  來源 {serverWx.source === "openweather" ? "OpenWeather" : "Open‑Meteo"} · 濕度{" "}
                  {serverWx.humidity}
                </div>
              </>
            ) : wxLocal ? (
              <>
                <div className="flex flex-wrap items-end gap-2">
                  <span className="text-5xl font-black tabular-nums drop-shadow-md md:text-6xl">
                    {wxLocal.temp}
                  </span>
                  <span className="pb-1 text-2xl font-bold text-white/75">°C</span>
                </div>
                <div className="mt-3 text-xl font-bold text-sky-100 drop-shadow">{wxLocal.label}</div>
                <div className="mt-2 text-xs text-white/50">
                  Open‑Meteo 定位（{wxLocal.lat.toFixed(2)}°, {wxLocal.lon.toFixed(2)}°）
                </div>
              </>
            ) : (
              <div className="text-lg text-white/55">
                {geoErr || dash.isLoading ? "正在讀取天氣…" : "天氣暫不可用"}
              </div>
            )}
          </div>
        </AmbientMediaCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-h-[180px] rounded-2xl border border-white/12 bg-slate-950/55 p-5 text-sm leading-relaxed text-white/78 shadow-lg backdrop-blur-md">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-200/95">
            即時路況（Gemini）
          </div>
          {(!geoAttemptDone || dash.isLoading) ? (
            <p className="mt-3 text-white/50">載入中…</p>
          ) : dash.data?.traffic ? (
            <>
              <p className="mt-3">{dash.data.traffic.summary}</p>
              {dash.data.traffic.congestedAreas.length > 0 ? (
                <ul className="mt-3 list-inside list-disc space-y-1.5 text-white/70">
                  {dash.data.traffic.congestedAreas.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="mt-3 text-white/50">暫無資料</p>
          )}
          {dash.isError ? <p className="mt-3 text-rose-300/90">路況載入失敗，請稍後重試</p> : null}
        </div>

        <div className="min-h-[180px] rounded-2xl border border-white/12 bg-slate-950/55 p-5 shadow-lg backdrop-blur-md">
          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-300/95">
            即時要聞（國內 5 + 國際 5 · AI 聚合 · 約 30 分鐘更新）
          </div>
          <p className="mt-1 text-[11px] text-white/40">
            已授權定位且座標在中國大陸範圍內時，國內前 2 條為周邊省區即時要聞，後 3 條為全國重大新聞；否則國內 5 條均為全國層級。
          </p>
          {newsQ.isLoading ? (
            <p className="mt-3 text-[13px] text-white/50">載入中…</p>
          ) : newsQ.data?.news?.length ? (
            <div className="mt-3 max-h-[min(48vh,26rem)] space-y-4 overflow-y-auto pr-1 text-[13px] leading-snug text-white/80">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-teal-200/90">國內</div>
                {localTierNews.length > 0 ? (
                  <div className="mt-2">
                    <div className="text-[11px] font-semibold text-white/55">周邊／本省區</div>
                    <ul className="mt-1.5 space-y-2">
                      {localTierNews.map((n) => (
                        <li key={`local-${n.source}-${n.headline.slice(0, 28)}`}>
                          <span className="text-white/90">{n.headline}</span>
                          <span className="mt-0.5 block text-[11px] text-white/45">{n.source}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className={localTierNews.length > 0 ? "mt-3" : "mt-2"}>
                  <div className="text-[11px] font-semibold text-white/55">
                    {localTierNews.length > 0 ? "全國重大" : "國內要聞"}
                  </div>
                  <ul className="mt-1.5 space-y-2">
                    {nationalDomesticNews.map((n) => (
                      <li key={`nat-${n.source}-${n.headline.slice(0, 28)}`}>
                        <span className="text-white/90">{n.headline}</span>
                        <span className="mt-0.5 block text-[11px] text-white/45">{n.source}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-200/90">國際</div>
                <ul className="mt-2 space-y-2">
                  {internationalNews.map((n) => (
                    <li key={`intl-${n.source}-${n.headline.slice(0, 28)}`}>
                      <span className="text-white/90">{n.headline}</span>
                      <span className="mt-0.5 block text-[11px] text-white/45">{n.source}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-white/50">暫無新聞條目</p>
          )}
          {newsQ.isError ? (
            <p className="mt-3 text-[13px] text-rose-300/90">新聞載入失敗，請稍後重試</p>
          ) : null}
        </div>
      </div>
      </div>
    </>
  );
}
