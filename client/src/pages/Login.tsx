import React, { useState, useEffect, useCallback } from "react";

type Step = "input" | "otp";
type Tab = "email" | "phone";

interface CaptchaState {
  imageBase64: string;
  captchaId: string;
}

async function fetchCaptcha(): Promise<CaptchaState> {
  const r = await fetch("/api/auth/captcha");
  if (!r.ok) throw new Error("获取图形验证码失败");
  return r.json();
}

async function requestEmailOtp(email: string, captchaId: string, captchaText: string) {
  const r = await fetch("/api/auth/send-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, captchaId, captchaText }),
  });
  return r.json();
}

async function verifyEmailOtp(email: string, otp: string) {
  const r = await fetch("/api/auth/verify-otp", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, otp }),
  });
  return r.json();
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "13px 14px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.05)",
  color: "white",
  fontSize: 15,
  outline: "none",
  boxSizing: "border-box",
};

const btnPrimary: React.CSSProperties = {
  width: "100%",
  padding: "13px 16px",
  borderRadius: 12,
  border: "none",
  background: "linear-gradient(135deg,#8b5cf6,#ff4fb3)",
  color: "white",
  fontWeight: 900,
  fontSize: 15,
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  padding: "13px 16px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.05)",
  color: "rgba(255,255,255,0.72)",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
  whiteSpace: "nowrap" as const,
};

export default function LoginPage() {
  const [tab, setTab] = useState<Tab>("email");
  const [step, setStep] = useState<Step>("input");

  // email flow
  const [email, setEmail] = useState("");
  const [captchaInput, setCaptchaInput] = useState("");
  const [captcha, setCaptcha] = useState<CaptchaState | null>(null);
  const [otp, setOtp] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [countdown, setCountdown] = useState(0);

  const loadCaptcha = useCallback(async () => {
    try {
      const c = await fetchCaptcha();
      setCaptcha(c);
      setCaptchaInput("");
    } catch {
      setErr("图形验证码加载失败，请刷新重试");
    }
  }, []);

  useEffect(() => {
    loadCaptcha();
  }, [loadCaptcha]);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) { setErr("请输入邮箱"); return; }
    if (!captchaInput.trim()) { setErr("请输入图形验证码"); return; }
    if (!captcha) return;

    setBusy(true);
    setErr("");
    try {
      const res = await requestEmailOtp(email.trim(), captcha.captchaId, captchaInput.trim());
      if (res.ok) {
        setStep("otp");
        setCountdown(60);
      } else {
        setErr(res.error || "发送失败，请重试");
        await loadCaptcha();
      }
    } catch {
      setErr("网络错误，请重试");
      await loadCaptcha();
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp)) { setErr("请输入 6 位数字验证码"); return; }

    setBusy(true);
    setErr("");
    try {
      const res = await verifyEmailOtp(email.trim(), otp.trim());
      if (res.ok) {
        window.location.href = "/";
      } else {
        setErr(res.error || "验证失败，请重试");
      }
    } catch {
      setErr("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    if (countdown > 0 || !captcha) return;
    await loadCaptcha();
    setStep("input");
    setOtp("");
    setErr("");
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top center, rgba(139,92,246,0.18), transparent 40%), linear-gradient(180deg,#0a0814 0%,#0a0d1f 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          borderRadius: 24,
          background: "linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))",
          border: "1px solid rgba(255,255,255,0.10)",
          padding: "36px 32px 32px",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
        }}
      >
        {/* Logo / Title */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 26, fontWeight: 900, color: "white", letterSpacing: -0.5 }}>
            MV Studio Pro
          </div>
          <div style={{ marginTop: 6, color: "rgba(255,255,255,0.5)", fontSize: 14 }}>
            登录以繼續使用
          </div>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            background: "rgba(255,255,255,0.05)",
            borderRadius: 12,
            padding: 4,
            marginBottom: 24,
          }}
        >
          {(["email", "phone"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => {
                if (t === "phone") return;
                setTab(t);
                setStep("input");
                setErr("");
              }}
              style={{
                flex: 1,
                padding: "9px 0",
                borderRadius: 10,
                border: "none",
                background: tab === t ? "rgba(255,255,255,0.12)" : "transparent",
                color: t === "phone" ? "rgba(255,255,255,0.30)" : "white",
                fontWeight: tab === t ? 900 : 600,
                fontSize: 14,
                cursor: t === "phone" ? "not-allowed" : "pointer",
                transition: "all 0.18s",
                position: "relative",
              }}
            >
              {t === "email" ? "郵箱登录" : "手機登录"}
              {t === "phone" && (
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.35)",
                  }}
                >
                  即将开放
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Email Flow */}
        {tab === "email" && (
          <>
            {step === "input" && (
              <form onSubmit={handleSendOtp} style={{ display: "grid", gap: 14 }}>
                <div>
                  <label style={{ display: "block", color: "rgba(255,255,255,0.6)", fontSize: 12, marginBottom: 6, fontWeight: 700 }}>
                    郵箱地址
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    autoComplete="email"
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={{ display: "block", color: "rgba(255,255,255,0.6)", fontSize: 12, marginBottom: 6, fontWeight: 700 }}>
                    图形验证码
                  </label>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input
                      type="text"
                      value={captchaInput}
                      onChange={(e) => setCaptchaInput(e.target.value.toUpperCase())}
                      placeholder="输入图中字符"
                      maxLength={5}
                      autoComplete="off"
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    {captcha ? (
                      <img
                        src={captcha.imageBase64}
                        alt="captcha"
                        title="点击刷新"
                        onClick={loadCaptcha}
                        style={{
                          height: 44,
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.12)",
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          height: 44,
                          width: 110,
                          borderRadius: 10,
                          background: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.08)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "rgba(255,255,255,0.3)",
                          fontSize: 12,
                        }}
                      >
                        加載中…
                      </div>
                    )}
                  </div>
                  <div
                    style={{ marginTop: 6, fontSize: 11, color: "rgba(255,255,255,0.35)", cursor: "pointer" }}
                    onClick={loadCaptcha}
                  >
                    看不清？点擊图片刷新
                  </div>
                </div>

                {err && (
                  <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)", color: "#fca5a5", fontSize: 13 }}>
                    {err}
                  </div>
                )}

                <button type="submit" disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.7 : 1 }}>
                  {busy ? "发送中…" : "发送验证码"}
                </button>
              </form>
            )}

            {step === "otp" && (
              <form onSubmit={handleVerifyOtp} style={{ display: "grid", gap: 14 }}>
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: 12,
                    background: "rgba(139,92,246,0.10)",
                    border: "1px solid rgba(139,92,246,0.25)",
                    color: "rgba(255,255,255,0.78)",
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}
                >
                  验证码已发送到<br />
                  <strong style={{ color: "white" }}>{email}</strong><br />
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>请查收信箱，有效时间 10 分钟</span>
                </div>

                <div>
                  <label style={{ display: "block", color: "rgba(255,255,255,0.6)", fontSize: 12, marginBottom: 6, fontWeight: 700 }}>
                    6 位验证码
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    autoComplete="one-time-code"
                    style={{ ...inputStyle, fontSize: 22, fontWeight: 900, letterSpacing: 6, textAlign: "center" }}
                    autoFocus
                  />
                </div>

                {err && (
                  <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)", color: "#fca5a5", fontSize: 13 }}>
                    {err}
                  </div>
                )}

                <button type="submit" disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.7 : 1 }}>
                  {busy ? "验证中…" : "登录"}
                </button>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <button type="button" onClick={handleResend} style={btnSecondary} disabled={countdown > 0}>
                    {countdown > 0 ? `重新发送 (${countdown}s)` : "重新发送"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setStep("input"); setErr(""); setOtp(""); }}
                    style={{ ...btnSecondary, border: "none", background: "transparent" }}
                  >
                    修改邮箱
                  </button>
                </div>
              </form>
            )}
          </>
        )}

        {/* Phone Tab placeholder */}
        {tab === "phone" && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "rgba(255,255,255,0.35)", fontSize: 14 }}>
            手機简讯登录即将开放
          </div>
        )}

        <div style={{ marginTop: 24, textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 12 }}>
          登录即代表同意服務条款與隱私政策
        </div>
      </div>
    </div>
  );
}
