import { useState } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, Plus, UserCircle, ArrowRight, Calendar, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import CommanderProfileDrawer from "@/components/CommanderProfileDrawer";
import { ShieldCheck } from "lucide-react";
import AgentInputPanel, { type UploadedAgentFile } from "@/components/AgentInputPanel";
import AgentJobMonitor from "@/components/AgentJobMonitor";
import ReportRenderer from "@/components/ReportRenderer";

type View = "list" | "create" | "detail";

export default function VipTrackerPage() {
  const [, navigate] = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);
  const [view, setView] = useState<View>("list");
  const [activeVipId, setActiveVipId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  return (
    <div style={{ minHeight: "100vh", background: "#0c0a08", color: "rgba(245,235,210,0.92)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px 80px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
          <button onClick={() => (view === "list" ? navigate("/god-view") : setView("list"))} style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", background: "rgba(168,118,27,0.10)", border: "1px solid rgba(168,118,27,0.30)", borderRadius: 8, cursor: "pointer", color: "#d6a861", fontSize: 13, fontWeight: 700 }}>
            <ChevronLeft size={14} /> {view === "list" ? "返回" : "返回档案列表"}
          </button>
          <button onClick={() => setProfileOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "rgba(168,118,27,0.15)", border: "1px solid rgba(168,118,27,0.40)", borderRadius: 8, cursor: "pointer", color: "#d6a861", fontSize: 12, fontWeight: 800 }}>
            <ShieldCheck size={12} /> 指挥官档案
          </button>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#d6a861", letterSpacing: "0.06em" }}>
              <UserCircle size={20} style={{ display: "inline", marginRight: 8, verticalAlign: "middle" }} />
              VIP 客户身心抗衰追踪
            </h1>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "rgba(160,140,90,0.70)", lineHeight: 1.7 }}>
              每位高净值客户一份专属档案 · 用 Interactions API 续接历史，每月动态更新身心抗衰处方
            </p>
          </div>
        </div>

        {view === "list" && <VipListView onCreate={() => setView("create")} onOpen={(id) => { setActiveVipId(id); setView("detail"); }} />}
        {view === "create" && (
          <VipCreateView
            onLaunched={(jobId) => {
              setActiveJobId(jobId);
              setView("list");
              toast.success("VIP 建档任务已派发，Agent 正在制定基线评估计划…");
            }}
          />
        )}
        {view === "detail" && activeVipId && (
          <VipDetailView vipId={activeVipId} />
        )}

        {/* 当前进行中的任务（任意页面都可见） */}
        {activeJobId && view === "list" && (
          <div style={{ marginTop: 32 }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: "#d6a861", marginBottom: 14 }}>当前进行中的任务</h2>
            <AgentJobMonitor jobId={activeJobId} onCompleted={() => setActiveJobId(null)} />
          </div>
        )}
      </div>
      <CommanderProfileDrawer open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}

// ── 列表视图 ────────────────────────────────────────────────────────────────
function VipListView({ onCreate, onOpen }: { onCreate: () => void; onOpen: (vipId: string) => void }) {
  const listQuery = trpc.agent.listVipProfiles.useQuery();

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#d6a861" }}>
          {listQuery.data?.profiles?.length ? `已建档 ${listQuery.data.profiles.length} 位客户` : "尚无客户档案"}
        </h2>
        <button onClick={onCreate} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 10, background: "linear-gradient(135deg,#a8761b,#7a5410)", border: "1px solid rgba(168,118,27,0.55)", color: "#fff7df", fontWeight: 900, fontSize: 13, cursor: "pointer", boxShadow: "0 4px 16px rgba(168,118,27,0.30)" }}>
          <Plus size={14} /> 新建 VIP 档案
        </button>
      </div>

      {listQuery.data?.profiles?.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
          {listQuery.data.profiles.map((p) => (
            <button key={p.vipId} onClick={() => onOpen(p.vipId)} style={{ textAlign: "left", padding: "18px 20px", background: "rgba(168,118,27,0.06)", border: "1px solid rgba(168,118,27,0.22)", borderRadius: 14, cursor: "pointer", color: "rgba(245,235,210,0.92)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 900, color: "#d6a861" }}>{p.vipName}</span>
                <ArrowRight size={14} color="#d6a861" />
              </div>
              <p style={{ margin: 0, fontSize: 11, color: "rgba(160,140,90,0.70)" }}>
                建档：{new Date(p.createdAt).toLocaleDateString("zh-CN")} · 已更新 {p.updateCount} 次
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(160,140,90,0.55)" }}>
                最近更新：{new Date(p.lastUpdateAt).toLocaleString("zh-CN")}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ padding: "40px 24px", background: "rgba(168,118,27,0.04)", border: "1px dashed rgba(168,118,27,0.30)", borderRadius: 14, textAlign: "center" }}>
          <UserCircle size={42} color="#d6a861" style={{ opacity: 0.4, marginBottom: 12 }} />
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#d6a861" }}>开始为您的第一位高净值客户建档</p>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "rgba(160,140,90,0.65)" }}>建档后每月可一键追加新数据，Agent 会基于全部历史档案给出动态调整处方</p>
        </div>
      )}
    </div>
  );
}

// ── 建档视图 ────────────────────────────────────────────────────────────────
function VipCreateView({ onLaunched }: { onLaunched: (jobId: string) => void }) {
  const [vipName, setVipName] = useState("");
  const [baselineSummary, setBaselineSummary] = useState("");

  const launchMutation = trpc.agent.launchVipBaseline.useMutation({
    onSuccess: (res) => onLaunched(res.jobId),
    onError: (e) => toast.error("建档失败：" + e.message),
  });

  const handleSubmit = async ({ text, files }: { text: string; files: UploadedAgentFile[] }) => {
    if (vipName.trim().length < 1) { toast.error("请填写客户姓名"); return; }
    if (baselineSummary.trim().length < 20) { toast.error("基线画像至少 20 字"); return; }
    await launchMutation.mutateAsync({
      vipName: vipName.trim(),
      baselineSummary: baselineSummary.trim(),
      supplementaryText: text.trim() || undefined,
      supplementaryFiles: files.length ? files : undefined,
    });
  };

  return (
    <div style={{ background: "rgba(168,118,27,0.04)", border: "1px solid rgba(168,118,27,0.22)", borderRadius: 16, padding: "26px 28px" }}>
      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 800, color: "#d6a861", marginBottom: 8 }}>
          客户姓名 <span style={{ color: "#fca5a5" }}>*</span>
        </label>
        <input
          value={vipName}
          onChange={(e) => setVipName(e.target.value)}
          placeholder="例：张女士 / 客户编号 V001"
          style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "rgba(0,0,0,0.30)", border: "1px solid rgba(168,118,27,0.30)", color: "rgba(245,235,210,0.92)", fontSize: 14, outline: "none", boxSizing: "border-box" }}
        />
      </div>

      <div style={{ marginBottom: 22 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 800, color: "#d6a861", marginBottom: 8 }}>
          基线画像 <span style={{ color: "#fca5a5" }}>*</span>
          <span style={{ fontWeight: 500, color: "rgba(160,140,90,0.65)", marginLeft: 8 }}>· 年龄 / 职业 / 健康基线 / 审美偏好 / 既往病史</span>
        </label>
        <textarea
          value={baselineSummary}
          onChange={(e) => setBaselineSummary(e.target.value.slice(0, 8000))}
          placeholder="例：女性，48 岁，金融行业高管。近 3 年长期失眠，颈椎问题。审美偏好极简、新中式。爱好古典乐与红酒。BMI 24.1，体脂 28%，最近一次体检 LDL 偏高。希望兼顾抗衰与体态重塑..."
          rows={6}
          style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "rgba(0,0,0,0.30)", border: "1px solid rgba(168,118,27,0.30)", color: "rgba(245,235,210,0.92)", fontSize: 13, lineHeight: 1.7, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }}
        />
        <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(160,140,90,0.55)", textAlign: "right" }}>{baselineSummary.length} / 8000</p>
      </div>

      <div>
        <label style={{ display: "block", fontSize: 13, fontWeight: 800, color: "#d6a861", marginBottom: 8 }}>
          附加资料 <span style={{ fontWeight: 500, color: "rgba(160,140,90,0.65)", marginLeft: 8 }}>· 体检报告 / 既往诊断 / 偏好的艺术品图片</span>
        </label>
        <AgentInputPanel
          placeholder="（可选）补充该客户的特殊关注点 / 禁忌 / 长期目标..."
          submitLabel="启动建档分析"
          submitting={launchMutation.isPending}
          onSubmit={handleSubmit}
          textRequired={false}
          hint="约 5-10 分钟生成基线评估计划，审批后 30-60 分钟交付首份档案"
          maxLen={4000}
        />
      </div>
    </div>
  );
}

// ── 详情视图 ────────────────────────────────────────────────────────────────
function VipDetailView({ vipId }: { vipId: string }) {
  const profileQuery = trpc.agent.getVipProfile.useQuery({ vipId }, { refetchInterval: 30_000 });
  const [showMonthlyForm, setShowMonthlyForm] = useState(false);
  const [activeUpdateJobId, setActiveUpdateJobId] = useState<string | null>(null);

  const monthlyMutation = trpc.agent.launchVipMonthlyUpdate.useMutation({
    onSuccess: (res) => {
      setActiveUpdateJobId(res.jobId);
      setShowMonthlyForm(false);
      toast.success("月度更新已派发，Agent 已用上次档案锚点续接深潜…");
      void profileQuery.refetch();
    },
    onError: (e) => toast.error("派发失败：" + e.message),
  });

  if (profileQuery.isLoading) return <p style={{ color: "rgba(160,140,90,0.6)" }}>加载档案中…</p>;
  if (!profileQuery.data) return <p style={{ color: "#fca5a5" }}>档案不存在</p>;

  const profile = profileQuery.data;
  const baseReady = !!profile.baseInteractionId;

  const handleMonthly = async ({ text, files }: { text: string; files: UploadedAgentFile[] }) => {
    if (text.trim().length < 20) { toast.error("月度新数据至少 20 字"); return; }
    await monthlyMutation.mutateAsync({
      vipId,
      monthlyData: text.trim(),
      supplementaryFiles: files.length ? files : undefined,
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* 档案头部 */}
      <div style={{ padding: "20px 24px", background: "linear-gradient(135deg, rgba(168,118,27,0.10), rgba(122,84,16,0.04))", border: "1px solid rgba(168,118,27,0.30)", borderRadius: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "#d6a861" }}>{profile.vipName}</h2>
            <p style={{ margin: "6px 0 0", fontSize: 11, color: "rgba(160,140,90,0.65)" }}>
              vipId: <span style={{ fontFamily: "monospace" }}>{profile.vipId}</span> · 建档 {new Date(profile.createdAt).toLocaleDateString("zh-CN")} · 已 {profile.updates.length} 次月度更新
            </p>
          </div>
          {baseReady ? (
            <button onClick={() => setShowMonthlyForm(true)} disabled={showMonthlyForm} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 10, background: showMonthlyForm ? "rgba(168,118,27,0.20)" : "linear-gradient(135deg,#a8761b,#7a5410)", border: "1px solid rgba(168,118,27,0.55)", color: showMonthlyForm ? "rgba(245,235,210,0.50)" : "#fff7df", fontWeight: 900, fontSize: 13, cursor: showMonthlyForm ? "not-allowed" : "pointer" }}>
              <Calendar size={14} /> 追加月度更新
            </button>
          ) : (
            <span style={{ padding: "8px 16px", borderRadius: 999, background: "rgba(0,180,255,0.10)", border: "1px solid rgba(0,180,255,0.30)", color: "#7dd3fc", fontSize: 11, fontWeight: 700 }}>
              基线建档中，待 baseInteractionId 就绪后开放月度更新
            </span>
          )}
        </div>
        <p style={{ margin: "12px 0 0", fontSize: 12, color: "rgba(245,235,210,0.75)", lineHeight: 1.7, padding: "12px 14px", background: "rgba(0,0,0,0.30)", borderRadius: 10 }}>
          <strong style={{ color: "#d6a861" }}>基线画像：</strong>{profile.baselineSummary}
        </p>
      </div>

      {/* 月度更新表单 */}
      {showMonthlyForm && (
        <div style={{ background: "rgba(168,118,27,0.04)", border: "1px solid rgba(168,118,27,0.22)", borderRadius: 14, padding: "22px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Sparkles size={16} color="#d6a861" />
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#d6a861" }}>追加本月新数据</h3>
            <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(160,140,90,0.65)" }}>
              用历史档案锚点 (previous_interaction_id) 续接，跳过计划阶段直接深潜
            </span>
          </div>
          <AgentInputPanel
            placeholder="例：本月睡眠从平均 5.2h 提升到 6.8h；HRV 改善；本周参观了某当代艺术展，对作品 X 有强烈共鸣..."
            submitLabel="开始月度推演"
            submitting={monthlyMutation.isPending}
            onSubmit={handleMonthly}
            hint="月度更新无需审批计划，Agent 直接基于历史档案 + 本月数据推演"
            maxLen={4000}
            textRequired={true}
          />
          <button onClick={() => setShowMonthlyForm(false)} style={{ marginTop: 10, padding: "6px 14px", background: "transparent", border: "none", color: "rgba(160,140,90,0.65)", cursor: "pointer", fontSize: 12 }}>
            取消
          </button>
        </div>
      )}

      {/* 月度任务监控 */}
      {activeUpdateJobId && (
        <div>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 800, color: "#d6a861" }}>当前月度任务</h3>
          <AgentJobMonitor jobId={activeUpdateJobId} onCompleted={() => { profileQuery.refetch(); setActiveUpdateJobId(null); }} />
        </div>
      )}

      {/* 历次月度更新列表 */}
      <div>
        <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 800, color: "#d6a861" }}>月度更新历史 · {profile.updates.length} 条</h3>
        {profile.updates.length === 0 ? (
          <p style={{ fontSize: 12, color: "rgba(160,140,90,0.55)" }}>还没有月度更新记录</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {profile.updates.map((u) => (
              <UpdateEntryCard key={u.jobId} entry={u} />
            ))}
          </div>
        )}
      </div>

      {/* 基线建档任务（如果还在跑） */}
      {!baseReady && profile.baseJobId && profile.baseJobId !== "pending" && (
        <div>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 800, color: "#d6a861" }}>基线建档任务进度</h3>
          <AgentJobMonitor jobId={profile.baseJobId} onCompleted={() => profileQuery.refetch()} />
        </div>
      )}
    </div>
  );
}

function UpdateEntryCard({ entry }: { entry: { jobId: string; summary: string; createdAt: string; fileNames: string[] } }) {
  const [expanded, setExpanded] = useState(false);
  const jobQuery = trpc.agent.getJob.useQuery({ jobId: entry.jobId }, {
    enabled: expanded,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "completed" || s === "failed" ? false : 20_000;
    },
  });

  return (
    <div style={{ background: "rgba(0,0,0,0.20)", border: "1px solid rgba(168,118,27,0.18)", borderRadius: 12, overflow: "hidden" }}>
      <button onClick={() => setExpanded(!expanded)} style={{ width: "100%", textAlign: "left", padding: "14px 18px", background: "transparent", border: "none", cursor: "pointer", color: "rgba(245,235,210,0.85)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#d6a861" }}>{new Date(entry.createdAt).toLocaleString("zh-CN")}</span>
          <span style={{ fontSize: 11, color: "rgba(168,118,27,0.55)" }}>{expanded ? "收起 ▲" : "展开 ▼"}</span>
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "rgba(245,235,210,0.75)", lineHeight: 1.6 }}>{entry.summary}</p>
        {entry.fileNames.length > 0 && (
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(160,140,90,0.55)" }}>📎 {entry.fileNames.length} 个附件：{entry.fileNames.join("、")}</p>
        )}
      </button>
      {expanded && jobQuery.data && (
        <div style={{ padding: "0 18px 18px" }}>
          {jobQuery.data.status === "completed" && jobQuery.data.reportMarkdown ? (
            <div style={{ background: "rgba(0,0,0,0.30)", border: "1px solid rgba(168,118,27,0.18)", borderRadius: 10, padding: "14px 16px", maxHeight: 500, overflow: "auto" }}>
              <ReportRenderer markdown={jobQuery.data.reportMarkdown} />
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "rgba(160,140,90,0.65)" }}>{jobQuery.data.progress || jobQuery.data.status}</p>
          )}
        </div>
      )}
    </div>
  );
}
