import { useLayoutEffect } from "react";
import { useLocation } from "wouter";

/** 仅 `/creator-growth-camp/platform` · `/analysis` · `/viral` 跳转到 /platform；主成长营页保留 MVAnalysis 与 Debug 并存 */
export default function GrowthCampRedirect() {
  const [, setLocation] = useLocation();

  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    const target = tab ? `/platform?tab=${encodeURIComponent(tab)}` : "/platform";
    setLocation(target);
  }, [setLocation]);

  return null;
}
