// @ts-nocheck

import { useState, useCallback, useRef, useEffect } from "react";
import { useLocation, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { CheckCircle, ArrowLeft, AlertTriangle, Mail, Lock, Gift, BarChart, Users, Sparkles, Megaphone, Loader2 } from "lucide-react";


type LoginMode = "otp" | "password" | "register" | "invite";

export default function Login() {
  const navigate = useLocation();
  const [location, setLocation] = useLocation();
  const params = new URLSearchParams(location.split('?')[1] || '');
  const errorParam = params.get('error');
  const inviteParam = params.get('invite');

  const { refresh } = useAuth({ autoFetch: false });

  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<LoginMode>(inviteParam ? "invite" : "otp");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [inviteCode, setInviteCode] = useState(inviteParam || "");
  const [error, setError] = useState(
    errorParam === "oauth_failed"
      ? "Google 登录失败，请重试"
      : errorParam === "invalid_redirect"
      ? "Sandbox 域名已变更，请重新发起 Google 登录"
      : ""
  );
  const [otpSent, setOtpSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [successMessage, setSuccessMessage] = useState("");

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const registerMutation = trpc.emailAuth.register.useMutation();
  const loginMutation = trpc.emailAuth.login.useMutation();
  const sendOtpMutation = trpc.emailOtp.sendCode.useMutation();
  const verifyOtpMutation = trpc.emailOtp.verifyAndLogin.useMutation();
  const redeemInviteMutation = trpc.beta.redeemInviteCode.useMutation();

  useEffect(() => {
    if (countdown > 0) {
      countdownRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [countdown > 0]);

  const handleGoogleLogin = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      window.location.href = getLoginUrl();
    } catch (err) {
      console.error("[Login] Google login failed:", err);
      setError("Google 登录失败，请重试");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSendOtp = useCallback(async () => {
    setError("");
    if (!email) {
      setError("请输入 Mail 地址");
      return;
    }
    setLoading(true);
    try {
      await sendOtpMutation.mutateAsync({ email });
      setOtpSent(true);
      setCountdown(60);
      setSuccessMessage("验证码已发送到您的邮箱");
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err: any) {
      setError(err.message || "发送验证码失败");
    } finally {
      setLoading(false);
    }
  }, [email, sendOtpMutation]);

  const handleVerifyOtp = useCallback(async () => {
    setError("");
    if (!otpCode || otpCode.length !== 6) {
      setError("请输入 6 位验证码");
      return;
    }
    setLoading(true);
    try {
      const result = await verifyOtpMutation.mutateAsync({ email, code: otpCode });
      if (result.success) {
        await refresh();
        window.history.back();
      }
    } catch (err: any) {
      setError(err.message || "验证失败");
    } finally {
      setLoading(false);
    }
  }, [email, otpCode, verifyOtpMutation, refresh]);

  const handlePasswordLogin = useCallback(async () => {
    setError("");
    if (!email || !password) {
      setError("请输入 Mail 和密码");
      return;
    }
    setLoading(true);
    try {
      await loginMutation.mutateAsync({ email, password });
      await refresh();
      window.history.back();
    } catch (err: any) {
      setError(err.message || "登录失败");
    } finally {
      setLoading(false);
    }
  }, [email, password, loginMutation, refresh]);

  const handleRegister = useCallback(async () => {
    setError("");
    if (!email || !password) {
      setError("请输入 Mail 和密码");
      return;
    }
    if (!name) {
      setError("请输入姓名");
      return;
    }
    setLoading(true);
    try {
      await registerMutation.mutateAsync({ email, password, name });
      setSuccessMessage("注册成功！请登录");
      setMode("password");
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err: any) {
      setError(err.message || "注册失败");
    } finally {
      setLoading(false);
    }
  }, [email, password, name, registerMutation]);

  const handleRedeemInvite = useCallback(async () => {
    setError("");
    if (!inviteCode) {
      setError("请输入邀请码");
      return;
    }
    setLoading(true);
    try {
      const result = await redeemInviteMutation.mutateAsync({ inviteCode });
      setSuccessMessage(result.message);
      setTimeout(() => {
        window.history.back();
      }, 2000);
    } catch (err: any) {
      setError(err.message || "邀请码兑换失败");
    } finally {
      setLoading(false);
    }
  }, [inviteCode, redeemInviteMutation]);

  const renderOtpForm = () => (
    <div className="mb-2">
      <input
        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-base text-[#F7F4EF] mb-3 disabled:opacity-50"
        placeholder="Mail 地址"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        type="email"
        autoCapitalize="none"
        disabled={otpSent}
      />

      {otpSent && (
        <div className="flex gap-2.5">
          <input
            className="flex-1 w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-lg text-[#F7F4EF] tracking-[0.5em] font-semibold text-center mb-3"
            placeholder="6 位验证码"
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value)}
            type="number"
            maxLength={6}
            onKeyDown={(e) => e.key === 'Enter' && handleVerifyOtp()}
          />
          <button
            className="bg-red-500/15 rounded-xl px-4 justify-center items-center mb-3 disabled:opacity-50"
            onClick={handleSendOtp}
            disabled={countdown > 0 || loading}
          >
            <span className="text-sm font-semibold text-red-400">
              {countdown > 0 ? `${countdown}s` : "重发"}
            </span>
          </button>
        </div>
      )}

      {successMessage && (
        <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/25 rounded-lg px-3.5 py-2.5 mb-3">
          <CheckCircle className="w-4 h-4 text-green-400" />
          <p className="flex-1 text-xs text-green-400 leading-snug">{successMessage}</p>
        </div>
      )}

      {error && <p className="text-xs text-red-400 mb-3 text-center">{error}</p>}

      <button
        className="w-full bg-red-400 hover:bg-red-500 transition-colors py-4 rounded-xl flex items-center justify-center mb-3 disabled:opacity-60"
        onClick={otpSent ? handleVerifyOtp : handleSendOtp}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="w-5 h-5 text-white animate-spin" />
        ) : (
          <span className="text-base font-semibold text-white">
            {otpSent ? "验证并登录" : "发送验证码"}
          </span>
        )}
      </button>

      {otpSent && (
        <button onClick={() => { setOtpSent(false); setOtpCode(""); setError(""); }} className="mt-2 w-full">
          <span className="text-sm text-[#9B9691] text-center">更换 Mail 地址</span>
        </button>
      )}
    </div>
  );

  const renderPasswordForm = () => (
    <div className="mb-2">
      {mode === "register" && (
        <input
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-base text-[#F7F4EF] mb-3"
          placeholder="姓名"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoCapitalize="words"
        />
      )}
      <input
        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-base text-[#F7F4EF] mb-3"
        placeholder="Mail"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        type="email"
        autoCapitalize="none"
      />
      <input
        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-base text-[#F7F4EF] mb-3"
        placeholder="密码"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        type="password"
        onKeyDown={(e) => e.key === 'Enter' && (mode === "register" ? handleRegister() : handlePasswordLogin())}
      />

      {successMessage && (
         <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/25 rounded-lg px-3.5 py-2.5 mb-3">
          <CheckCircle className="w-4 h-4 text-green-400" />
          <p className="flex-1 text-xs text-green-400 leading-snug">{successMessage}</p>
        </div>
      )}

      {error && <p className="text-xs text-red-400 mb-3 text-center">{error}</p>}

      <button
        className="w-full bg-red-400 hover:bg-red-500 transition-colors py-4 rounded-xl flex items-center justify-center mb-3 disabled:opacity-60"
        onClick={mode === "register" ? handleRegister : handlePasswordLogin}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="w-5 h-5 text-white animate-spin" />
        ) : (
          <span className="text-base font-semibold text-white">
            {mode === "register" ? "注册" : "登录"}
          </span>
        )}
      </button>

      <button onClick={() => setMode(mode === "register" ? "password" : "register")} className="w-full">
        <span className="text-sm text-[#9B9691] text-center">
          {mode === "register" ? "已有帐号？登录" : "还没有帐号？注册"}
        </span>
      </button>
    </div>
  );

  const renderInviteForm = () => (
    <div className="mb-2">
      <div className="flex flex-col items-center gap-2 mb-6">
        <Gift className="w-8 h-8 text-red-400" />
        <h2 className="text-xl font-bold text-[#F7F4EF]">兑换邀请码</h2>
        <p className="text-sm text-[#9B9691] text-center leading-snug">输入朋友的邀请码，双方各获得 10 次额外配额</p>
      </div>

      <input
        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-lg text-[#F7F4EF] tracking-[0.25em] font-semibold text-center mb-3"
        placeholder="输入 8 位邀请码"
        value={inviteCode}
        onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
        autoCapitalize="characters"
        maxLength={8}
        onKeyDown={(e) => e.key === 'Enter' && handleRedeemInvite()}
      />

      {successMessage && (
        <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/25 rounded-lg px-3.5 py-2.5 mb-3">
          <CheckCircle className="w-4 h-4 text-green-400" />
          <p className="flex-1 text-xs text-green-400 leading-snug">{successMessage}</p>
        </div>
      )}

      {error && <p className="text-xs text-red-400 mb-3 text-center">{error}</p>}

      <button
        className="w-full bg-red-400 hover:bg-red-500 transition-colors py-4 rounded-xl flex items-center justify-center mb-3 disabled:opacity-60"
        onClick={handleRedeemInvite}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="w-5 h-5 text-white animate-spin" />
        ) : (
          <span className="text-base font-semibold text-white">兑换邀请码</span>
        )}
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF] flex flex-col items-center justify-center p-5 overflow-hidden relative">
      <button onClick={() => window.history.back()} className="absolute top-4 left-5 md:top-6 flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/5 z-10 hover:bg-white/10 transition-colors">
        <ArrowLeft className="w-4 h-4 text-[#9B9691]" />
        <span className="text-sm text-[#9B9691] font-medium">返回</span>
      </button>

      <div className="absolute w-[300px] h-[300px] -top-20 -right-16 bg-red-500/5 rounded-full" />
      <div className="absolute w-[250px] h-[250px] -bottom-10 -left-20 bg-blue-400/5 rounded-full" />

      <div className="flex flex-col items-center mt-10 mb-8 z-0">
        <div className="w-20 h-20 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4 shadow-[0_0_40px_rgba(255,107,107,0.15)]">
          <img src="/icon.png" alt="MV Studio Pro Logo" className="w-14 h-14 rounded-xl" />
        </div>
        <h1 className="text-3xl font-extrabold text-[#F7F4EF] tracking-tight">MV Studio Pro</h1>
        <p className="text-sm text-[#9B9691] mt-1.5">My Video, I am the team.</p>
      </div>

      <div className="w-full max-w-md bg-[rgba(20,15,25,0.7)] rounded-2xl p-7 md:p-9 border border-white/10 backdrop-blur-xl shadow-2xl z-0">
        <h2 className="text-2xl font-bold text-[#F7F4EF] text-center mb-2">欢迎使用</h2>
        <p className="text-sm text-[#9B9691] text-center mb-6 leading-relaxed">
          {mode === "invite"
            ? "使用邀请码加入内测，获得额外功能配额"
            : "使用 Google 或 Mail 帐号登录，即可享受完整的视频创作功能"}
        </p>

        {errorParam === "oauth_failed" && (
          <div className="flex items-center gap-2.5 bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3 mb-5">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <p className="flex-1 text-sm text-red-400 leading-snug">Google 登录验证失败，请重新尝试</p>
          </div>
        )}

        {mode !== "invite" && (
          <div className="flex bg-black/20 rounded-xl p-1 mb-6">
            <button
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg transition-colors ${mode === "otp" ? "bg-red-500/15" : "hover:bg-white/5"}`}
              onClick={() => { setMode("otp"); setError(""); }}
            >
              <Mail className={`w-4 h-4 ${mode === "otp" ? "text-red-400" : "text-gray-500"}`} />
              <span className={`text-sm font-medium ${mode === "otp" ? "text-red-400" : "text-gray-400"}`}>验证码登录</span>
            </button>
            <button
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg transition-colors ${(mode === "password" || mode === "register") ? "bg-red-500/15" : "hover:bg-white/5"}`}
              onClick={() => { setMode("password"); setError(""); }}
            >
              <Lock className={`w-4 h-4 ${(mode === "password" || mode === "register") ? "text-red-400" : "text-gray-500"}`} />
              <span className={`text-sm font-medium ${(mode === "password" || mode === "register") ? "text-red-400" : "text-gray-400"}`}>密码登录</span>
            </button>
          </div>
        )}

        {mode === "otp" && renderOtpForm()}
        {(mode === "password" || mode === "register") && renderPasswordForm()}
        {mode === "invite" && renderInviteForm()}

        {mode !== "invite" && (
          <>
            <div className="flex items-center my-4">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-[#9B9691] px-3">或</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            <button
              className="w-full flex items-center justify-center gap-3 py-4 rounded-xl bg-white text-black/80 shadow-md hover:shadow-lg transition-shadow disabled:opacity-60"
              onClick={handleGoogleLogin}
              disabled={loading}
            >
              <img src="https://www.google.com/favicon.ico" alt="Google Icon" className="w-5 h-5" />
              <span className="text-base font-semibold">
                {loading ? "连接中..." : "使用 Google 帐号登录"}
              </span>
            </button>

            <button
              className="w-full flex items-center justify-center gap-2 py-3 mt-4 rounded-xl border border-dashed border-red-500/30 hover:bg-red-500/10 transition-colors"
              onClick={() => { setMode("invite"); setError(""); }}
            >
              <Gift className="w-4 h-4 text-red-400" />
              <span className="text-sm font-medium text-red-400">有邀请码？点此兑换</span>
            </button>
          </>
        )}

        {mode === "invite" && (
          <button
            className="w-full flex items-center justify-center gap-1.5 py-3 mt-2"
            onClick={() => { setMode("otp"); setError(""); setSuccessMessage(""); }}
          >
            <ArrowLeft className="w-4 h-4 text-[#9B9691]" />
            <span className="text-sm text-[#9B9691]">返回登录</span>
          </button>
        )}

        {mode !== "invite" && (
          <div className="mt-6 pt-5 border-t border-white/10">
            <h3 className="text-sm font-semibold text-[#9B9691] mb-3.5 text-center">登录后可使用</h3>
            <div className="space-y-3">
              {[
                { icon: BarChart, text: "视频 PK 评分 — AI 深度解析爆款潜力" },
                { icon: Users, text: "虚拟偶像工坊 — 生成多风格虚拟形象" },
                { icon: Sparkles, text: "分镜转视频 — 将分镜脚本转化为视频" },
                { icon: Megaphone, text: "多平台发布 — 一键跨平台发布" },
              ].map((feat, i) => (
                <div key={i} className="flex items-center gap-3">
                  <feat.icon className="w-5 h-5 text-red-400" />
                  <p className="text-sm text-[#F7F4EF] flex-1 leading-snug">{feat.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-gray-600 text-center mt-6 leading-relaxed">
          继续即表示您同意我们的
          <a href="#" className="text-red-400 hover:underline"> 服务条款 </a>
          和
          <a href="#" className="text-red-400 hover:underline"> 隐私政策</a>
        </p>
      </div>
    </div>
  );
}
