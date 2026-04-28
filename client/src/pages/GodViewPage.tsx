import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, Loader2, Crown, Sparkles, RotateCcw, Mic, MicOff, Bug } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const SUPERVISOR_KEY = "mvs-supervisor-access";

// ── 定價配置（與後端 billingService.ts 保持同步）──────────────────────────────
type ProductType = "deep_report" | "magazine_single" | "magazine_sub" | "personalized";

const PRODUCT_FIRST_KEYS: Record<ProductType, string> = {
  deep_report:     "mvs-godview-first-used",
  magazine_single: "mvs-magazine-first-used",
  magazine_sub:    "mvs-magsub-first-used",
  personalized:    "mvs-personalized-first-used",
};

const PRODUCTS: Array<{
  id: ProductType;
  label: string;
  price: number;
  firstPrice?: number;
  tag?: string;
  desc: string;
  color: string;
}> = [
  { id: "deep_report",     label: "全景行業戰報",   price: 4900, firstPrice: 4000, tag: "首次優惠",  desc: "萬字商業白皮書 · 異步重算力推演",            color: "#f5c842" },
  { id: "magazine_single", label: "戰略半月刊",      price: 800,  firstPrice: 720,  tag: "首購九折",  desc: "當月賽道趨勢報告 · 單期購買",                color: "#a78bfa" },
  { id: "magazine_sub",    label: "半年訂閱 (12期)", price: 6000, firstPrice: 5400, tag: "首購九折",   desc: "6 個月持續情報陪伴 · 尊貴長線戰略",          color: "#34d399" },
  { id: "personalized",    label: "個性化大洗牌",    price: 3000, firstPrice: 2700, tag: "首購九折",  desc: "與歷史快照對比 · 哈佛醫師級二次進化分析",    color: "#f97316" },
];

function calcPrice(product: typeof PRODUCTS[0], isFirst: boolean): number {
  if (isFirst && product.firstPrice !== undefined) return product.firstPrice;
  return product.price;
}

export default function GodViewPage() {
  const [, navigate] = useLocation();
  const [topic, setTopic] = useState("");
  const [phase, setPhase] = useState<"idle" | "launching" | "dispatched" | "failed">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const [selectedProduct, setSelectedProduct] = useState<ProductType>("deep_report");
  const [isBundlePromo, setIsBundlePromo] = useState(false);

  const currentProduct = PRODUCTS.find((p) => p.id === selectedProduct)!;
  const [isFirst, setIsFirst] = useState(() => !localStorage.getItem(PRODUCT_FIRST_KEYS[selectedProduct]));

  // supervisor debug
  const [isSupervisor, setIsSupervisor] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [launchTime, setLaunchTime] = useState<Date | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  // voice recording
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    setIsSupervisor(localStorage.getItem(SUPERVISOR_KEY) === "1");
  }, []);

  useEffect(() => {
    if (!launchTime) return;
    const t = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - launchTime.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [launchTime]);

  const cost = calcPrice(currentProduct, isBundlePromo ? false : isFirst);

  const launchMutation = trpc.deepResearch.launch.useMutation({
    onSuccess: () => {
      const firstKey = PRODUCT_FIRST_KEYS[selectedProduct];
      if (!localStorage.getItem(firstKey)) {
        localStorage.setItem(firstKey, "1");
        setIsFirst(false);
      }
      setPhase("dispatched");
    },
    onError: (err) => {
      setPhase("failed");
      setErrorMsg(err.message || "任务启动失败");
    },
  });

  const handleProductChange = (id: ProductType) => {
    setSelectedProduct(id);
    setIsFirst(!localStorage.getItem(PRODUCT_FIRST_KEYS[id]));
    setIsBundlePromo(false);
  };

  const handleLaunch = () => {
    if (!topic.trim()) { toast.error("请输入研究课题"); return; }
    const discount = isBundlePromo ? "（滿月老用戶雙本促銷）" : isFirst && currentProduct.firstPrice !== undefined ? "（首購優惠價）" : "";
    if (!window.confirm(`啟動「${currentProduct.label}」將扣除 ${cost.toLocaleString()} 點${discount}，確定執行？`)) return;
    setPhase("launching");
    setLaunchTime(new Date());
    setElapsedSec(0);
    launchMutation.mutate({ topic, isFirstTime: isFirst, productType: selectedProduct, isBundlePromo });
  };

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
          const r = await fetch("/api/google?op=transcribeAudio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64: base64, mimeType: mimeType.split(";")[0] }),
          });
          const data = await r.json().catch(() => ({}));
          const text = String(data?.text || "").trim();
          if (text) {
            setTopic(text);
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
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => navigate("/my-reports")}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 9, background: "linear-gradient(135deg,rgba(200,160,0,0.20),rgba(138,98,0,0.15))", border: "1px solid rgba(180,130,0,0.45)", color: "#f5c842", fontSize: 12, fontWeight: 800, cursor: "pointer", transition: "all 0.2s" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg,#c8a000,#8a6200)"; (e.currentTarget as HTMLElement).style.color = "#050300"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg,rgba(200,160,0,0.20),rgba(138,98,0,0.15))"; (e.currentTarget as HTMLElement).style.color = "#f5c842"; }}
          >
            <Crown size={13} />我的战报
          </button>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "#f5c842", background: "rgba(180,130,0,0.15)", border: "1px solid rgba(180,130,0,0.4)", borderRadius: 99, padding: "3px 10px" }}>
            👑 VIP 专享
          </span>
        </div>
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
            为您交付降维打击的<strong style={{ color: "rgba(245,200,80,0.8)" }}>全景行业战报</strong>。
            穿透赛道迷雾，锁定商业胜率。
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
            {["宏观趋势前瞻", "竞品变现拆解", "私域留存策略", "30天行动清单"].map((t) => (
              <span key={t} style={{ fontSize: 11, fontWeight: 700, color: "rgba(245,200,80,0.6)", background: "rgba(180,130,0,0.10)", border: "1px solid rgba(180,130,0,0.25)", borderRadius: 99, padding: "4px 12px" }}>{t}</span>
            ))}
          </div>
        </div>

        {/* ── 定價矩陣 ── */}
        {(phase === "idle" || phase === "launching") && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 20 }}>
            {PRODUCTS.map((p) => {
              const isSelected = selectedProduct === p.id;
              const pIsFirst = !localStorage.getItem(PRODUCT_FIRST_KEYS[p.id]);
              const displayPrice = calcPrice(p, pIsFirst);
              return (
                <button
                  key={p.id}
                  onClick={() => handleProductChange(p.id)}
                  style={{
                    textAlign: "left", padding: "16px 18px", borderRadius: 16, cursor: "pointer",
                    background: isSelected ? `rgba(${p.id === "deep_report" ? "180,130,0" : p.id === "magazine_single" ? "120,80,200" : p.id === "magazine_sub" ? "30,160,100" : "200,100,20"},0.12)` : "rgba(255,255,255,0.03)",
                    border: `1.5px solid ${isSelected ? p.color : "rgba(255,255,255,0.10)"}`,
                    boxShadow: isSelected ? `0 0 20px ${p.color}25` : "none",
                    transition: "all 0.2s",
                    position: "relative", overflow: "hidden",
                  }}
                >
                  {p.tag && (
                    <span style={{ position: "absolute", top: 8, right: 8, fontSize: 9, fontWeight: 900, color: p.color, background: `${p.color}20`, border: `1px solid ${p.color}50`, borderRadius: 99, padding: "1px 6px", letterSpacing: "0.05em" }}>
                      {p.tag}
                    </span>
                  )}
                  <div style={{ fontSize: 12, fontWeight: 700, color: isSelected ? p.color : "rgba(255,255,255,0.5)", marginBottom: 4 }}>{p.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: isSelected ? p.color : "rgba(255,255,255,0.7)", lineHeight: 1 }}>
                    {displayPrice.toLocaleString()}
                    <span style={{ fontSize: 11, fontWeight: 600, marginLeft: 3 }}>點</span>
                    {pIsFirst && p.firstPrice !== undefined && (
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textDecoration: "line-through", marginLeft: 6 }}>{p.price.toLocaleString()}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.30)", marginTop: 6, lineHeight: 1.4 }}>{p.desc}</div>
                </button>
              );
            })}
          </div>
        )}

        {/* ── 输入区 ── */}
        {(phase === "idle" || phase === "launching") && (
          <div style={{ background: "rgba(180,130,0,0.05)", border: "1px solid rgba(180,130,0,0.22)", borderRadius: 20, padding: 28 }}>
            <p style={{ fontSize: 12, color: "rgba(245,200,80,0.5)", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>
              输入研究课题
            </p>
            <div style={{ position: "relative" }}>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                rows={5}
                placeholder="请描述您要研究的赛道或课题，例如：2026年小红书形体美学与心血管健康赛道的商业模式、头部变现路径与差异化破局策略…"
                style={{ width: "100%", padding: "14px 16px", paddingRight: 52, borderRadius: 12, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(180,130,0,0.25)", color: "#fff", fontSize: 14, lineHeight: 1.7, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit", transition: "border-color 0.2s" }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(245,200,80,0.5)"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(180,130,0,0.25)"; }}
                disabled={phase === "launching"}
              />
              <button
                onClick={toggleVoice}
                disabled={isTranscribing || phase === "launching"}
                title={isRecording ? "点击停止录音" : isTranscribing ? "转录中…" : "语音输入课题（Gemini 转录）"}
                style={{
                  position: "absolute", top: 10, right: 10,
                  width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                  background: isRecording ? "rgba(239,68,68,0.18)" : isTranscribing ? "rgba(251,191,36,0.12)" : "rgba(180,130,0,0.10)",
                  border: isRecording ? "1px solid rgba(239,68,68,0.5)" : isTranscribing ? "1px solid rgba(251,191,36,0.4)" : "1px solid rgba(180,130,0,0.3)",
                  color: isRecording ? "#ef4444" : isTranscribing ? "#fbbf24" : "rgba(245,200,80,0.55)",
                  cursor: isTranscribing || phase === "launching" ? "not-allowed" : "pointer",
                  transition: "all 0.2s",
                  animation: isRecording ? "godview-mic-pulse 1.2s ease-in-out infinite" : "none",
                }}
              >
                {isRecording ? <MicOff size={14} /> : isTranscribing ? <Loader2 size={14} className="animate-spin" /> : <Mic size={14} />}
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", margin: 0 }}>
                  ⏱ 異步重算力推演，約 15-30 分鐘，派發後可關閉頁面到「我的戰報」查看
                </p>
                {selectedProduct === "magazine_single" && (
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "rgba(255,255,255,0.45)", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={isBundlePromo}
                      onChange={(e) => setIsBundlePromo(e.target.checked)}
                      style={{ accentColor: "#f5c842" }}
                    />
                    滿月老用戶專享：兩本 800 點特惠（需在平台超過 30 天）
                  </label>
                )}
              </div>
              <button
                onClick={handleLaunch}
                disabled={!topic.trim() || phase === "launching"}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 28px", borderRadius: 12, background: (!topic.trim() || phase === "launching") ? "rgba(180,130,0,0.08)" : "linear-gradient(135deg,#c8a000,#8a6200)", border: "1px solid rgba(180,130,0,0.5)", color: (!topic.trim() || phase === "launching") ? "rgba(245,200,80,0.3)" : "#050300", fontWeight: 900, fontSize: 14, cursor: (!topic.trim() || phase === "launching") ? "not-allowed" : "pointer", boxShadow: (topic.trim() && phase !== "launching") ? "0 0 20px rgba(200,160,0,0.30)" : "none", transition: "all 0.2s", position: "relative", flexShrink: 0 }}
              >
                {phase === "launching" ? <Loader2 size={15} className="animate-spin" /> : <Crown size={15} />}
                {phase === "launching"
                  ? "正在派發任務…"
                  : `💎 啟動 ${currentProduct.label}（${cost.toLocaleString()} 點）`}
                {isFirst && currentProduct.firstPrice !== undefined && phase !== "launching" && (
                  <span style={{ position: "absolute", top: -10, right: -6, fontSize: 9, fontWeight: 900, background: "#ef4444", color: "#fff", borderRadius: 99, padding: "1px 6px" }}>首次優惠</span>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── 已派发：任务接收确认 ── */}
        {phase === "dispatched" && (
          <div style={{ textAlign: "center", padding: "48px 24px", animation: "fadeIn 0.5s ease" }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: "linear-gradient(135deg,#16a34a,#15803d)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", boxShadow: "0 0 40px rgba(22,163,74,0.35)", fontSize: 32 }}>✅</div>
            <h2 style={{ fontSize: 24, fontWeight: 900, color: "#f5c842", marginBottom: 12 }}>
              全景战报任务已成功派发
            </h2>
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, lineHeight: 1.9, maxWidth: 540, margin: "0 auto 32px" }}>
              专属 AI 研究集群已接收指令并开始推演。由于涉及全网海量检索与万字逻辑推演，<br />
              此过程预计需要 <strong style={{ color: "#f5c842" }}>15 到 30 分钟</strong>。<br />
              <strong style={{ color: "rgba(255,255,255,0.75)" }}>您现在可以安心关闭此页面</strong>，战报生成后可在「我的战报」中查阅。
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                onClick={() => navigate("/my-reports")}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 28px", borderRadius: 12, background: "linear-gradient(135deg,#c8a000,#8a6200)", border: "none", color: "#050300", fontWeight: 900, fontSize: 14, cursor: "pointer", boxShadow: "0 0 20px rgba(200,160,0,0.30)" }}
              >
                <Sparkles size={16} />前往「我的战报」查看进度
              </button>
              <button
                onClick={() => { setPhase("idle"); setTopic(""); }}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 24px", borderRadius: 12, background: "rgba(180,130,0,0.08)", border: "1px solid rgba(180,130,0,0.3)", color: "rgba(245,200,80,0.7)", fontWeight: 700, fontSize: 14, cursor: "pointer" }}
              >
                再发起一个新课题
              </button>
            </div>
          </div>
        )}

        {/* ── 启动失败 ── */}
        {phase === "failed" && (
          <div style={{ padding: "20px 24px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p style={{ color: "#f87171", fontSize: 13, margin: 0 }}>❌ {errorMsg} · 积分已退回</p>
            <button onClick={() => { setPhase("idle"); setErrorMsg(""); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", fontSize: 12, cursor: "pointer" }}>
              <RotateCcw size={12} />重试
            </button>
          </div>
        )}

        {/* ── Supervisor Debug 面板 ── */}
        {isSupervisor && (
          <div style={{ marginTop: 40 }}>
            <button
              onClick={() => setShowDebug(!showDebug)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", background: "rgba(0,255,70,0.06)", border: "1px solid rgba(0,255,70,0.2)", borderRadius: 8, cursor: "pointer", color: "rgba(0,255,70,0.7)", fontSize: 11, fontWeight: 700, fontFamily: "monospace", letterSpacing: "0.05em" }}
            >
              <Bug size={12} />
              DEBUG {showDebug ? "▲ 收起" : "▼ 展开"}
              <span style={{ marginLeft: 4, color: "rgba(0,255,70,0.35)", fontWeight: 400 }}>supervisor only</span>
            </button>

            {showDebug && (
              <div style={{ marginTop: 10, background: "#000", border: "1px solid rgba(0,255,70,0.25)", borderRadius: 12, padding: "16px 18px", fontFamily: "monospace", fontSize: 11, color: "#00ff46", animation: "fadeIn 0.2s ease", lineHeight: 1.7 }}>
                <p style={{ color: "rgba(0,255,70,0.45)", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", marginBottom: 10 }}>▶ GODVIEW DEBUG TERMINAL</p>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
                  {[
                    { k: "PHASE", v: phase },
                    { k: "MUTATION", v: launchMutation.isPending ? "⏳ pending" : launchMutation.isSuccess ? "✅ success" : launchMutation.isError ? "❌ error" : "— idle" },
                    { k: "JOB_ID", v: String((launchMutation.data as any)?.jobId || (launchMutation.data as any)?.id || "—") },
                    { k: "TOPIC_LEN", v: `${topic.length} chars` },
                    { k: "LAUNCH_AT", v: launchTime ? launchTime.toLocaleTimeString("zh-CN") : "—" },
                    { k: "ELAPSED", v: launchTime ? `${elapsedSec}s` : "—" },
                  ].map(({ k, v }) => (
                    <div key={k} style={{ background: "rgba(0,255,70,0.05)", border: "1px solid rgba(0,255,70,0.15)", borderRadius: 6, padding: "5px 10px", minWidth: 120 }}>
                      <p style={{ color: "rgba(0,255,70,0.4)", fontSize: 9, margin: "0 0 2px", fontWeight: 700 }}>{k}</p>
                      <p style={{ color: "#00ff46", fontSize: 11, margin: 0 }}>{v}</p>
                    </div>
                  ))}
                </div>

                <p style={{ color: "rgba(0,255,70,0.4)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 6 }}>RAW MUTATION DATA</p>
                <pre style={{ fontSize: 10, color: "rgba(0,255,70,0.75)", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 300, overflowY: "auto", margin: 0, lineHeight: 1.6, background: "rgba(0,255,70,0.03)", borderRadius: 6, padding: "10px 12px" }}>
                  {launchMutation.data
                    ? JSON.stringify(launchMutation.data, null, 2)
                    : launchMutation.error
                      ? JSON.stringify({ error: launchMutation.error.message, code: (launchMutation.error as any)?.data?.code }, null, 2)
                      : "暂无数据，启动任务后显示"}
                </pre>
              </div>
            )}
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
        @keyframes godview-mic-pulse {
          0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.4)}
          50%{box-shadow:0 0 0 6px rgba(239,68,68,0)}
        }
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
