import { useLayoutEffect } from "react";
import { useLocation } from "wouter";
import { premiumRemixRedirectTarget } from "@shared/premiumRemixRetired";
import MVAnalysisPage from "./MVAnalysis";

/**
 * 旧地址 /creator-growth-camp/premium-remix：视频复刻已并入拉片（站长 2026-11-11），替换式跳到 /lapian；
 * 带 ?format=note 的图文笔记复刻保留入口（拉片只收视频），沿用原有的参考拆解、改写与交接。
 */
export default function RemixLanding() {
  const [, setLocation] = useLocation();
  const target = premiumRemixRedirectTarget(typeof window !== "undefined" ? window.location.search : "");
  useLayoutEffect(() => {
    if (target) setLocation(target, { replace: true });
  }, [setLocation, target]);
  return target ? null : <MVAnalysisPage remixWorkspace />;
}
