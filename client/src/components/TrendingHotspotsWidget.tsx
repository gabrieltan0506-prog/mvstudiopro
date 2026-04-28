/**
 * 实时趋势 · 一键深潜 Widget
 *
 * 调用 trpc.agent.listTrendHotspots 拿 4 大平台 top N 爆款，
 * 每条配两个按钮：「→ IP 矩阵」「→ 竞品雷达」，
 * 点击后通过 sessionStorage 把这条数据塞进去，跳到目标场景页。
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Flame, Sparkles, Target, ExternalLink, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { saveAgentHandoff, type AgentHandoffTarget, type AgentTrendHandoff } from "@/lib/agentHandoff";

const PLATFORM_BADGE: Record<string, string> = {
  douyin: "bg-[#FF1744]/20 text-[#ff8aa3] border-[#ff1744]/40",
  xiaohongshu: "bg-[#ff2442]/20 text-[#ff9faa] border-[#ff2442]/40",
  bilibili: "bg-[#00a1d6]/20 text-[#7fdfff] border-[#00a1d6]/40",
  kuaishou: "bg-[#ff7700]/20 text-[#ffc77f] border-[#ff7700]/40",
  weixin_channels: "bg-[#07c160]/20 text-[#7fe8af] border-[#07c160]/40",
  toutiao: "bg-[#f04142]/20 text-[#ff9091] border-[#f04142]/40",
};

const ROUTE_BY_TARGET: Record<AgentHandoffTarget, string> = {
  platform_ip_matrix: "/agent/platform-ip-matrix",
  competitor_radar: "/agent/competitor-radar",
};

export function TrendingHotspotsWidget() {
  const [, setLocation] = useLocation();
  const [topN, setTopN] = useState(5);
  const { data, isLoading, refetch, isFetching } = trpc.agent.listTrendHotspots.useQuery(
    { topN },
    { staleTime: 5 * 60 * 1000 },
  );

  const entries = data?.entries ?? [];
  const platforms = data?.coveredPlatforms ?? [];

  function handleDispatch(item: (typeof entries)[number], target: AgentHandoffTarget) {
    const handoff: AgentTrendHandoff = {
      source: "trend_hotspot",
      target,
      savedAt: new Date().toISOString(),
      platform: item.platform,
      platformLabel: item.platformLabel,
      title: item.title,
      url: item.url,
      hotValue: item.hotValue,
      views: item.views,
      likes: item.likes,
      tags: item.tags,
      industryLabels: item.industryLabels,
    };
    saveAgentHandoff(handoff);
    setLocation(ROUTE_BY_TARGET[target]);
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#1a1230]/80 to-[#0d0820]/80 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-base font-semibold text-white">
            <Flame className="h-4 w-4 text-[#ff8a4c]" />
            实时趋势 · 一键深潜
          </div>
          <p className="mt-1 text-xs text-white/55">
            来自 4 大平台的实时爆款（trendStore），每条都能直接派发给 Deep Research Max 做差异化对比 / 跨界脚本
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value))}
            className="rounded-lg border border-white/15 bg-black/30 px-2.5 py-1.5 text-xs text-white/80 outline-none"
          >
            <option value={3}>每平台 3 条</option>
            <option value={5}>每平台 5 条</option>
            <option value={8}>每平台 8 条</option>
          </select>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
            刷新
          </button>
        </div>
      </div>

      {/* 平台覆盖徽章 */}
      {platforms.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {platforms.map((p) => {
            const label = entries.find((e) => e.platform === p)?.platformLabel || p;
            return (
              <span
                key={p}
                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${PLATFORM_BADGE[p] || "bg-white/10 text-white/70 border-white/20"}`}
              >
                {label}
              </span>
            );
          })}
          <span className="text-[10px] text-white/40">{data?.meta}</span>
        </div>
      ) : null}

      {/* 列表 */}
      <div className="mt-4">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-white/50">加载实时趋势中…</div>
        ) : entries.length === 0 ? (
          <div className="py-8 text-center text-sm text-white/50">
            暂无可用数据。<br />
            <span className="text-xs text-white/35">trendStore 还未采集到 4 平台数据，等下一轮采集生效后再来。</span>
          </div>
        ) : (
          <div className="grid gap-2">
            {entries.map((item) => (
              <div
                key={`${item.platform}-${item.id}`}
                className="rounded-xl border border-white/10 bg-black/25 p-3 transition hover:border-white/25 hover:bg-black/35"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${PLATFORM_BADGE[item.platform] || "bg-white/10 text-white/70 border-white/20"}`}
                      >
                        {item.platformLabel}
                      </span>
                      {item.hotValue ? (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-[#ffaf6b]">
                          <Flame className="h-3 w-3" />
                          {item.hotValue.toLocaleString()}
                        </span>
                      ) : null}
                      {item.views ? (
                        <span className="text-[10px] text-white/50">播放 {item.views.toLocaleString()}</span>
                      ) : null}
                      {item.likes ? (
                        <span className="text-[10px] text-white/50">赞 {item.likes.toLocaleString()}</span>
                      ) : null}
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-0.5 text-[10px] text-[#9ddcff] hover:text-[#cdf0ff]"
                        >
                          <ExternalLink className="h-3 w-3" />
                          原帖
                        </a>
                      ) : null}
                    </div>
                    <div className="mt-2 line-clamp-2 text-sm leading-6 text-white/90">{item.title}</div>
                    {item.tags.length > 0 || item.industryLabels.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {item.tags.slice(0, 3).map((t) => (
                          <span key={t} className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/60">
                            #{t}
                          </span>
                        ))}
                        {item.industryLabels.slice(0, 2).map((t) => (
                          <span key={t} className="rounded border border-[#9ddcff]/30 bg-[#9ddcff]/10 px-1.5 py-0.5 text-[10px] text-[#9ddcff]">
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
                    <button
                      onClick={() => handleDispatch(item, "platform_ip_matrix")}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#ffd166]/40 bg-[#ffd166]/10 px-2.5 py-1.5 text-[11px] font-medium text-[#ffd166] transition hover:bg-[#ffd166]/20"
                      title="派发到「多平台 IP 矩阵」生成跨界爆款脚本"
                    >
                      <Sparkles className="h-3 w-3" />
                      IP 矩阵
                    </button>
                    <button
                      onClick={() => handleDispatch(item, "competitor_radar")}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#9ddcff]/40 bg-[#9ddcff]/10 px-2.5 py-1.5 text-[11px] font-medium text-[#9ddcff] transition hover:bg-[#9ddcff]/20"
                      title="派发到「竞品 / 赛道雷达」做高密度差异化对比"
                    >
                      <Target className="h-3 w-3" />
                      雷达对比
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
