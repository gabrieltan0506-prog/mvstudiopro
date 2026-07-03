import { useLayoutEffect } from "react";
import { useLocation } from "wouter";

/** 成长营能力已并入 /platform；旧版调试入口见 /creator-growth-camp/legacy */
export default function GrowthCampRedirect() {
  const [, setLocation] = useLocation();

  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("legacy") === "1") {
      setLocation("/creator-growth-camp/legacy");
      return;
    }
    const tab = params.get("tab");
    const target = tab ? `/platform?tab=${encodeURIComponent(tab)}` : "/platform";
    setLocation(target);
  }, [setLocation]);

  return null;
}
