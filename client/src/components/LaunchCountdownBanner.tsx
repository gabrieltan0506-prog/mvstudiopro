import React, { useState, useEffect, useRef } from "react";
import { Rocket, PartyPopper } from "lucide-react";
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
      <div className="flex flex-row items-center justify-center gap-2 py-3.5 px-5 bg-green-500/10 border-b border-green-500/20">
        <PartyPopper size={18} className="text-yellow-400" />
        <span className="text-green-500 text-base font-bold">{SEEDANCE_25_LAUNCHED_LABEL_ZH}</span>
        <PartyPopper size={18} className="text-yellow-400" />
      </div>
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
