import React, { useState, useEffect, useRef } from "react";
import { Hourglass, TimerOff, X } from "lucide-react";
import { useLocation } from "wouter";

/**
 * Trial Countdown Banner
 * 
 * Shows a countdown timer when the user's trial has less than 6 hours remaining.
 * Precision: second-level countdown.
 * Includes a CTA to upgrade to a paid plan.
 */

interface TrialCountdownBannerProps {
  /** Trial end date ISO string */
  trialEndDate?: string | null;
  /** Whether the user is on a trial plan */
  isTrial?: boolean;
  /** Whether the trial has expired */
  trialExpired?: boolean;
}

interface TimeLeft {
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
}

function calcTimeLeft(endDate: string): TimeLeft {
  const now = new Date();
  const end = new Date(endDate);
  const total = end.getTime() - now.getTime();
  if (total <= 0) {
    return { hours: 0, minutes: 0, seconds: 0, total: 0 };
  }
  const hours = Math.floor(total / (1000 * 60 * 60));
  const minutes = Math.floor((total / (1000 * 60)) % 60);
  const seconds = Math.floor((total / 1000) % 60);
  return { hours, minutes, seconds, total };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function TrialCountdownBanner({ trialEndDate, isTrial, trialExpired }: TrialCountdownBannerProps) {
  const [, navigate] = useLocation();
  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isTrial || !trialEndDate || trialExpired) return;

    const tl = calcTimeLeft(trialEndDate);
    // Only show when less than 6 hours remaining
    if (tl.total > 6 * 60 * 60 * 1000) return;

    setTimeLeft(tl);

    intervalRef.current = setInterval(() => {
      const newTl = calcTimeLeft(trialEndDate);
      setTimeLeft(newTl);
      if (newTl.total <= 0 && intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isTrial, trialEndDate, trialExpired]);

  // Don't render if: not trial, no end date, expired, dismissed, or more than 6h remaining
  if (!isTrial || !trialEndDate || trialExpired || dismissed || !timeLeft) return null;

  // Trial already ended
  if (timeLeft.total <= 0) {
    return (
      <div className="mx-0 my-1 rounded-xl bg-red-500/10 border border-red-500/20">
        <div className="flex flex-row items-center justify-center gap-2.5 py-2.5 px-3.5">
          <TimerOff size={18} className="text-red-400" />
          <span className="text-red-400 text-sm font-bold">试用已结束</span>
          <button
            className="bg-red-400 px-3.5 py-2 rounded-lg"
            onClick={() => navigate("/student-verification")}
          >
            <span className="text-white text-xs font-bold">立即升级</span>
          </button>
        </div>
      </div>
    );
  }

  // Urgency levels
  const isUrgent = timeLeft.total < 1 * 60 * 60 * 1000; // < 1 hour
  const isWarning = timeLeft.total < 3 * 60 * 60 * 1000; // < 3 hours

  const bannerClasses = isUrgent
    ? "bg-red-500/10 border-red-500/30"
    : isWarning
    ? "bg-orange-500/10 border-orange-500/25"
    : "bg-yellow-500/10 border-yellow-500/20";

  const iconColor = isUrgent ? "text-red-600" : isWarning ? "text-orange-400" : "text-yellow-400";
  const titleColor = isUrgent ? "text-red-600" : "text-yellow-400";
  const timeColor = isUrgent ? "text-red-600" : "text-white";

  return (
    <div className={`mx-0 my-1 rounded-xl overflow-hidden border ${bannerClasses}`}>
      <div className="flex flex-row items-center justify-between py-2.5 px-3.5">
        <div className="flex flex-row items-center gap-2.5">
          <Hourglass size={18} className={iconColor} />
          <div>
            <p className={`text-xs font-semibold ${titleColor}`}>
              {isUrgent ? "试用即将结束！" : "试用剩余时间"}
            </p>
            <div className="flex flex-row items-center mt-0.5">
              <span className={`text-xl font-extrabold tracking-wider font-mono ${timeColor}`}>
                {pad(timeLeft.hours)}:{pad(timeLeft.minutes)}:{pad(timeLeft.seconds)}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-row items-center gap-2">
          <button
            className={`px-3.5 py-2 rounded-lg ${isUrgent ? "bg-red-600" : "bg-red-400"}`}
            onClick={() => navigate("/student-verification")}
          >
            <span className="text-white text-xs font-bold">升级方案</span>
          </button>
          <button onClick={() => setDismissed(true)} className="p-1">
            <X size={16} className="text-white/40" />
          </button>
        </div>
      </div>
    </div>
  );
}
