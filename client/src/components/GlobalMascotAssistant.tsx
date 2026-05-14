import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2, Shuffle } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import "./mascot-assistant.css";

const PROACTIVE_TTS_KEY = "mv_mascot_proactive_tts";

export type MascotDashboardData = {
  currentTime: string;
  weather: { condition: string; temperature: string; humidity: string; source?: string };
  traffic: { summary: string; congestedAreas?: string[] };
};

export const MASCOT_OPTIONS = [
  {
    id: "cloud",
    label: "雲朵播報員",
    src: "/mascots/mascot-cloud.png",
    fallbackEmoji: "☁️",
    gradient: "from-sky-300/90 to-indigo-400/90",
  },
  {
    id: "fox",
    label: "智庫狐",
    src: "/mascots/mascot-fox.png",
    fallbackEmoji: "🦊",
    gradient: "from-orange-300/90 to-amber-600/90",
  },
  {
    id: "cat",
    label: "數碼貓",
    src: "/mascots/mascot-cat.png",
    fallbackEmoji: "🐱",
    gradient: "from-cyan-300/90 to-slate-500/90",
  },
] as const;

function pickRandomMascotId(
  exclude?: (typeof MASCOT_OPTIONS)[number]["id"],
): (typeof MASCOT_OPTIONS)[number]["id"] {
  const pool = exclude
    ? MASCOT_OPTIONS.filter((m) => m.id !== exclude)
    : [...MASCOT_OPTIONS];
  return pool[Math.floor(Math.random() * pool.length)]!.id;
}

function pickZhVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang.toLowerCase().startsWith("zh-cn")) ||
    voices.find((v) => v.lang.toLowerCase().startsWith("zh-tw")) ||
    voices.find((v) => v.lang.toLowerCase().startsWith("zh")) ||
    null
  );
}

function normSig(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function buildReportMessage(
  d: MascotDashboardData,
  newsHeadline?: string | null,
): string {
  const wx = `今天天氣${d.weather.condition}，氣溫大約${d.weather.temperature}，濕度${d.weather.humidity}`;
  let road = d.traffic.summary;
  const areas = d.traffic.congestedAreas;
  if (areas && areas.length > 0) {
    road += `。主要擁堵路段包括：${areas.slice(0, 4).join("、")}`;
  }
  let s = `現在時間是 ${d.currentTime}。${wx}。路況方面，${road}。`;
  const head = newsHeadline?.trim();
  if (head) s += ` 頭條速報：${head}。`;
  s += " 祝您創作順利！";
  return s;
}

type NewsQueryData = {
  domestic: { headline: string; source: string; tier: string }[];
  international: { headline: string; source: string; tier: string }[];
  news?: { headline: string; source: string; tier: string }[];
};

function buildNewsDigest(data: NewsQueryData): string {
  const dom = data.domestic.map((x) => normSig(x.headline)).join("｜");
  const intl = data.international.map((x) => normSig(x.headline)).join("｜");
  return `${dom}::${intl}`;
}

function buildFullNewsSpeech(data: NewsQueryData): string {
  const local = data.domestic.filter((x) => x.tier === "local");
  const nat = data.domestic.filter((x) => x.tier === "national");
  const intl = data.international;
  let s = "為您播報即時新聞。";
  if (local.length) {
    s += "周邊與本地：" + local.map((n) => n.headline).join("；") + "。";
  }
  if (nat.length) {
    s += "國內要聞：" + nat.map((n) => n.headline).join("；") + "。";
  }
  if (intl.length) {
    s += "國際：" + intl.map((n) => n.headline).join("；") + "。";
  }
  return s;
}

/**
 * 全站浮層吉祥物：文本朗讀、儀表板／新聞播報、資料變化提醒、LLM 情緒關懷。
 */
export function GlobalMascotAssistant() {
  const [locationPath] = useLocation();
  const [geo, setGeo] = useState<{ lat: number; lon: number } | null>(null);
  const [geoAttemptDone, setGeoAttemptDone] = useState(false);
  const browserTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);

  const [panelOpen, setPanelOpen] = useState(false);
  const [userInput, setUserInput] = useState("");
  const proactiveTtsRef = useRef(true);

  const [mascotId, setMascotId] = useState<(typeof MASCOT_OPTIONS)[number]["id"]>(() =>
    pickRandomMascotId(),
  );
  const [imgBroken, setImgBroken] = useState(false);
  const [bubbleText, setBubbleText] = useState(
    "我是全站播報員，點我展開：可朗讀您輸入的文字，或播報天氣、路況與新聞。",
  );
  const [displayedText, setDisplayedText] = useState(bubbleText);
  const [isTalking, setIsTalking] = useState(false);
  const [proactiveUi, setProactiveUi] = useState(true);

  const typewriterTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(
    typeof window !== "undefined" ? window.speechSynthesis : null,
  );
  const dataSnapRef = useRef<{ wx: string; tr: string; news: string } | null>(null);
  const lastProactiveAt = useRef(0);

  const mascot = useMemo(() => MASCOT_OPTIONS.find((m) => m.id === mascotId)!, [mascotId]);

  useEffect(() => {
    try {
      const v = localStorage.getItem(PROACTIVE_TTS_KEY);
      if (v === "0") {
        proactiveTtsRef.current = false;
        setProactiveUi(false);
      }
    } catch {
      /**/
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PROACTIVE_TTS_KEY, proactiveUi ? "1" : "0");
    } catch {
      /**/
    }
    proactiveTtsRef.current = proactiveUi;
  }, [proactiveUi]);

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
        if (!cancelled) {
          setGeo({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        }
      } catch {
        if (!cancelled) setGeo(null);
      } finally {
        if (!cancelled) setGeoAttemptDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const live = trpc.ambient.dashboardLive.useQuery(
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

  const newsQ = trpc.ambient.dashboardNews.useQuery(
    { lat: geo?.lat, lon: geo?.lon },
    {
      staleTime: 30 * 60_000,
      refetchInterval: 30 * 60_000,
      refetchOnWindowFocus: false,
    },
  );

  const careMut = trpc.ambient.mascotCareMessage.useMutation();

  const dashboardData: MascotDashboardData | null = live.data
    ? {
        currentTime: live.data.currentTime,
        weather: live.data.weather,
        traffic: live.data.traffic,
      }
    : null;

  const newsHeadlineForReport =
    newsQ.data?.domestic?.find((n) => n.tier === "local")?.headline ??
    newsQ.data?.domestic?.[0]?.headline ??
    null;

  useEffect(() => {
    setImgBroken(false);
  }, [mascotId, mascot.src]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const warm = () => pickZhVoice();
    warm();
    window.speechSynthesis.onvoiceschanged = warm;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const stopTypewriter = useCallback(() => {
    if (typewriterTimer.current) {
      clearInterval(typewriterTimer.current);
      typewriterTimer.current = null;
    }
  }, []);

  const runTypewriter = useCallback(
    (full: string, msPerChar: number) => {
      stopTypewriter();
      let i = 0;
      setDisplayedText("");
      typewriterTimer.current = setInterval(() => {
        i += 1;
        setDisplayedText(full.slice(0, i));
        if (i >= full.length) stopTypewriter();
      }, msPerChar);
    },
    [stopTypewriter],
  );

  useEffect(() => () => stopTypewriter(), [stopTypewriter]);

  const trySpeak = useCallback((text: string, onUnavailable: () => void) => {
    const synth = synthRef.current;
    if (!synth) {
      onUnavailable();
      return;
    }
    try {
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "zh-CN";
      utterance.rate = 1.08;
      utterance.pitch = 1.05;
      const v = pickZhVoice();
      if (v) utterance.voice = v;
      utterance.onstart = () => setIsTalking(true);
      utterance.onend = () => setIsTalking(false);
      utterance.onerror = () => {
        setIsTalking(false);
        onUnavailable();
      };
      synth.speak(utterance);
    } catch {
      onUnavailable();
    }
  }, []);

  useEffect(() => {
    return () => {
      synthRef.current?.cancel();
    };
  }, []);

  const speakAndShow = useCallback(
    (full: string) => {
      stopTypewriter();
      synthRef.current?.cancel();
      setIsTalking(false);
      setBubbleText(full);
      runTypewriter(full, 22);
      trySpeak(full, () => {
        stopTypewriter();
        runTypewriter(full, 36);
      });
    },
    [runTypewriter, stopTypewriter, trySpeak],
  );

  useEffect(() => {
    if (!geoAttemptDone || !live.data) return;
    const wx = normSig(
      `${live.data.weather.condition}|${live.data.weather.temperature}|${live.data.weather.humidity}`,
    );
    const tr = normSig(
      `${live.data.traffic.summary}|${(live.data.traffic.congestedAreas ?? []).join(",")}`,
    );
    const newsDigest = newsQ.data ? buildNewsDigest(newsQ.data as NewsQueryData) : "";
    const prev = dataSnapRef.current;
    dataSnapRef.current = { wx, tr, news: newsDigest };
    if (!prev) return;

    const hints: string[] = [];
    if (prev.wx !== wx) hints.push("天氣資訊有更新，請留意穿著與出行");
    if (prev.tr !== tr) hints.push("路況摘要已變化");
    if (newsDigest && prev.news !== newsDigest) hints.push("即時新聞頭條已刷新");

    if (hints.length === 0) return;
    if (!proactiveUi) return;
    const now = Date.now();
    if (now - lastProactiveAt.current < 120_000) return;
    lastProactiveAt.current = now;

    const msg = `小提醒：${hints.join("；")}。需要完整內容可點「儀表板」或「新聞」播放。`;
    toast.message("吉祥物提醒", { description: msg });
    setPanelOpen(true);
    setBubbleText(msg);
    runTypewriter(msg, 18);
    if (proactiveTtsRef.current) {
      trySpeak(msg, () => {
        stopTypewriter();
        runTypewriter(msg, 34);
      });
    }
  }, [geoAttemptDone, live.data, newsQ.data, proactiveUi, runTypewriter, stopTypewriter, trySpeak]);

  const onReadInput = useCallback(() => {
    const t = userInput.trim();
    if (!t) {
      toast.message("請先在文本框輸入內容");
      return;
    }
    speakAndShow(t);
  }, [speakAndShow, userInput]);

  const onDashboard = useCallback(() => {
    if (!geoAttemptDone || live.isLoading) {
      speakAndShow("正在讀取天氣與路況，請稍候再試。");
      return;
    }
    if (!dashboardData) {
      speakAndShow("暫時無法取得儀表板資料，請稍後再試。");
      return;
    }
    speakAndShow(buildReportMessage(dashboardData, newsHeadlineForReport));
  }, [
    dashboardData,
    geoAttemptDone,
    live.isLoading,
    newsHeadlineForReport,
    speakAndShow,
  ]);

  const onNews = useCallback(() => {
    if (newsQ.isLoading || !newsQ.data?.news?.length) {
      speakAndShow(newsQ.isLoading ? "新聞仍在載入中。" : "暫時沒有可播報的新聞條目。");
      return;
    }
    speakAndShow(buildFullNewsSpeech(newsQ.data as NewsQueryData));
  }, [newsQ.data, newsQ.isLoading, speakAndShow]);

  const onAiCare = useCallback(async () => {
    if (!dashboardData) {
      toast.message("請先等天氣與路況載入完成，再試一次");
      return;
    }
    try {
      const message = await careMut.mutateAsync({
        userNote: userInput.trim() || undefined,
        currentTime: dashboardData.currentTime,
        pagePath: locationPath || "/",
        weather: dashboardData.weather,
        trafficSummary: dashboardData.traffic.summary,
        trafficAreas: dashboardData.traffic.congestedAreas,
        newsLines: newsQ.data?.news?.slice(0, 10).map((n) => `${n.headline}（${n.source}）`),
      });
      speakAndShow(message.message);
    } catch {
      toast.error("關懷語生成失敗，請稍後再試");
      speakAndShow("剛才有點網路小狀況，不妨深呼吸一下，我們等等再試。");
    }
  }, [careMut, dashboardData, locationPath, newsQ.data?.news, speakAndShow, userInput]);

  const shuffleMascot = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setMascotId((prev) => pickRandomMascotId(prev));
  }, []);

  return (
    <div
      className="pointer-events-none fixed bottom-6 right-4 z-[120] flex w-[min(100vw-1.25rem,22rem)] flex-col items-end sm:bottom-8 sm:right-8"
      aria-live="polite"
    >
      {panelOpen ? (
        <div className="pointer-events-auto mb-3 w-full space-y-3 rounded-2xl border border-white/20 bg-slate-950/88 p-3 shadow-2xl backdrop-blur-xl">
          <div
            className={`relative rounded-[1.2rem] border border-white/20 bg-white/92 px-3.5 py-3 shadow-lg backdrop-blur-xl ${isTalking ? "ring-2 ring-cyan-400/40" : ""}`}
          >
            <p className="max-h-[28vh] overflow-y-auto text-[14px] font-medium leading-relaxed tracking-tight text-gray-800 antialiased">
              {displayedText}
              {displayedText.length > 0 && displayedText.length < bubbleText.length ? (
                <span
                  className="ml-0.5 inline-block h-4 w-px animate-pulse bg-gray-400"
                  aria-hidden
                />
              ) : null}
            </p>
            <div
              className="absolute -bottom-2 right-10 h-3 w-3 rotate-45 border-b border-r border-white/25 bg-white/92"
              aria-hidden
            />
          </div>

          <textarea
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder="輸入想讓吉祥物朗讀的文字，或給 AI 關懷的備註…"
            rows={3}
            className="w-full resize-none rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-[13px] leading-snug text-white placeholder:text-white/35 focus:border-cyan-400/50 focus:outline-none focus:ring-1 focus:ring-cyan-400/30"
          />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onReadInput}
              className="rounded-lg border border-sky-400/35 bg-sky-500/20 px-2.5 py-1.5 text-[12px] font-semibold text-sky-100 transition hover:bg-sky-500/30"
            >
              朗讀文本框
            </button>
            <button
              type="button"
              onClick={onDashboard}
              className="rounded-lg border border-amber-400/35 bg-amber-500/20 px-2.5 py-1.5 text-[12px] font-semibold text-amber-100 transition hover:bg-amber-500/25"
            >
              天氣路況
            </button>
            <button
              type="button"
              onClick={onNews}
              className="rounded-lg border border-emerald-400/35 bg-emerald-500/20 px-2.5 py-1.5 text-[12px] font-semibold text-emerald-100 transition hover:bg-emerald-500/30"
            >
              即時新聞
            </button>
            <button
              type="button"
              onClick={() => void onAiCare()}
              disabled={careMut.isPending}
              className="inline-flex items-center gap-1 rounded-lg border border-violet-400/40 bg-violet-500/25 px-2.5 py-1.5 text-[12px] font-semibold text-violet-100 transition enabled:hover:bg-violet-500/35 disabled:opacity-45"
            >
              {careMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              AI 關懷
            </button>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-white/60">
            <input
              type="checkbox"
              checked={proactiveUi}
              onChange={(e) => setProactiveUi(e.target.checked)}
              className="accent-cyan-400"
            />
            資料更新時通知並朗讀摘要（關閉則不主動打擾；約每 2 分鐘最多提醒一次）
          </label>

          <button
            type="button"
            onClick={() => setPanelOpen(false)}
            className="flex w-full items-center justify-center gap-1 rounded-lg border border-white/15 bg-white/5 py-1.5 text-[12px] text-white/70 transition hover:bg-white/10"
          >
            <ChevronDown className="h-4 w-4" />
            收起面板
          </button>
        </div>
      ) : null}

      <div className="pointer-events-auto relative">
        <button
          type="button"
          onClick={shuffleMascot}
          className="absolute -left-1 -top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-slate-900/80 text-white shadow-lg backdrop-blur-md transition hover:scale-105 hover:bg-slate-800"
          aria-label="隨機更換吉祥物"
          title={`隨機更換（目前：${mascot.label}）`}
        >
          <Shuffle className="h-4 w-4 opacity-90" />
        </button>

        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          className={`relative cursor-pointer rounded-2xl border border-white/15 bg-white/5 p-1 shadow-xl backdrop-blur-sm transition hover:scale-[1.05] active:scale-95 ${isTalking ? "mascot-assistant-talk" : "mascot-assistant-float"} `}
          style={{ width: 112, height: 112 }}
          aria-expanded={panelOpen}
          aria-label={`${mascot.label}：展開播報面板`}
        >
          {!imgBroken ? (
            <img
              src={mascot.src}
              alt={mascot.label}
              width={112}
              height={112}
              className="h-full w-full object-contain drop-shadow-2xl"
              loading="lazy"
              decoding="async"
              onError={() => setImgBroken(true)}
            />
          ) : (
            <div
              className={`flex h-full w-full select-none items-center justify-center rounded-xl bg-gradient-to-br text-4xl ${mascot.gradient}`}
            >
              <span aria-hidden>{mascot.fallbackEmoji}</span>
            </div>
          )}
        </button>
      </div>
    </div>
  );
}

export default GlobalMascotAssistant;
