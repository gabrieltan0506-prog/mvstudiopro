import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, MessageSquare, Gift, CheckCircle, ArrowRight } from "lucide-react";

export default function HomeFeedback() {
  const { isAuthenticated } = useAuth({ autoFetch: true, redirectOnUnauthenticated: false });
  const [form, setForm] = useState({ subject: "", message: "" });
  const [done, setDone] = useState(false);

  const submitMutation = trpc.feedback.submit.useMutation({
    onSuccess: () => setDone(true),
    onError: (err) => toast.error(err.message || "提交失败，请稍后重试"),
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.subject.trim() || !form.message.trim()) {
      toast.error("请填写标题和反馈内容");
      return;
    }
    submitMutation.mutate(form);
  };

  return (
    <section style={{ maxWidth: 1240, margin: "64px auto 0", padding: "0 20px" }}>
      <div
        style={{
          borderRadius: 28,
          border: "1.5px solid rgba(73,230,255,0.18)",
          background: "linear-gradient(135deg,rgba(19,9,46,0.92) 0%,rgba(10,6,25,0.96) 100%)",
          padding: "48px 40px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 48,
          alignItems: "center",
        }}
        className="max-md:!grid-cols-1 max-md:!gap-8 max-md:!px-6 max-md:!py-8"
      >
        {/* Left: intro */}
        <div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              borderRadius: 999,
              border: "1px solid rgba(73,230,255,0.25)",
              background: "rgba(73,230,255,0.08)",
              padding: "6px 16px",
              marginBottom: 20,
            }}
          >
            <Gift size={14} style={{ color: "#49e6ff" }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: "#8cefff", letterSpacing: "0.14em", textTransform: "uppercase" }}>
              用戶回饋
            </span>
          </div>

          <h2 style={{ fontSize: 30, fontWeight: 900, color: "#fff", lineHeight: 1.25, margin: "0 0 16px" }}>
            說說你的想法，
            <br />
            <span style={{ color: "#49e6ff" }}>送你 100 積分</span>
          </h2>

          <p style={{ fontSize: 15, color: "rgba(200,191,231,0.85)", lineHeight: 1.8, margin: 0 }}>
            我們真心希望聽到你的使用感受。每一條被採納的建議都會為你帳戶發放
            <strong style={{ color: "#fff" }}> 100 Credits</strong>，
            可直接用於成長營分析、平台趨勢、節點工作流等所有功能。
          </p>

          <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              "功能建議或 Bug 回報",
              "使用體驗改進意見",
              "行業洞察或內容需求",
            ].map((item) => (
              <div key={item} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <CheckCircle size={16} style={{ color: "#49e6ff", flexShrink: 0 }} />
                <span style={{ fontSize: 14, color: "rgba(200,191,231,0.8)" }}>{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: form */}
        <div>
          {done ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px 24px",
                borderRadius: 20,
                border: "1.5px solid rgba(73,230,255,0.2)",
                background: "rgba(73,230,255,0.06)",
              }}
            >
              <CheckCircle size={48} style={{ color: "#49e6ff", margin: "0 auto 16px" }} />
              <p style={{ fontSize: 18, fontWeight: 800, color: "#fff", margin: "0 0 8px" }}>感謝你的反饋！</p>
              <p style={{ fontSize: 14, color: "rgba(200,191,231,0.75)", margin: 0 }}>
                我們已收到，若建議被採納將發放 100 Credits 至你的帳戶。
              </p>
            </div>
          ) : !isAuthenticated ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px 24px",
                borderRadius: 20,
                border: "1.5px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <MessageSquare size={40} style={{ color: "#8cefff", margin: "0 auto 16px" }} />
              <p style={{ fontSize: 15, color: "rgba(200,191,231,0.8)", margin: "0 0 20px" }}>
                登入後即可提交回饋並獲得積分獎勵
              </p>
              <a
                href="/auth"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  borderRadius: 999,
                  padding: "12px 28px",
                  background: "linear-gradient(135deg,#15c8ff,#6a5cff)",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 14,
                  textDecoration: "none",
                }}
              >
                立即登入 <ArrowRight size={16} />
              </a>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "rgba(140,239,255,0.8)", marginBottom: 6, letterSpacing: "0.08em" }}>
                  標題
                </label>
                <input
                  type="text"
                  value={form.subject}
                  onChange={set("subject")}
                  maxLength={120}
                  placeholder="例：希望支持批量導出"
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 12,
                    border: "1.5px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.05)",
                    color: "#fff",
                    fontSize: 14,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "rgba(140,239,255,0.8)", marginBottom: 6, letterSpacing: "0.08em" }}>
                  詳細描述
                </label>
                <textarea
                  value={form.message}
                  onChange={set("message")}
                  maxLength={4000}
                  rows={5}
                  placeholder="請描述你的建議、問題或使用場景..."
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 12,
                    border: "1.5px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.05)",
                    color: "#fff",
                    fontSize: 14,
                    outline: "none",
                    resize: "vertical",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={submitMutation.isPending}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  padding: "13px 0",
                  borderRadius: 14,
                  border: "none",
                  background: submitMutation.isPending
                    ? "rgba(73,230,255,0.25)"
                    : "linear-gradient(135deg,#15c8ff,#6a5cff)",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 15,
                  cursor: submitMutation.isPending ? "not-allowed" : "pointer",
                  transition: "opacity 0.15s",
                }}
              >
                {submitMutation.isPending ? (
                  <><Loader2 size={16} className="animate-spin" /> 提交中…</>
                ) : (
                  <>提交回饋 · 獲取 100 積分 <Gift size={16} /></>
                )}
              </button>

              <p style={{ fontSize: 12, color: "rgba(140,130,180,0.6)", textAlign: "center", margin: 0 }}>
                建議被採納後積分自動入帳，郵件通知
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
