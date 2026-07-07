import { useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  formatPlatformList,
  formatShanghaiDateTime,
  formatTruthSource,
  getPlatformDescription,
  getPlatformLabel,
  GROWTH_BURST_PLATFORMS,
  type GrowthBurstPlatform,
} from "@/lib/growthSystemDebugHelpers";

export type GrowthSystemDebugPanelProps = {
  enabled: boolean;
  /** Debug 开启或分析进行中时轮询 */
  pollActive?: boolean;
  growthSnapshotDebug?: Record<string, unknown> | null;
  growthSnapshotNotes?: string[];
  className?: string;
};

export function GrowthSystemDebugPanel({
  enabled,
  pollActive = false,
  growthSnapshotDebug,
  growthSnapshotNotes,
  className = "",
}: GrowthSystemDebugPanelProps) {
  const growthSystemStatusQuery = trpc.mvAnalysis.getGrowthSystemStatus.useQuery(undefined, {
    enabled,
    staleTime: 30_000,
    refetchInterval: enabled && pollActive ? 10_000 : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  const setGrowthRuntimeModeMutation = trpc.mvAnalysis.setGrowthRuntimeMode.useMutation({
    onSuccess: async () => {
      await growthSystemStatusQuery.refetch();
      toast.success("运行模式已切换");
    },
    onError: (error) => {
      toast.error(error.message || "运行模式切换失败");
    },
  });

  const setGrowthBurstControlMutation = trpc.mvAnalysis.setGrowthBurstControl.useMutation({
    onSuccess: async () => {
      await growthSystemStatusQuery.refetch();
      toast.success("burst 模式已切换");
    },
    onError: (error) => {
      toast.error(error.message || "burst 模式切换失败");
    },
  });

  const data = growthSystemStatusQuery.data;
  const growthAnomalies = data?.anomalies || [];
  const growthHealthState = growthAnomalies.length ? "异常" : "正常";
  const hasCriticalGrowthAnomaly = growthAnomalies.some((item) => item?.level === "critical");

  const trySetBurstControl = useCallback(
    (payload: { burst: "auto" | "manual" | "off"; platforms: GrowthBurstPlatform[] }) => {
      if (payload.burst !== "off" && hasCriticalGrowthAnomaly) {
        toast.error("当前系统状态异常，不建议执行 burst。请先恢复健康度。");
        return;
      }
      setGrowthBurstControlMutation.mutate(payload);
    },
    [hasCriticalGrowthAnomaly, setGrowthBurstControlMutation],
  );

  if (!enabled) return null;

  return (
    <div className={`rounded-[24px] border border-fuchsia-300/20 bg-fuchsia-400/5 p-5 ${className}`}>
      <div className="text-sm font-semibold text-fuchsia-100">Growth 系统 Debug（live / 回填 / 各平台累计）</div>

      <div
        className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-semibold ${
          growthAnomalies.length
            ? "border-red-300/40 bg-red-500/15 text-red-100"
            : "border-emerald-300/30 bg-emerald-500/15 text-emerald-100"
        }`}
      >
        系统状态：{growthHealthState}
      </div>

      {growthAnomalies.length ? (
        <div className="mt-3 space-y-2 rounded-2xl border border-red-300/20 bg-red-500/10 p-4 text-sm text-red-50">
          {growthAnomalies.map((item, index) => (
            <div key={`growth-anomaly-${index}`} className="leading-6">
              <span className="font-semibold">{String(item.title || "异常")}</span>
              <span>：{String(item.message || "-")}</span>
            </div>
          ))}
        </div>
      ) : null}

      {growthSystemStatusQuery.isLoading && !data ? (
        <div className="mt-4 text-xs text-white/45">正在拉取 Growth 系统状态…</div>
      ) : null}

      {data ? (
        <>
          <div className="mt-3 grid gap-2 text-sm text-white/75 md:grid-cols-2">
            <div>真值口径：{formatTruthSource(data.truthStore?.source)}</div>
            <div>真值更新时间：{formatShanghaiDateTime(String(data.truthStore?.updatedAt || ""))}</div>
            <div>真值当前总量：{String(data.truthStore?.currentItems ?? "-")}</div>
            <div>真值历史总量：{String(data.truthStore?.archivedItems ?? "-")}</div>
            <div className={data.storage?.lowSpace ? "font-semibold text-red-300 animate-pulse" : ""}>
              剩余空间：{data.storage ? `${String(data.storage.freeMb)} MB` : "-"}
            </div>
            <div>
              已用空间：
              {data.storage ? `${String(data.storage.usedMb)} / ${String(data.storage.totalMb)} MB` : "-"}
            </div>
            <div>服务健康度：{String(data.serviceHealth?.label || (growthAnomalies.length ? "critical" : "passing"))}</div>
            <div>健康检查时间：{formatShanghaiDateTime(String(data.serviceHealth?.checkedAt || ""))}</div>
            <div>运行模式：{String(data.runtimeControl?.mode || "auto")}</div>
            <div>模式更新时间：{formatShanghaiDateTime(String(data.runtimeControl?.updatedAt || ""))}</div>
          </div>

          <div className="mt-4 rounded-2xl border border-fuchsia-200/15 bg-black/15 p-4 text-xs text-white/75">
            <div className="font-semibold text-fuchsia-100">运行控制</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  { mode: "auto", label: "自动" },
                  { mode: "live", label: "只跑 live" },
                  { mode: "backfill", label: "只跑回填" },
                ] as const
              ).map((item) => {
                const active = data.runtimeControl?.mode === item.mode;
                return (
                  <button
                    key={item.mode}
                    type="button"
                    onClick={() => setGrowthRuntimeModeMutation.mutate({ mode: item.mode })}
                    disabled={setGrowthRuntimeModeMutation.isPending}
                    className={`rounded-full border px-3 py-1.5 transition ${
                      active
                        ? "border-fuchsia-300 bg-fuchsia-400/20 text-fuchsia-100"
                        : "border-white/15 bg-white/5 text-white/75 hover:border-fuchsia-200/30 hover:text-white"
                    } ${setGrowthRuntimeModeMutation.isPending ? "opacity-60" : ""}`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 font-semibold text-fuchsia-100">Burst 控制</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  { burst: "auto", label: "自动" },
                  { burst: "off", label: "全部关闭" },
                  { burst: "manual", label: "手动平台" },
                ] as const
              ).map((item) => {
                const active = data.runtimeControl?.burst === item.burst;
                return (
                  <button
                    key={item.burst}
                    type="button"
                    onClick={() =>
                      trySetBurstControl({
                        burst: item.burst,
                        platforms:
                          item.burst === "manual"
                            ? ((data.runtimeControl?.burstPlatforms as GrowthBurstPlatform[] | undefined) || [])
                            : [],
                      })
                    }
                    disabled={setGrowthBurstControlMutation.isPending}
                    className={`rounded-full border px-3 py-1.5 transition ${
                      active
                        ? "border-fuchsia-300 bg-fuchsia-400/20 text-fuchsia-100"
                        : "border-white/15 bg-white/5 text-white/75 hover:border-fuchsia-200/30 hover:text-white"
                    } ${setGrowthBurstControlMutation.isPending ? "opacity-60" : ""}`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {GROWTH_BURST_PLATFORMS.map((platform) => {
                const selected = ((data.runtimeControl?.burstPlatforms as string[] | undefined) || []).includes(platform);
                const manual = data.runtimeControl?.burst === "manual";
                return (
                  <button
                    key={platform}
                    type="button"
                    onClick={() => {
                      const current = new Set((data.runtimeControl?.burstPlatforms as string[] | undefined) || []);
                      if (current.has(platform)) current.delete(platform);
                      else current.add(platform);
                      trySetBurstControl({
                        burst: "manual",
                        platforms: Array.from(current) as GrowthBurstPlatform[],
                      });
                    }}
                    disabled={setGrowthBurstControlMutation.isPending}
                    className={`rounded-full border px-3 py-1.5 transition ${
                      manual && selected
                        ? "border-amber-300 bg-amber-400/20 text-amber-100"
                        : "border-white/15 bg-white/5 text-white/75 hover:border-amber-200/30 hover:text-white"
                    } ${setGrowthBurstControlMutation.isPending ? "opacity-60" : ""}`}
                  >
                    {getPlatformLabel(platform)}
                  </button>
                );
              })}
            </div>

            {hasCriticalGrowthAnomaly ? (
              <div className="mt-3 text-xs font-semibold text-red-200">当前系统状态异常，不建议开启 burst。</div>
            ) : null}
          </div>

          {data.truthStore?.platforms?.length ? (
            <div className="mt-4 space-y-2 rounded-2xl border border-sky-200/15 bg-black/15 p-4 text-xs text-white/72">
              <div className="font-semibold text-sky-100">各平台真值拆分（同口径库存）</div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-white/45">
                      <th className="py-1.5 pr-3">平台</th>
                      <th className="py-1.5 pr-3">仓库总量</th>
                      <th className="py-1.5 pr-3">15天窗口</th>
                      <th className="py-1.5 pr-3">30天窗口</th>
                      <th className="py-1.5 pr-3">历史归档</th>
                      <th className="py-1.5">最近 Pipeline</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.truthStore.platforms.map((item) => {
                      const pipeline = (item as { lastPipeline?: Record<string, unknown> }).lastPipeline;
                      return (
                        <tr key={String(item.platform)} className="border-b border-white/5">
                          <td className="py-2 pr-3 font-medium text-white/85">
                            {String(item.platformLabel || getPlatformLabel(item.platform))}
                          </td>
                          <td className="py-2 pr-3">{String((item as { warehouseTotal?: number }).warehouseTotal ?? item.currentItems ?? 0)}</td>
                          <td className="py-2 pr-3">{String((item as { windowItems15d?: number }).windowItems15d ?? "-")}</td>
                          <td className="py-2 pr-3">{String((item as { windowItems30d?: number }).windowItems30d ?? "-")}</td>
                          <td className="py-2 pr-3">{String(item.archivedItems || 0)}</td>
                          <td className="py-2 font-mono text-[10px] leading-5 text-white/60">
                            {pipeline
                              ? `raw=${String(pipeline.rawFetched ?? "-")} dedup=${String(pipeline.afterDedup ?? "-")} win=${String(pipeline.afterWindowFilter ?? "-")} add=${String(pipeline.mergedAdded ?? "-")}`
                              : "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="space-y-2 pt-2">
                {data.truthStore.platforms.map((item) => (
                  <div key={`desc-${String(item.platform)}`} className="text-[10px] leading-5 text-white/45">
                    {String(item.platformLabel || getPlatformLabel(item.platform))}：
                    {String(item.platformDescription || getPlatformDescription(item.platform))}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {growthSnapshotDebug ? (
            <div className="mt-4 space-y-2 rounded-2xl border border-emerald-200/15 bg-black/15 p-4 text-xs text-white/72">
              <div className="font-semibold text-emerald-100">Growth Snapshot Debug</div>
              <div className="grid gap-1 md:grid-cols-2">
                <div>快照路由：{String(growthSnapshotDebug.route || "-")}</div>
                <div>基础来源：{String(growthSnapshotDebug.baseSource || "-")}</div>
                <div>最终来源：{String(growthSnapshotDebug.finalSource || "-")}</div>
                <div>分析窗口天数：{String(growthSnapshotDebug.windowDays || "-")}</div>
                <div>是否有实时样本：{String(growthSnapshotDebug.hasAnyLiveCollection ?? "-")}</div>
                <div>是否应用个性化：{String(growthSnapshotDebug.personalizedApplied ?? "-")}</div>
                <div>请求平台：{formatPlatformList(growthSnapshotDebug.requestedPlatforms)}</div>
                <div>过期平台：{formatPlatformList(growthSnapshotDebug.stalePlatforms)}</div>
                <div>平台快照数：{String(growthSnapshotDebug.platformSnapshotCount || 0)}</div>
              </div>
              {growthSnapshotDebug.platformInventory &&
              typeof growthSnapshotDebug.platformInventory === "object" ? (
                <div className="mt-2 overflow-x-auto rounded-xl border border-emerald-200/15 bg-emerald-400/5 p-3">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-100">
                    四平台同口径库存（仓库总量 / 窗口过滤）
                  </div>
                  <table className="w-full min-w-[520px] border-collapse text-left text-[11px]">
                    <thead>
                      <tr className="border-b border-white/10 text-white/45">
                        <th className="py-1 pr-2">平台</th>
                        <th className="py-1 pr-2">仓库</th>
                        <th className="py-1 pr-2">15d</th>
                        <th className="py-1">选中窗口</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(growthSnapshotDebug.platformInventory as Record<string, Record<string, unknown>>).map(
                        ([platform, row]) => (
                          <tr key={platform} className="border-b border-white/5">
                            <td className="py-1 pr-2">{getPlatformLabel(platform)}</td>
                            <td className="py-1 pr-2">{String(row.warehouseTotal ?? "-")}</td>
                            <td className="py-1 pr-2">{String(row.window15d ?? "-")}</td>
                            <td className="py-1">
                              {String(row.selectedWindowFiltered ?? "-")} / {String(row.selectedWindowDays ?? "-")}d
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {growthSnapshotNotes?.length ? (
                <div className="space-y-1 rounded-xl border border-emerald-200/15 bg-emerald-400/5 p-3 leading-6">
                  {growthSnapshotNotes.slice(0, 8).map((note, index) => (
                    <div key={`snapshot-note-${index}`}>{String(note)}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {data.scheduler?.length && data.runtimeControl?.mode !== "backfill" ? (
            <div className="mt-4 space-y-2 rounded-2xl border border-cyan-200/15 bg-black/15 p-4 text-xs text-white/72">
              <div className="font-semibold text-cyan-100">抓取调度状态</div>
              <div className="rounded-xl border border-cyan-200/15 bg-cyan-400/5 p-3 leading-6">
                <div>全部平台 live：统一每 30 分钟抓取一次</div>
                <div>burst 控制：{String(data.runtimeControl?.burst || "auto")}</div>
                <div>
                  burst 平台：
                  {((data.runtimeControl?.burstPlatforms as string[] | undefined) || [])
                    .map((item) => getPlatformLabel(item))
                    .join("、") || "-"}
                </div>
                <div>历史回填：仍按独立 backfill 节奏执行，不跟 live 共用频率</div>
              </div>
              {data.scheduler.map((item) => (
                <div key={String(item.platform)} className="grid gap-1 md:grid-cols-2">
                  <div>
                    {String(item.platformLabel || getPlatformLabel(item.platform))} 最近成功：
                    {formatShanghaiDateTime(String(item.lastSuccessAt || ""))}
                  </div>
                  <div>
                    {String(item.platformLabel || getPlatformLabel(item.platform))} 下次执行：
                    {formatShanghaiDateTime(String(item.nextRunAt || ""))}
                  </div>
                  <div>
                    {String(item.platformLabel || getPlatformLabel(item.platform))} 失败次数：
                    {String(item.failureCount ?? 0)}
                  </div>
                  <div>
                    {String(item.platformLabel || getPlatformLabel(item.platform))} 爆发模式：
                    {String(item.burstMode ?? false)}
                  </div>
                  <div>
                    {String(item.platformLabel || getPlatformLabel(item.platform))} 最近抓取量（仓库）：
                    {String(item.lastCollectedCount ?? 0)}
                  </div>
                  <div>
                    {String(item.platformLabel || getPlatformLabel(item.platform))} Pipeline：
                    raw={String((item as { lastRawFetchedCount?: number }).lastRawFetchedCount ?? "-")} dedup=
                    {String((item as { lastAfterDedupCount?: number }).lastAfterDedupCount ?? "-")} win=
                    {String((item as { lastAfterWindowFilterCount?: number }).lastAfterWindowFilterCount ?? "-")} add=
                    {String((item as { lastAddedCount?: number }).lastAddedCount ?? 0)}
                  </div>
                  <div>
                    {String(item.platformLabel || getPlatformLabel(item.platform))} 爆发开始：
                    {formatShanghaiDateTime(String(item.burstTriggeredAt || ""))}
                  </div>
                  <div className="md:col-span-2">
                    {String(item.platformLabel || getPlatformLabel(item.platform))} 错误：
                    {String(item.lastError || "-")}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {(
            [
              { key: "live", title: "近期回填进度", data: data.backfillLive },
              { key: "history", title: "历史回填进度", data: data.backfillHistory },
            ] as const
          ).map((section) =>
            section.data ? (
              <div
                key={section.key}
                className="mt-4 space-y-2 rounded-2xl border border-amber-200/15 bg-black/15 p-4 text-xs text-white/72"
              >
                <div className="font-semibold text-amber-100">{section.title}</div>
                <div className="grid gap-1 md:grid-cols-2">
                  <div>status: {String(section.data.status || "-")}</div>
                  <div>active: {String(section.data.active ?? false)}</div>
                  <div>window days: {String(section.data.selectedWindowDays || "-")}</div>
                  <div>
                    回填模式：
                    {section.key === "history" ? "夜间 burst / 每 15 分钟" : "夜间 live 回填 / 每 15 分钟"}
                  </div>
                  <div>开始时间：{formatShanghaiDateTime(String(section.data.startedAt || ""))}</div>
                  <div>下一次回填：{formatShanghaiDateTime(String(section.data.nextRunAt || ""))}</div>
                  <div>更新时间：{formatShanghaiDateTime(String(section.data.updatedAt || ""))}</div>
                  <div>结束时间：{formatShanghaiDateTime(String(section.data.finishedAt || ""))}</div>
                </div>
                <div className="rounded-xl border border-amber-200/15 bg-amber-400/5 p-3 leading-6">
                  {String(section.data.note || "-")}
                </div>
                <div className="space-y-2">
                  {section.data.platforms?.map((item) => (
                    <div key={`${section.key}-${String(item.platform)}`} className="grid gap-1 md:grid-cols-2">
                      <div>
                        {String(item.platformLabel || getPlatformLabel(item.platform))} 状态：
                        {String(item.status || "-")}
                      </div>
                      <div>
                        {String(item.platformLabel || getPlatformLabel(item.platform))} 历史量：
                        {String(item.archivedTotal || 0)} / {String(item.target || 0)}
                      </div>
                      <div>
                        {String(item.platformLabel || getPlatformLabel(item.platform))} 当前量：
                        {String(item.currentTotal || 0)}
                      </div>
                      <div>
                        {String(item.platformLabel || getPlatformLabel(item.platform))} 添加：
                        {String(item.addedCount || 0)}
                      </div>
                      <div>
                        {String(item.platformLabel || getPlatformLabel(item.platform))} 合并：
                        {String(item.mergedCount || 0)}
                      </div>
                      <div>
                        {String(item.platformLabel || getPlatformLabel(item.platform))} 平台停滞轮数：
                        {String(item.plateauCount || 0)}
                      </div>
                      <div className="md:col-span-2">
                        {String(item.platformLabel || getPlatformLabel(item.platform))} 错误：
                        {String(item.error || "-")}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </>
      ) : null}
    </div>
  );
}
