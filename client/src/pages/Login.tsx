import React, { useState, useEffect, useCallback } from "react";

type Mode = "otp" | "password";
type OtpStep = "input" | "otp";

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

/** 调用 tRPC emailAuth.login mutation（/api/trpc batch 格式） */
async function loginWithPassword(email: string, password: string) {
  const r = await fetch("/api/trpc/emailAuth.login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: { email, password } }),
  });
  const json = await r.json();
  // tRPC batch response 格式：[{ result: { data: ... } }] 或 [{ error: ... }]
  const item = Array.isArray(json) ? json[0] : json;
  if (item?.error) {
    const msg = item.error?.json?.message || item.error?.message || "登录失败，请检查邮箱和密码";
    throw new Error(msg);
  }
  return item?.result?.data ?? item;
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

// ─── OTP 登录流程 ───────────────────────────────────────────────────────────

function OtpFlow() {
  const [step, setStep] = useState<OtpStep>("input");
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

  useEffect(() => { loadCaptcha(); }, [loadCaptcha]);

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
        // 首次登录后导到个人中心，方便设定密码
        window.location.href = "/dashboard";
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
    <>
      {step === "input" && (
        <form onSubmit={handleSendOtp} style={{ display: "grid", gap: 14 }}>
          <div>
            <label style={{ display: "block", color: "rgba(255,255,255,0.6)", fontSize: 12, marginBottom: 6, fontWeight: 700 }}>
              邮箱地址
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
                  style={{ height: 44, borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer", flexShrink: 0 }}
                />
              ) : (
                <div style={{ height: 44, width: 110, borderRadius: 10, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)", fontSize: 12 }}>
                  加载中…
                </div>
              )}
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: "rgba(255,255,255,0.35)", cursor: "pointer" }} onClick={loadCaptcha}>
              看不清？点击图片刷新
            </div>
          </div>

          {err && <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)", color: "#fca5a5", fontSize: 13 }}>{err}</div>}

          <button type="submit" disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.7 : 1 }}>
            {busy ? "发送中…" : "发送验证码"}
          </button>
        </form>
      )}

      {step === "otp" && (
        <form onSubmit={handleVerifyOtp} style={{ display: "grid", gap: 14 }}>
          <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(139,92,246,0.10)", border: "1px solid rgba(139,92,246,0.25)", color: "rgba(255,255,255,0.78)", fontSize: 13, lineHeight: 1.6 }}>
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

          {err && <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)", color: "#fca5a5", fontSize: 13 }}>{err}</div>}

          <button type="submit" disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.7 : 1 }}>
            {busy ? "验证中…" : "登录"}
          </button>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button type="button" onClick={handleResend} style={btnSecondary} disabled={countdown > 0}>
              {countdown > 0 ? `重新发送 (${countdown}s)` : "重新发送"}
            </button>
            <button type="button" onClick={() => { setStep("input"); setErr(""); setOtp(""); }} style={{ ...btnSecondary, border: "none", background: "transparent" }}>
              修改邮箱
            </button>
          </div>
        </form>
      )}
    </>
  );
}

// ─── 邮箱+密码 登录流程 ─────────────────────────────────────────────────────

function PasswordFlow() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) { setErr("请输入邮箱"); return; }
    if (!password.trim()) { setErr("请输入密码"); return; }
    setBusy(true);
    setErr("");
    try {
      await loginWithPassword(email.trim(), password);
      window.location.href = "/dashboard";
    } catch (error: any) {
      setErr(error.message || "登录失败，请检查邮箱和密码");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleLogin} style={{ display: "grid", gap: 14 }}>
      <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.20)", color: "rgba(200,191,231,0.8)", fontSize: 12, lineHeight: 1.6 }}>
        使用在「个人中心」设定的登录密码。如尚未设定，请先用验证码登录再补设。
      </div>

      <div>
        <label style={{ display: "block", color: "rgba(255,255,255,0.6)", fontSize: 12, marginBottom: 6, fontWeight: 700 }}>
          邮箱地址
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
          登录密码
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="输入登录密码"
          autoComplete="current-password"
          style={inputStyle}
        />
      </div>

      {err && <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)", color: "#fca5a5", fontSize: 13 }}>{err}</div>}

      <button type="submit" disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.7 : 1 }}>
        {busy ? "登录中…" : "邮箱密码登录"}
      </button>

      <div style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
        忘记密码？切换到「验证码登录」后重新验证，再到个人中心重设密码
      </div>
    </form>
  );
}

// ─── 主页面 ──────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("otp");

  return (
    <div
      style={{
        minHeight: "100dvh",
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
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 26, fontWeight: 900, color: "white", letterSpacing: -0.5 }}>
            MV Studio Pro
          </div>
          <div style={{ marginTop: 6, color: "rgba(255,255,255,0.5)", fontSize: 14 }}>
            {mode === "otp" ? "验证码登录 · 首次验证即完成注册" : "邮箱密码登录"}
          </div>
        </div>

        {/* Mode Tabs */}
        <div
          style={{
            display: "flex",
            background: "rgba(255,255,255,0.05)",
            borderRadius: 12,
            padding: 4,
            marginBottom: 24,
            gap: 4,
          }}
        >
          {(["otp", "password"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                flex: 1,
                padding: "9px 0",
                borderRadius: 10,
                border: "none",
                background: mode === m ? "rgba(255,255,255,0.12)" : "transparent",
                color: "white",
                fontWeight: mode === m ? 900 : 600,
                fontSize: 14,
                cursor: "pointer",
                transition: "all 0.18s",
              }}
            >
              {m === "otp" ? "验证码登录" : "密码登录"}
            </button>
          ))}
        </div>

        {/* Flow Content */}
        {mode === "otp" ? <OtpFlow /> : <PasswordFlow />}

        <div style={{ marginTop: 24, textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 12 }}>
          登录即代表同意服务条款与隐私政策
        </div>
      </div>
    </div>
  );
}
