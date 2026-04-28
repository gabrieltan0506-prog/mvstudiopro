import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, Loader2, Crown, Sparkles, RotateCcw, Mic, MicOff, Bug } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const SUPERVISOR_KEY = "mvs-supervisor-access";

// ── 定價配置（與後端 billingService.ts 保持同步）──────────────────────────────
type ProductType = "magazine_single" | "magazine_sub" | "personalized";

const PRODUCT_FIRST_KEYS: Record<ProductType, string> = {
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
  { id: "magazine_single", label: "战略半月刊",      price: 800,  firstPrice: 720,  tag: "首购九折",  desc: "当月赛道趋势报告 · 单期购买",              color: "#a78bfa" },
  { id: "magazine_sub",    label: "半年订阅 (12期)", price: 6000, firstPrice: 5400, tag: "首购九折",  desc: "6 个月持续情报陪伴 · 尊贵长线战略",        color: "#34d399" },
  { id: "personalized",    label: "尊享季度私人订制", price: 3000, firstPrice: 2700, tag: "首购九折",  desc: "与历史快照对比 · 哈佛医师级二次进化分析",  color: "#f97316" },
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

  const [selectedProduct, setSelectedProduct] = useState<ProductType>("magazine_single");
  const [isBundlePromo, setIsBundlePromo] = useState(false);

  const currentProduct = PRODUCTS.find((p) => p.id === selectedProduct)!;
  const [isFirst, setIsFirst] = useState(() => !localStorage.getItem(PRODUCT_FIRST_KEYS["magazine_single"]));

  // supervisor debug
  const [isSupervisor, setIsSupervisor] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [launchTime, setLaunchTime] = useState<Date | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  // 当前正在轮询的 jobId（从 launchMutation.data 取出）
  const [pollingJobId, setPollingJobId] = useState<string | null>(null);

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
    onSuccess: (data) => {
      const firstKey = PRODUCT_FIRST_KEYS[selectedProduct];
      if (!localStorage.getItem(firstKey)) {
        localStorage.setItem(firstKey, "1");
        setIsFirst(false);
      }
      setPhase("dispatched");
      // supervisor：拿到 jobId 后立即开始轮询
      if (data?.jobId) setPollingJobId(data.jobId);
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
    const discount = isBundlePromo ? "（满月老用户双本促销）" : isFirst && currentProduct.firstPrice !== undefined ? "（首购优惠价）" : "";
    if (!window.confirm(`启动「${currentProduct.label}」将扣除 ${cost.toLocaleString()} 点${discount}，确定执行？`)) return;
    setPhase("launching");
    setLaunchTime(new Date());
    setElapsedSec(0);
    launchMutation.mutate({ topic, isFirstTime: isFirst, productType: selectedProduct, isBundlePromo });
  };

  // Supervisor 轮询：每 4s 拉一次 job 状态，job 完成/失败后停止
  const jobStatusQuery = trpc.deepResearch.supervisorJobStatus.useQuery(
    { jobId: pollingJobId! },
    {
      enabled: isSupervisor && !!pollingJobId,
      refetchInterval: (query) => {
        const s = query.state.data?.status;
        if (s === "completed" || s === "failed") return false;
        return 4000;
      },
      retry: false,
    },
  );

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
    <div
      style={{
        minHeight: "100vh",
        // 卡布奇諾深焙渐变：顶部奶泡米色 → 中段焦糖核心（最浓郁的质感段）→ 底部深拿铁/摩卡棕
        background: `
          radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255,247,224,0.85) 0%, transparent 60%),
          radial-gradient(ellipse 70% 50% at 100% 100%, rgba(74,54,33,0.20) 0%, transparent 65%),
          linear-gradient(180deg,
            #ede1c5 0%,
            #ddc59c 22%,
            #c9a878 48%,
            #b08c5a 72%,
            #8e6c45 92%,
            #7a5e3f 100%
          )
        `,
        fontFamily: "'PingFang SC','HarmonyOS Sans','Source Han Sans',Inter,sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* 卡布奇諾暖金多层光晕 + 微噪点（提升质感与「咖啡的层次感」）*/}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        {/* 顶部奶泡高光（让顶端阅读区更明亮，文字更易读）*/}
        <div style={{ position: "absolute", top: "-15%", left: "50%", transform: "translateX(-50%)", width: 1100, height: 700, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,247,224,0.55) 0%,transparent 70%)", filter: "blur(70px)" }} />
        {/* 左上焦糖金光晕 · 慢呼吸动画 */}
        <div style={{ position: "absolute", top: "8%", left: "8%", width: 620, height: 620, borderRadius: "50%", background: "radial-gradient(circle,rgba(216,162,58,0.32) 0%,rgba(168,118,27,0.18) 35%,transparent 70%)", filter: "blur(90px)", animation: "godview-float 18s ease-in-out infinite" }} />
        {/* 右下深咖啡光晕 · 反向呼吸 */}
        <div style={{ position: "absolute", bottom: "8%", right: "5%", width: 480, height: 480, borderRadius: "50%", background: "radial-gradient(circle,rgba(74,54,33,0.40) 0%,rgba(122,84,16,0.22) 35%,transparent 70%)", filter: "blur(80px)", animation: "godview-float 22s ease-in-out infinite reverse" }} />
        {/* 中段焦糖核心暖光（强化「咖啡心脏」段的浓郁度）*/}
        <div style={{ position: "absolute", top: "45%", right: "20%", width: 380, height: 380, borderRadius: "50%", background: "radial-gradient(circle,rgba(216,162,58,0.18) 0%,transparent 70%)", filter: "blur(60px)", animation: "godview-float 26s ease-in-out infinite" }} />
        {/* 微噪点纹理（仿咖啡粉颗粒，提升手感与质感） */}
        <div style={{ position: "absolute", inset: 0, opacity: 0.25, mixBlendMode: "overlay", backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.30  0 0 0 0 0.20  0 0 0 0 0.10  0 0 0 0.45 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")" }} />
      </div>

      {/* 顶部导航 */}
      <div style={{ borderBottom: "1px solid rgba(122,84,16,0.20)", background: "rgba(255,250,240,0.92)", backdropFilter: "blur(14px)", padding: "14px 24px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 50, boxShadow: "0 1px 0 rgba(122,84,16,0.05)" }}>
        <button onClick={() => navigate("/")} style={{ color: "#7a5410", cursor: "pointer", background: "none", border: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 700 }}>
          <ChevronLeft size={16} />首页
        </button>
        <span style={{ color: "rgba(122,84,16,0.4)" }}>/</span>
        <span style={{ color: "#3d2c14", fontSize: 13, fontWeight: 800 }}>AI 上帝视角</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => navigate("/my-reports")}
            style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 18px", borderRadius: 10, background: "linear-gradient(135deg,#a8761b,#7a5410)", border: "1px solid rgba(168,118,27,0.65)", color: "#fff7df", fontSize: 12, fontWeight: 900, cursor: "pointer", transition: "all 0.2s", boxShadow: "0 4px 14px rgba(168,118,27,0.32)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 22px rgba(168,118,27,0.55)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = "none"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 14px rgba(168,118,27,0.32)"; }}
          >
            <Crown size={13} />战略作品快照库
          </button>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", color: "#7a5410", background: "rgba(168,118,27,0.15)", border: "1px solid rgba(168,118,27,0.40)", borderRadius: 99, padding: "4px 12px" }}>
            👑 至尊专享
          </span>
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px 80px", position: "relative", zIndex: 2 }}>

        {/* 页面标题 */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg,#a8761b,#7a5410)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 26px rgba(122,84,16,0.30)" }}>
              <Crown size={28} color="#fff7df" />
            </div>
            <div style={{ textAlign: "left" }}>
              <h1 style={{ fontSize: 30, fontWeight: 900, color: "#3d2c14", margin: 0, letterSpacing: "0.01em" }}>
                AI 上帝视角
              </h1>
              <p style={{ color: "rgba(122,84,16,0.85)", fontSize: 13, margin: "4px 0 0", letterSpacing: "0.10em", fontWeight: 700 }}>
                全景行业战报 · 旗舰级商业智库
              </p>
            </div>
          </div>
          <p style={{ color: "rgba(61,44,20,0.78)", fontSize: 15, maxWidth: 640, margin: "0 auto", lineHeight: 1.85, fontWeight: 500 }}>
            停止在信息泥潭中盲目试错。派遣专属智能研究集群，独占极限算力，全网深度检索与逻辑推演，
            为您交付降维打击的<strong style={{ color: "#7a5410", background: "linear-gradient(180deg, transparent 70%, rgba(216,162,58,0.30) 70%)", padding: "0 3px" }}>全景行业战报</strong>。
            穿透赛道迷雾，锁定商业胜率。
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
            {["宏观趋势前瞻", "竞品变现拆解", "私域留存策略", "30天行动清单"].map((t) => (
              <span key={t} style={{ fontSize: 11, fontWeight: 800, color: "#7a5410", background: "rgba(168,118,27,0.12)", border: "1px solid rgba(168,118,27,0.35)", borderRadius: 99, padding: "5px 14px" }}>{t}</span>
            ))}
          </div>
        </div>

        {/* 战略作品快照库 · 醒目入口卡 */}
        <div
          onClick={() => navigate("/my-reports")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "16px 22px",
            marginBottom: 24,
            borderRadius: 14,
            background: "linear-gradient(135deg,#fffaf0 0%,#f5ecda 100%)",
            border: "1px solid rgba(168,118,27,0.30)",
            boxShadow: "0 6px 20px rgba(122,84,16,0.10)",
            cursor: "pointer",
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(168,118,27,0.65)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 10px 30px rgba(168,118,27,0.20)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(168,118,27,0.30)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 20px rgba(122,84,16,0.10)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
        >
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#a8761b,#7a5410)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 4px 14px rgba(168,118,27,0.30)" }}>
            <Crown size={20} color="#fff7df" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: "#3d2c14", marginBottom: 3 }}>
              战略作品快照库 · 历史战报一键直达
            </div>
            <div style={{ fontSize: 12, color: "rgba(61,44,20,0.65)", lineHeight: 1.5 }}>
              所有已生成的全景战报、个性化分析与半月刊都在此沉淀，支持<strong style={{ color: "#7a5410" }}>富图文 PDF 一键下载</strong>，包含个人亮点、平台赛道、产品矩阵、商业变现、生涯规划五大模块。
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 10, background: "linear-gradient(135deg,#a8761b,#7a5410)", color: "#fff7df", fontSize: 12, fontWeight: 900, flexShrink: 0 }}>
            进入快照库 →
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
                    background: isSelected ? "linear-gradient(135deg,#fffaf0,#f5ecda)" : "rgba(255,250,240,0.55)",
                    border: `1.5px solid ${isSelected ? p.color : "rgba(168,118,27,0.25)"}`,
                    boxShadow: isSelected ? `0 6px 22px ${p.color}30` : "0 2px 8px rgba(122,84,16,0.06)",
                    transition: "all 0.2s",
                    position: "relative", overflow: "hidden",
                  }}
                >
                  {p.tag && (
                    <span style={{ position: "absolute", top: 8, right: 8, fontSize: 9, fontWeight: 900, color: "#fff", background: p.color, borderRadius: 99, padding: "2px 8px", letterSpacing: "0.05em" }}>
                      {p.tag}
                    </span>
                  )}
                  <div style={{ fontSize: 12, fontWeight: 800, color: isSelected ? p.color : "#7a5410", marginBottom: 6 }}>{p.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: isSelected ? p.color : "#3d2c14", lineHeight: 1 }}>
                    {displayPrice.toLocaleString()}
                    <span style={{ fontSize: 11, fontWeight: 700, marginLeft: 3 }}>点</span>
                    {pIsFirst && p.firstPrice !== undefined && (
                      <span style={{ fontSize: 10, color: "rgba(61,44,20,0.45)", textDecoration: "line-through", marginLeft: 6, fontWeight: 600 }}>{p.price.toLocaleString()}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(61,44,20,0.65)", marginTop: 8, lineHeight: 1.5, fontWeight: 500 }}>{p.desc}</div>
                </button>
              );
            })}
          </div>
        )}

        {/* ── 输入区 ── */}
        {(phase === "idle" || phase === "launching") && (
          <div style={{ background: "linear-gradient(135deg,#fffaf0,#f5ecda)", border: "1px solid rgba(168,118,27,0.30)", borderRadius: 20, padding: 28, boxShadow: "0 6px 22px rgba(122,84,16,0.10)" }}>
            <p style={{ fontSize: 12, color: "#7a5410", fontWeight: 800, letterSpacing: "0.1em", marginBottom: 10 }}>
              输入研究课题
            </p>
            <div style={{ position: "relative" }}>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                rows={5}
                placeholder="请描述您要研究的赛道或课题，例如：2026 年小红书形体美学与心血管健康赛道的商业模式、头部变现路径与差异化破局策略…"
                style={{ width: "100%", padding: "14px 16px", paddingRight: 52, borderRadius: 12, background: "#fff", border: "1px solid rgba(168,118,27,0.35)", color: "#1c1407", fontSize: 14.5, lineHeight: 1.75, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit", transition: "border-color 0.2s" }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "#a8761b"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(168,118,27,0.35)"; }}
                disabled={phase === "launching"}
              />
              <button
                onClick={toggleVoice}
                disabled={isTranscribing || phase === "launching"}
                title={isRecording ? "点击停止录音" : isTranscribing ? "转录中…" : "语音输入课题"}
                style={{
                  position: "absolute", top: 10, right: 10,
                  width: 34, height: 34, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                  background: isRecording ? "rgba(220,38,38,0.10)" : isTranscribing ? "rgba(217,119,6,0.10)" : "rgba(168,118,27,0.12)",
                  border: isRecording ? "1px solid rgba(220,38,38,0.5)" : isTranscribing ? "1px solid rgba(217,119,6,0.4)" : "1px solid rgba(168,118,27,0.4)",
                  color: isRecording ? "#dc2626" : isTranscribing ? "#d97706" : "#7a5410",
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
                <p style={{ fontSize: 12, color: "rgba(61,44,20,0.60)", margin: 0, fontWeight: 600 }}>
                  ⏱ 异步重算力推演，约 15-30 分钟，派发后可关闭页面到「战略作品快照库」查看
                </p>
                {selectedProduct === "magazine_single" && (
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "rgba(61,44,20,0.70)", cursor: "pointer", fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={isBundlePromo}
                      onChange={(e) => setIsBundlePromo(e.target.checked)}
                      style={{ accentColor: "#a8761b" }}
                    />
                    满月老用户专享：两本 800 点特惠（需在平台超过 30 天）
                  </label>
                )}
              </div>
              <button
                onClick={handleLaunch}
                disabled={!topic.trim() || phase === "launching"}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "13px 30px", borderRadius: 12, background: (!topic.trim() || phase === "launching") ? "rgba(168,118,27,0.20)" : "linear-gradient(135deg,#a8761b,#7a5410)", border: "1px solid rgba(168,118,27,0.55)", color: (!topic.trim() || phase === "launching") ? "rgba(61,44,20,0.45)" : "#fff7df", fontWeight: 900, fontSize: 14, cursor: (!topic.trim() || phase === "launching") ? "not-allowed" : "pointer", boxShadow: (topic.trim() && phase !== "launching") ? "0 6px 22px rgba(168,118,27,0.40)" : "none", transition: "all 0.2s", position: "relative", flexShrink: 0 }}
              >
                {phase === "launching" ? <Loader2 size={15} className="animate-spin" /> : <Crown size={15} />}
                {phase === "launching"
                  ? "正在派发任务…"
                  : `启动 ${currentProduct.label}（${cost.toLocaleString()} 点）`}
                {isFirst && currentProduct.firstPrice !== undefined && phase !== "launching" && (
                  <span style={{ position: "absolute", top: -10, right: -6, fontSize: 9, fontWeight: 900, background: "#dc2626", color: "#fff", borderRadius: 99, padding: "2px 8px" }}>首次优惠</span>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── 已派发：任务接收确认 ── */}
        {phase === "dispatched" && (
          <div style={{ textAlign: "center", padding: "48px 24px", animation: "fadeIn 0.5s ease", background: "linear-gradient(135deg,#fffaf0,#f5ecda)", borderRadius: 20, border: "1px solid rgba(168,118,27,0.30)", boxShadow: "0 6px 22px rgba(122,84,16,0.10)" }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: "linear-gradient(135deg,#16a34a,#15803d)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", boxShadow: "0 6px 24px rgba(22,163,74,0.30)", fontSize: 32 }}>✅</div>
            <h2 style={{ fontSize: 24, fontWeight: 900, color: "#3d2c14", marginBottom: 12 }}>
              全景战报任务已成功派发
            </h2>
            <p style={{ color: "rgba(61,44,20,0.75)", fontSize: 14.5, lineHeight: 1.9, maxWidth: 560, margin: "0 auto 32px", fontWeight: 500 }}>
              专属智能研究集群已接收指令并开始推演。由于涉及全网海量检索与万字逻辑推演，<br />
              此过程预计需要 <strong style={{ color: "#7a5410" }}>15 到 30 分钟</strong>。<br />
              <strong style={{ color: "#3d2c14" }}>您现在可以安心关闭此页面</strong>，战报生成后可在「战略作品快照库」中查阅。
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                onClick={() => navigate("/my-reports")}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 28px", borderRadius: 12, background: "linear-gradient(135deg,#a8761b,#7a5410)", border: "none", color: "#fff7df", fontWeight: 900, fontSize: 14, cursor: "pointer", boxShadow: "0 6px 22px rgba(168,118,27,0.35)" }}
              >
                <Sparkles size={16} />前往「战略作品快照库」查看进度
              </button>
              <button
                onClick={() => { setPhase("idle"); setTopic(""); }}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 24px", borderRadius: 12, background: "rgba(168,118,27,0.10)", border: "1px solid rgba(168,118,27,0.35)", color: "#7a5410", fontWeight: 800, fontSize: 14, cursor: "pointer" }}
              >
                再发起一个新课题
              </button>
            </div>
          </div>
        )}

        {/* ── 启动失败 ── */}
        {phase === "failed" && (
          <div style={{ padding: "20px 24px", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.30)", borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p style={{ color: "#dc2626", fontSize: 13, margin: 0, fontWeight: 700 }}>❌ {errorMsg} · 积分已退回</p>
            <button onClick={() => { setPhase("idle"); setErrorMsg(""); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 8, background: "rgba(220,38,38,0.12)", border: "1px solid rgba(220,38,38,0.40)", color: "#dc2626", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              <RotateCcw size={12} />重试
            </button>
          </div>
        )}

        {/* ── Supervisor Debug 面板 ── */}
        {isSupervisor && (
          <div style={{ marginTop: 40 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => setShowDebug(!showDebug)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", background: "rgba(0,255,70,0.06)", border: "1px solid rgba(0,255,70,0.2)", borderRadius: 8, cursor: "pointer", color: "rgba(0,255,70,0.7)", fontSize: 11, fontWeight: 700, fontFamily: "monospace", letterSpacing: "0.05em" }}
              >
                <Bug size={12} />
                DEBUG {showDebug ? "▲ 收起" : "▼ 展开"}
                <span style={{ marginLeft: 4, color: "rgba(0,255,70,0.35)", fontWeight: 400 }}>supervisor only</span>
              </button>
              {/* 手动输入 jobId 轮询 */}
              <input
                placeholder="粘贴 jobId 查询..."
                defaultValue={pollingJobId || ""}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = (e.target as HTMLInputElement).value.trim();
                    if (v) { setPollingJobId(v); setShowDebug(true); }
                  }
                }}
                style={{ flex: 1, maxWidth: 280, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(0,255,70,0.2)", borderRadius: 8, color: "#00ff46", fontSize: 11, fontFamily: "monospace", padding: "6px 12px", outline: "none" }}
              />
              {pollingJobId && (
                <span style={{ fontSize: 10, color: "rgba(0,255,70,0.5)", fontFamily: "monospace" }}>
                  轮询中 {jobStatusQuery.isFetching ? "⏳" : "✓"} 每 4s
                </span>
              )}
            </div>

            {showDebug && (
              <div style={{ marginTop: 10, background: "#000", border: "1px solid rgba(0,255,70,0.25)", borderRadius: 12, padding: "18px 20px", fontFamily: "monospace", fontSize: 11, color: "#00ff46", lineHeight: 1.7 }}>
                <p style={{ color: "rgba(0,255,70,0.45)", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", marginBottom: 12 }}>▶ DEEP RESEARCH DEBUG TERMINAL</p>

                {/* 基础字段 */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                  {[
                    { k: "PHASE", v: phase },
                    { k: "JOB_ID", v: pollingJobId || String((launchMutation.data as any)?.jobId || "—") },
                    { k: "LAUNCH_AT", v: launchTime ? launchTime.toLocaleTimeString("zh-CN") : "—" },
                    { k: "ELAPSED", v: launchTime ? `${elapsedSec}s` : "—" },
                    { k: "CREDITS", v: jobStatusQuery.data?.creditsUsed != null ? `${jobStatusQuery.data.creditsUsed} 点` : "—" },
                    { k: "ATTEMPT", v: jobStatusQuery.data?.attemptCount != null ? `#${jobStatusQuery.data.attemptCount}` : "—" },
                    { k: "PID", v: String(jobStatusQuery.data?.pid || "—") },
                  ].map(({ k, v }) => (
                    <div key={k} style={{ background: "rgba(0,255,70,0.05)", border: "1px solid rgba(0,255,70,0.12)", borderRadius: 6, padding: "4px 10px", minWidth: 100 }}>
                      <p style={{ color: "rgba(0,255,70,0.35)", fontSize: 9, margin: "0 0 2px", fontWeight: 700 }}>{k}</p>
                      <p style={{ color: "#00ff46", fontSize: 11, margin: 0 }}>{v}</p>
                    </div>
                  ))}
                </div>

                {/* Job 状态 + 进度 */}
                {jobStatusQuery.data && (
                  <>
                    {/* 状态徽章 */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <span style={{
                        padding: "3px 12px", borderRadius: 99, fontSize: 11, fontWeight: 800,
                        background: jobStatusQuery.data.status === "completed" ? "rgba(0,255,70,0.15)"
                          : jobStatusQuery.data.status === "failed" ? "rgba(255,50,50,0.15)"
                          : jobStatusQuery.data.status === "running" ? "rgba(0,180,255,0.15)"
                          : "rgba(200,160,0,0.15)",
                        color: jobStatusQuery.data.status === "completed" ? "#00ff46"
                          : jobStatusQuery.data.status === "failed" ? "#ff5050"
                          : jobStatusQuery.data.status === "running" ? "#00b4ff"
                          : "#c8a000",
                        border: `1px solid ${jobStatusQuery.data.status === "completed" ? "rgba(0,255,70,0.3)"
                          : jobStatusQuery.data.status === "failed" ? "rgba(255,50,50,0.3)"
                          : jobStatusQuery.data.status === "running" ? "rgba(0,180,255,0.3)"
                          : "rgba(200,160,0,0.3)"}`,
                      }}>
                        {jobStatusQuery.data.status === "running" ? "🔄 运行中" : jobStatusQuery.data.status === "completed" ? "✅ 完成" : jobStatusQuery.data.status === "failed" ? "❌ 失败" : jobStatusQuery.data.status}
                      </span>
                      {jobStatusQuery.data.lastHeartbeatAt && (
                        <span style={{ color: "rgba(0,255,70,0.4)", fontSize: 10 }}>
                          心跳 {new Date(jobStatusQuery.data.lastHeartbeatAt).toLocaleTimeString("zh-CN")}
                        </span>
                      )}
                      {jobStatusQuery.data.hasMarkdown && (
                        <span style={{ color: "rgba(0,255,70,0.5)", fontSize: 10 }}>
                          报告已生成 ({jobStatusQuery.data.markdownLen.toLocaleString()} chars)
                        </span>
                      )}
                    </div>

                    {/* 进度日志（最重要的字段） */}
                    {jobStatusQuery.data.progress && (
                      <div style={{ marginBottom: 10 }}>
                        <p style={{ color: "rgba(0,255,70,0.4)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 6 }}>PROGRESS LOG</p>
                        <div style={{ background: "rgba(0,255,70,0.04)", border: "1px solid rgba(0,255,70,0.12)", borderRadius: 8, padding: "10px 14px", maxHeight: 200, overflowY: "auto" }}>
                          {jobStatusQuery.data.progress.split("\n").map((line, i) => (
                            <div key={i} style={{ color: line.includes("❌") || line.includes("失败") ? "#ff7070" : line.includes("✅") || line.includes("完成") ? "#00ff46" : line.includes("⏳") || line.includes("进行") ? "#00b4ff" : "rgba(0,255,70,0.75)", marginBottom: 2, wordBreak: "break-all" }}>
                              {line || <span style={{ opacity: 0.2 }}>—</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 错误（失败时） */}
                    {jobStatusQuery.data.error && (
                      <div style={{ marginBottom: 10 }}>
                        <p style={{ color: "rgba(255,80,80,0.6)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 6 }}>ERROR</p>
                        <div style={{ background: "rgba(255,50,50,0.06)", border: "1px solid rgba(255,50,50,0.2)", borderRadius: 8, padding: "10px 14px", color: "#ff7070", wordBreak: "break-all" }}>
                          {jobStatusQuery.data.error}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Launch mutation 原始返回 */}
                <p style={{ color: "rgba(0,255,70,0.4)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 6, marginTop: 4 }}>LAUNCH RESPONSE</p>
                <pre style={{ fontSize: 10, color: "rgba(0,255,70,0.65)", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 180, overflowY: "auto", margin: 0, lineHeight: 1.6, background: "rgba(0,255,70,0.03)", borderRadius: 6, padding: "10px 12px" }}>
                  {launchMutation.data
                    ? JSON.stringify(launchMutation.data, null, 2)
                    : launchMutation.error
                      ? JSON.stringify({ error: launchMutation.error.message, code: (launchMutation.error as any)?.data?.code }, null, 2)
                      : "暂无（任务启动后显示）"}
                </pre>

                {jobStatusQuery.error && (
                  <p style={{ color: "#ff7070", fontSize: 10, marginTop: 8 }}>轮询错误：{jobStatusQuery.error.message}</p>
                )}
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
