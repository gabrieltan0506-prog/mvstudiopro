import { useLayoutEffect } from "react";
import { useLocation } from "wouter";
import { premiumRemixRedirectTarget } from "@shared/premiumRemixRetired";

/**
 * 旧地址 /creator-growth-camp/premium-remix（含 ?format=video / ?format=note 等任意参数）：
 * 爆款复刻已并入拉片（站长 2026-11-11），一律替换式跳到 /lapian，不留死链、不进浏览历史。
 */
export default function RemixLanding() {
  const [, setLocation] = useLocation();
  useLayoutEffect(() => {
    setLocation(premiumRemixRedirectTarget(), { replace: true });
  }, [setLocation]);
  return null;
}
