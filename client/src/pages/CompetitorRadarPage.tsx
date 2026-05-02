import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, Plus, X, Radar, Flame } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import CommanderProfileDrawer from "@/components/CommanderProfileDrawer";
import { ShieldCheck } from "lucide-react";
import AgentInputPanel, { type UploadedAgentFile } from "@/components/AgentInputPanel";
import AgentJobMonitor from "@/components/AgentJobMonitor";
import { readAndClearAgentHandoff, formatHandoffAsPainPoint, type AgentTrendHandoff } from "@/lib/agentHandoff";
import { AGENT_SCENARIO_CREDITS, estimateCnyFromCredits } from "@/lib/agentPricing";

const PRESET_DIMENSIONS = ["数据", "创意", "商业模式", "用户画像", "内容工业化能力", "IP 衍生品深度", "合规风险"];

interface BenchmarkRow { platform: string; handle: string; notes?: string }

export default function CompetitorRadarPage() {
  const [, navigate] = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);
  const [benchmarks, setBenchmarks] = useState<BenchmarkRow[]>([
    { platform: "抖音", handle: "" },
    { platform: "小红书", handle: "" },
    { platform: "B 站", handle: "" },
  ]);
  const [dimensions, setDimensions] = useState<string[]>(["数据", "创意", "商业模式", "用户画像"]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [handoffPrefill, setHandoffPrefill] = useState<AgentTrendHandoff | null>(null);
  const [supplementaryPrefill, setSupplementaryPrefill] = useState<string>("");
  const [painPointFromHandoff, setPainPointFromHandoff] = useState<string | undefined>(undefined);

  useEffect(() => {
    const h = readAndClearAgentHandoff("competitor_radar");
    if (h) {
      setHandoffPrefill(h);
      setSupplementaryPrefill(formatHandoffAsPainPoint(h));
      setPainPointFromHandoff(`基于 ${h.platformLabel} 实时爆款「${h.title}」做高密度差异化对比，找出可降维打击的突破口`);
      const platformLabel = h.platformLabel === "B 站" ? "B 站" : h.platformLabel;
      setBenchmarks((prev) => {
        const head: BenchmarkRow = { platform: platformLabel, handle: h.title.slice(0, 80), notes: "实时爆款（trendStore 派发）" };
        return [head, ...prev.filter((b) => !(b.platform === platformLabel && !b.handle))];
      });
      toast.success(`已从 ${h.platformLabel} 实时爆款派发到雷达`);
    }
  }, []);

  const launchMutation = trpc.agent.launchCompetitorRadar.useMutation({
    onSuccess: (res) => {
      setActiveJobId(res.jobId);
      toast.success("雷达任务已派发，Agent 正在制定深潜计划…");
    },
    onError: (e) => toast.error("派发失败：" + e.message),
  });

  const listQuery = trpc.agent.listScenarioJobs.useQuery({ productType: "competitor_radar" }, {
    refetchInterval: activeJobId ? 30_000 : false,
  });

  const addBenchmark = () => setBenchmarks((a) => [...a, { platform: "", handle: "" }]);
  const removeBenchmark = (i: number) => setBenchmarks((a) => a.filter((_, j) => j !== i));
  const updateBenchmark = (i: number, patch: Partial<BenchmarkRow>) =>
    setBenchmarks((a) => a.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const toggleDimension = (d: string) => {
    setDimensions((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  };

  const handleSubmit = async ({ text, files }: { text: string; files: UploadedAgentFile[] }) => {
    const filled = benchmarks.filter((b) => b.platform.trim() && b.handle.trim());
    if (filled.length === 0 && !text.trim()) {
      toast.error("请至少填一个对标账号，或在补充资料中描述");
      return;
    }
    const cost = AGENT_SCENARIO_CREDITS.competitor_radar;
    const rmb = estimateCnyFromCredits(cost);
    if (!window.confirm(`派发「竞品 / 赛道雷达」将先扣除 ${cost} 点积分（约合 ${rmb} 元，以账户为准），确定继续？`)) {
      return;
    }
    await launchMutation.mutateAsync({
      benchmarks: filled.map((b) => ({ platform: b.platform.trim(), handle: b.handle.trim(), notes: b.notes?.trim() || undefined })),
      focusDimensions: dimensions,
      painPoint: painPointFromHandoff,
      supplementaryText: text.trim() || undefined,
      supplementaryFiles: files.length ? files : undefined,
    });
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0c0a08", color: "rgba(245,235,210,0.92)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px 80px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
          <button onClick={() => navigate("/god-view")} style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", background: "rgba(168,118,27,0.10)", border: "1px solid rgba(168,118,27,0.30)", borderRadius: 8, cursor: "pointer", color: "#d6a861", fontSize: 13, fontWeight: 700 }}>
            <ChevronLeft size={14} /> 返回
          </button>
          <button onClick={() => setProfileOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "rgba(168,118,27,0.15)", border: "1px solid rgba(168,118,27,0.40)", borderRadius: 8, cursor: "pointer", color: "#d6a861", fontSize: 12, fontWeight: 800 }}>
            <ShieldCheck size={12} /> 指挥官档案
          </button>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#d6a861", letterSpacing: "0.06em" }}>
              <Radar size={20} style={{ display: "inline", marginRight: 8, verticalAlign: "middle" }} />
              竞品 / 赛道雷达
            </h1>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "rgba(160,140,90,0.70)", lineHeight: 1.7 }}>
              对标账号长时间深潜分析 · 输出可作为「降维打击弹药」的高密度竞争分析报告
            </p>
          </div>
        </div>

        {!activeJobId && handoffPrefill && (
          <div style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 12, background: "linear-gradient(135deg, rgba(157,220,255,0.10), rgba(73,230,255,0.06))", border: "1px solid rgba(157,220,255,0.35)", display: "flex", alignItems: "center", gap: 10 }}>
            <Flame size={16} style={{ color: "#9ddcff", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#9ddcff" }}>已从 {handoffPrefill.platformLabel} 实时爆款派发到雷达</div>
              <div style={{ fontSize: 11, color: "rgba(245,235,210,0.65)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {handoffPrefill.title}
              </div>
            </div>
            <button onClick={() => { setHandoffPrefill(null); setSupplementaryPrefill(""); setPainPointFromHandoff(undefined); }} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 700, background: "rgba(168,118,27,0.10)", border: "1px solid rgba(168,118,27,0.30)", borderRadius: 6, color: "#d6a861", cursor: "pointer" }}>
              清空预填
            </button>
          </div>
        )}

        {!activeJobId && (
          <div style={{ background: "rgba(168,118,27,0.04)", border: "1px solid rgba(168,118,27,0.22)", borderRadius: 16, padding: "26px 28px" }}>
            {/* 对标账号 */}
            <div style={{ marginBottom: 22 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 800, color: "#d6a861", marginBottom: 8 }}>
                对标账号 <span style={{ fontWeight: 500, color: "rgba(160,140,90,0.65)", marginLeft: 8 }}>· 留空则由 Agent 自行筛选 5 个头部对手</span>
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {benchmarks.map((row, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      value={row.platform}
                      onChange={(e) => updateBenchmark(i, { platform: e.target.value })}
                      placeholder="平台"
                      style={{ width: 110, padding: "10px 12px", borderRadius: 8, background: "rgba(0,0,0,0.30)", border: "1px solid rgba(168,118,27,0.30)", color: "rgba(245,235,210,0.92)", fontSize: 13, outline: "none" }}
                    />
                    <input
                      value={row.handle}
                      onChange={(e) => updateBenchmark(i, { handle: e.target.value })}
                      placeholder="账号名 / @handle / 链接"
                      style={{ flex: 1, padding: "10px 12px", borderRadius: 8, background: "rgba(0,0,0,0.30)", border: "1px solid rgba(168,118,27,0.30)", color: "rgba(245,235,210,0.92)", fontSize: 13, outline: "none" }}
                    />
                    <input
                      value={row.notes ?? ""}
                      onChange={(e) => updateBenchmark(i, { notes: e.target.value })}
                      placeholder="备注（如：威胁等级、商业模式标签）"
                      style={{ width: 240, padding: "10px 12px", borderRadius: 8, background: "rgba(0,0,0,0.30)", border: "1px solid rgba(168,118,27,0.30)", color: "rgba(245,235,210,0.92)", fontSize: 13, outline: "none" }}
                    />
                    <button onClick={() => removeBenchmark(i)} style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(220,38,38,0.10)", border: "1px solid rgba(220,38,38,0.30)", borderRadius: 8, color: "#fca5a5", cursor: "pointer" }}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button onClick={addBenchmark} style={{ display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start", padding: "8px 14px", background: "rgba(168,118,27,0.08)", border: "1px dashed rgba(168,118,27,0.40)", borderRadius: 8, color: "#d6a861", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                  <Plus size={12} /> 添加对手
                </button>
              </div>
            </div>

            {/* 关注维度 */}
            <div style={{ marginBottom: 22 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 800, color: "#d6a861", marginBottom: 8 }}>
                关注维度
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {PRESET_DIMENSIONS.map((d) => (
                  <button
                    key={d}
                    onClick={() => toggleDimension(d)}
                    style={{
                      padding: "7px 14px",
                      borderRadius: 999,
                      background: dimensions.includes(d) ? "rgba(168,118,27,0.20)" : "rgba(168,118,27,0.04)",
                      border: dimensions.includes(d) ? "1px solid rgba(168,118,27,0.55)" : "1px solid rgba(168,118,27,0.20)",
                      color: dimensions.includes(d) ? "#d6a861" : "rgba(160,140,90,0.55)",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {dimensions.includes(d) ? "✓ " : ""}{d}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 800, color: "#d6a861", marginBottom: 8 }}>
                补充资料 <span style={{ fontWeight: 500, color: "rgba(160,140,90,0.65)", marginLeft: 8 }}>· 可上传对手截图 / 数据 PDF / 语音口述</span>
              </label>
              <AgentInputPanel
                placeholder="例：重点关注其商业化路径，最近他们刚上线了付费课程，想看转化模型..."
                submitLabel={`派发雷达任务（${AGENT_SCENARIO_CREDITS.competitor_radar} 点）`}
                submitting={launchMutation.isPending}
                onSubmit={handleSubmit}
                textRequired={false}
                hint={`异步深潜 · 先扣 ${AGENT_SCENARIO_CREDITS.competitor_radar} 点（≈¥${estimateCnyFromCredits(AGENT_SCENARIO_CREDITS.competitor_radar)}）· 失败自动退还 · 约 5-10 分钟出计划`}
                maxLen={4000}
                initialText={supplementaryPrefill}
              />
            </div>
          </div>
        )}

        {activeJobId && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#d6a861" }}>当前雷达任务</h2>
              <button onClick={() => setActiveJobId(null)} style={{ padding: "6px 12px", background: "rgba(168,118,27,0.08)", border: "1px solid rgba(168,118,27,0.30)", borderRadius: 8, color: "#d6a861", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                ← 派发新任务
              </button>
            </div>
            <AgentJobMonitor jobId={activeJobId} onCompleted={() => listQuery.refetch()} />
          </div>
        )}

        <div style={{ marginTop: 36 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: "#d6a861", marginBottom: 14 }}>历史雷达扫描</h2>
          {listQuery.data?.items.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {listQuery.data.items.map((j) => (
                <button
                  key={j.jobId}
                  onClick={() => setActiveJobId(j.jobId)}
                  style={{ textAlign: "left", padding: "14px 18px", background: "rgba(0,0,0,0.25)", border: "1px solid rgba(168,118,27,0.18)", borderRadius: 10, cursor: "pointer", color: "rgba(245,235,210,0.85)" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{j.topic}</span>
                    <span style={{ fontSize: 11, color: "rgba(168,118,27,0.65)", fontFamily: "monospace" }}>{j.status} · {new Date(j.createdAt).toLocaleString("zh-CN")}</span>
                  </div>
                  {j.progress && <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(160,140,90,0.65)" }}>{j.progress}</p>}
                </button>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "rgba(160,140,90,0.55)" }}>暂无历史任务</p>
          )}
        </div>
      </div>
      <CommanderProfileDrawer open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
