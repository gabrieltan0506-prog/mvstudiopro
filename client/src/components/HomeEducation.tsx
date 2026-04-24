import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, GraduationCap, CheckCircle } from "lucide-react";

export default function HomeEducation() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", organization: "", message: "" });
  const [done, setDone] = useState(false);

  const inquiryMutation = trpc.education.inquiry.useMutation();

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      toast.error("请填写姓名和邮箱");
      return;
    }
    try {
      await inquiryMutation.mutateAsync(form);
      setDone(true);
    } catch (err: any) {
      toast.error(err.message || "提交失败，请稍后重试");
    }
  };

  return (
    <section style={{ maxWidth: 1240, margin: "48px auto 0", padding: "0 20px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 0,
          borderRadius: 24,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
        }}
      >
        {/* 左：介绍 */}
        <div
          style={{
            padding: "48px 44px",
            background:
              "linear-gradient(140deg,rgba(255,107,53,0.14) 0%,rgba(139,92,246,0.10) 60%,transparent 100%)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: "rgba(255,107,53,0.18)",
                border: "1px solid rgba(255,107,53,0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <GraduationCap size={26} color="#FF6B35" />
            </div>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#FF6B35",
                letterSpacing: 0.8,
                textTransform: "uppercase",
              }}
            >
              教育合作计划
            </span>
          </div>

          <h2
            style={{
              fontSize: "clamp(24px,3vw,36px)",
              fontWeight: 900,
              color: "#f7f4ef",
              lineHeight: 1.25,
              margin: 0,
            }}
          >
            为院校 & 培训机构
            <br />
            定制 AI 创作课程
          </h2>

          <p style={{ fontSize: 15, color: "rgba(255,255,255,0.62)", lineHeight: 1.75, margin: 0 }}>
            MV Studio Pro 与高校、职业院校及内容创作培训机构深度合作，提供：
          </p>

          <ul style={{ paddingLeft: 0, listStyle: "none", margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              "专属课程包 & 批量 Credits 授权",
              "驻场培训 / 远程直播教学支持",
              "学员作品展示 & 平台流量支持",
              "教学素材库 & 案例课件共创",
            ].map((item) => (
              <li key={item} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, color: "rgba(255,255,255,0.72)" }}>
                <span style={{ color: "#FF6B35", fontWeight: 900, marginTop: 1 }}>✓</span>
                {item}
              </li>
            ))}
          </ul>

          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: 0, marginTop: 4 }}>
            填写右侧表单，我们将在 1-2 个工作日内联系您
          </p>
        </div>

        {/* 右：表单 */}
        <div style={{ padding: "48px 44px", background: "rgba(0,0,0,0.25)" }}>
          {done ? (
            <div
              style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 16,
                textAlign: "center",
              }}
            >
              <CheckCircle size={60} color="#4ade80" />
              <p style={{ fontSize: 22, fontWeight: 900, color: "#f7f4ef", margin: 0 }}>洽询已提交！</p>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", margin: 0 }}>
                我们会在 1-2 个工作日内通过邮件或电话与您联系。
              </p>
              <button
                onClick={() => { setDone(false); setForm({ name: "", email: "", phone: "", organization: "", message: "" }); }}
                style={{
                  marginTop: 8,
                  padding: "10px 24px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "transparent",
                  color: "rgba(255,255,255,0.7)",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                再次填写
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <h3 style={{ fontSize: 20, fontWeight: 800, color: "#f7f4ef", margin: 0 }}>留下联系方式</h3>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="姓名 *" value={form.name} onChange={set("name")} placeholder="您的姓名" />
                <Field label="邮箱 *" type="email" value={form.email} onChange={set("email")} placeholder="email@example.com" />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="联系电话" value={form.phone} onChange={set("phone")} placeholder="手机 / 微信号" />
                <Field label="所在机构 / 院校" value={form.organization} onChange={set("organization")} placeholder="学校或机构名称" />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>合作需求（选填）</label>
                <textarea
                  rows={3}
                  value={form.message}
                  onChange={set("message")}
                  placeholder="简述合作场景、学员规模或其他需求..."
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 12,
                    padding: "10px 14px",
                    color: "#f7f4ef",
                    fontSize: 14,
                    resize: "vertical",
                    outline: "none",
                    fontFamily: "inherit",
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={inquiryMutation.isPending}
                style={{
                  padding: "14px 0",
                  borderRadius: 14,
                  background: inquiryMutation.isPending ? "rgba(255,107,53,0.5)" : "#FF6B35",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 16,
                  border: "none",
                  cursor: inquiryMutation.isPending ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                {inquiryMutation.isPending && <Loader2 size={18} className="animate-spin" />}
                {inquiryMutation.isPending ? "提交中..." : "提交洽询"}
              </button>

              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", textAlign: "center", margin: 0 }}>
                提交即表示同意我们通过邮件或电话回访
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function Field({
  label, value, onChange, placeholder, type = "text",
}: {
  label: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string; type?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        style={{
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 12,
          padding: "10px 14px",
          color: "#f7f4ef",
          fontSize: 14,
          outline: "none",
          fontFamily: "inherit",
          width: "100%",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}
