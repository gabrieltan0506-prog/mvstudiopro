import React, { useRef, useState } from "react";
import { toPng } from "html-to-image";
import {
  Download,
  Loader2,
  Moon,
  Sun,
  Sparkles,
  BarChart2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { VisualReportTemplate, type VisualReportData } from "./VisualReportTemplate";

type WindowDays = "15" | "30";
type Theme = "dark" | "light";
type PlatformKey = "douyin" | "kuaishou" | "xiaohongshu" | "toutiao";

const PLATFORM_OPTIONS: { key: PlatformKey; label: string; icon: string }[] = [
  { key: "douyin", label: "抖音", icon: "🎵" },
  { key: "kuaishou", label: "快手", icon: "⚡" },
  { key: "xiaohongshu", label: "小红书", icon: "📖" },
  { key: "toutiao", label: "今日头条", icon: "📰" },
];

const PLATFORM_NAMES: Record<PlatformKey, string> = {
  douyin: "抖音",
  kuaishou: "快手",
  xiaohongshu: "小红书",
  toutiao: "今日头条",
};

type Props = {
  supervisorAccess?: boolean;
};

export default function ReportGeneratorPanel({ supervisorAccess }: Props) {
  const reportRef = useRef<HTMLDivElement>(null);
  const [windowDays, setWindowDays] = useState<WindowDays>("30");
  const [theme, setTheme] = useState<Theme>("dark");
  const [platforms, setPlatforms] = useState<PlatformKey[]>(["douyin", "xiaohongshu"]);
  const [reportData, setReportData] = useState<VisualReportData | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const generateMutation = trpc.mvAnalysis.generateVisualReport.useMutation({
    onSuccess: (result: { success: boolean; report: { reportTitle: string; insightSummary: string[]; platformDetails: Array<{ platform: string; trafficBoosters: string[]; cashRewards: string[]; hotTopics: string[] }> } }) => {
      if (!result.report) {
        toast.error("报表生成失败，请重试");
        return;
      }
      const today = new Date();
      const end = today.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - Number(windowDays));
      const start = startDate.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });

      setReportData({
        reportTitle: result.report.reportTitle || `平台趋势看板 · 近${windowDays}天`,
        dateRange: `${start} – ${end}`,
        theme,
        insightSummary: result.report.insightSummary || [],
        platformDetails: (result.report.platformDetails || []).map((p) => ({
          platform: p.platform,
          displayName: PLATFORM_NAMES[p.platform as PlatformKey] || p.platform,
          trafficBoosters: p.trafficBoosters || [],
          cashRewards: p.cashRewards || [],
          hotTopics: p.hotTopics || [],
        })),
      });
    },
    onError: (error: { message?: string }) => {
      toast.error(error.message || "报表生成失败");
    },
  });

  const togglePlatform = (key: PlatformKey) => {
    setPlatforms((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    );
  };

  const handleGenerate = () => {
    if (platforms.length === 0) {
      toast.error("请至少选择一个平台");
      return;
    }
    generateMutation.mutate({ windowDays, theme, platforms });
  };

  const handleDownload = async () => {
    if (!reportRef.current) return;
    setIsDownloading(true);
    try {
      const dataUrl = await toPng(reportRef.current, {
        pixelRatio: 2,
        backgroundColor: theme === "dark" ? "#080618" : "#fff5f0",
      });
      const link = document.createElement("a");
      link.download = `mvstudiopro-trend-report-${windowDays}d-${theme}.png`;
      link.href = dataUrl;
      link.click();
      toast.success("图片已下载！");
    } catch (err) {
      toast.error("下载失败，请重试");
    } finally {
      setIsDownloading(false);
    }
  };

  const isLoading = generateMutation.isPending;
  const CREDITS = 5;

  return (
    <div className="rounded-[28px] border border-white/10 bg-[rgba(14,9,32,0.88)] shadow-[0_18px_80px_rgba(0,0,0,0.28)] backdrop-blur p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(73,230,255,0.2),rgba(125,103,255,0.2))] border border-[#49e6ff]/20">
          <BarChart2 className="h-5 w-5 text-[#49e6ff]" />
        </div>
        <div>
          <div className="font-bold text-white">趋势报表生成器</div>
          <div className="text-xs text-[#9080b8]">生成精美图文报表 · 一键下载 PNG</div>
        </div>
        {!supervisorAccess && (
          <div className="ml-auto rounded-full border border-[#ffdd44]/20 bg-[rgba(255,221,68,0.08)] px-3 py-1 text-xs text-[#ffdd44]">
            扣除 {CREDITS} 积分
          </div>
        )}
        {supervisorAccess && (
          <div className="ml-auto rounded-full border border-[#6fffb0]/20 bg-[rgba(111,255,176,0.08)] px-3 py-1 text-xs text-[#6fffb0]">
            Supervisor · 免积分
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        {/* Window */}
        <div className="rounded-2xl border border-[#2a1c55] bg-[rgba(11,7,26,0.94)] p-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[#9ddcff] mb-3">时间窗口</div>
          <div className="flex gap-2">
            {(["15", "30"] as WindowDays[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setWindowDays(d)}
                className={`flex-1 rounded-xl border py-2 text-sm font-semibold transition ${
                  windowDays === d
                    ? "border-[#49e6ff]/40 bg-[rgba(73,230,255,0.12)] text-[#8cefff]"
                    : "border-white/10 bg-white/5 text-[#b7add8] hover:bg-white/10"
                }`}
              >
                {d}天
              </button>
            ))}
          </div>
        </div>

        {/* Theme */}
        <div className="rounded-2xl border border-[#2a1c55] bg-[rgba(11,7,26,0.94)] p-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[#9ddcff] mb-3">报表主题</div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTheme("dark")}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl border py-2 text-sm font-semibold transition ${
                theme === "dark"
                  ? "border-[#49e6ff]/40 bg-[rgba(73,230,255,0.12)] text-[#8cefff]"
                  : "border-white/10 bg-white/5 text-[#b7add8] hover:bg-white/10"
              }`}
            >
              <Moon className="h-3.5 w-3.5" /> 深色
            </button>
            <button
              type="button"
              onClick={() => setTheme("light")}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl border py-2 text-sm font-semibold transition ${
                theme === "light"
                  ? "border-[#ffdd44]/40 bg-[rgba(255,221,68,0.10)] text-[#ffdd44]"
                  : "border-white/10 bg-white/5 text-[#b7add8] hover:bg-white/10"
              }`}
            >
              <Sun className="h-3.5 w-3.5" /> 浅色
            </button>
          </div>
        </div>

        {/* Platforms */}
        <div className="rounded-2xl border border-[#2a1c55] bg-[rgba(11,7,26,0.94)] p-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[#9ddcff] mb-3">选择平台（多选）</div>
          <div className="grid grid-cols-2 gap-2">
            {PLATFORM_OPTIONS.map((opt) => {
              const active = platforms.includes(opt.key);
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => togglePlatform(opt.key)}
                  className={`flex items-center gap-1.5 rounded-xl border px-2 py-1.5 text-xs font-semibold transition ${
                    active
                      ? "border-[#c060ff]/40 bg-[rgba(192,96,255,0.12)] text-[#d88cff]"
                      : "border-white/10 bg-white/5 text-[#b7add8] hover:bg-white/10"
                  }`}
                >
                  <span>{opt.icon}</span>
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Generate Button */}
      <div className="flex gap-3 mb-6">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isLoading || platforms.length === 0}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-[#49e6ff]/25 bg-[linear-gradient(135deg,#15c8ff,#6a5cff,#b25cff)] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_40px_rgba(73,230,255,0.18)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              正在为您比对各平台最新流量扶持活动...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              生成精美图文报表{!supervisorAccess ? ` (扣除 ${CREDITS} 积分)` : ""}
            </>
          )}
        </button>

        {reportData && (
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={isDownloading}
            className="inline-flex items-center gap-2 rounded-full border border-[#6fffb0]/25 bg-[rgba(111,255,176,0.10)] px-5 py-3 text-sm font-semibold text-[#6fffb0] transition hover:bg-[rgba(111,255,176,0.18)] disabled:opacity-60"
          >
            {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            下载长图
          </button>
        )}
      </div>

      {/* Report Preview (hidden visually but captured by html-to-image) */}
      {reportData && (
        <div>
          <div className="mb-3 text-xs text-[#9080b8]">报表预览（点击「下载长图」保存 PNG）</div>
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <VisualReportTemplate data={reportData} ref={reportRef} />
          </div>
        </div>
      )}
    </div>
  );
}
