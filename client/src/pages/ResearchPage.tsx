import { useState } from "react";
import { useLocation } from "wouter";
import { Loader2, ChevronLeft, Rocket, Search, BookOpen, AlertCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const PLATFORMS = [
  { value: "xiaohongshu", label: "小红书" },
  { value: "douyin", label: "抖音" },
  { value: "kuaishou", label: "快手" },
  { value: "bilibili", label: "B站" },
] as const;

type Platform = (typeof PLATFORMS)[number]["value"];

const MAX_CHARS = 5000;

export default function ResearchPage() {
  const [, navigate] = useLocation();
  const [platform, setPlatform] = useState<Platform>("xiaohongshu");
  const [content, setContent] = useState("");
  const [showGuide, setShowGuide] = useState(false);
  const [result, setResult] = useState<any>(null);

  const mutation = trpc.competitorResearch.run.useMutation({
    onSuccess: (data) => {
      setResult(data.strategy);
      toast.success(`调研完成，消耗 ${data.creditsUsed} 点`);
    },
    onError: (err) => {
      toast.error(err.message || "调研失败，请重试");
    },
  });

  const handleRun = () => {
    if (content.length > MAX_CHARS) {
      toast.error("字数超过 5000 字限制，请精简后再试");
      return;
    }
    if (!window.confirm(`执行「${PLATFORMS.find((p) => p.value === platform)?.label}」深度调研将扣除 20 点，确定继续？`)) return;
    mutation.mutate({ platform, competitorData: content });
  };

  const overLimit = content.length > MAX_CHARS;

  return (
    <div className="min-h-screen bg-[#0a0a0f]" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* 顶部导航 */}
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(10,10,15,0.95)", backdropFilter: "blur(12px)", padding: "14px 24px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 50 }}>
        <button onClick={() => navigate("/")} style={{ color: "rgba(255,255,255,0.45)", cursor: "pointer", background: "none", border: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
          <ChevronLeft size={16} />首页
        </button>
        <span style={{ color: "rgba(255,255,255,0.15)" }}>/</span>
        <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, fontWeight: 600 }}>竞品与对标分析</span>
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "#f97316", background: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.3)", borderRadius: 99, padding: "3px 10px" }}>
          20点/次
        </span>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px 80px" }}>
        {/* 页面标题 */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "linear-gradient(135deg,#f97316,#fb923c)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Search size={20} color="#fff" />
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#fff", margin: 0 }}>竞品与对标分析</h1>
          </div>
          <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 14, margin: 0 }}>
            双引擎驱动 · Gemma 4 底层扫描 + Gemini 2.5 Pro 战略处方 · 30秒内生成降维打击方案
          </p>
        </div>

        {/* 使用说明折叠 */}
        <button
          onClick={() => setShowGuide(!showGuide)}
          style={{ width: "100%", marginBottom: 24, padding: "12px 16px", background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.18)", borderRadius: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", color: "rgba(255,255,255,0.7)", fontSize: 13 }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BookOpen size={14} style={{ color: "#f97316" }} />
            使用说明 · 多平台双引擎调研手册
          </span>
          <span style={{ color: "#f97316", fontSize: 11 }}>{showGuide ? "▲ 收起" : "▼ 展开"}</span>
        </button>

        {showGuide && (
          <div style={{ marginBottom: 24, padding: "20px 20px", background: "rgba(249,115,22,0.04)", border: "1px solid rgba(249,115,22,0.15)", borderRadius: 12, fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.8 }}>
            <p style={{ color: "#fb923c", fontWeight: 700, marginBottom: 8 }}>📘 操作流程</p>
            <p>① 选择平台 → ② 粘贴竞品文案/标题/逐字稿（5000字以内）→ ③ 点击执行（扣除20点）→ ④ 等待约30秒获取处方</p>
            <p style={{ marginTop: 8, color: "#fb923c", fontWeight: 700 }}>💡 专家语录</p>
            <p style={{ fontStyle: "italic" }}>「不要用你的体力，去挑战对手的数据力。」</p>
          </div>
        )}

        {/* 主输入区 */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "24px", marginBottom: 24 }}>
          {/* 平台选择 */}
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>选择分析平台</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
            {PLATFORMS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPlatform(p.value)}
                style={{
                  padding: "7px 18px", borderRadius: 99, fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s",
                  background: platform === p.value ? "rgba(249,115,22,0.18)" : "rgba(255,255,255,0.05)",
                  border: platform === p.value ? "1px solid rgba(249,115,22,0.5)" : "1px solid rgba(255,255,255,0.1)",
                  color: platform === p.value ? "#fb923c" : "rgba(255,255,255,0.5)",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* 竞品内容输入 */}
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>竞品内容</p>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="粘贴竞品文案、爆款标题、逐字稿或账号描述…"
            style={{
              width: "100%", minHeight: 200, padding: "14px 16px", borderRadius: 10, resize: "vertical",
              background: "rgba(0,0,0,0.3)", border: `1px solid ${overLimit ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.1)"}`,
              color: "#fff", fontSize: 14, lineHeight: 1.7, outline: "none", boxSizing: "border-box",
              fontFamily: "inherit",
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <span style={{ fontSize: 12, color: overLimit ? "#ef4444" : "rgba(255,255,255,0.3)" }}>
              {overLimit && <AlertCircle size={12} style={{ display: "inline", marginRight: 4 }} />}
              {content.length} / {MAX_CHARS} 字
            </span>
            <button
              onClick={handleRun}
              disabled={mutation.isPending || content.trim().length === 0 || overLimit}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "10px 24px", borderRadius: 10,
                background: mutation.isPending || content.trim().length === 0 || overLimit ? "rgba(255,255,255,0.08)" : "linear-gradient(135deg,#f97316,#ea580c)",
                border: "none", color: mutation.isPending || content.trim().length === 0 || overLimit ? "rgba(255,255,255,0.3)" : "#fff",
                fontWeight: 700, fontSize: 14, cursor: mutation.isPending || content.trim().length === 0 || overLimit ? "not-allowed" : "pointer",
                transition: "all 0.2s",
              }}
            >
              {mutation.isPending
                ? <><Loader2 size={15} className="animate-spin" />双引擎化验中…</>
                : <><Rocket size={15} />执行深度调研（20点）</>}
            </button>
          </div>
        </div>

        {/* 结果展示 */}
        {result && (
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(249,115,22,0.2)", borderRadius: 16, padding: "24px", animation: "fadeIn 0.4s ease" }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#fb923c", marginBottom: 20 }}>🏆 战略处方</h2>

            {result.raw ? (
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.7 }}>{result.raw}</pre>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {/* 差异化定位 */}
                {result.positioning && (
                  <Section title="差异化人设定位" color="#a78bfa">
                    <p style={{ fontSize: 14, color: "rgba(255,255,255,0.8)", lineHeight: 1.8, margin: 0 }}>
                      {typeof result.positioning === "string" ? result.positioning : JSON.stringify(result.positioning, null, 2)}
                    </p>
                  </Section>
                )}

                {/* 执行脚本 */}
                {Array.isArray(result.scripts) && result.scripts.length > 0 && (
                  <Section title="内容执行脚本" color="#34d399">
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {result.scripts.map((s: any, i: number) => (
                        <div key={i} style={{ background: "rgba(52,211,153,0.05)", border: "1px solid rgba(52,211,153,0.15)", borderRadius: 10, padding: "12px 14px" }}>
                          <p style={{ fontWeight: 700, color: "#34d399", fontSize: 13, margin: "0 0 4px" }}>#{i + 1} {s.title}</p>
                          {s.hook && <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, margin: "0 0 4px" }}>🎣 钩子：{s.hook}</p>}
                          {s.copywriting && <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, margin: 0 }}>✍️ 文案：{s.copywriting}</p>}
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {/* 视觉指引 */}
                {result.visuals && (
                  <Section title="视觉排版指引" color="#38bdf8">
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                      {Array.isArray(result.visuals.colorPalette) && result.visuals.colorPalette.length > 0 && (
                        <div style={{ flex: "0 0 auto" }}>
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>色卡</p>
                          <div style={{ display: "flex", gap: 6 }}>
                            {result.visuals.colorPalette.map((c: string, i: number) => (
                              <div key={i} title={c} style={{ width: 28, height: 28, borderRadius: 6, background: c, border: "1px solid rgba(255,255,255,0.15)" }} />
                            ))}
                          </div>
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 200 }}>
                        {result.visuals.typography && <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", margin: "0 0 6px" }}>字体风格：{result.visuals.typography}</p>}
                        {result.visuals.layoutGuide && <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", margin: 0 }}>构图建议：{result.visuals.layoutGuide}</p>}
                      </div>
                    </div>
                  </Section>
                )}

                {/* 发布策略 */}
                {result.publishStrategy && (
                  <Section title="发布节奏策略" color="#fbbf24">
                    <p style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", lineHeight: 1.8, margin: 0 }}>
                      {typeof result.publishStrategy === "string" ? result.publishStrategy : JSON.stringify(result.publishStrategy, null, 2)}
                    </p>
                  </Section>
                )}

                {/* 30天路径 */}
                {result.growthPlan30Days && (
                  <Section title="30天增长路径" color="#f97316">
                    <p style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", lineHeight: 1.8, margin: 0, whiteSpace: "pre-wrap" }}>
                      {typeof result.growthPlan30Days === "string" ? result.growthPlan30Days : JSON.stringify(result.growthPlan30Days, null, 2)}
                    </p>
                  </Section>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  );
}

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 14 }}>
      <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", color, textTransform: "uppercase", marginBottom: 10 }}>{title}</p>
      {children}
    </div>
  );
}
