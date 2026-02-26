import { useState } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";

export default function EmailLogin() {
  const [, setLocation] = useLocation();
  const { refresh } = useAuth({ autoFetch: false });
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const requestOtp = async () => {
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/email/request-otp", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || "Failed to send OTP");
      }
      setOtpSent(true);
      setMessage("验证码已发送，请检查邮箱。");
    } catch (err: any) {
      setError(err?.message || "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/email/verify-otp", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, otp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || "Failed to verify OTP");
      }
      await refresh();
      setLocation("/dashboard");
    } catch (err: any) {
      setError(err?.message || "Failed to verify OTP");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0B0D] text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-2xl font-semibold mb-2">邮箱验证码登录</h1>
        <p className="text-sm text-white/70 mb-6">输入邮箱获取 6 位验证码，5 分钟内有效。</p>

        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          disabled={loading || otpSent}
          className="w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2.5 mb-3"
        />

        {otpSent && (
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="6-digit OTP"
            value={otp}
            onChange={e => setOtp(e.target.value.replace(/\D/g, ""))}
            disabled={loading}
            className="w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2.5 mb-3 tracking-[0.35em] text-center"
          />
        )}

        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
        {message && <p className="text-sm text-emerald-400 mb-3">{message}</p>}

        <button
          onClick={otpSent ? verifyOtp : requestOtp}
          disabled={loading || !email || (otpSent && otp.length !== 6)}
          className="w-full rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-60 py-2.5 font-medium flex items-center justify-center"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : otpSent ? "验证并登录" : "发送验证码"}
        </button>
      </div>
    </div>
  );
}
