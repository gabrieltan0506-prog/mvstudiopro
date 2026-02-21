import React, { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";

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
  const router = useRouter();
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
      <View style={styles.bannerExpired}>
        <View style={styles.expiredContent}>
          <MaterialIcons name="timer-off" size={18} color="#FF6B6B" />
          <Text style={styles.expiredText}>试用已结束</Text>
          <TouchableOpacity
            style={styles.upgradeBtn}
            onPress={() => router.push("/student-verification" as any)}
            activeOpacity={0.8}
          >
            <Text style={styles.upgradeBtnText}>立即升级</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Urgency levels
  const isUrgent = timeLeft.total < 1 * 60 * 60 * 1000; // < 1 hour
  const isWarning = timeLeft.total < 3 * 60 * 60 * 1000; // < 3 hours

  return (
    <View style={[
      styles.banner,
      isUrgent ? styles.bannerUrgent : isWarning ? styles.bannerWarning : styles.bannerNormal,
    ]}>
      <View style={styles.bannerContent}>
        <View style={styles.leftSection}>
          <MaterialIcons
            name="hourglass-bottom"
            size={18}
            color={isUrgent ? "#FF3B30" : isWarning ? "#FF9F0A" : "#FFD60A"}
          />
          <View>
            <Text style={[
              styles.bannerTitle,
              isUrgent && { color: "#FF3B30" },
            ]}>
              {isUrgent ? "试用即将结束！" : "试用剩余时间"}
            </Text>
            <View style={styles.timeRow}>
              <Text style={[styles.timeText, isUrgent && { color: "#FF3B30" }]}>
                {pad(timeLeft.hours)}:{pad(timeLeft.minutes)}:{pad(timeLeft.seconds)}
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.rightSection}>
          <TouchableOpacity
            style={[styles.upgradeBtn, isUrgent && styles.upgradeBtnUrgent]}
            onPress={() => router.push("/student-verification" as any)}
            activeOpacity={0.8}
          >
            <Text style={styles.upgradeBtnText}>升级方案</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setDismissed(true)} style={styles.dismissBtn}>
            <MaterialIcons name="close" size={16} color="rgba(255,255,255,0.40)" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: Platform.OS === "web" ? 0 : 12,
    marginTop: 4,
    marginBottom: 4,
    borderRadius: 12,
    overflow: "hidden",
  },
  bannerNormal: {
    backgroundColor: "rgba(255,214,10,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,214,10,0.20)",
  },
  bannerWarning: {
    backgroundColor: "rgba(255,159,10,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,159,10,0.25)",
  },
  bannerUrgent: {
    backgroundColor: "rgba(255,59,48,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,59,48,0.30)",
  },
  bannerContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  leftSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bannerTitle: {
    color: "#FFD60A",
    fontSize: 12,
    fontWeight: "600",
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  timeText: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    letterSpacing: 1,
  },
  rightSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  upgradeBtn: {
    backgroundColor: "#FF6B6B",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  upgradeBtnUrgent: {
    backgroundColor: "#FF3B30",
  },
  upgradeBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  dismissBtn: {
    padding: 4,
  },
  bannerExpired: {
    marginHorizontal: Platform.OS === "web" ? 0 : 12,
    marginTop: 4,
    marginBottom: 4,
    borderRadius: 12,
    backgroundColor: "rgba(255,59,48,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,59,48,0.20)",
  },
  expiredContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  expiredText: {
    color: "#FF6B6B",
    fontSize: 14,
    fontWeight: "700",
  },
});
