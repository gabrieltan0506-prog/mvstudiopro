import { useRef, useState, useEffect } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
  onDebugLog?: (msg: string) => void;
  className?: string;
  size?: number;
  disabled?: boolean;
}

type Status = "idle" | "listening" | "processing" | "error";

export default function VoiceInputButton({
  onTranscript,
  onDebugLog,
  className = "",
  size = 18,
  disabled = false,
}: VoiceInputButtonProps) {
  const [status, setStatus] = useState<Status>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const onDebugLogRef = useRef(onDebugLog);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onDebugLogRef.current = onDebugLog; }, [onDebugLog]);

  const dbg = (msg: string) => {
    console.log("[VoiceInput]", msg);
    onDebugLogRef.current?.(`${new Date().toLocaleTimeString()} ${msg}`);
  };

  // 组件卸载时强制停止录音并释放麦克风
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const startRecording = async () => {
    try {
      dbg("① 請求麥克風權限…");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      dbg(`② 麥克風已取得，mimeType=${mimeType}`);
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
          dbg(`③ 收到音頻塊 size=${e.data.size}`);
        }
      };

      mediaRecorder.onstop = async () => {
        setStatus("processing");
        const totalSize = audioChunksRef.current.reduce((s, b) => s + (b instanceof Blob ? b.size : (b as ArrayBuffer).byteLength ?? 0), 0);
        dbg(`④ 錄音停止，chunks=${audioChunksRef.current.length} totalBytes≈${totalSize}`);
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        dbg(`⑤ Blob 大小=${audioBlob.size} type=${audioBlob.type}`);
        const formData = new FormData();
        formData.append("audio", audioBlob, "voice.webm");

        try {
          dbg("⑥ 發送 POST /api/speech-to-text…");
          const response = await fetch("/api/speech-to-text", {
            method: "POST",
            body: formData,
          });
          dbg(`⑦ HTTP 回應 status=${response.status}`);
          if (!response.ok) {
            const errText = await response.text();
            dbg(`❌ API 錯誤 ${response.status}: ${errText.slice(0, 200)}`);
            throw new Error(`API ${response.status}`);
          }
          const data = await response.json();
          dbg(`⑧ 返回 text="${data.text ?? "(空)"}"`);
          if (data.text) {
            onTranscriptRef.current(data.text);
            dbg("⑨ onTranscript 已調用 ✅");
          } else {
            dbg("⑨ text 為空，未調用 onTranscript");
          }
          setStatus("idle");
        } catch (err) {
          console.error("[VoiceInput] API error:", err);
          dbg(`❌ catch: ${String(err)}`);
          setStatus("error");
          setTimeout(() => setStatus("idle"), 2000);
        } finally {
          stream.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          dbg("⑩ 麥克風軌道已釋放");
        }
      };

      mediaRecorder.start();
      setStatus("listening");
      dbg("② 錄音開始，等待停止…");
      // 45 秒自動停止，避免超過 GCP sync API 1 分鐘上限
      autoStopTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          dbg("⏰ 45秒自動停止");
          mediaRecorderRef.current.stop();
        }
      }, 45000);
    } catch (err) {
      dbg(`❌ 麥克風錯誤: ${String(err)}`);
      alert("请允许浏览器使用麦克风权限后重试。");
      setStatus("idle");
    }
  };

  const handleClick = () => {
    if (status === "listening") {
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
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
