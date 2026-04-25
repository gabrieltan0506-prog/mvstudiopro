import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";

// Web Speech API — not in all TS lib versions, use any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpeechRecognition = any;

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
  lang?: string;
  className?: string;
  size?: number;
  /** append 模式：追加到现有文字；replace 模式：替换 */
  mode?: "append" | "replace";
  disabled?: boolean;
}

type Status = "idle" | "listening" | "processing";

export default function VoiceInputButton({
  onTranscript,
  lang = "zh-CN",
  className = "",
  size = 18,
  mode = "append",
  disabled = false,
}: VoiceInputButtonProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef<AnySpeechRecognition>(null);

  useEffect(() => {
    const w = window as AnySpeechRecognition;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    const r = new SR();
    r.lang = lang;
    r.continuous = false;
    r.interimResults = false;
    r.maxAlternatives = 1;

    r.onresult = (e: AnySpeechRecognition) => {
      const text = e.results[0][0].transcript;
      setStatus("idle");
      onTranscript(text);
    };
    r.onerror = () => setStatus("idle");
    r.onend = () => setStatus("idle");

    recognitionRef.current = r;
    return () => { r.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  if (!supported) return null;

  const handleClick = () => {
    const r = recognitionRef.current;
    if (!r) return;
    if (status === "listening") {
      r.stop();
      setStatus("idle");
      return;
    }
    setStatus("listening");
    r.start();
  };

  const colorMap: Record<Status, string> = {
    idle: "text-white/40 hover:text-purple-400 hover:border-purple-500/50",
    listening: "text-red-400 border-red-500/60 bg-red-500/10 animate-pulse",
    processing: "text-purple-400 border-purple-500/40",
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || status === "processing"}
      title={status === "listening" ? "点击停止录音" : "语音输入（中文）"}
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
