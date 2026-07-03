import { lazy, useLayoutEffect } from "react";
import { useLocation } from "wouter";
import { hasSupervisorAccess } from "@/lib/supervisorAccess";

const GrowthCampPage = lazy(() => import("./MVAnalysis"));

/** 旧版成长营整页（MVAnalysis）；普通用户 redirect 至 /platform */
export default function GrowthCampLegacyGate() {
  const [, setLocation] = useLocation();
  const allowed = hasSupervisorAccess();

  useLayoutEffect(() => {
    if (!allowed) {
      setLocation("/platform");
    }
  }, [allowed, setLocation]);

  if (!allowed) return null;
  return <GrowthCampPage />;
}
