import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Loader2, ChevronLeft, Rocket, Search, BookOpen, AlertCircle, Bug, ImagePlus, ZoomIn, ExternalLink, Music, Video, Mic, MicOff, Download, FileDown } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { getMusicClipsFromJobPayload, clipToGeneratedSong, songDownloadUrlCandidates, downloadGeneratedMusicToFile } from "@/lib/growthMusic";

const VIDEO_FIRST_USE_KEY = "mvs-video-first-used";

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
  const [isPdfBusy, setIsPdfBusy] = useState(false);

  const pdfMutation = trpc.mvAnalysis.downloadAnalysisPdf.useMutation({
    onSuccess: (res) => {
      setIsPdfBusy(false);
      if (!res.pdfBase64) { toast.error("PDF 内容为空，请重试"); return; }
      const bytes = Uint8Array.from(atob(res.pdfBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const label = PLATFORMS.find((p) => p.value === platform)?.label || platform;
      a.download = `竞品调研报告_${label}_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success("PDF 已开始下载");
    },
    onError: (err) => {
      setIsPdfBusy(false);
      toast.error(`PDF 生成失败：${err.message}`);
    },
  });
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    setIsSupervisor(localStorage.getItem(SUPERVISOR_KEY) === "1");
  }, []);

  const toggleVoice = useCallback(async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("当前浏览器不支持录音，请使用 Chrome 或 Safari");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (!blob.size) { toast.error("录音内容为空，请重试"); return; }
        setIsTranscribing(true);
        try {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          const r = await fetchJsonish("/api/google?op=transcribeAudio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64: base64, mimeType: mimeType.split(";")[0] }),
          });
          const text = String(r?.json?.text || "").trim();
          if (text) {
            setContent((prev) => prev + (prev ? " " : "") + text);
            toast.success("转录成功");
          } else {
            toast.error("转录结果为空，请重试");
          }
        } catch (e: any) {
          toast.error(`转录失败：${e?.message}`);
        } finally {
          setIsTranscribing(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (e: any) {
      toast.error(`录音失败：${e?.message}`);
    }
  }, [isRecording]);

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

  const handleDownloadPdf = useCallback(() => {
    if (!result) return;
    setIsPdfBusy(true);
    const label = PLATFORMS.find((p) => p.value === platform)?.label || platform;
    const date = new Date().toLocaleDateString("zh-TW", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });

    const esc = (s: string) => String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

    const scenesHtml = Array.isArray(result.scenes)
      ? result.scenes.map((sc: any) => `
        <div style="margin-bottom:24px;padding:16px;background:#1a1008;border:1px solid #c87a00;border-radius:10px;">
          <h3 style="color:#f5a800;margin:0 0 10px">🎬 镜头 ${sc.sceneNumber}</h3>
          <p style="color:#e8d5b0;line-height:1.8;margin:0 0 10px">${esc(sc.copywriting)}</p>
          ${sc.visualPrompt ? `<p style="font-size:12px;color:#7eb8d4;font-family:monospace;margin:0 0 6px"><b>🎨 生图提示词：</b>${esc(sc.visualPrompt)}</p>` : ""}
          ${sc.audioPrompt ? `<p style="font-size:12px;color:#f97316;margin:0 0 6px"><b>🗣️ 口播台词&拟音（Veo）：</b>${esc(sc.audioPrompt)}</p>` : ""}
          ${sc.bgmPrompt ? `<p style="font-size:12px;color:#e8c87a;margin:0"><b>🎵 BGM战略（Suno）：</b>${esc(sc.bgmPrompt)}</p>` : ""}
        </div>`).join("") : "";

    const scriptsHtml = !Array.isArray(result.scenes) && Array.isArray(result.scripts)
      ? result.scripts.map((s: any, i: number) => `
        <div style="margin-bottom:16px;padding:14px;background:#1a1008;border-left:3px solid #34d399;border-radius:8px;">
          <p style="color:#34d399;font-weight:700;margin:0 0 6px">#${i + 1} ${esc(s.title)}</p>
          ${s.hook ? `<p style="color:#aaa;font-size:13px;margin:0 0 4px">🎣 ${esc(s.hook)}</p>` : ""}
          ${s.copywriting ? `<p style="color:#aaa;font-size:13px;margin:0">${esc(s.copywriting)}</p>` : ""}
        </div>`).join("") : "";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <style>
        body{font-family:'Helvetica Neue',Arial,sans-serif;background:#120800;color:#f0e0c0;margin:0;padding:32px;line-height:1.7}
        h1{color:#f5a800;font-size:24px;margin:0 0 4px}
        h2{color:#c87a00;font-size:16px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;border-left:4px solid #c87a00;padding-left:12px;margin:28px 0 14px}
        .meta{font-size:13px;color:#9a7a50;margin-bottom:28px}
        .strategy{background:#1a1008;border:1px solid #3a2010;border-radius:10px;padding:16px;margin-bottom:24px;color:#e8d5b0;font-size:14px}
        .text-block{font-size:13px;color:#d4b896;white-space:pre-wrap;line-height:1.8}
        .color-dot{display:inline-block;width:18px;height:18px;border-radius:4px;margin-right:6px;vertical-align:middle}
      </style>
    </head><body>
      <h1>竞品与对标分析报告</h1>
      <div class="meta">平台：${label} &nbsp;|&nbsp; 生成日期：${date}</div>

      ${result.overallStrategy || result.positioning ? `
        <h2>战略洞察</h2>
        <div class="strategy">${esc(result.overallStrategy || result.positioning)}</div>` : ""}

      ${scenesHtml ? `<h2>智能分镜与制片台</h2>${scenesHtml}` : ""}
      ${scriptsHtml ? `<h2>内容执行脚本</h2>${scriptsHtml}` : ""}

      ${result.visuals ? `
        <h2>视觉排版指引</h2>
        <div class="strategy">
          ${Array.isArray(result.visuals.colorPalette) ? result.visuals.colorPalette.map((c: string) =>
            `<span class="color-dot" style="background:${esc(c)}"></span><code>${esc(c)}</code> `).join("") : ""}
          ${result.visuals.typography ? `<p><b>字体风格：</b>${esc(result.visuals.typography)}</p>` : ""}
          ${result.visuals.layoutGuide ? `<p><b>构图建议：</b>${esc(result.visuals.layoutGuide)}</p>` : ""}
        </div>` : ""}

      ${result.publishStrategy ? `
        <h2>发布节奏策略</h2>
        <div class="strategy text-block">${esc(typeof result.publishStrategy === "string" ? result.publishStrategy : JSON.stringify(result.publishStrategy, null, 2))}</div>` : ""}

      ${result.growthPlan30Days ? `
        <h2>30天增长路径</h2>
        <div class="strategy text-block">${esc(typeof result.growthPlan30Days === "string" ? result.growthPlan30Days : JSON.stringify(result.growthPlan30Days, null, 2))}</div>` : ""}

      <div style="margin-top:40px;padding-top:16px;border-top:1px solid #3a2010;font-size:11px;color:#6a4a30">
        由 MV Studio Pro 竞品与对标分析生成 · ${date}
      </div>
    </body></html>`;

    pdfMutation.mutate({ html });
  }, [result, platform, pdfMutation]);

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
      // 琥珀暗金底：极深棕黑 + 暗琥珀渐变
      background: "linear-gradient(145deg, #0E0700 0%, #160B00 25%, #1E1000 50%, #160900 75%, #0C0600 100%)",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* ── 流光琥珀浮动光晕 ── */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        {/* 主光弧 — 左上，亮琥珀金 */}
        <div style={{ position: "absolute", top: "-10%", left: "-8%", width: 700, height: 700, borderRadius: "50%", background: "radial-gradient(circle, rgba(200,120,0,0.22) 0%, rgba(160,80,0,0.10) 40%, transparent 70%)", filter: "blur(55px)", animation: "cappuccino-float-a 14s ease-in-out infinite" }} />
        {/* 次光弧 — 右下，深琥珀 */}
        <div style={{ position: "absolute", bottom: "-5%", right: "-5%", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(180,90,0,0.18) 0%, rgba(130,60,0,0.08) 45%, transparent 70%)", filter: "blur(65px)", animation: "cappuccino-float-b 20s ease-in-out infinite" }} />
        {/* 高光核心 — 中偏右，最亮 */}
        <div style={{ position: "absolute", top: "30%", left: "50%", width: 450, height: 450, borderRadius: "50%", background: "radial-gradient(circle, rgba(220,140,10,0.20) 0%, rgba(180,100,0,0.08) 45%, transparent 68%)", filter: "blur(50px)", animation: "cappuccino-float-c 17s ease-in-out infinite" }} />
        {/* 边缘流光 — 右上 */}
        <div style={{ position: "absolute", top: "10%", right: "5%", width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle, rgba(240,160,20,0.15) 0%, transparent 65%)", filter: "blur(45px)", animation: "cappuccino-float-d 13s ease-in-out infinite" }} />
        {/* 底部暗焰 */}
        <div style={{ position: "absolute", bottom: "5%", left: "20%", width: 400, height: 200, borderRadius: "50%", background: "radial-gradient(ellipse, rgba(160,70,0,0.12) 0%, transparent 70%)", filter: "blur(60px)", animation: "cappuccino-float-a 25s ease-in-out infinite reverse" }} />
        {/* 流光线条效果：对角线亮带 */}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, transparent 20%, rgba(200,120,5,0.04) 40%, rgba(230,150,10,0.07) 50%, rgba(200,120,5,0.04) 60%, transparent 80%)", animation: "cappuccino-float-c 30s linear infinite" }} />
      </div>

      {/* ── 生成中：流光强化动画 ── */}
      {isGenerating && (
        <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 1 }}>
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(120deg, transparent 0%, rgba(220,140,10,0.09) 30%, rgba(255,180,30,0.12) 50%, rgba(210,130,0,0.09) 70%, transparent 100%)", animation: "morandi-flow 2.8s ease-in-out infinite", backgroundSize: "200% 200%" }} />
          <div style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 160px rgba(180,100,0,0.18)", animation: "morandi-breathe 2.2s ease-in-out infinite" }} />
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent, rgba(200,120,5,0.5), rgba(255,180,30,1.0), rgba(200,120,5,0.5), transparent)", animation: "morandi-slide 1.8s ease-in-out infinite" }} />
        </div>
      )}

      {/* 顶部导航 */}
      <div style={{ borderBottom: "1px solid rgba(200,120,5,0.20)", background: "rgba(10,6,0,0.92)", backdropFilter: "blur(14px)", padding: "14px 24px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 50 }}>
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
        <div style={{ background: isGenerating ? "rgba(200,120,5,0.08)" : "rgba(200,120,5,0.04)", border: `1px solid ${isGenerating ? "rgba(230,150,10,0.35)" : "rgba(200,120,5,0.18)"}`, borderRadius: 16, padding: "24px", marginBottom: 24, transition: "background 0.8s ease, border-color 0.8s ease" }}>
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, gap: 8 }}>
            <span style={{ fontSize: 12, color: overLimit ? "#ef4444" : "rgba(255,255,255,0.3)", flexShrink: 0 }}>
              {overLimit && <AlertCircle size={12} style={{ display: "inline", marginRight: 4 }} />}
              {content.length} / {MAX_CHARS} 字
            </span>

            {/* 语音输入按钮（Gemini 转录） */}
            <button
              onClick={toggleVoice}
              disabled={isTranscribing}
              title={isRecording ? "点击停止录音" : isTranscribing ? "转录中…" : "点击开始录音（Gemini 转录）"}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, flexShrink: 0,
                background: isRecording ? "rgba(239,68,68,0.15)" : isTranscribing ? "rgba(251,191,36,0.10)" : "rgba(255,255,255,0.05)",
                border: isRecording ? "1px solid rgba(239,68,68,0.5)" : isTranscribing ? "1px solid rgba(251,191,36,0.4)" : "1px solid rgba(255,255,255,0.1)",
                color: isRecording ? "#ef4444" : isTranscribing ? "#fbbf24" : "rgba(255,255,255,0.4)",
                fontSize: 12, fontWeight: 700, cursor: isTranscribing ? "not-allowed" : "pointer", transition: "all 0.2s",
                animation: isRecording ? "morandi-breathe 1.2s ease-in-out infinite" : "none",
              }}
            >
              {isRecording ? <MicOff size={14} /> : isTranscribing ? <Loader2 size={14} className="animate-spin" /> : <Mic size={14} />}
              {isTranscribing ? "转录中…" : isRecording ? "停止录音" : "语音输入"}
            </button>

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
            {/* PDF 下载栏 */}
            <div data-pdf-exclude="true" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
              <button
                onClick={handleDownloadPdf}
                disabled={isPdfBusy}
                style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 18px", borderRadius: 10, background: isPdfBusy ? "rgba(200,120,5,0.06)" : "linear-gradient(135deg,rgba(200,120,5,0.22),rgba(160,80,0,0.18))", border: "1px solid rgba(200,120,5,0.35)", color: isPdfBusy ? "rgba(200,120,5,0.4)" : "#f5a800", fontSize: 13, fontWeight: 700, cursor: isPdfBusy ? "not-allowed" : "pointer", transition: "all 0.2s" }}
              >
                {isPdfBusy ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
                {isPdfBusy ? "生成 PDF 中…" : "下载完整报告 PDF"}
              </button>
            </div>

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
        /* 卡布奇诺浮动光晕 — 各自独立节奏，产生层叠漂浮感 */
        @keyframes cappuccino-float-a {
          0%,100% { transform: translate(0px, 0px) scale(1); opacity: 0.85; }
          25%     { transform: translate(28px, -36px) scale(1.06); opacity: 1; }
          50%     { transform: translate(-20px, -60px) scale(0.96); opacity: 0.75; }
          75%     { transform: translate(-40px, -20px) scale(1.03); opacity: 0.95; }
        }
        @keyframes cappuccino-float-b {
          0%,100% { transform: translate(0px, 0px) scale(1); opacity: 0.8; }
          30%     { transform: translate(-36px, 28px) scale(1.08); opacity: 1; }
          60%     { transform: translate(24px, 50px) scale(0.94); opacity: 0.7; }
          80%     { transform: translate(40px, 10px) scale(1.04); opacity: 0.9; }
        }
        @keyframes cappuccino-float-c {
          0%,100% { transform: translate(0px, 0px) scale(1); opacity: 0.6; }
          40%     { transform: translate(50px, -30px) scale(1.1); opacity: 0.9; }
          70%     { transform: translate(-30px, 40px) scale(0.92); opacity: 0.65; }
        }
        @keyframes cappuccino-float-d {
          0%,100% { transform: translate(0px, 0px) scale(1); opacity: 0.7; }
          35%     { transform: translate(-24px, 40px) scale(1.07); opacity: 1; }
          65%     { transform: translate(30px, -20px) scale(0.95); opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}

// ── 多场景分镜制片台：文案 + 口播拟音（Veo）+ BGM战略（Suno）+ 参考图 + 视频 ──
function SceneVideoCard({ scene, index, platform }: {
  scene: { sceneNumber: number; copywriting: string; visualPrompt: string; audioPrompt: string; bgmPrompt?: string };
  index: number;
  platform: string;
}) {
  const [audioPrompt, setAudioPrompt] = useState(scene.audioPrompt || "");
  const [bgmPrompt, setBgmPrompt] = useState(scene.bgmPrompt || "");
  const [visualPrompt, setVisualPrompt] = useState(scene.visualPrompt || `${platform} platform viral content cover, vertical 9:16, high contrast, professional blogger style`);
  const [genBusy, setGenBusy] = useState(false);
  const [upscaleBusy, setUpscaleBusy] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [bgmBusy, setBgmBusy] = useState(false);
  const [bgmProgress, setBgmProgress] = useState("");
  const [bgmSong, setBgmSong] = useState<{ title: string; audioUrl?: string; streamUrl?: string } | null>(null);
  const bgmRunRef = useRef(0);
  const [origUrl, setOrigUrl] = useState("");
  const [hdUrl, setHdUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");

  const effectiveVisualPrompt = visualPrompt.trim() || `${platform} platform viral content cover, vertical 9:16, high contrast, professional blogger style`;

  async function generateImage() {
    setGenBusy(true);
    setOrigUrl("");
    setHdUrl("");
    try {
      const r = await fetchJsonish("/api/google?op=nanoImage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: effectiveVisualPrompt, tier: "pro", aspectRatio: "9:16", numberOfImages: 1 }),
      });
      const url = String(r?.json?.imageUrl || r?.json?.imageUrls?.[0] || "").trim();
      if (!url || !r.ok) throw new Error(r?.json?.error || r?.json?.raw?.error?.message || "生成失败");
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

  async function generateBgm() {
    const sunoPrompt = bgmPrompt.trim() || audioPrompt.trim();
    if (!sunoPrompt) { toast.error("请先填写 BGM 战略指令"); return; }
    bgmRunRef.current += 1;
    const runId = bgmRunRef.current;
    setBgmBusy(true);
    setBgmSong(null);
    setBgmProgress("提交音乐任务…");
    try {
      const create = await fetchJsonish("/api/jobs?op=aimusicSunoCreate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_type: "create_music", custom_mode: false, mv: "sonic-v5-5", gpt_description_prompt: sunoPrompt }),
      });
      const taskId = String(
        create?.json?.raw?.task_id || create?.json?.raw?.data?.task_id ||
        create?.json?.json?.raw?.task_id || create?.json?.json?.raw?.data?.task_id || ""
      );
      if (!create.ok || !taskId) throw new Error(create?.json?.error || "音乐任务提交失败");

      const MSGS = ["节拍引擎启动中…", "旋律正在生成…", "和弦编排中…", "混音渲染中…", "BGM 即将就绪…"];
      let attempts = 0;
      const startedAt = Date.now();

      while (bgmRunRef.current === runId) {
        if (Date.now() - startedAt > 8 * 60 * 1000) throw new Error("BGM 生成超时，请重试");
        await new Promise((r) => setTimeout(r, 4000));
        if (bgmRunRef.current !== runId) break;

        const poll = await fetchJsonish(`/api/jobs?op=aimusicSunoTask&taskId=${encodeURIComponent(taskId)}`);
        attempts++;
        setBgmProgress(MSGS[Math.floor(attempts / 2) % MSGS.length]);

        const clips = getMusicClipsFromJobPayload(poll.json);
        const playable = clips.find((c: any) => c?.audio_url || c?.audioUrl || c?.download_url || c?.stream_url);
        if (playable) {
          const song = clipToGeneratedSong(playable, 0);
          setBgmSong(song);
          setBgmBusy(false);
          toast.success("BGM 生成成功！");
          return;
        }
      }
    } catch (e: any) {
      if (bgmRunRef.current === runId) {
        toast.error(`BGM 生成失败：${e?.message}`);
        setBgmBusy(false);
        setBgmProgress("");
      }
    }
  }

  async function generateVideo() {
    const imageToUse = hdUrl || origUrl;
    if (!imageToUse) { toast.error("请先生成参考图，再生成视频"); return; }
    const isFirst = !localStorage.getItem(VIDEO_FIRST_USE_KEY);
    const cost = isFirst ? 80 : 99;
    if (!window.confirm(`生成镜头 ${index + 1} 的视频将扣除 ${cost} 点${isFirst ? "（首次体验优惠价）" : ""}，确定继续？`)) return;
    setVideoBusy(true);
    setVideoUrl("");
    try {
      // Step 1: 中文音效/台词 → Veo 原生英文指令（Gemini Flash 翻译中间件）
      let veoAudio = audioPrompt.trim();
      if (veoAudio) {
        try {
          const tr = await fetchJsonish("/api/google?op=translateForVeo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: veoAudio }),
          });
          if (tr?.json?.translated) {
            veoAudio = tr.json.translated;
            console.log("[Veo] 翻译完成:", veoAudio.slice(0, 100));
          }
        } catch (tErr) {
          console.warn("[Veo] 翻译中间件调用失败，降级使用原始文本:", tErr);
        }
      }

      // Step 2: 构造「视听对位」Veo 指令（口播对口型 + 拟音SFX，严格无BGM）
      const veoPrompt = veoAudio
        ? `Animate this reference image into a professional cinematic short video.

VISUAL: The main character MUST have perfect lip-sync. Their mouth, jaw, and facial muscles must move naturally and precisely in synchronization with every spoken syllable.

AUDIO DIRECTION (character voice & sound effects ONLY — strictly NO background music):
${veoAudio}

TECHNICAL REQUIREMENTS:
1. Achieve Hollywood-grade lip-sync accuracy — every phoneme must match the mouth shape.
2. Include realistic, immersive sound effects that match the scene's physical actions.
3. If animals or cartoon characters are present, add their authentic vocalizations.
4. Maintain stable camera with subtle cinematic motion.
5. ABSOLUTELY NO background music or BGM — only character voice and action SFX.`
        : "Animate this reference image into a cinematic 8-second short video with natural character motion, stable camera, and rich environmental sound effects. No background music.";

      const create = await fetchJsonish("/api/google?op=veoCreate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: veoPrompt,
          imageUrl: imageToUse,
          provider: "pro",
          durationSeconds: 8,
          aspectRatio: "9:16",
          resolution: "720p",
        }),
      });
      const taskId = String(create?.json?.taskId || "").trim();
      if (!create.ok || !taskId) throw new Error(create?.json?.error || "Veo 任务创建失败");

      // Step 2: 轮询结果（2.5s 间隔，最多 120 次 ≈ 5 分钟）
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const poll = await fetchJsonish(`/api/google?op=veoTask&provider=pro&taskId=${encodeURIComponent(taskId)}`);
        const status = String(poll?.json?.status || "");
        const url = String(poll?.json?.videoUrl || "").trim();
        if (url) {
          localStorage.setItem(VIDEO_FIRST_USE_KEY, "1");
          setVideoUrl(url);
          return;
        }
        if (status === "failed") throw new Error("Veo 渲染失败，请重试");
      }
      throw new Error("Veo 生成超时（超过5分钟），请重试");
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

        {/* 画面提示词（可编辑） */}
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, color: "rgba(56,189,248,0.7)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
            🎨 画面生图提示词（可修改）
          </label>
          <textarea
            value={visualPrompt}
            onChange={(e) => setVisualPrompt(e.target.value)}
            rows={3}
            style={{
              width: "100%", padding: "10px 14px", borderRadius: 10, fontSize: 12,
              background: "rgba(0,0,0,0.25)", border: "1px solid rgba(56,189,248,0.18)",
              color: "rgba(255,255,255,0.75)", outline: "none", boxSizing: "border-box",
              fontFamily: "monospace", lineHeight: 1.6, resize: "vertical",
              transition: "border-color 0.2s",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(56,189,248,0.45)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(56,189,248,0.18)"; }}
          />
        </div>

        {/* 口播台词 + 动作拟音（传给 Veo，可编辑） */}
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, color: "rgba(249,115,22,0.8)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
            <Music size={11} />
            🗣️ 口播台词 & 动作拟音（Veo 对口型 · 可修改）
          </label>
          <textarea
            rows={3}
            value={audioPrompt}
            onChange={(e) => setAudioPrompt(e.target.value)}
            placeholder="角色说的具体台词 + 动作音效描述，传入 Veo 实现精准对口型…"
            style={{
              width: "100%", padding: "10px 14px", borderRadius: 10, fontSize: 13,
              background: "rgba(0,0,0,0.3)", border: "1px solid rgba(249,115,22,0.22)",
              color: "#fff", outline: "none", boxSizing: "border-box", fontFamily: "inherit",
              lineHeight: 1.6, resize: "vertical", transition: "border-color 0.2s",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(249,115,22,0.55)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(249,115,22,0.22)"; }}
          />
          <p style={{ fontSize: 10, color: "rgba(249,115,22,0.45)", margin: "4px 0 0", fontStyle: "italic" }}>
            ⚡ 此指令直接传入 Veo · 严格无BGM · 仅角色人声 + 动作音效
          </p>
        </div>

        {/* BGM 背景音乐战略（预留给 Suno，不传给 Veo） */}
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, color: "rgba(251,191,36,0.7)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
            <Music size={11} />
            🎵 背景音乐战略（预留给 Suno · 可修改）
          </label>
          <input
            type="text"
            value={bgmPrompt}
            onChange={(e) => setBgmPrompt(e.target.value)}
            placeholder="BPM、曲风、情绪、乐器组合…（例：BPM 118，治愈钢琴+电子合成器）"
            style={{
              width: "100%", padding: "10px 14px", borderRadius: 10, fontSize: 13,
              background: "rgba(0,0,0,0.3)", border: "1px solid rgba(251,191,36,0.2)",
              color: "#fff", outline: "none", boxSizing: "border-box", fontFamily: "inherit",
              transition: "border-color 0.2s",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(251,191,36,0.5)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(251,191,36,0.2)"; }}
          />
          <p style={{ fontSize: 10, color: "rgba(251,191,36,0.4)", margin: "4px 0 0", fontStyle: "italic" }}>
            🎼 此战略仅供 Suno BGM 生成使用，不影响 Veo 视频渲染
          </p>
        </div>

        {/* BGM 生成区 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={generateBgm}
              disabled={bgmBusy || !audioPrompt.trim()}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: bgmBusy ? "rgba(251,191,36,0.05)" : "linear-gradient(135deg, rgba(251,191,36,0.2), rgba(234,179,8,0.15))", border: "1px solid rgba(251,191,36,0.35)", color: bgmBusy || !audioPrompt.trim() ? "rgba(251,191,36,0.35)" : "#fbbf24", fontSize: 12, fontWeight: 700, cursor: bgmBusy || !audioPrompt.trim() ? "not-allowed" : "pointer", transition: "all 0.2s" }}
            >
              {bgmBusy ? <Loader2 size={12} className="animate-spin" /> : <Music size={12} />}
              {bgmBusy ? bgmProgress : "生成 BGM"}
            </button>
            {bgmSong && (
              <button
                onClick={async () => {
                  const urls = songDownloadUrlCandidates(bgmSong);
                  const r = await downloadGeneratedMusicToFile(urls, bgmSong.title);
                  if (!r.ok) toast.error(r.message);
                }}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", borderRadius: 8, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)", color: "rgba(251,191,36,0.7)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                <Download size={11} />下载 MP3
              </button>
            )}
          </div>

          {/* BGM 播放器 */}
          {bgmSong?.audioUrl && (
            <div style={{ background: "rgba(251,191,36,0.05)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 10, padding: "10px 14px", animation: "fadeIn 0.3s ease" }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(251,191,36,0.6)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>🎵 {bgmSong.title}</p>
              <audio
                src={bgmSong.audioUrl}
                controls
                style={{ width: "100%", height: 36, borderRadius: 6, accentColor: "#fbbf24" }}
              />
            </div>
          )}
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

          <VideoButton videoBusy={videoBusy} hasImage={!!(hdUrl || origUrl)} onGenerate={generateVideo} />
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

// ── 视频生成按钮（动态显示首次/后续积分） ───────────────────────────
function VideoButton({ videoBusy, hasImage, onGenerate }: { videoBusy: boolean; hasImage: boolean; onGenerate: () => void }) {
  const [isFirst, setIsFirst] = useState(!localStorage.getItem(VIDEO_FIRST_USE_KEY));
  useEffect(() => {
    setIsFirst(!localStorage.getItem(VIDEO_FIRST_USE_KEY));
  }, [videoBusy]);
  const cost = isFirst ? 80 : 99;
  const disabled = videoBusy || !hasImage;
  return (
    <button
      onClick={onGenerate}
      disabled={disabled}
      title={!hasImage ? "请先生成参考图" : undefined}
      style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: disabled ? "rgba(249,115,22,0.04)" : "linear-gradient(135deg, rgba(249,115,22,0.25), rgba(234,88,12,0.2))", border: "1px solid rgba(249,115,22,0.25)", color: disabled ? "rgba(249,115,22,0.3)" : "#fb923c", fontSize: 12, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", marginLeft: "auto", position: "relative" }}
    >
      {videoBusy ? <Loader2 size={12} className="animate-spin" /> : <Video size={12} />}
      {videoBusy ? "Veo 3.1 渲染中…" : !hasImage ? "生成视频（先生成参考图）" : `生成此镜视频（${cost}点）`}
      {isFirst && !disabled && (
        <span style={{ position: "absolute", top: -8, right: -4, fontSize: 9, fontWeight: 900, background: "#ef4444", color: "#fff", borderRadius: 99, padding: "1px 5px", letterSpacing: 0 }}>首次优惠</span>
      )}
    </button>
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
    "高对比度，强情绪感，专业博主风格，无文本",
  ].filter(Boolean).join("，");

  async function generate() {
    setGenBusy(true);
    setOrigUrl("");
    setHdUrl("");
    try {
      const r = await fetchJsonish("/api/google?op=nanoImage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: imagePrompt, tier: "pro", aspectRatio: "9:16", numberOfImages: 1 }),
      });
      const url = String(r?.json?.imageUrl || r?.json?.imageUrls?.[0] || "").trim();
      if (!url || !r.ok) throw new Error(r?.json?.error || r?.json?.raw?.error?.message || "生成失败");
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
