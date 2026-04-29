import React, { useCallback, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Crown } from "lucide-react";
import { toast } from "sonner";

export type UploadedAgentFile = {
  name: string;
  type: "image" | "pdf";
  mimeType: string;
  url: string;
  gcsUri: string;
};

interface AgentInputPanelProps {
  /** 主输入区 placeholder */
  placeholder?: string;
  /** 主输入区初始值（仅首次渲染） */
  initialText?: string;
  /** 字数上限（默认 4000） */
  maxLen?: number;
  /** 文件数上限（默认 5） */
  maxFiles?: number;
  /** 提交按钮文案 */
  submitLabel?: string;
  /** 外部传入的提交中状态 */
  submitting?: boolean;
  /** 是否需要必填校验（默认 true）。textRequired 为 true 时 text 为空则禁用提交。 */
  textRequired?: boolean;
  /** 提交回调（父级处理 mutate） */
  onSubmit: (input: { text: string; files: UploadedAgentFile[] }) => void | Promise<void>;
  /** 父级控制的关闭/重置触发 key（变化时清空内部状态） */
  resetKey?: number | string;
  /** 备注/小提示文案（按钮下方） */
  hint?: string;
  /** 受控外部状态：传入则改为受控模式 */
  value?: string;
  onValueChange?: (v: string) => void;
}

/**
 * 通用 Agent 交互面板：
 * - 大文本框（语音输入会覆盖文本）
 * - 文件上传（图片 PNG/JPG/WEBP + PDF，最大 100MB/个，存 GCS）
 * - 语音录制 → /api/google?op=transcribeAudio 转录
 * - 提交按钮
 */
export default function AgentInputPanel(props: AgentInputPanelProps) {
  const {
    placeholder = "请输入您的诉求...",
    initialText = "",
    maxLen = 4000,
    maxFiles = 5,
    submitLabel = "提交给 Agent",
    submitting = false,
    textRequired = true,
    onSubmit,
    resetKey,
    hint,
    value,
    onValueChange,
  } = props;

  const isControlled = typeof value === "string" && typeof onValueChange === "function";
  const [internalText, setInternalText] = useState(initialText);
  const text = isControlled ? value! : internalText;
  const setText = (v: string) => (isControlled ? onValueChange!(v) : setInternalText(v));

  const [files, setFiles] = useState<UploadedAgentFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 重置：父级传入新的 resetKey 时清空
  React.useEffect(() => {
    if (resetKey === undefined) return;
    setInternalText("");
    setFiles([]);
  }, [resetKey]);

  // ── 文件上传（GCS） ───────────────────────────────────────────────────────
  const handleFileAdd = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    if (e.target) e.target.value = "";
    const remaining = maxFiles - files.length;
    if (!remaining) {
      toast.error(`最多只能上传 ${maxFiles} 个文件，请先移除部分文件`);
      return;
    }
    if (picked.length > remaining) {
      toast.warning(`本次只能再上传 ${remaining} 个文件，超出部分已忽略`);
    }

    setUploading(true);
    let okCount = 0;
    let failCount = 0;
    try {
      for (const file of picked.slice(0, remaining)) {
        const isImage = file.type.startsWith("image/");
        const isPdf = file.type === "application/pdf";
        if (!isImage && !isPdf) {
          toast.error(`「${file.name}」不支持，仅接受图片或 PDF`);
          failCount++;
          continue;
        }
        if (file.size > 100 * 1024 * 1024) {
          toast.error(`「${file.name}」超过 100MB 上限（${(file.size / 1024 / 1024).toFixed(1)}MB）`);
          failCount++;
          continue;
        }

        const sizeMB = (file.size / 1024 / 1024).toFixed(1);
        const tid = toast.loading(`正在上传「${file.name}」（${sizeMB}MB）…`);
        try {
          const fd = new FormData();
          fd.append("file", file);
          const res = await fetch("/api/magazine/upload", { method: "POST", body: fd });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            toast.error(`上传「${file.name}」失败：${err?.error || `HTTP ${res.status}`}`, { id: tid });
            failCount++;
            continue;
          }
          const data = await res.json();
          if (!data?.url || !data?.gcsUri) {
            toast.error(`上传「${file.name}」失败：服务器未返回文件链接`, { id: tid });
            failCount++;
            continue;
          }
          setFiles((prev) => [
            ...prev,
            {
              name: file.name,
              type: isImage ? "image" : "pdf",
              mimeType: file.type,
              url: data.url,
              gcsUri: data.gcsUri,
            },
          ]);
          toast.success(`「${file.name}」上传成功（${sizeMB}MB）`, { id: tid });
          okCount++;
        } catch (netErr: any) {
          toast.error(`上传「${file.name}」网络异常：${netErr?.message || "请检查网络后重试"}`, { id: tid });
          failCount++;
        }
      }
      if (okCount > 1 || (okCount > 0 && failCount > 0)) {
        toast.success(`本次上传完成：成功 ${okCount} 个${failCount ? `，失败 ${failCount} 个` : ""}`);
      }
    } finally {
      setUploading(false);
    }
  };

  // ── 语音输入（MediaRecorder → /api/google?op=transcribeAudio） ──────────
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const toggleVoice = useCallback(async () => {
    if (isRecording) {
      recorderRef.current?.stop();
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
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (!blob.size) {
          toast.error("录音内容为空，请重试");
          return;
        }
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
          const transcribed = String(data?.text || "").trim();
          if (transcribed) {
            // 追加到现有内容（不覆盖）
            setText(text ? `${text}\n${transcribed}` : transcribed);
            toast.success("已追加语音转录");
          } else {
            toast.error("转录结果为空，请重试");
          }
        } catch (e: any) {
          toast.error(`转录失败：${e?.message}`);
        } finally {
          setIsTranscribing(false);
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (e: any) {
      toast.error(`录音失败：${e?.message}`);
    }
  }, [isRecording, text]);

  const canSubmit = !submitting && !uploading && (!textRequired || text.trim().length > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 主输入框 + 语音按钮 */}
      <div style={{ position: "relative" }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, maxLen))}
          placeholder={placeholder}
          rows={5}
          style={{
            width: "100%",
            minHeight: 120,
            padding: "14px 60px 14px 16px",
            borderRadius: 12,
            background: "rgba(0,0,0,0.30)",
            border: "1px solid rgba(168,118,27,0.30)",
            color: "rgba(245,235,210,0.92)",
            fontSize: 14,
            lineHeight: 1.7,
            resize: "vertical",
            outline: "none",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        />
        {/* 字数 + 语音按钮 */}
        <div style={{ position: "absolute", right: 10, top: 10, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <button
            type="button"
            onClick={toggleVoice}
            disabled={isTranscribing}
            title={isRecording ? "点击停止录音" : isTranscribing ? "转录中…" : "语音输入（追加到文本）"}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: 10,
              background: isRecording ? "rgba(220,38,38,0.18)" : isTranscribing ? "rgba(217,119,6,0.18)" : "rgba(168,118,27,0.18)",
              border: isRecording ? "1px solid rgba(220,38,38,0.55)" : isTranscribing ? "1px solid rgba(217,119,6,0.45)" : "1px solid rgba(168,118,27,0.45)",
              color: isRecording ? "#dc2626" : isTranscribing ? "#d97706" : "#d6a861",
              cursor: isTranscribing ? "wait" : "pointer",
              animation: isRecording ? "agent-mic-pulse 1.2s ease-in-out infinite" : "none",
            }}
          >
            {isRecording ? <MicOff size={16} /> : isTranscribing ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
          </button>
        </div>
        <div style={{ position: "absolute", right: 14, bottom: 10, fontSize: 11, color: "rgba(168,118,27,0.55)", fontFamily: "monospace" }}>
          {text.length} / {maxLen}
        </div>
      </div>

      {/* 文件上传区 */}
      <div>
        <p style={{ fontSize: 12, color: "rgba(160,140,90,0.85)", margin: "0 0 8px", fontWeight: 600 }}>
          上传补充材料（最多 {maxFiles} 个，PNG/JPG/WEBP/PDF，每个 ≤ 100MB）
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {files.map((f, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                background: "rgba(168,118,27,0.10)",
                border: "1px solid rgba(168,118,27,0.30)",
                borderRadius: 10,
                fontSize: 12,
                color: "#d6a861",
              }}
            >
              <span>{f.type === "image" ? "🖼️" : "📄"}</span>
              <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.name}>
                {f.name}
              </span>
              <span style={{ fontSize: 10, opacity: 0.6 }}>✓</span>
              <button
                type="button"
                onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#a87020", fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 2 }}
              >
                ×
              </button>
            </div>
          ))}
          {uploading && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 14px",
                background: "rgba(168,118,27,0.05)",
                border: "1px dashed rgba(168,118,27,0.40)",
                borderRadius: 10,
                fontSize: 12,
                color: "#d6a861",
              }}
            >
              <Loader2 size={12} className="animate-spin" /> 上传中…
            </div>
          )}
          {files.length < maxFiles && !uploading && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 14px",
                background: "rgba(168,118,27,0.06)",
                border: "1px dashed rgba(168,118,27,0.45)",
                borderRadius: 10,
                cursor: "pointer",
                color: "#d6a861",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              + 添加文件
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            multiple
            style={{ display: "none" }}
            onChange={handleFileAdd}
          />
        </div>
      </div>

      {/* 提交按钮 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => {
            if (!canSubmit) return;
            void onSubmit({ text: text.trim(), files });
          }}
          disabled={!canSubmit}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "13px 28px",
            borderRadius: 12,
            background: canSubmit ? "linear-gradient(135deg,#a8761b,#7a5410)" : "rgba(168,118,27,0.20)",
            border: "1px solid rgba(168,118,27,0.55)",
            color: canSubmit ? "#fff7df" : "rgba(245,235,210,0.45)",
            fontWeight: 900,
            fontSize: 14,
            cursor: canSubmit ? "pointer" : "not-allowed",
            boxShadow: canSubmit ? "0 4px 18px rgba(168,118,27,0.40)" : "none",
          }}
        >
          {submitting ? <Loader2 size={15} className="animate-spin" /> : <Crown size={15} />}
          {submitting ? "派发中…" : submitLabel}
        </button>
        {hint && <span style={{ fontSize: 11, color: "rgba(160,140,90,0.65)" }}>{hint}</span>}
      </div>

      <style>{`
        @keyframes agent-mic-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(220,38,38,0.5); }
          50%      { box-shadow: 0 0 0 8px rgba(220,38,38,0); }
        }
      `}</style>
    </div>
  );
}
