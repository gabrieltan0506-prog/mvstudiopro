import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, RefreshCw } from "lucide-react";

const OTP_SECONDS = 60;

type CaptchaResponse = {
  imageBase64: string;
  captchaId: string;
};

export default function Login() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [captchaId, setCaptchaId] = useState("");
  const [captchaImage, setCaptchaImage] = useState("");
  const [captchaText, setCaptchaText] = useState("");
  const [otp, setOtp] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [loadingCaptcha, setLoadingCaptcha] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    void refreshCaptcha();
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => {
      setCountdown(value => (value > 1 ? value - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  const isValidEmail = useMemo(() => /[^\s@]+@[^\s@]+\.[^\s@]+/.test(email.trim()), [email]);

  const refreshCaptcha = useCallback(async () => {
    setLoadingCaptcha(true);
    setError("");
    try {
      const response = await fetch("/api/auth/captcha", { method: "GET", credentials: "include" });
      const data = (await response.json()) as CaptchaResponse;
      if (!response.ok) {
        throw new Error("获取图形验证码失败，请重试");
      }
      setCaptchaId(data.captchaId);
      setCaptchaImage(data.imageBase64);
      setCaptchaText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取图形验证码失败，请重试");
    } finally {
      setLoadingCaptcha(false);
    }
  }, []);

  const handleSendOtp = useCallback(async () => {
    setError("");
    setSuccess("");

    if (!isValidEmail) {
      setError("请输入有效的邮箱地址");
      return;
    }
    if (!captchaId || !captchaText.trim()) {
      setError("请输入图形验证码");
      return;
    }

    setSendingOtp(true);
    try {
      const response = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: email.trim(),
          captchaId,
          captchaText: captchaText.trim(),
        }),
      });

      const data = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "发送验证码失败，请稍后重试");
      }

      setSuccess("验证码已发送，请查收邮箱");
      setCountdown(OTP_SECONDS);
      await refreshCaptcha();
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送验证码失败，请稍后重试");
      await refreshCaptcha();
    } finally {
      setSendingOtp(false);
    }
  }, [captchaId, captchaText, email, isValidEmail, refreshCaptcha]);

  const handleVerifyOtp = useCallback(async () => {
    setError("");
    setSuccess("");

    if (!isValidEmail) {
      setError("请输入有效的邮箱地址");
      return;
    }
    if (!/^\d{6}$/.test(otp.trim())) {
      setError("请输入 6 位数字 OTP");
      return;
    }

    setVerifying(true);
    try {
      const response = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), otp: otp.trim() }),
      });

      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "登录失败，请稍后重试");
      }

      setSuccess("登录成功，正在跳转...");
      window.setTimeout(() => {
        setLocation("/dashboard");
      }, 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请稍后重试");
    } finally {
      setVerifying(false);
    }
  }, [email, isValidEmail, otp, setLocation]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-4 py-10">
      <div className="max-w-md mx-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <h1 className="text-2xl font-semibold mb-1">邮箱 + 图形验证码登录</h1>
        <p className="text-sm text-slate-400 mb-6">一次性会话登录，关闭浏览器后需重新登录</p>

        <label className="block text-sm mb-2">邮箱</label>
        <input
          className="w-full mb-4 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:ring-2 focus:ring-sky-600"
          placeholder="请输入邮箱"
          value={email}
          onChange={e => setEmail(e.target.value)}
          type="email"
        />

        <label className="block text-sm mb-2">图形验证码</label>
        <div className="flex items-center gap-3 mb-3">
          <button
            type="button"
            onClick={() => void refreshCaptcha()}
            className="h-[50px] w-[160px] rounded-md border border-slate-700 bg-white disabled:opacity-60"
            disabled={loadingCaptcha}
            title="点击刷新验证码"
          >
            {loadingCaptcha ? (
              <div className="flex h-full items-center justify-center text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : captchaImage ? (
              <img src={captchaImage} alt="验证码" className="h-full w-full object-cover" />
            ) : (
              <span className="text-slate-500 text-xs">加载失败</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => void refreshCaptcha()}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
            disabled={loadingCaptcha}
          >
            <RefreshCw className={`h-4 w-4 ${loadingCaptcha ? "animate-spin" : ""}`} />
            刷新
          </button>
        </div>

        <input
          className="w-full mb-4 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 uppercase outline-none focus:ring-2 focus:ring-sky-600"
          placeholder="请输入图形验证码"
          value={captchaText}
          onChange={e => setCaptchaText(e.target.value)}
          maxLength={8}
        />

        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => void handleSendOtp()}
            disabled={sendingOtp || countdown > 0}
            className="flex-1 rounded-lg bg-sky-600 px-3 py-2 font-medium hover:bg-sky-500 disabled:opacity-60"
          >
            {sendingOtp ? "发送中..." : countdown > 0 ? `${countdown}s 后可重发` : "发送 OTP"}
          </button>
        </div>

        <label className="block text-sm mb-2">OTP</label>
        <input
          className="w-full mb-4 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:ring-2 focus:ring-sky-600"
          placeholder="请输入 6 位 OTP"
          value={otp}
          onChange={e => setOtp(e.target.value)}
          maxLength={6}
        />

        {error && <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-300">{error}</div>}
        {success && <div className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2 text-sm text-emerald-300">{success}</div>}

        <button
          type="button"
          onClick={() => void handleVerifyOtp()}
          disabled={verifying}
          className="w-full rounded-lg bg-emerald-600 px-3 py-2 font-medium hover:bg-emerald-500 disabled:opacity-60"
        >
          {verifying ? "登录中..." : "登录"}
        </button>
      </div>
    </div>
  );
}
