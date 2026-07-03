import { useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2, PenLine } from "lucide-react";

const TARGET = "/creator-growth-camp/platform#platform-custom-workspace";

/**
 * 成长营全页分析已迁移至平台页「自定义创作工作台」。
 * 旧版 MVAnalysis 保留在 /creator-growth-camp/legacy（supervisor 调试用）。
 */
export default function GrowthCampRedirect() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("legacy") === "1") {
      setLocation("/creator-growth-camp/legacy");
      return;
    }
    setLocation(TARGET);
  }, [setLocation]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-transparent px-6 text-white">
      <Loader2 className="h-8 w-8 animate-spin text-[#ff4fb8]" />
      <div className="flex items-center gap-2 text-sm text-[#c9c0e6]/80">
        <PenLine className="h-4 w-4 text-[#ff9fe0]" />
        正在进入平台页 · 自定义创作工作台…
      </div>
    </div>
  );
}
