import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2, ChevronLeft, Rocket, Search, BookOpen, AlertCircle, Bug, ImagePlus, ZoomIn, ExternalLink, Music, Video } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

async function fetchJsonish(url: string, opts?: RequestInit) {
  try {
    const res = await fetch(url, opts);
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  } catch (e: any) {
    return { ok: false, status: 0, json: { error: e?.message } };
  }
}

const SUPERVISOR_KEY = "mvs-supervisor-access";

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
  const [rawResponse, setRawResponse] = useState<any>(null);
  const [isSupervisor, setIsSupervisor] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    setIsSupervisor(localStorage.getItem(SUPERVISOR_KEY) === "1");
  }, []);

  const mutation = trpc.competitorResearch.run.useMutation({
    onSuccess: (data) => {
      setResult(data.strategy);
      setRawResponse(data);
      toast.success(`调研完成，消耗 ${data.creditsUsed} 点`);
    },
    onError: (err) => {
      setRawResponse({ error: err.message, code: err.data?.code });
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

  const isGenerating = mutation.isPending;

  return (
    <div style={{
      minHeight: "100vh",
      fontFamily: "'Inter', sans-serif",
      // 莫兰迪底色：深邃的灰蓝绿暗调
      background: "linear-gradient(160deg, #1a1f25 0%, #1c2128 40%, #1e1d22 70%, #1a1c1e 100%)",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* 莫兰迪装饰光晕（静态） */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{ position: "absolute", top: "10%", left: "5%", width: 480, height: 480, borderRadius: "50%", background: "radial-gradient(circle, rgba(131,148,150,0.07) 0%, transparent 70%)", filter: "blur(60px)" }} />
        <div style={{ position: "absolute", bottom: "15%", right: "8%", width: 360, height: 360, borderRadius: "50%", background: "radial-gradient(circle, rgba(180,163,150,0.06) 0%, transparent 70%)", filter: "blur(50px)" }} />
        <div style={{ position: "absolute", top: "50%", left: "55%", width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(150,160,148,0.05) 0%, transparent 70%)", filter: "blur(70px)" }} />
      </div>

      {/* 生成中：莫兰迪渐变流动动画 */}
      {isGenerating && (
        <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 1 }}>
          {/* 主流动光波 */}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(120deg, rgba(131,148,150,0.0) 0%, rgba(131,148,150,0.08) 30%, rgba(163,150,140,0.10) 50%, rgba(148,163,150,0.08) 70%, rgba(131,148,150,0.0) 100%)", animation: "morandi-flow 3s ease-in-out infinite", backgroundSize: "200% 200%" }} />
          {/* 边框呼吸光 */}
          <div style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 120px rgba(131,148,150,0.12)", animation: "morandi-breathe 2.4s ease-in-out infinite" }} />
          {/* 顶部进度条 */}
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent, rgba(131,148,150,0.6), rgba(180,163,150,0.8), rgba(148,163,150,0.6), transparent)", animation: "morandi-slide 2s ease-in-out infinite" }} />
        </div>
      )}

      {/* 顶部导航 */}
      <div style={{ borderBottom: "1px solid rgba(131,148,150,0.12)", background: "rgba(26,31,37,0.96)", backdropFilter: "blur(12px)", padding: "14px 24px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 50 }}>
        <button onClick={() => navigate("/")} style={{ color: "rgba(255,255,255,0.45)", cursor: "pointer", background: "none", border: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
          <ChevronLeft size={16} />首页
        </button>
        <span style={{ color: "rgba(255,255,255,0.15)" }}>/</span>
        <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, fontWeight: 600 }}>竞品与对标分析</span>
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "#f97316", background: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.3)", borderRadius: 99, padding: "3px 10px" }}>
          20点/次
        </span>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px 80px", position: "relative", zIndex: 2 }}>
        {/* 页面标题 */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "linear-gradient(135deg,#f97316,#fb923c)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Search size={20} color="#fff" />
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#fff", margin: 0 }}>竞品与对标分析</h1>
          </div>
          <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 14, margin: 0 }}>
            双引擎驱动 · 底层流量扫描 + 战略处方生成 · 30秒内输出降维打击方案
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
        <div style={{ background: isGenerating ? "rgba(131,148,150,0.06)" : "rgba(255,255,255,0.03)", border: `1px solid ${isGenerating ? "rgba(131,148,150,0.25)" : "rgba(255,255,255,0.08)"}`, borderRadius: 16, padding: "24px", marginBottom: 24, transition: "background 0.8s ease, border-color 0.8s ease" }}>
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
          <div style={{ animation: "fadeIn 0.4s ease" }}>
            {result.raw ? (
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(249,115,22,0.2)", borderRadius: 16, padding: "24px" }}>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: "#fb923c", marginBottom: 20 }}>🏆 战略处方</h2>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.7 }}>{result.raw}</pre>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

                {/* 整体战略洞察 */}
                {(result.overallStrategy || result.positioning) && (
                  <div style={{ background: "rgba(167,139,250,0.07)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: 16, padding: "20px 24px" }}>
                    <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", color: "#a78bfa", textTransform: "uppercase", marginBottom: 10 }}>📊 战略洞察</p>
                    <p style={{ fontSize: 14, color: "rgba(255,255,255,0.8)", lineHeight: 1.8, margin: 0 }}>
                      {result.overallStrategy || result.positioning}
                    </p>
                  </div>
                )}

                {/* ── 多场景分镜制片台（新格式 scenes） ── */}
                {Array.isArray(result.scenes) && result.scenes.length > 0 && (
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 800, color: "rgba(255,255,255,0.5)", letterSpacing: "0.08em", marginBottom: 14, textTransform: "uppercase" }}>
                      🎥 智能分镜与制片台 · {result.scenes.length} 个场景
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                      {result.scenes.map((scene: any, i: number) => (
                        <SceneVideoCard key={i} scene={scene} index={i} platform={platform} />
                      ))}
                    </div>
                  </div>
                )}

                {/* 旧格式 scripts（兼容回退） */}
                {!Array.isArray(result.scenes) && Array.isArray(result.scripts) && result.scripts.length > 0 && (
                  <Section title="内容执行脚本" color="#34d399">
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                      {result.scripts.map((s: any, i: number) => (
                        <ScriptImageCard key={i} index={i} script={s} platform={platform} platformLabel={result.platformLabel || platform} />
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

        {/* ── Supervisor Debug 面板（仅 supervisor 可见） ── */}
        {isSupervisor && (
          <div style={{ marginTop: 32 }}>
            <button
              onClick={() => setShowDebug(!showDebug)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, cursor: "pointer", color: "rgba(239,68,68,0.8)", fontSize: 12, fontWeight: 700 }}
            >
              <Bug size={13} />
              DEBUG {showDebug ? "▲ 收起" : "▼ 展开"}
              <span style={{ marginLeft: 4, fontSize: 10, color: "rgba(239,68,68,0.5)", fontWeight: 400 }}>supervisor only</span>
            </button>

            {showDebug && (
              <div style={{ marginTop: 12, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 12, padding: "16px", animation: "fadeIn 0.2s ease" }}>
                <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                  <Stat label="状态" value={mutation.isPending ? "⏳ 请求中" : mutation.isSuccess ? "✅ 成功" : mutation.isError ? "❌ 失败" : "— 待机"} />
                  <Stat label="平台" value={platform} />
                  <Stat label="输入字数" value={`${content.length} / ${MAX_CHARS}`} />
                  <Stat label="输出字段" value={result ? Object.keys(result).join(", ") : "—"} />
                </div>

                <p style={{ fontSize: 11, color: "rgba(239,68,68,0.6)", marginBottom: 6, fontWeight: 700 }}>RAW RESPONSE</p>
                <pre style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 400, overflowY: "auto", margin: 0, lineHeight: 1.6 }}>
                  {rawResponse ? JSON.stringify(rawResponse, null, 2) : "暂无数据，执行一次调研后显示"}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes morandi-flow {
          0%   { background-position: 0% 50%; opacity: 0.6; }
          50%  { background-position: 100% 50%; opacity: 1; }
          100% { background-position: 0% 50%; opacity: 0.6; }
        }
        @keyframes morandi-breathe {
          0%,100% { opacity: 0.5; }
          50%     { opacity: 1; }
        }
        @keyframes morandi-slide {
          0%   { transform: translateX(-100%); opacity: 0; }
          20%  { opacity: 1; }
          80%  { opacity: 1; }
          100% { transform: translateX(100%); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ── 多场景分镜制片台：文案 + 音效提示词（可编辑）+ 生成参考图 + 视频 ──
function SceneVideoCard({ scene, index, platform }: {
  scene: { sceneNumber: number; copywriting: string; visualPrompt: string; audioPrompt: string };
  index: number;
  platform: string;
}) {
  const [audioPrompt, setAudioPrompt] = useState(scene.audioPrompt || "");
  const [genBusy, setGenBusy] = useState(false);
  const [upscaleBusy, setUpscaleBusy] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [origUrl, setOrigUrl] = useState("");
  const [hdUrl, setHdUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");

  const effectiveVisualPrompt = scene.visualPrompt || `${platform} platform viral content cover, vertical 9:16, high contrast, professional blogger style`;

  async function generateImage() {
    setGenBusy(true);
    setOrigUrl("");
    setHdUrl("");
    try {
      const r = await fetchJsonish("/api/trpc/openaiImage.generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: { prompt: effectiveVisualPrompt, model: "gpt-image-2", size: "1024x1536", quality: "high", n: 1 } }),
      });
      const result = r?.json?.result?.data?.json ?? r?.json;
      const url = String(result?.imageUrl || "").trim();
      if (!url) throw new Error(result?.error || "生成失败");
      setOrigUrl(url);
    } catch (e: any) {
      toast.error(`参考图生成失败：${e?.message}`);
    } finally {
      setGenBusy(false);
    }
  }

  async function upscale() {
    if (!origUrl) return;
    setUpscaleBusy(true);
    setHdUrl("");
    try {
      const r = await fetchJsonish("/api/google?op=upscaleImage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: origUrl, upscaleFactor: "x2", prompt: effectiveVisualPrompt, outputMimeType: "image/png" }),
      });
      const url = String(r?.json?.imageUrl || r?.json?.imageUrls?.[0] || "").trim();
      if (!url) throw new Error("高清放大失败");
      setHdUrl(url);
    } catch (e: any) {
      toast.error(`高清放大失败：${e?.message}`);
    } finally {
      setUpscaleBusy(false);
    }
  }

  async function generateVideo() {
    if (!window.confirm(`生成镜头 ${index + 1} 的视频将扣除 100 点，确定继续？`)) return;
    setVideoBusy(true);
    setVideoUrl("");
    try {
      const imageToUse = hdUrl || origUrl;
      const r = await fetchJsonish("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: imageToUse, audioPrompt, platform }),
      });
      if (!r.ok) throw new Error(r.json?.error || "视频生成失败");
      const url = String(r.json?.videoUrl || "").trim();
      if (!url) throw new Error("未获得视频链接");
      setVideoUrl(url);
    } catch (e: any) {
      toast.error(`视频生成失败：${e?.message}`);
    } finally {
      setVideoBusy(false);
    }
  }

  return (
    <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, overflow: "hidden" }}>
      {/* 镜头头部 */}
      <div style={{ padding: "14px 18px 12px", background: "rgba(249,115,22,0.06)", borderBottom: "1px solid rgba(249,115,22,0.12)", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(249,115,22,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 900, color: "#fb923c" }}>{scene.sceneNumber ?? index + 1}</span>
        </div>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#fb923c" }}>镜头 {scene.sceneNumber ?? index + 1}</span>
      </div>

      <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
        {/* 分镜文案 */}
        <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: "12px 14px" }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>📝 分镜文案</p>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", lineHeight: 1.8, margin: 0, whiteSpace: "pre-wrap" }}>{scene.copywriting}</p>
        </div>

        {/* 画面提示词（只读展示） */}
        {scene.visualPrompt && (
          <div style={{ background: "rgba(56,189,248,0.04)", border: "1px solid rgba(56,189,248,0.12)", borderRadius: 10, padding: "10px 14px" }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(56,189,248,0.6)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>🎨 画面生图提示词</p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, margin: 0, fontFamily: "monospace" }}>{scene.visualPrompt}</p>
          </div>
        )}

        {/* 音效提示词（可编辑） */}
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, color: "rgba(251,191,36,0.7)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
            <Music size={11} />
            BGM & 音效指令（可修改）
          </label>
          <input
            type="text"
            value={audioPrompt}
            onChange={(e) => setAudioPrompt(e.target.value)}
            style={{
              width: "100%", padding: "10px 14px", borderRadius: 10, fontSize: 13,
              background: "rgba(0,0,0,0.3)", border: "1px solid rgba(251,191,36,0.2)",
              color: "#fff", outline: "none", boxSizing: "border-box", fontFamily: "inherit",
              transition: "border-color 0.2s",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(251,191,36,0.5)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(251,191,36,0.2)"; }}
          />
        </div>

        {/* 操作按钮行 */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={generateImage}
            disabled={genBusy}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, background: genBusy ? "rgba(52,211,153,0.05)" : "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)", color: genBusy ? "rgba(52,211,153,0.4)" : "#34d399", fontSize: 12, fontWeight: 700, cursor: genBusy ? "not-allowed" : "pointer" }}
          >
            {genBusy ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
            {genBusy ? "生成中…" : "生成参考图"}
          </button>

          {origUrl && (
            <button
              onClick={upscale}
              disabled={upscaleBusy}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, background: upscaleBusy ? "rgba(56,189,248,0.05)" : "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.25)", color: upscaleBusy ? "rgba(56,189,248,0.4)" : "#38bdf8", fontSize: 12, fontWeight: 700, cursor: upscaleBusy ? "not-allowed" : "pointer" }}
            >
              {upscaleBusy ? <Loader2 size={12} className="animate-spin" /> : <ZoomIn size={12} />}
              {upscaleBusy ? "放大中…" : "高清放大 2x"}
            </button>
          )}

          <button
            onClick={generateVideo}
            disabled={videoBusy}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: videoBusy ? "rgba(249,115,22,0.06)" : "linear-gradient(135deg, rgba(249,115,22,0.25), rgba(234,88,12,0.2))", border: "1px solid rgba(249,115,22,0.35)", color: videoBusy ? "rgba(249,115,22,0.4)" : "#fb923c", fontSize: 12, fontWeight: 700, cursor: videoBusy ? "not-allowed" : "pointer", marginLeft: "auto" }}
          >
            {videoBusy ? <Loader2 size={12} className="animate-spin" /> : <Video size={12} />}
            {videoBusy ? "渲染中（约1分钟）…" : "生成此镜视频（100点）"}
          </button>
        </div>

        {/* 图片对比区：原图左 / 高清右 */}
        {origUrl && (
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 6, fontWeight: 700, textTransform: "uppercase" }}>原图</p>
              <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", background: "rgba(0,0,0,0.3)" }}>
                <img src={origUrl} alt={`Scene ${index + 1} ref`} style={{ width: "100%", display: "block", borderRadius: 8 }} />
                <a href={origUrl} target="_blank" rel="noreferrer" style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.6)", borderRadius: 6, padding: "4px 6px", display: "flex", alignItems: "center" }}>
                  <ExternalLink size={11} color="rgba(255,255,255,0.7)" />
                </a>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 10, color: "rgba(56,189,248,0.6)", marginBottom: 6, fontWeight: 700, textTransform: "uppercase" }}>高清放大 2x</p>
              <div style={{ borderRadius: 8, overflow: "hidden", background: "rgba(0,0,0,0.3)", minHeight: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {hdUrl ? (
                  <div style={{ position: "relative", width: "100%" }}>
                    <img src={hdUrl} alt="高清放大" style={{ width: "100%", display: "block", borderRadius: 8 }} />
                    <a href={hdUrl} target="_blank" rel="noreferrer" style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.6)", borderRadius: 6, padding: "4px 6px", display: "flex", alignItems: "center" }}>
                      <ExternalLink size={11} color="rgba(255,255,255,0.7)" />
                    </a>
                  </div>
                ) : upscaleBusy ? (
                  <Loader2 size={20} color="rgba(56,189,248,0.5)" className="animate-spin" />
                ) : (
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", textAlign: "center", padding: 16 }}>点击「高清放大」<br/>在此显示</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 视频展示区 */}
        {videoUrl && (
          <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid rgba(249,115,22,0.3)", background: "#000" }}>
            <video src={videoUrl} controls autoPlay loop style={{ width: "100%", display: "block", aspectRatio: "9/16", objectFit: "cover", maxHeight: 480 }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── 脚本卡片：含生成参考图 + 高清放大 ──────────────────────────────
function ScriptImageCard({ index, script, platform, platformLabel }: {
  index: number;
  script: { title: string; hook?: string; copywriting?: string };
  platform: string;
  platformLabel: string;
}) {
  const [genBusy, setGenBusy] = useState(false);
  const [upscaleBusy, setUpscaleBusy] = useState(false);
  const [origUrl, setOrigUrl] = useState("");
  const [hdUrl, setHdUrl] = useState("");

  const imagePrompt = [
    `${platformLabel}平台爆款内容封面图，竖版9:16`,
    script.title ? `主题：${script.title}` : "",
    script.hook ? `视觉钩子：${script.hook.slice(0, 60)}` : "",
    "高对比度，强情绪感，专业博主风格，无文字",
  ].filter(Boolean).join("，");

  async function generate() {
    setGenBusy(true);
    setOrigUrl("");
    setHdUrl("");
    try {
      const r = await fetchJsonish("/api/trpc/openaiImage.generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: { prompt: imagePrompt, model: "gpt-image-2", size: "1024x1536", quality: "high", n: 1 } }),
      });
      const result = r?.json?.result?.data?.json ?? r?.json;
      const url = String(result?.imageUrl || "").trim();
      if (!url) throw new Error(result?.error || "生成失败");
      setOrigUrl(url);
    } catch (e: any) {
      toast.error(`参考图生成失败：${e?.message}`);
    } finally {
      setGenBusy(false);
    }
  }

  async function upscale() {
    if (!origUrl) return;
    setUpscaleBusy(true);
    setHdUrl("");
    try {
      const r = await fetchJsonish("/api/google?op=upscaleImage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: origUrl, upscaleFactor: "x2", prompt: imagePrompt, outputMimeType: "image/png" }),
      });
      const url = String(r?.json?.imageUrl || r?.json?.imageUrls?.[0] || "").trim();
      if (!url) throw new Error("高清放大失败");
      setHdUrl(url);
    } catch (e: any) {
      toast.error(`高清放大失败：${e?.message}`);
    } finally {
      setUpscaleBusy(false);
    }
  }

  return (
    <div style={{ background: "rgba(52,211,153,0.05)", border: "1px solid rgba(52,211,153,0.15)", borderRadius: 12, padding: "14px 16px" }}>
      {/* 文案内容 */}
      <p style={{ fontWeight: 700, color: "#34d399", fontSize: 13, margin: "0 0 6px" }}>#{index + 1} {script.title}</p>
      {script.hook && <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, margin: "0 0 4px" }}>🎣 钩子：{script.hook}</p>}
      {script.copywriting && <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, margin: "0 0 12px" }}>✍️ 文案：{script.copywriting}</p>}

      {/* 操作按钮行 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: origUrl ? 14 : 0 }}>
        <button
          onClick={generate}
          disabled={genBusy}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, background: genBusy ? "rgba(52,211,153,0.05)" : "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.3)", color: genBusy ? "rgba(52,211,153,0.4)" : "#34d399", fontSize: 12, fontWeight: 700, cursor: genBusy ? "not-allowed" : "pointer" }}
        >
          {genBusy ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
          {genBusy ? "生成中…" : "生成参考图"}
        </button>

        {origUrl && (
          <button
            onClick={upscale}
            disabled={upscaleBusy}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, background: upscaleBusy ? "rgba(56,189,248,0.05)" : "rgba(56,189,248,0.10)", border: "1px solid rgba(56,189,248,0.25)", color: upscaleBusy ? "rgba(56,189,248,0.4)" : "#38bdf8", fontSize: 12, fontWeight: 700, cursor: upscaleBusy ? "not-allowed" : "pointer" }}
          >
            {upscaleBusy ? <Loader2 size={12} className="animate-spin" /> : <ZoomIn size={12} />}
            {upscaleBusy ? "放大中…" : "高清放大 2x"}
          </button>
        )}
      </div>

      {/* 图片对比区：原图左 / 高清右 */}
      {origUrl && (
        <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
          {/* 原图 */}
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 6, fontWeight: 700, textTransform: "uppercase" }}>原图</p>
            <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", background: "rgba(0,0,0,0.3)" }}>
              <img src={origUrl} alt="参考图" style={{ width: "100%", display: "block", borderRadius: 8 }} />
              <a href={origUrl} target="_blank" rel="noreferrer" style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.6)", borderRadius: 6, padding: "4px 6px", display: "flex", alignItems: "center" }}>
                <ExternalLink size={11} color="rgba(255,255,255,0.7)" />
              </a>
            </div>
          </div>

          {/* 高清放大 */}
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 10, color: "rgba(56,189,248,0.6)", marginBottom: 6, fontWeight: 700, textTransform: "uppercase" }}>高清放大 2x</p>
            <div style={{ borderRadius: 8, overflow: "hidden", background: "rgba(0,0,0,0.3)", minHeight: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {hdUrl ? (
                <div style={{ position: "relative", width: "100%" }}>
                  <img src={hdUrl} alt="高清放大" style={{ width: "100%", display: "block", borderRadius: 8 }} />
                  <a href={hdUrl} target="_blank" rel="noreferrer" style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.6)", borderRadius: 6, padding: "4px 6px", display: "flex", alignItems: "center" }}>
                    <ExternalLink size={11} color="rgba(255,255,255,0.7)" />
                  </a>
                </div>
              ) : upscaleBusy ? (
                <Loader2 size={20} color="rgba(56,189,248,0.5)" className="animate-spin" />
              ) : (
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", textAlign: "center", padding: 16 }}>点击「高清放大」<br/>在此显示</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 8, padding: "6px 12px" }}>
      <p style={{ fontSize: 10, color: "rgba(239,68,68,0.5)", margin: "0 0 2px", fontWeight: 700, textTransform: "uppercase" }}>{label}</p>
      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", margin: 0, fontFamily: "monospace" }}>{value}</p>
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
