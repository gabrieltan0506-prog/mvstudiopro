import React, { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

/**
 * Launch Countdown Banner
 * 
 * Shows a countdown timer from a fixed launch date (today 3PM + 7 days).
 * Precision: second-level countdown.
 * After countdown ends, shows "已正式上线" message.
 */

// Launch date: Feb 19, 2026 15:00:00 CST (UTC+8) + 7 days = Feb 26, 2026 15:00:00 CST
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
      <View style={styles.bannerLaunched}>
        <MaterialIcons name="celebration" size={18} color="#FFD60A" />
        <Text style={styles.launchedText}>MV Studio Pro 已正式上线！</Text>
        <MaterialIcons name="celebration" size={18} color="#FFD60A" />
      </View>
    );
  }

  return (
    <View style={styles.banner}>
      {/* Gradient background effect via layered views */}
      <View style={styles.bannerBg} />
      <View style={styles.bannerContent}>
        <View style={styles.bannerTop}>
          <MaterialIcons name="rocket-launch" size={16} color="#FFD60A" />
          <Text style={styles.bannerLabel}>正式上线倒计时</Text>
          <MaterialIcons name="rocket-launch" size={16} color="#FFD60A" />
        </View>
        <View style={styles.countdownRow}>
          <View style={styles.timeBlock}>
            <Text style={styles.timeValue}>{pad(timeLeft.days)}</Text>
            <Text style={styles.timeUnit}>天</Text>
          </View>
          <Text style={styles.timeSeparator}>:</Text>
          <View style={styles.timeBlock}>
            <Text style={styles.timeValue}>{pad(timeLeft.hours)}</Text>
            <Text style={styles.timeUnit}>时</Text>
          </View>
          <Text style={styles.timeSeparator}>:</Text>
          <View style={styles.timeBlock}>
            <Text style={styles.timeValue}>{pad(timeLeft.minutes)}</Text>
            <Text style={styles.timeUnit}>分</Text>
          </View>
          <Text style={styles.timeSeparator}>:</Text>
          <View style={styles.timeBlock}>
            <Text style={[styles.timeValue, styles.secondsValue]}>{pad(timeLeft.seconds)}</Text>
            <Text style={styles.timeUnit}>秒</Text>
          </View>
        </View>
        <Text style={styles.bannerSubtext}>全功能开放 · Stripe 支付上线 · AI 视频创作一站式体验</Text>
      </View>
    </View>
  );
}

const isWeb = Platform.OS === "web";

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: isWeb ? 0 : 16,
    marginTop: isWeb ? 0 : 8,
    borderRadius: isWeb ? 0 : 16,
    overflow: "hidden",
    position: "relative",
  },
  bannerBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#1A0A2E",
    // Deep purple gradient effect
  },
  bannerContent: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: "center",
    gap: 10,
  },
  bannerTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  bannerLabel: {
    color: "#FFD60A",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  countdownRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  timeBlock: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 56,
    borderWidth: 1,
    borderColor: "rgba(255,214,10,0.20)",
  },
  timeValue: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    letterSpacing: 1,
  },
  secondsValue: {
    color: "#FF6B6B",
  },
  timeUnit: {
    color: "rgba(255,255,255,0.50)",
    fontSize: 10,
    fontWeight: "600",
    marginTop: 2,
  },
  timeSeparator: {
    color: "#FFD60A",
    fontSize: 24,
    fontWeight: "800",
    marginHorizontal: 2,
  },
  bannerSubtext: {
    color: "rgba(255,255,255,0.50)",
    fontSize: 11,
    textAlign: "center",
    letterSpacing: 0.5,
  },
  bannerLaunched: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: "rgba(48,209,88,0.10)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(48,209,88,0.20)",
  },
  launchedText: {
    color: "#30D158",
    fontSize: 15,
    fontWeight: "700",
  },
});
