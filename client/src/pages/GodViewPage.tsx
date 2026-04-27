import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, Loader2, Crown, Sparkles, FileDown, RotateCcw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const GOD_VIEW_FIRST_KEY = "mvs-godview-first-used";
const COST_FIRST = 4000;
const COST_FULL = 4900;

const TERMINAL_SEQUENCE = [
  "👑 [系统] 正在唤醒 AI 上帝视角研究集群，分配超级算力节点…",
  "📡 [特工] 突破信息茧房，全网检索行业论文与商业数据库…",
  "📊 [数据] 抓取四平台 Top 变现博主链路，解剖爆款底层逻辑…",
  "🧠 [算力] 构建商业思维链（CoT），高载运算差异化战略矩阵…",
  "✍️ [引擎] 万字商业白皮书撰写中，正在注入哈佛级商业逻辑…",
  "⏳ [系统] 研报正在高速推演，您现在可以关闭页面，完成后通知您…",
];

export default function GodViewPage() {
  const [, navigate] = useLocation();
  const [topic, setTopic] = useState("");
  const [jobId, setJobId] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [phase, setPhase] = useState<"idle" | "terminal" | "polling" | "done" | "failed">("idle");
  const [reportMd, setReportMd] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isFirst, setIsFirst] = useState(!localStorage.getItem(GOD_VIEW_FIRST_KEY));
  const terminalRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef(0);

  const cost = isFirst ? COST_FIRST : COST_FULL;

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [logs]);

  // 终端日志动画
  useEffect(() => {
    if (phase !== "terminal") return;
    let i = 0;
    const iv = setInterval(() => {
      if (i < TERMINAL_SEQUENCE.length) {
        setLogs((p) => [...p, TERMINAL_SEQUENCE[i]]);
        i++;
      } else {
        clearInterval(iv);
        setPhase("polling");
      }
    }, 2200);
    return () => clearInterval(iv);
  }, [phase]);

  const launchMutation = trpc.deepResearch.launch.useMutation({
    onSuccess: (data) => {
      setJobId(data.jobId);
      setPhase("terminal");
      if (!localStorage.getItem(GOD_VIEW_FIRST_KEY)) {
        localStorage.setItem(GOD_VIEW_FIRST_KEY, "1");
        setIsFirst(false);
      }
    },
    onError: (err) => {
      setPhase("idle");
      setLogs([]);
      toast.error(err.message || "任务启动失败");
    },
  });

  const statusQuery = trpc.deepResearch.status.useQuery(
    { jobId },
    {
      enabled: phase === "polling" && !!jobId,
      refetchInterval: phase === "polling" ? 6000 : false,
      refetchIntervalInBackground: true,
    },
  );

  useEffect(() => {
    if (phase !== "polling" || !statusQuery.data) return;
    const { status, progress, reportMarkdown, error } = statusQuery.data;
    if (progress) setLogs((p) => {
      const last = p[p.length - 1];
      return last === progress ? p : [...p, `🔄 ${progress}`];
    });
    if (status === "completed" && reportMarkdown) {
      setReportMd(reportMarkdown);
      setPhase("done");
      setLogs((p) => [...p, "✅ [完成] 全景战报已生成，滚动查看完整白皮书 ↓"]);
    }
    if (status === "failed") {
      setErrorMsg(error || "研报生成失败");
      setPhase("failed");
    }
  }, [statusQuery.data, phase]);

  const handleLaunch = () => {
    if (!topic.trim()) { toast.error("请输入研究课题"); return; }
    const costStr = cost.toLocaleString();
    if (!window.confirm(`启动「AI 上帝视角」将扣除 ${costStr} 点${isFirst ? "（首次优惠价）" : ""}，研报约需 15-20 分钟，确定执行？`)) return;
    setLogs(["🚀 正在验证积分，分配超级算力节点…"]);
    setPhase("terminal");
    launchMutation.mutate({ topic, isFirstTime: isFirst });
  };

  const handleDownloadPdf = useCallback(() => {
    if (!reportMd) return;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <style>body{font-family:'Helvetica Neue',Arial,sans-serif;background:#0a0600;color:#e8d5a0;padding:40px;max-width:900px;margin:0 auto;line-height:1.8}
      h1,h2,h3{color:#f5c842}h1{font-size:28px;border-bottom:2px solid #8a6200;padding-bottom:12px}
      h2{font-size:20px;margin-top:36px;border-left:4px solid #c8a000;padding-left:12px}
      h3{font-size:16px;color:#d4a840}p{margin:8px 0}li{margin:4px 0}
      strong{color:#ffd060}code{background:#1a1000;padding:2px 6px;border-radius:4px;color:#ffcc44}
      blockquote{border-left:3px solid #8a6200;padding-left:16px;color:#b89060;margin:12px 0}
      hr{border:none;border-top:1px solid #3a2800;margin:24px 0}</style>
    </head><body>
      <h1>👑 AI 上帝视角：全景行业战报</h1>
      <p style="color:#8a6200;font-size:13px">课题：${topic} &nbsp;|&nbsp; 生成于：${new Date().toLocaleString("zh-CN")}</p>
      <hr>
      ${reportMd.replace(/\n/g, "<br>").replace(/#{1,6}\s/g, (m) => `<h${m.trim().length}>`).replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/__(.*?)__/g, "<em>$1</em>")}
      <hr><p style="color:#6a4800;font-size:11px;text-align:center">由 MV Studio Pro AI 上帝视角生成 · ${new Date().toLocaleDateString("zh-CN")}</p>
    </body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `AI上帝视角研报_${topic.slice(0, 20)}_${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast.success("研报已导出为 HTML，可用浏览器打印为 PDF");
  }, [reportMd, topic]);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#050300 0%,#0a0600 40%,#0e0800 70%,#060400 100%)", fontFamily: "'Inter',sans-serif", position: "relative", overflow: "hidden" }}>
      {/* 黑金光晕 */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{ position: "absolute", top: "5%", left: "10%", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle,rgba(180,130,0,0.12) 0%,transparent 65%)", filter: "blur(80px)", animation: "godview-float 18s ease-in-out infinite" }} />
        <div style={{ position: "absolute", bottom: "10%", right: "5%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle,rgba(140,90,0,0.10) 0%,transparent 65%)", filter: "blur(60px)", animation: "godview-float 22s ease-in-out infinite reverse" }} />
      </div>

      {/* 顶部导航 */}
      <div style={{ borderBottom: "1px solid rgba(180,130,0,0.20)", background: "rgba(5,3,0,0.95)", backdropFilter: "blur(14px)", padding: "14px 24px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 50 }}>
        <button onClick={() => navigate("/")} style={{ color: "rgba(245,200,80,0.5)", cursor: "pointer", background: "none", border: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
          <ChevronLeft size={16} />首页
        </button>
        <span style={{ color: "rgba(245,200,80,0.2)" }}>/</span>
        <span style={{ color: "rgba(245,200,80,0.85)", fontSize: 13, fontWeight: 700 }}>AI 上帝视角</span>
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "#f5c842", background: "rgba(180,130,0,0.15)", border: "1px solid rgba(180,130,0,0.4)", borderRadius: 99, padding: "3px 10px" }}>
          👑 VIP 专享
        </span>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px 80px", position: "relative", zIndex: 2 }}>

        {/* 页面标题 */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 52, height: 52, borderRadius: 16, background: "linear-gradient(135deg,#c8a000,#8a6200)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 30px rgba(200,160,0,0.35)" }}>
              <Crown size={26} color="#fff" />
            </div>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 900, background: "linear-gradient(90deg,#f5c842,#ffd878,#c8a000)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", margin: 0, letterSpacing: "-0.02em" }}>
                AI 上帝视角
              </h1>
              <p style={{ color: "rgba(245,200,80,0.55)", fontSize: 13, margin: 0, letterSpacing: "0.15em", textTransform: "uppercase" }}>
                全景行业战报 · 旗舰级商业智库
              </p>
            </div>
          </div>
          <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 14, maxWidth: 600, margin: "0 auto", lineHeight: 1.8 }}>
            停止在信息泥潭中盲目试错。派遣专属 AI 研究集群，独占极限算力，全网深度检索与逻辑推演，
            为您交付降维打击的<strong style={{ color: "rgba(245,200,80,0.8)" }}>万字商业白皮书</strong>。
            穿透赛道迷雾，锁定商业胜率。
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
            {["宏观趋势前瞻", "竞品变现拆解", "私域留存策略", "30天行动清单"].map((t) => (
              <span key={t} style={{ fontSize: 11, fontWeight: 700, color: "rgba(245,200,80,0.6)", background: "rgba(180,130,0,0.10)", border: "1px solid rgba(180,130,0,0.25)", borderRadius: 99, padding: "4px 12px" }}>{t}</span>
            ))}
          </div>
        </div>

        {/* ── 输入区（idle 状态） ── */}
        {phase === "idle" && (
          <div style={{ background: "rgba(180,130,0,0.05)", border: "1px solid rgba(180,130,0,0.22)", borderRadius: 20, padding: 28 }}>
            <p style={{ fontSize: 12, color: "rgba(245,200,80,0.5)", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>
              输入研究课题
            </p>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={5}
              placeholder="请描述您要研究的赛道或课题，例如：2026年小红书形体美学与心血管健康赛道的商业模式、头部变现路径与差异化破局策略…"
              style={{ width: "100%", padding: "14px 16px", borderRadius: 12, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(180,130,0,0.25)", color: "#fff", fontSize: 14, lineHeight: 1.7, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit", transition: "border-color 0.2s" }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(245,200,80,0.5)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(180,130,0,0.25)"; }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", margin: 0 }}>
                ⏱ 异步重算力推演，预计耗时 15-20 分钟，可关闭页面等待
              </p>
              <button
                onClick={handleLaunch}
                disabled={!topic.trim() || launchMutation.isPending}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 28px", borderRadius: 12, background: !topic.trim() ? "rgba(180,130,0,0.08)" : "linear-gradient(135deg,#c8a000,#8a6200)", border: "1px solid rgba(180,130,0,0.5)", color: !topic.trim() ? "rgba(245,200,80,0.3)" : "#050300", fontWeight: 900, fontSize: 14, cursor: !topic.trim() ? "not-allowed" : "pointer", boxShadow: topic.trim() ? "0 0 20px rgba(200,160,0,0.30)" : "none", transition: "all 0.2s", position: "relative" }}
              >
                {launchMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Crown size={15} />}
                💎 启动战略深潜（{cost.toLocaleString()}点）
                {isFirst && (
                  <span style={{ position: "absolute", top: -10, right: -6, fontSize: 9, fontWeight: 900, background: "#ef4444", color: "#fff", borderRadius: 99, padding: "1px 6px" }}>首次优惠</span>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── 终端动画 + 轮询区 ── */}
        {(phase === "terminal" || phase === "polling" || phase === "done" || phase === "failed") && (
          <div style={{ background: "#050300", border: "1px solid rgba(180,130,0,0.35)", borderRadius: 16, overflow: "hidden", boxShadow: "0 0 40px rgba(200,160,0,0.10)" }}>
            {/* 终端标题栏 */}
            <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid rgba(180,130,0,0.18)", background: "rgba(0,0,0,0.4)" }}>
              <div style={{ display: "flex", gap: 6 }}>
                {["#ef4444", "#f59e0b", "#22c55e"].map((c) => <div key={c} style={{ width: 12, height: 12, borderRadius: "50%", background: c }} />)}
              </div>
              <span style={{ marginLeft: 12, fontSize: 12, color: "rgba(245,200,80,0.4)", fontFamily: "monospace" }}>Terminal — Deep Research Cluster · {topic.slice(0, 30)}{topic.length > 30 ? "…" : ""}</span>
              {(phase === "polling" || phase === "terminal") && <Loader2 size={12} style={{ marginLeft: "auto", color: "rgba(245,200,80,0.5)", animation: "spin 1s linear infinite" }} />}
            </div>

            {/* 日志区 */}
            <div ref={terminalRef} style={{ padding: 20, fontFamily: "monospace", fontSize: 13, maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
              {logs.map((log, i) => (
                <div key={i} style={{ color: i === logs.length - 1 && phase !== "done" && phase !== "failed" ? "#f5c842" : "#4ade80", animation: i === logs.length - 1 ? "fadeIn 0.3s ease" : "none" }}>
                  {log}
                </div>
              ))}
              {(phase === "terminal" || phase === "polling") && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "rgba(245,200,80,0.6)" }}>
                  <Loader2 size={12} className="animate-spin" />
                  <span style={{ animation: "blink 1.2s step-end infinite" }}>_</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── 错误状态 ── */}
        {phase === "failed" && (
          <div style={{ marginTop: 20, padding: "16px 20px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p style={{ color: "#f87171", fontSize: 13, margin: 0 }}>❌ {errorMsg} · 积分已退回</p>
            <button onClick={() => { setPhase("idle"); setLogs([]); setErrorMsg(""); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", fontSize: 12, cursor: "pointer" }}>
              <RotateCcw size={12} />重试
            </button>
          </div>
        )}

        {/* ── 研报正文 ── */}
        {phase === "done" && reportMd && (
          <div style={{ marginTop: 24, animation: "fadeIn 0.6s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <p style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 800, color: "#f5c842", margin: 0 }}>
                <Sparkles size={18} />全景行业战报
              </p>
              <button onClick={handleDownloadPdf} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 18px", borderRadius: 10, background: "linear-gradient(135deg,rgba(180,130,0,0.22),rgba(140,90,0,0.18))", border: "1px solid rgba(180,130,0,0.4)", color: "#f5c842", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                <FileDown size={14} />导出研报 HTML
              </button>
            </div>
            <div style={{ background: "rgba(180,130,0,0.04)", border: "1px solid rgba(180,130,0,0.18)", borderRadius: 16, padding: "24px 28px" }}>
              <ReportRenderer markdown={reportMd} />
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none} }
        @keyframes godview-float {
          0%,100%{transform:translate(0,0) scale(1)}
          40%{transform:translate(30px,-40px) scale(1.05)}
          70%{transform:translate(-20px,25px) scale(0.97)}
        }
        @keyframes blink { 0%,100%{opacity:1}50%{opacity:0} }
        @keyframes spin { from{transform:rotate(0deg)}to{transform:rotate(360deg)} }
      `}</style>
    </div>
  );
}

/** Markdown → 简单 HTML 渲染（轻量，无依赖） */
function ReportRenderer({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  return (
    <div style={{ color: "rgba(255,255,255,0.82)", fontSize: 14, lineHeight: 1.9 }}>
      {lines.map((line, i) => {
        const key = i;
        if (line.startsWith("# ")) return <h1 key={key} style={{ fontSize: 22, fontWeight: 900, color: "#f5c842", margin: "28px 0 12px", borderBottom: "1px solid rgba(180,130,0,0.25)", paddingBottom: 8 }}>{line.slice(2)}</h1>;
        if (line.startsWith("## ")) return <h2 key={key} style={{ fontSize: 17, fontWeight: 800, color: "#d4a840", margin: "24px 0 10px", borderLeft: "3px solid #c8a000", paddingLeft: 12 }}>{line.slice(3)}</h2>;
        if (line.startsWith("### ")) return <h3 key={key} style={{ fontSize: 15, fontWeight: 700, color: "#c09030", margin: "18px 0 8px" }}>{line.slice(4)}</h3>;
        if (line.startsWith("- ") || line.startsWith("* ")) return <div key={key} style={{ display: "flex", gap: 8, marginBottom: 4 }}><span style={{ color: "#c8a000", flexShrink: 0 }}>•</span><span>{renderInline(line.slice(2))}</span></div>;
        if (/^\d+\.\s/.test(line)) return <div key={key} style={{ display: "flex", gap: 8, marginBottom: 4 }}><span style={{ color: "#c8a000", minWidth: 20 }}>{line.match(/^\d+/)?.[0]}.</span><span>{renderInline(line.replace(/^\d+\.\s/, ""))}</span></div>;
        if (line.startsWith("> ")) return <blockquote key={key} style={{ borderLeft: "3px solid #8a6200", paddingLeft: 14, color: "rgba(245,200,80,0.65)", margin: "10px 0", fontStyle: "italic" }}>{renderInline(line.slice(2))}</blockquote>;
        if (line.startsWith("---") || line.startsWith("===")) return <hr key={key} style={{ border: "none", borderTop: "1px solid rgba(180,130,0,0.2)", margin: "20px 0" }} />;
        if (!line.trim()) return <div key={key} style={{ height: 8 }} />;
        return <p key={key} style={{ margin: "4px 0" }}>{renderInline(line)}</p>;
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i} style={{ color: "#ffd060" }}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} style={{ background: "rgba(180,130,0,0.15)", padding: "1px 6px", borderRadius: 4, color: "#ffc842", fontSize: 12 }}>{part.slice(1, -1)}</code>;
    return part;
  });
}
