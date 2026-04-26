import { useRef, useState, useEffect } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
  className?: string;
  size?: number;
  disabled?: boolean;
}

type Status = "idle" | "listening" | "processing" | "error";

export default function VoiceInputButton({
  onTranscript,
  className = "",
  size = 18,
  disabled = false,
}: VoiceInputButtonProps) {
  const [status, setStatus] = useState<Status>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  // 组件卸载时强制停止录音并释放麦克风
  useEffect(() => {
    return () => {
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current?.stream
        .getTracks()
        .forEach((track) => track.stop());
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        setStatus("processing");
        const audioBlob = new Blob(audioChunksRef.current, {
          type: "audio/webm",
        });
        const formData = new FormData();
        formData.append("audio", audioBlob, "voice.webm");

        try {
          const response = await fetch("/api/speech-to-text", {
            method: "POST",
            body: formData,
          });
          if (!response.ok) throw new Error(`API ${response.status}`);
          const data = await response.json();
          if (data.text) onTranscript(data.text);
          setStatus("idle");
        } catch (err) {
          console.error("[VoiceInput] API error:", err);
          setStatus("error");
          setTimeout(() => setStatus("idle"), 2000);
        } finally {
          stream.getTracks().forEach((track) => track.stop());
        }
      };

      mediaRecorder.start();
      setStatus("listening");
    } catch {
      alert("请允许浏览器使用麦克风权限后重试。");
      setStatus("idle");
    }
  };

  const handleClick = () => {
    if (status === "listening") {
      mediaRecorderRef.current?.stop();
    } else if (status === "idle" || status === "error") {
      startRecording();
    }
  };

  const styleMap: Record<Status, string> = {
    idle: "text-gray-400 hover:text-blue-400 hover:border-blue-500/50 border-transparent",
    listening: "text-red-400 border-red-500/60 bg-red-500/10 animate-pulse",
    processing: "text-blue-400 border-blue-500/40 bg-blue-500/10",
    error: "text-yellow-500 border-yellow-500/50 bg-yellow-500/10",
  };

  const titleMap: Record<Status, string> = {
    idle: "语音输入（点击开始录音）",
    listening: "录音中… 点击停止并识别",
    processing: "识别中，请稍候…",
    error: "识别失败，点击重试",
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
