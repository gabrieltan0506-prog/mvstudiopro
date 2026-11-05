import { Loader2, Sparkles } from "lucide-react";
import { getPlatformTrendReportCredits } from "@shared/platformTrendPricing";
import type { PlatformWindowDays } from "@shared/decisionIntelligencePlatformHint";
import type { VisualReportPlatformKey } from "@/lib/visualReportMapper";

const PLATFORMS: { value: VisualReportPlatformKey; label: string }[] = [
  { value: "xiaohongshu", label: "小红书" },
  { value: "bilibili", label: "B站" },
  { value: "douyin", label: "抖音" },
  { value: "weixin_channels", label: "视频号" },
  { value: "tiktok", label: "TikTok" },
  { value: "kuaishou", label: "快手" },
];

/** 趋势入口仅接收平台与时间范围，资料匹配由服务端完成。 */
export function TrendReportControls(props: {
  id?: string;
  platform: VisualReportPlatformKey;
  windowDays: PlatformWindowDays;
  busy: boolean;
  hasReport: boolean;
  onPlatformChange: (platform: VisualReportPlatformKey) => void;
  onWindowDaysChange: (days: 3 | 7 | 15) => void;
  onGenerate: () => void;
}) {
  const inputClass = "mt-2 block min-w-36 rounded-xl border border-white/15 bg-[#100c24] px-4 py-3 text-sm font-semibold text-white outline-none focus:border-cyan-300 disabled:opacity-50";
  return (
    <div id={props.id} className="mt-5 flex scroll-mt-24 flex-wrap items-end gap-4">
      <label className="text-xs text-[#c9c0e6]">平台
        <select aria-label="趋势报告平台" className={inputClass} value={props.platform} disabled={props.busy}
          onChange={event => props.onPlatformChange(event.target.value as VisualReportPlatformKey)}>
          {PLATFORMS.map(platform => <option key={platform.value} value={platform.value}>{platform.label}</option>)}
        </select>
      </label>
      <label className="text-xs text-[#c9c0e6]">天数
        <select aria-label="趋势报告天数" className={inputClass} value={props.windowDays} disabled={props.busy}
          onChange={event => props.onWindowDaysChange(Number(event.target.value) as 3 | 7 | 15)}>
          {[3, 7, 15].map(days => <option key={days} value={days}>近 {days} 天</option>)}
        </select>
      </label>
      <button type="button" onClick={props.onGenerate} disabled={props.busy}
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#15c8ff,#6a5cff,#b25cff)] px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_28px_rgba(73,230,255,0.16)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
        {props.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {props.busy ? "生成中…" : `${props.hasReport ? "重新生成" : "生成"}近${props.windowDays}天报告 · ${getPlatformTrendReportCredits(props.windowDays)}积分`}
      </button>
    </div>
  );
}
