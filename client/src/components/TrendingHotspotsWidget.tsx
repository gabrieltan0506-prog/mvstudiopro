/**
 * 实时趋势 · 一键深潜 Widget（v4）
 *
 * v3 → v4 重构：
 *   ⚠️ 不再展示 likes 绝对值（两年前老作品点赞天然多，会误导）
 *   ✅ 改展示 growthPercentile（+N%↑）+ 行业大类徽章 + ageDays（N 天前）
 *   ✅ 同账号突然爆发标记 🚀（个人创作者从沉睡到爆发）
 *   ✅ 评论 / 转发 数据保留（"讨论度 + 传播度" 才是真信号）
 *
 *   排序：调用 trpc.agent.listTrendHotspots，后端已用 selectByGrowthPotential
 *         过滤了 18 天外作品 + 企业号
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Flame, Sparkles, Target, ExternalLink, RefreshCw, TrendingUp, Rocket } from "lucide-react";
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

/** 增长率徽章颜色：+200% → 红炽热 / +100% → 橙 / +60% → 金 / 其他 → 绿 */
function growthBadgeColor(pct: number): string {
  if (pct >= 180) return "bg-[#ef4444]/20 text-[#fca5a5] border-[#ef4444]/45";
  if (pct >= 120) return "bg-[#f97316]/20 text-[#fdba74] border-[#f97316]/45";
  if (pct >= 70) return "bg-[#eab308]/20 text-[#fde047] border-[#eab308]/45";
  return "bg-[#10b981]/20 text-[#6ee7b7] border-[#10b981]/40";
}

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
      // 兼容旧字段：把 growthPercentile 映射到 hotValue 给下游
      hotValue: item.growthPercentile,
      views: item.views,
      likes: undefined,
      tags: item.tags,
      industryLabels: [item.category],
    };
    saveAgentHandoff(handoff);
    setLocation(ROUTE_BY_TARGET[target]);
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#1a1230]/80 to-[#0d0820]/80 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-base font-semibold text-white">
            <TrendingUp className="h-4 w-4 text-[#10b981]" />
            实时趋势 · 18 天高增长爆款
          </div>
          <p className="mt-1 text-xs text-white/55">
            严格 18 天窗口 · 排除企业号投流 · 同账号突然爆发优先 · 强制行业归类
            <span className="ml-1 text-[#10b981]/80">— 不看点赞绝对值，看增长潜力</span>
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

      {/* 平台覆盖徽章 + 过滤摘要 */}
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
          {data?.meta ? <span className="text-[10px] text-white/40">{data.meta}</span> : null}
        </div>
      ) : null}

      {/* 列表 */}
      <div className="mt-4">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-white/50">加载实时趋势中…</div>
        ) : entries.length === 0 ? (
          <div className="py-8 text-center text-sm text-white/50">
            18 天窗口内暂无可用爆款。<br />
            <span className="text-xs text-white/35">trendStore 还在采集，或当前样本均为窗外 / 企业号；下一轮采集后再来。</span>
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
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${PLATFORM_BADGE[item.platform] || "bg-white/10 text-white/70 border-white/20"}`}>
                        {item.platformLabel}
                      </span>

                      {/* ✨ 增长率徽章（替换原 hotValue） */}
                      <span className={`inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[10px] font-bold ${growthBadgeColor(item.growthPercentile)}`}>
                        <TrendingUp className="h-2.5 w-2.5" />
                        +{item.growthPercentile}%
                      </span>

                      {/* 同账号突然爆发徽章 */}
                      {item.isBreakout ? (
                        <span className="inline-flex items-center gap-0.5 rounded-full border border-[#fb7185]/45 bg-[#fb7185]/15 px-2 py-0.5 text-[10px] font-bold text-[#fda4af]">
                          <Rocket className="h-2.5 w-2.5" />
                          该账号突然爆发
                        </span>
                      ) : null}

                      {/* 行业大类徽章（强制非空，不再有"待判定"） */}
                      <span className="rounded-full border border-[#a855f7]/40 bg-[#a855f7]/15 px-2 py-0.5 text-[10px] font-medium text-[#d8b4fe]">
                        {item.category}
                      </span>

                      {/* 距今天数 */}
                      {item.ageDays !== null ? (
                        <span className="text-[10px] text-white/45">{item.ageDays} 天前</span>
                      ) : null}

                      {/* 评论 / 转发（讨论度 + 传播度） */}
                      {item.comments ? (
                        <span className="text-[10px] text-white/55">评论 {item.comments.toLocaleString()}</span>
                      ) : null}
                      {item.shares ? (
                        <span className="text-[10px] text-white/55">转发 {item.shares.toLocaleString()}</span>
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
                    {item.tags.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {item.tags.slice(0, 4).map((t) => (
                          <span key={t} className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/60">
                            #{t}
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
