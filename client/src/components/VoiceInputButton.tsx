import { useRef, useState, useEffect } from "react";
import { Mic, MicOff, Loader2, Check } from "lucide-react";

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
  onDebugLog?: (msg: string) => void;
  className?: string;
  size?: number;
  disabled?: boolean;
}

type Status = "idle" | "listening" | "processing" | "success" | "error";

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

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? { mimeType: "audio/webm;codecs=opus" }
        : undefined;

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        setStatus("processing");
        dbg("录音结束，正在发送至 GCP...");

        const formData = new FormData();
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        formData.append("audio", audioBlob, "voice.webm");

        try {
          const response = await fetch("/api/speech-to-text", { method: "POST", body: formData });
          if (!response.ok) throw new Error(`API Error: ${response.status}`);

          const data = await response.json();

          if (data.text && data.text.trim() !== "") {
            dbg(`识别成功: ${data.text}`);
            onTranscriptRef.current(data.text);
            setStatus("success");
            setTimeout(() => setStatus("idle"), 1500);
          } else {
            dbg("GCP 返回空字符串（可能无声音或太短）");
            alert("未识别到语音或声音太小，请重试");
            setStatus("error");
            setTimeout(() => setStatus("idle"), 2000);
          }
        } catch (err) {
          dbg(`上传失败: ${String(err)}`);
          setStatus("error");
          setTimeout(() => setStatus("idle"), 2000);
        } finally {
          stream.getTracks().forEach((track) => track.stop());
        }
      };

      mediaRecorder.start();
      setStatus("listening");
      dbg("开始录音...");

      autoStopTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          dbg("达到 45 秒上限，自动停止");
          mediaRecorderRef.current.stop();
        }
      }, 45000);
    } catch (err) {
      dbg(`麦克风权限错误: ${String(err)}`);
      alert("请允许浏览器使用麦克风权限后重试");
      setStatus("idle");
    }
  };

  const handleClick = () => {
    if (status === "listening") {
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
      mediaRecorderRef.current?.stop();
    } else if (status === "idle" || status === "error" || status === "success") {
      startRecording();
    }
  };

  const styleMap: Record<Status, string> = {
    idle: "text-gray-400 hover:text-blue-400 hover:border-blue-500/50 border-transparent",
    listening: "text-red-400 border-red-500/60 bg-red-500/10 animate-pulse",
    processing: "text-blue-400 border-blue-500/40 bg-blue-500/10",
    success: "text-green-500 border-green-500/50 bg-green-500/10",
    error: "text-yellow-500 border-yellow-500/50 bg-yellow-500/10",
  };

  const titleMap: Record<Status, string> = {
    idle: "语音输入（点击开始录音）",
    listening: "录音中… 点击停止并识别",
    processing: "识别中，请稍候…",
    success: "识别成功！",
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
      ) : status === "success" ? (
        <Check size={size} />
      ) : (
        <Mic size={size} />
      )}
    </button>
  );
}
