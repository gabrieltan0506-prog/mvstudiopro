import React, { useCallback, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Send } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

/**
 * 首页智能向导：和善引导站内付费能力（后端 Gemini 3.1 Pro）。
 */
export default function HomeProductGuide() {
  const { isAuthenticated } = useAuth({ autoFetch: true });
  const [q, setQ] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const mutation = trpc.mvAnalysis.homeProductGuide.useMutation({
    onSuccess: (data) => {
      setReply(data.reply);
      toast.success(`已回复（本次消耗 ${data.creditsCost} 点）`);
    },
    onError: (e) => toast.error(e.message || "请求失败"),
  });

  const toggleVoice = useCallback(async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("当前浏览器不支持录音");
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
        if (!blob.size) {
          toast.error("录音为空");
          return;
        }
        setIsTranscribing(true);
        try {
          const buf = await blob.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          const base64 = btoa(binary);
          const r = await fetch("/api/google?op=transcribeAudio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64: base64, mimeType: mimeType.split(";")[0] }),
          });
          const data = await r.json().catch(() => ({}));
          const text = String(data?.text || "").trim();
          if (text) setQ((prev) => (prev ? `${prev} ${text}` : text));
          else toast.error("转写结果为空");
        } catch (e: any) {
          toast.error(e?.message || "转写失败");
        } finally {
          setIsTranscribing(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (e: any) {
      toast.error(e?.message || "无法开始录音");
    }
  }, [isRecording]);

  const submit = () => {
    const t = q.trim();
    if (!t) {
      toast.error("请先输入问题");
      return;
    }
    if (!isAuthenticated) {
      toast.error("请先登录再使用智能向导");
      return;
    }
    mutation.mutate({ message: t });
  };

  return (
    <div
      style={{
        marginTop: 18,
        padding: 16,
        borderRadius: 18,
        background: "rgba(12,18,40,0.72)",
        border: "1px solid rgba(99,102,241,0.35)",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 800, color: "#c7d2fe", marginBottom: 8 }}>站内智能向导</div>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.6, marginBottom: 10 }}>
        随便问：适合用哪个功能、大约多少积分、怎么开始。每次约 2 点，回答由 Gemini 3.1 Pro 生成。
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={isAuthenticated ? "例如：想做深度行业报告该去哪？" : "登录后可提问…"}
          disabled={!isAuthenticated || mutation.isPending}
          rows={3}
          style={{
            flex: 1,
            minWidth: 0,
            resize: "vertical",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(0,0,0,0.35)",
            color: "#fff",
            padding: "10px 12px",
            fontSize: 14,
            lineHeight: 1.55,
            outline: "none",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            type="button"
            onClick={toggleVoice}
            disabled={!isAuthenticated || isTranscribing || mutation.isPending}
            title="语音输入"
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: 12,
              border: isRecording ? "1px solid rgba(239,68,68,0.5)" : "1px solid rgba(255,255,255,0.15)",
              background: isRecording ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.06)",
              color: "#fff",
              cursor: !isAuthenticated || isTranscribing ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isTranscribing ? <Loader2 className="h-5 w-5 animate-spin" /> : isRecording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!isAuthenticated || mutation.isPending || !q.trim()}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: 12,
              border: "none",
              background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
              color: "#fff",
              fontWeight: 800,
              cursor: !isAuthenticated || mutation.isPending ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              opacity: !isAuthenticated || mutation.isPending ? 0.5 : 1,
            }}
          >
            {mutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {reply ? (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            background: "rgba(99,102,241,0.08)",
            border: "1px solid rgba(165,180,252,0.25)",
            color: "rgba(255,255,255,0.82)",
            fontSize: 14,
            lineHeight: 1.75,
            whiteSpace: "pre-wrap",
          }}
        >
          {reply}
        </div>
      ) : null}
    </div>
  );
}
