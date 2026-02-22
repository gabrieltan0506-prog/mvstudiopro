// @ts-nocheck
import {
  useState,
  useCallback
} from "react";
import { useLocation, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Loader2, Lock, ArrowLeft, Gift, CheckCircle, Share2, Home, Star, User, Music, Video, Box, BarChart } from "lucide-react";
import { toast } from "sonner";

export default function RedeemPage() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated, loading: authLoading } = useAuth();

  const [code, setCode] = useState("");
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    quota?: number;
    klingLimit?: number;
    inviteCode?: string;
    message?: string;
  } | null>(null);
  const [error, setError] = useState("");

  const redeemMutation = trpc.beta.redeemCodeBetaCode.useMutation();

  const handleRedeem = useCallback(async () => {
    setError("");
    setResult(null);
    const trimmed = code.trim();
    if (!trimmed) {
      setError("请输入内测码");
      return;
    }
    setIsRedeeming(true);
    try {
      const res = await redeemMutation.mutateAsync({ code: trimmed });
      setResult(res);
      setCode("");
      toast.success(res.message || "兑换成功！");
    } catch (err: any) {
      const errorMessage = err.message || "兑换失败，请稍后重试";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsRedeeming(false);
    }
  }, [code, redeemMutation]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0A0A0C] flex items-center justify-center p-6">
        <Loader2 className="h-12 w-12 animate-spin text-[#FF6B6B]" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#0A0A0C] flex flex-col items-center justify-center p-6 gap-4">
        <Lock className="h-12 w-12 text-gray-500" />
        <p className="text-base text-gray-400">请先登录后再兑换内测码</p>
        <Link href="/login">
          <a className="bg-red-500/15 text-red-400 font-semibold px-6 py-2.5 rounded-lg text-sm hover:bg-red-500/20 transition-colors">
            去登录
          </a>
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF]">
      <div className="flex-grow overflow-y-auto">
        <div className="container mx-auto max-w-lg p-4 pb-10">
          {/* Header */}
          <header className="flex items-center justify-between py-4">
            <button
              onClick={() => window.history.back()}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="text-xl font-bold">兑换内测码</h1>
            <div className="w-10" />
          </header>

          {/* Hero Section */}
          <section className="flex flex-col items-center text-center py-8">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-500/10 mb-4">
              <Gift className="h-10 w-10 text-[#FF6B6B]" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight">MV Studio Pro 内测</h2>
            <p className="text-gray-400 mt-2 max-w-sm">
              输入内测码即可解锁全部功能体验，每个码包含 20 次使用配额
            </p>
          </section>

          {/* Input Section */}
          <section className="space-y-4">
            <label htmlFor="redeem-code" className="font-semibold text-gray-300">内测码</label>
            <input
              id="redeem-code"
              type="text"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-lg font-mono tracking-widest placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-[#FF6B6B] transition-all"
              placeholder="例如：MV3A2F1B"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              maxLength={16}
              onKeyDown={(e) => e.key === 'Enter' && handleRedeem()}
            />

            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-red-900/50 p-3 text-sm text-red-400">
                <p>{error}</p>
              </div>
            )}

            <button
              onClick={handleRedeem}
              disabled={isRedeeming}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#FF6B6B] py-3.5 text-base font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRedeeming ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <Gift className="h-5 w-5" />
                  <span>兑换</span>
                </>
              )}
            </button>
          </section>

          {/* Success Result */}
          {result?.success && (
            <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6 flex flex-col items-center text-center animate-fade-in">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10 mb-4">
                <CheckCircle className="h-9 w-9 text-green-400" />
              </div>
              <h3 className="text-2xl font-bold text-green-400">兑换成功！</h3>
              <p className="text-gray-300 mt-2">{result.message}</p>

              <div className="my-6 grid grid-cols-3 divide-x divide-white/10 w-full max-w-sm bg-white/5 rounded-lg p-2">
                <div className="flex flex-col items-center p-2">
                  <span className="text-2xl font-bold">{result.quota}</span>
                  <span className="text-xs text-gray-400">总配额</span>
                </div>
                <div className="flex flex-col items-center p-2">
                  <span className="text-2xl font-bold">{result.klingLimit}</span>
                  <span className="text-xs text-gray-400">Kling 视频</span>
                </div>
                <div className="flex flex-col items-center p-2">
                  <span className="text-2xl font-bold">+10</span>
                  <span className="text-xs text-gray-400">每邀请1人</span>
                </div>
              </div>

              {result.inviteCode && (
                <div className="w-full rounded-lg border border-dashed border-red-400/50 bg-red-900/20 p-4 space-y-2">
                  <p className="text-sm text-red-300">你的邀请码</p>
                  <p className="text-2xl font-bold font-mono tracking-widest text-white">{result.inviteCode}</p>
                  <p className="text-xs text-red-300/80">分享给朋友，双方各获 +10 次配额</p>
                </div>
              )}

              <div className="mt-6 flex w-full gap-4">
                <Link href="/invite" className="flex-1">
                  <a className="w-full flex items-center justify-center gap-2 rounded-lg bg-red-500/15 py-3 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/25">
                    <Share2 className="h-4 w-4" />
                    <span>邀请朋友</span>
                  </a>
                </Link>
                <Link href="/" className="flex-1">
                  <a className="w-full flex items-center justify-center gap-2 rounded-lg bg-white/10 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/20">
                    <Home className="h-4 w-4" />
                    <span>开始体验</span>
                  </a>
                </Link>
              </div>
            </section>
          )}

          {/* Features Preview */}
          {!result?.success && (
            <section className="mt-10">
              <h3 className="text-lg font-bold text-center mb-6">内测可体验功能</h3>
              <div className="space-y-4">
                {[
                  { icon: Star, title: "智能分镜生成", desc: "AI 脚本 + 分镜图一键生成" },
                  { icon: User, title: "虚拟偶像 2D/3D", desc: "AI 生成偶像形象 + 3D 转换" },
                  { icon: Music, title: "Suno 音乐生成", desc: "Custom / Simple 双模式创作" },
                  { icon: Video, title: "Kling 视频生成", desc: "分镜转视频（限 1 次）" },
                  { icon: Box, title: "3D Studio", desc: "2D 转 3D 模型 + GLB 导出" },
                  { icon: BarChart, title: "视频 PK 评分", desc: "AI 分析视频质量和表现力" },
                ].map((f, i) => (
                  <div key={i} className="flex items-start gap-4 rounded-lg bg-white/5 p-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10 shrink-0">
                      <f.icon className="h-5 w-5 text-[#FF6B6B]" />
                    </div>
                    <div>
                      <p className="font-semibold">{f.title}</p>
                      <p className="text-sm text-gray-400">{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
