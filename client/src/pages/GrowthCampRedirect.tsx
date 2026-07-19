import { useLayoutEffect } from "react";
import { useLocation } from "wouter";

/** 仅 `/creator-growth-camp/platform` · `/analysis` · `/viral` 跳转到 /platform；视频深度拆解入口为 /platform?tab=video */
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
