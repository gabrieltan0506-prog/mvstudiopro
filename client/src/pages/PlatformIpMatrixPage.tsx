import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, Plus, X, Layers, Flame } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import CommanderProfileDrawer from "@/components/CommanderProfileDrawer";
import { ShieldCheck } from "lucide-react";
import AgentInputPanel, { type UploadedAgentFile } from "@/components/AgentInputPanel";
import AgentJobMonitor from "@/components/AgentJobMonitor";
import { readAndClearAgentHandoff, formatHandoffAsPainPoint, type AgentTrendHandoff } from "@/lib/agentHandoff";
import { AGENT_SCENARIO_CREDITS, estimateCnyFromCredits } from "@/lib/agentPricing";

const DEFAULT_PLATFORMS = ["抖音", "小红书", "B 站", "快手", "视频号", "微博"];

interface AccountRow { platform: string; handle: string; notes?: string }

export default function PlatformIpMatrixPage() {
  const [, navigate] = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);
  const [accounts, setAccounts] = useState<AccountRow[]>([
    { platform: "抖音", handle: "" },
    { platform: "小红书", handle: "" },
    { platform: "B 站", handle: "" },
    { platform: "快手", handle: "" },
  ]);
  const [topicDirection, setTopicDirection] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [handoffPrefill, setHandoffPrefill] = useState<AgentTrendHandoff | null>(null);
  const [supplementaryPrefill, setSupplementaryPrefill] = useState<string>("");

  useEffect(() => {
    const h = readAndClearAgentHandoff("platform_ip_matrix");
    if (h) {
      setHandoffPrefill(h);
      setTopicDirection(h.title);
      setSupplementaryPrefill(formatHandoffAsPainPoint(h));
      toast.success(`已从 ${h.platformLabel} 实时爆款预填话题方向`);
    }
  }, []);

  const launchMutation = trpc.agent.launchPlatformIpMatrix.useMutation({
    onSuccess: (res) => {
      setActiveJobId(res.jobId);
      toast.success("任务已派发，Agent 正在制定研究计划…");
    },
    onError: (e) => toast.error("派发失败：" + e.message),
  });

  const listQuery = trpc.agent.listScenarioJobs.useQuery({ productType: "platform_ip_matrix" }, {
    refetchInterval: activeJobId ? 30_000 : false,
  });

  const addAccount = () => setAccounts((a) => [...a, { platform: "", handle: "" }]);
  const removeAccount = (i: number) => setAccounts((a) => a.filter((_, j) => j !== i));
  const updateAccount = (i: number, patch: Partial<AccountRow>) =>
    setAccounts((a) => a.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  const handleSubmit = async ({ text, files }: { text: string; files: UploadedAgentFile[] }) => {
    if (topicDirection.trim().length < 4) {
      toast.error("请填写话题方向（≥ 4 字）");
      return;
    }
    const cost = AGENT_SCENARIO_CREDITS.platform_ip_matrix;
    const rmb = estimateCnyFromCredits(cost);
    if (!window.confirm(`派发「多平台 IP 矩阵」将先扣除 ${cost} 点积分（约合 ${rmb} 元，以账户为准），确定继续？`)) {
      return;
    }
    const filledAccounts = accounts.filter((a) => a.platform.trim() && a.handle.trim());
    await launchMutation.mutateAsync({
      topicDirection: topicDirection.trim(),
      accounts: filledAccounts.map((a) => ({
        platform: a.platform.trim(),
        handle: a.handle.trim(),
        notes: a.notes?.trim() || undefined,
      })),
      supplementaryText: text.trim() || undefined,
      supplementaryFiles: files.length ? files : undefined,
    });
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0c0a08", color: "rgba(245,235,210,0.92)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px 80px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
          <button onClick={() => navigate("/god-view")} style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", background: "rgba(168,118,27,0.10)", border: "1px solid rgba(168,118,27,0.30)", borderRadius: 8, cursor: "pointer", color: "#d6a861", fontSize: 13, fontWeight: 700 }}>
            <ChevronLeft size={14} /> 返回
          </button>
          <button onClick={() => setProfileOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "rgba(168,118,27,0.15)", border: "1px solid rgba(168,118,27,0.40)", borderRadius: 8, cursor: "pointer", color: "#d6a861", fontSize: 12, fontWeight: 800 }}>
            <ShieldCheck size={12} /> 指挥官档案
          </button>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#d6a861", letterSpacing: "0.06em" }}>
              <Layers size={20} style={{ display: "inline", marginRight: 8, verticalAlign: "middle" }} />
              多平台内容 IP 矩阵自动驾驶
            </h1>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "rgba(160,140,90,0.70)", lineHeight: 1.7 }}>
              四大平台爆款交叉对比 + 跨界短影音脚本 + 分镜表 · 由战略智库一次性交付「开机即录」的内容资产
            </p>
          </div>
        </div>

        {/* 实时趋势预填提示 banner */}
        {!activeJobId && handoffPrefill && (
          <div style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 12, background: "linear-gradient(135deg, rgba(255,209,102,0.10), rgba(255,138,76,0.06))", border: "1px solid rgba(255,209,102,0.35)", display: "flex", alignItems: "center", gap: 10 }}>
            <Flame size={16} style={{ color: "#ffc77f", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#ffd166" }}>已从 {handoffPrefill.platformLabel} 实时爆款派发</div>
              <div style={{ fontSize: 11, color: "rgba(245,235,210,0.65)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {handoffPrefill.title}
              </div>
            </div>
            <button onClick={() => { setHandoffPrefill(null); setSupplementaryPrefill(""); setTopicDirection(""); }} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 700, background: "rgba(168,118,27,0.10)", border: "1px solid rgba(168,118,27,0.30)", borderRadius: 6, color: "#d6a861", cursor: "pointer" }}>
              清空预填
            </button>
          </div>
        )}

        {/* 任务派发区 */}
        {!activeJobId && (
          <div style={{ background: "rgba(168,118,27,0.04)", border: "1px solid rgba(168,118,27,0.22)", borderRadius: 16, padding: "26px 28px" }}>
            {/* 话题方向 */}
            <div style={{ marginBottom: 22 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 800, color: "#d6a861", marginBottom: 8 }}>
                话题方向 <span style={{ color: "#fca5a5" }}>*</span>
              </label>
              <input
                value={topicDirection}
                onChange={(e) => setTopicDirection(e.target.value)}
                placeholder="例：哈佛医师视角的 15 分钟心血管与体态重塑"
                style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "rgba(0,0,0,0.30)", border: "1px solid rgba(168,118,27,0.30)", color: "rgba(245,235,210,0.92)", fontSize: 14, outline: "none", boxSizing: "border-box" }}
              />
            </div>

            {/* 账号矩阵 */}
            <div style={{ marginBottom: 22 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 800, color: "#d6a861", marginBottom: 8 }}>
                账号矩阵 <span style={{ fontWeight: 500, color: "rgba(160,140,90,0.65)", marginLeft: 8 }}>· 留空则由 Agent 自行选取头部账号</span>
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {accounts.map((row, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select
                      value={row.platform}
                      onChange={(e) => updateAccount(i, { platform: e.target.value })}
                      style={{ width: 120, padding: "10px 12px", borderRadius: 8, background: "rgba(0,0,0,0.30)", border: "1px solid rgba(168,118,27,0.30)", color: "rgba(245,235,210,0.92)", fontSize: 13, outline: "none" }}
                    >
                      <option value="">平台</option>
                      {DEFAULT_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <input
                      value={row.handle}
                      onChange={(e) => updateAccount(i, { handle: e.target.value })}
                      placeholder="账号名 / @handle / 链接"
                      style={{ flex: 1, padding: "10px 12px", borderRadius: 8, background: "rgba(0,0,0,0.30)", border: "1px solid rgba(168,118,27,0.30)", color: "rgba(245,235,210,0.92)", fontSize: 13, outline: "none" }}
                    />
                    <input
                      value={row.notes ?? ""}
                      onChange={(e) => updateAccount(i, { notes: e.target.value })}
                      placeholder="备注（可选）"
                      style={{ width: 200, padding: "10px 12px", borderRadius: 8, background: "rgba(0,0,0,0.30)", border: "1px solid rgba(168,118,27,0.30)", color: "rgba(245,235,210,0.92)", fontSize: 13, outline: "none" }}
                    />
                    <button onClick={() => removeAccount(i)} style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(220,38,38,0.10)", border: "1px solid rgba(220,38,38,0.30)", borderRadius: 8, color: "#fca5a5", cursor: "pointer" }}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button onClick={addAccount} style={{ display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start", padding: "8px 14px", background: "rgba(168,118,27,0.08)", border: "1px dashed rgba(168,118,27,0.40)", borderRadius: 8, color: "#d6a861", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                  <Plus size={12} /> 添加账号
                </button>
              </div>
            </div>

            {/* 共享输入面板（补充文字 + 文件 + 语音） */}
            <div style={{ marginBottom: 6 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 800, color: "#d6a861", marginBottom: 8 }}>
                补充资料 <span style={{ fontWeight: 500, color: "rgba(160,140,90,0.65)", marginLeft: 8 }}>· 可上传账号截图 / 数据 PDF / 语音口述</span>
              </label>
              <AgentInputPanel
                placeholder="例：本月重点要主推「黄金比例美学 × 心血管健康」混剪短片，希望偏知识科普风..."
                submitLabel={`派发任务（${AGENT_SCENARIO_CREDITS.platform_ip_matrix} 点）`}
                submitting={launchMutation.isPending}
                onSubmit={handleSubmit}
                textRequired={false}
                hint={`异步深潜 · 先扣 ${AGENT_SCENARIO_CREDITS.platform_ip_matrix} 点（≈¥${estimateCnyFromCredits(AGENT_SCENARIO_CREDITS.platform_ip_matrix)}）· 失败自动退还 · 约 5-10 分钟出计划`}
                maxLen={4000}
                initialText={supplementaryPrefill}
              />
            </div>
          </div>
        )}

        {/* 任务进行中 */}
        {activeJobId && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#d6a861" }}>当前任务</h2>
              <button onClick={() => setActiveJobId(null)} style={{ padding: "6px 12px", background: "rgba(168,118,27,0.08)", border: "1px solid rgba(168,118,27,0.30)", borderRadius: 8, color: "#d6a861", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                ← 派发新任务
              </button>
            </div>
            <AgentJobMonitor jobId={activeJobId} onCompleted={() => listQuery.refetch()} />
          </div>
        )}

        {/* 历史任务 */}
        <div style={{ marginTop: 36 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: "#d6a861", marginBottom: 14 }}>历史任务</h2>
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
