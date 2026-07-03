import { useLayoutEffect } from "react";
import { useLocation } from "wouter";
import { hasSupervisorAccess } from "@/lib/supervisorAccess";

/** 成长营能力已并入 /platform；旧版整页仅 supervisor 可访问 /creator-growth-camp/legacy */
export default function GrowthCampRedirect() {
  const [, setLocation] = useLocation();

  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("legacy") === "1") {
      setLocation(hasSupervisorAccess() ? "/creator-growth-camp/legacy" : "/platform");
      return;
    }
    const tab = params.get("tab");
    const target = tab ? `/platform?tab=${encodeURIComponent(tab)}` : "/platform";
    setLocation(target);
  }, [setLocation]);

  return null;
}
