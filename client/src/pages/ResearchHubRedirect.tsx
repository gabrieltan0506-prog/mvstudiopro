import { useLayoutEffect } from "react";
import { useLocation } from "wouter";

/** 旧调研 / 智库 / Agent 路径 → /research（1113：战略智库与 Agent 场景已下线，只剩竞品调研）。 */
export default function ResearchHubRedirect() {
  const [, setLocation] = useLocation();

  useLayoutEffect(() => {
    setLocation("/research");
  }, [setLocation]);

  return null;
}
