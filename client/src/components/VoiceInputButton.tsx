import { useRef, useState, useCallback } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
  lang?: string;
  className?: string;
  size?: number;
  mode?: "append" | "replace";
  disabled?: boolean;
}

type Status = "idle" | "listening" | "processing";

export default function VoiceInputButton({
  onTranscript,
  lang = "zh-CN",
  className = "",
  size = 18,
  disabled = false,
}: VoiceInputButtonProps) {
  const [status, setStatus] = useState<Status>("idle");
  const recognitionRef = useRef<any>(null);
  // 用 ref 持有最新的 onTranscript，避免陈旧闭包
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const w = typeof window !== "undefined" ? (window as any) : null;
  const SR = w?.SpeechRecognition || w?.webkitSpeechRecognition;
  if (!SR) return null;

  const startListening = useCallback(() => {
    // 每次点击创建全新实例，避免已结束的实例无法重启
    const r = new SR();
    r.lang = lang;
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onstart = () => setStatus("listening");

    r.onresult = (e: any) => {
      // 取最后一个 result 的最佳识别结果
      const results = Array.from(e.results as any[]);
      const final = results.filter((res: any) => res.isFinal);
      if (final.length > 0) {
        const text = (final[final.length - 1] as any)[0].transcript.trim();
        if (text) {
          setStatus("processing");
          onTranscriptRef.current(text);
          setTimeout(() => setStatus("idle"), 300);
        }
      }
    };

    r.onerror = (e: any) => {
      console.warn("[VoiceInput] error:", e.error);
      setStatus("idle");
    };

    r.onend = () => {
      // 若没有触发 onresult 就结束（比如用户没说话），也回到 idle
      setStatus((prev) => (prev === "listening" ? "idle" : prev));
    };

    recognitionRef.current = r;
    try {
      r.start();
    } catch (err) {
      console.warn("[VoiceInput] start failed:", err);
      setStatus("idle");
    }
  }, [lang]);

  const handleClick = () => {
    if (status === "listening") {
      recognitionRef.current?.stop();
      setStatus("idle");
      return;
    }
    if (status === "idle") {
      startListening();
    }
  };

  const colorMap: Record<Status, string> = {
    idle: "text-white/40 hover:text-purple-400 hover:border-purple-500/50",
    listening: "text-red-400 border-red-500/60 bg-red-500/10 animate-pulse",
    processing: "text-purple-400 border-purple-500/40",
  };

  const title =
    status === "listening"
      ? "正在录音，点击停止"
      : status === "processing"
      ? "识别中…"
      : "语音输入（点击开始）";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || status === "processing"}
      title={title}
      className={`inline-flex items-center justify-center rounded-lg border p-1.5 transition-all duration-200 disabled:opacity-40 ${colorMap[status]} ${className}`}
    >
      {status === "processing" ? (
        <Loader2 size={size} className="animate-spin" />
      ) : status === "listening" ? (
        <MicOff size={size} />
      ) : (
        <Mic size={size} />
      )}
    </button>
  );
}
