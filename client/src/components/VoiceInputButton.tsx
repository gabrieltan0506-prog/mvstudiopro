import { useRef, useState, useEffect } from "react";
import { Mic, MicOff, Loader2, Check } from "lucide-react";

interface VoiceInputButtonProps {
  onTranscript?: (text: string) => void;
  /** 保留原录音时不触发转写，调用方决定后续用途。 */
  onRecording?: (file: File) => Promise<void>;
  maxSeconds?: number;
  onDebugLog?: (msg: string) => void;
  className?: string;
  size?: number;
  disabled?: boolean;
}

type Status = "idle" | "listening" | "processing" | "success" | "error";

export default function VoiceInputButton({
  onTranscript,
  onRecording,
  maxSeconds = 45,
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
  const onRecordingRef = useRef(onRecording);
  const mounted = useRef(true);
  const recordingRun = useRef(0);
  useEffect(() => {
    onRecordingRef.current = onRecording;
  }, [onRecording]);
  const onDebugLogRef = useRef(onDebugLog);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);
  useEffect(() => {
    onDebugLogRef.current = onDebugLog;
  }, [onDebugLog]);

  const dbg = (msg: string) => {
    console.log("[VoiceInput]", msg);
    onDebugLogRef.current?.(`${new Date().toLocaleTimeString()} ${msg}`);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recordingRun.current++;
      if (mediaRecorderRef.current) mediaRecorderRef.current.onstop = null;
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach(track => track.stop());
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
    };
  }, []);

  const startRecording = async () => {
    if (mediaRecorderRef.current?.state === "recording") return;
    const run = ++recordingRun.current;
    setStatus("processing");
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error("当前浏览器不支持录音");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || run !== recordingRun.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      streamRef.current = stream;

      const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? { mimeType: "audio/webm;codecs=opus" }
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? { mimeType: "audio/mp4" }
          : undefined;

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
        if (!mounted.current || run !== recordingRun.current) return;
        setStatus("processing");

        const formData = new FormData();
        const mime = mediaRecorder.mimeType || "audio/webm";
        const ext = mime.includes("mp4")
          ? "m4a"
          : mime.includes("ogg")
            ? "ogg"
            : "webm";
        const audioBlob = new Blob(audioChunksRef.current, { type: mime });
        if (onRecordingRef.current) {
          try {
            if (!audioBlob.size) throw new Error("录音为空，请重新录制");
            await onRecordingRef.current(
              new File([audioBlob], `作者录音-${Date.now()}.${ext}`, {
                type: mime,
              })
            );
            if (mounted.current && run === recordingRun.current)
              setStatus("idle");
          } catch (err) {
            if (mounted.current && run === recordingRun.current) {
              dbg(String(err));
              setStatus("error");
            }
          }
          return;
        }
        formData.append("audio", audioBlob, `voice.${ext}`);

        try {
          const response = await fetch("/api/speech-to-text", {
            method: "POST",
            body: formData,
          });
          if (!response.ok) throw new Error(`API Error: ${response.status}`);

          const data = await response.json();
          if (!mounted.current || run !== recordingRun.current) return;

          if (data.text && data.text.trim() !== "") {
            dbg(`识别成功: ${data.text}`);
            onTranscriptRef.current?.(data.text);
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
          stream.getTracks().forEach(track => track.stop());
        }
      };

      mediaRecorder.start();
      setStatus("listening");
      dbg("开始录音...");

      autoStopTimerRef.current = setTimeout(
        () => {
          if (mediaRecorderRef.current?.state === "recording") {
            dbg("达到本次录音时长上限，自动停止");
            mediaRecorderRef.current.stop();
          }
        },
        Math.min(180, Math.max(1, maxSeconds)) * 1000
      );
    } catch (err) {
      streamRef.current?.getTracks().forEach(track => track.stop());
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
      if (mediaRecorderRef.current) mediaRecorderRef.current.onstop = null;
      dbg(`麦克风权限错误: ${String(err)}`);
      alert("请允许浏览器使用麦克风权限后重试");
      if (mounted.current && run === recordingRun.current) setStatus("idle");
    }
  };

  const handleClick = () => {
    if (status === "listening") {
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
      mediaRecorderRef.current?.stop();
    } else if (
      status === "idle" ||
      status === "error" ||
      status === "success"
    ) {
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
      title={
        onRecording
          ? status === "listening"
            ? "停止录音并保留原声"
            : status === "processing"
              ? "正在处理录音"
              : "录制作者原声"
          : titleMap[status]
      }
      aria-label={
        onRecording
          ? status === "listening"
            ? "停止录音并保留原声"
            : "录制作者原声"
          : titleMap[status]
      }
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
