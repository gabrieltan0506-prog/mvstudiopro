import React, { useState, useEffect, useRef } from "react";
import { Rocket, PartyPopper, ArrowRight, Clapperboard } from "lucide-react";
import { Link } from "wouter";
import {
  SEEDANCE_25_COUNTDOWN_SUBTITLE_ZH,
  SEEDANCE_25_COUNTDOWN_TITLE_ZH,
  SEEDANCE_25_LAUNCHED_LABEL_ZH,
  SEEDANCE_25_LAUNCH_AT_ISO,
} from "@shared/seedance25Access";

/**
 * 首页上线倒计时（读秒）。
 *
 * 用户 2026-08-05 明文：对外宣称 Seedance 2.5 上线日（日期真源见下），首页开始读秒；
 * 到点自动对正式会员开放（见 `shared/seedance25Access.ts`），横幅同步换成已上线文案。
 * 本处按用户明文授权对外写出引擎名，属前台零技术泄漏规则的显式例外。
 */

const LAUNCH_DATE = new Date(SEEDANCE_25_LAUNCH_AT_ISO);

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
}

function calcTimeLeft(): TimeLeft {
  const now = new Date();
  const total = LAUNCH_DATE.getTime() - now.getTime();
  if (total <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 };
  }
  const days = Math.floor(total / (1000 * 60 * 60 * 24));
  const hours = Math.floor((total / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((total / (1000 * 60)) % 60);
  const seconds = Math.floor((total / 1000) % 60);
  return { days, hours, minutes, seconds, total };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function LaunchCountdownBanner() {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(calcTimeLeft());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setTimeLeft(calcTimeLeft());
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Already launched
  if (timeLeft.total <= 0) {
    return (
      <section className="border-b border-emerald-300/15 bg-[radial-gradient(circle_at_20%_10%,rgba(16,185,129,0.17),transparent_34%),linear-gradient(135deg,#070a10,#111126_58%,#170b25)] px-5 py-8 sm:py-11">
        <div className="mx-auto grid w-full max-w-[1120px] items-center gap-7 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-bold text-emerald-200">
              <PartyPopper size={14} className="text-yellow-300" /> 正式上线
            </div>
            <h2 className="mt-4 text-3xl font-black leading-tight text-white sm:text-4xl">
              {SEEDANCE_25_LAUNCHED_LABEL_ZH}
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-7 text-white/58">
              单段最长 30 秒，原生声画同步。文生视频、图生视频、多模态参考、视频编辑与视频延长，已经接入漫剧工厂和创作画布。
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold text-white/65">
              {["文生视频", "图生视频", "多模态参考", "视频编辑", "视频延长"].map(label => (
                <span key={label} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5">
                  {label}
                </span>
              ))}
            </div>
            <Link
              href="/canvas"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-5 py-3 text-sm font-black text-slate-950 transition hover:brightness-110"
            >
              <Clapperboard className="h-4 w-4" /> 进入漫剧工厂与画布
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <figure className="overflow-hidden rounded-2xl border border-white/12 bg-black/35 shadow-[0_24px_80px_rgba(0,0,0,0.4)]">
            <video
              controls
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              poster="/home-assets/seedance25-kpop-dance-poster.jpg"
              className="aspect-video w-full bg-black object-cover"
            >
              <source src="/home-assets/seedance25-kpop-dance.mp4" type="video/mp4" />
            </video>
            <figcaption className="flex items-center justify-between gap-3 px-4 py-3 text-xs text-white/55">
              <span>Seedance 2.5 · K-pop dance 示例</span>
              <span>1920×1080 · 声画同步</span>
            </figcaption>
          </figure>
        </div>
      </section>
    );
  }

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-0 bg-[#1A0A2E]"></div>
      <div className="relative py-4 px-5 flex flex-col items-center gap-2.5">
        <div className="flex flex-row items-center gap-2">
          <Rocket size={16} className="text-yellow-400" />
          <span className="text-yellow-400 text-xs font-bold tracking-widest uppercase">
            {SEEDANCE_25_COUNTDOWN_TITLE_ZH}
          </span>
          <Rocket size={16} className="text-yellow-400" />
        </div>
        <div className="flex flex-row items-center gap-1">
          <div className="flex flex-col items-center bg-white/10 rounded-lg px-3 py-2 min-w-[56px] border border-yellow-400/20">
            <span className="text-white text-3xl font-extrabold font-mono tracking-wider">{pad(timeLeft.days)}</span>
            <span className="text-white/50 text-[10px] font-semibold mt-0.5">天</span>
          </div>
          <span className="text-yellow-400 text-2xl font-extrabold mx-0.5">:</span>
          <div className="flex flex-col items-center bg-white/10 rounded-lg px-3 py-2 min-w-[56px] border border-yellow-400/20">
            <span className="text-white text-3xl font-extrabold font-mono tracking-wider">{pad(timeLeft.hours)}</span>
            <span className="text-white/50 text-[10px] font-semibold mt-0.5">时</span>
          </div>
          <span className="text-yellow-400 text-2xl font-extrabold mx-0.5">:</span>
          <div className="flex flex-col items-center bg-white/10 rounded-lg px-3 py-2 min-w-[56px] border border-yellow-400/20">
            <span className="text-white text-3xl font-extrabold font-mono tracking-wider">{pad(timeLeft.minutes)}</span>
            <span className="text-white/50 text-[10px] font-semibold mt-0.5">分</span>
          </div>
          <span className="text-yellow-400 text-2xl font-extrabold mx-0.5">:</span>
          <div className="flex flex-col items-center bg-white/10 rounded-lg px-3 py-2 min-w-[56px] border border-yellow-400/20">
            <span className="text-red-500 text-3xl font-extrabold font-mono tracking-wider">{pad(timeLeft.seconds)}</span>
            <span className="text-white/50 text-[10px] font-semibold mt-0.5">秒</span>
          </div>
        </div>
        <p className="text-white/50 text-[11px] text-center tracking-wide">
          {SEEDANCE_25_COUNTDOWN_SUBTITLE_ZH}
        </p>
      </div>
    </div>
  );
}
