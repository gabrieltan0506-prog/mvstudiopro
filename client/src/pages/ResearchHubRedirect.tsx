import { useLayoutEffect } from "react";
import { useLocation } from "wouter";

const PATH_TO_TAB: Record<string, string> = {
  "/god-view": "god-view",
  "/agent/competitor-radar": "competitor-radar",
  "/agent/platform-ip-matrix": "ip-matrix",
  "/agent/vip-tracker": "vip-tracker",
};

/** 旧调研/智库/Agent 路径 → /research?tab= */
export default function ResearchHubRedirect() {
  const [location, setLocation] = useLocation();

  useLayoutEffect(() => {
    const path = location.split("?")[0];
    const tab = PATH_TO_TAB[path];
    if (!tab) {
      setLocation("/research");
      return;
    }
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    setLocation(`/research?${params.toString()}`);
  }, [location, setLocation]);

  return null;
}
