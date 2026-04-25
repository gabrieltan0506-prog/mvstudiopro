import { useRef, useState, useCallback, useEffect } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
  lang?: string;
  className?: string;
  size?: number;
  disabled?: boolean;
}

type Status = "idle" | "listening" | "processing" | "error";

export default function VoiceInputButton({
  onTranscript,
  lang = "zh-CN",
  className = "",
  size = 18,
  disabled = false,
}: VoiceInputButtonProps) {
  const [status, setStatus] = useState<Status>("idle");
  const recognitionRef = useRef<any>(null);
  const onTranscriptRef = useRef(onTranscript);

  // 保持最新的 callback 引用
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  // 组件卸载时，强制释放麦克风资源
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  const w = typeof window !== "undefined" ? (window as any) : null;
  const SR = w?.SpeechRecognition || w?.webkitSpeechRecognition;

  const startListening = useCallback(() => {
    if (!SR) {
      alert("抱歉，您的浏览器不支持语音识别，请使用 Chrome 或 Edge 浏览器。");
      return;
    }

    // 每次点击创建干净的实例
    const r = new SR();
    r.lang = lang;
    r.continuous = false;
    r.interimResults = false; // 只接收最终结果，避免 isFinal 假死
    r.maxAlternatives = 1;

    r.onstart = () => {
      setStatus("listening");
    };

    r.onresult = (e: any) => {
      setStatus("processing");
      let finalTranscript = "";

      // 稳健地组合所有识别结果
      for (let i = e.resultIndex; i < e.results.length; ++i) {
        if (e.results[i].isFinal) {
          finalTranscript += e.results[i][0].transcript;
        }
      }

      const cleanText = finalTranscript.trim();
      if (cleanText) {
        onTranscriptRef.current(cleanText);
      }

      setTimeout(() => setStatus("idle"), 300);
    };

    r.onerror = (e: any) => {
      console.warn("[VoiceInput] 语音识别发生错误:", e.error);
      if (e.error === "not-allowed") {
        alert("请允许浏览器使用您的麦克风。");
      }
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2000);
    };

    r.onend = () => {
      // 确保即使没有结果，状态也能正确重置
      setStatus((prev) => (prev === "listening" ? "idle" : prev));
    };

    recognitionRef.current = r;

    try {
      r.start();
    } catch (err) {
      console.error("[VoiceInput] 启动失败，可能是实例冲突:", err);
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2000);
    }
  }, [lang, SR]);

  const handleClick = () => {
    if (status === "listening") {
      recognitionRef.current?.stop();
      setStatus("processing");
      return;
    }
    if (status === "idle" || status === "error") {
      startListening();
    }
  };

  if (!SR) return null;

  const styleMap: Record<Status, string> = {
    idle: "text-gray-400 hover:text-blue-400 hover:border-blue-500/50 border-transparent",
    listening: "text-red-400 border-red-500/60 bg-red-500/10 animate-pulse",
    processing: "text-blue-400 border-blue-500/40 bg-blue-500/10",
    error: "text-yellow-500 border-yellow-500/50 bg-yellow-500/10",
  };

  const titleMap: Record<Status, string> = {
    idle: "语音输入（点击开始）",
    listening: "正在录音... （点击结束并输入）",
    processing: "识别中...",
    error: "识别失败，请重试",
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || status === "processing"}
      title={titleMap[status]}
      className={`inline-flex items-center justify-center rounded-xl border p-2.5 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${styleMap[status]} ${className}`}
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
