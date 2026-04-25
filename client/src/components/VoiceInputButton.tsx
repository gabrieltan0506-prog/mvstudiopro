import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";

type SpeechRecognitionEvent = Event & {
  results: SpeechRecognitionResultList;
  error?: string;
};

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
  lang?: string;
  className?: string;
  size?: number;
  /** append 模式：追加到現有文字；replace 模式：替換 */
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
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    const r = new SR();
    r.lang = lang;
    r.continuous = false;
    r.interimResults = false;
    r.maxAlternatives = 1;

    r.onresult = (e: SpeechRecognitionEvent) => {
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
      title={status === "listening" ? "點擊停止錄音" : "語音輸入（中文）"}
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
