import React, { useState, useEffect, useRef } from "react";
import { Rocket, PartyPopper } from "lucide-react";

/**
 * Launch Countdown Banner
 * 
 * Shows a countdown timer from a fixed launch date (today 3PM + 7 days).
 * Precision: second-level countdown.
 * After countdown ends, shows "已正式上线" message.
 */

// Launch date: Feb 26, 2026 15:00:00 CST (UTC+8)
const LAUNCH_DATE = new Date("2026-02-26T15:00:00+08:00");

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
        <span className="text-green-500 text-base font-bold">MV Studio Pro 已正式上线！</span>
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
          <span className="text-yellow-400 text-xs font-bold tracking-widest uppercase">正式上线倒计时</span>
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
        <p className="text-white/50 text-[11px] text-center tracking-wide">全功能开放 · Stripe 支付上线 · AI 视频创作一站式体验</p>
      </div>
    </div>
  );
}
