import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Sparkles, Rocket, InfinityIcon, Eye, Film, Users, Code, CreditCard, Home, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

export default function PaymentSuccess() {
  const [location, setLocation] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const plan = params.get('plan');

  const { user } = useAuth();

  const [welcomeMsg, setWelcomeMsg] = useState<string | null>(null);
  const [loadingWelcome, setLoadingWelcome] = useState(false);

  const welcomeMutation = trpc.welcomeMessage.generate.useMutation();

  useEffect(() => {
    if (plan && user) {
      generateWelcome();
    }
  }, [plan, user]);

  const generateWelcome = async () => {
    if (!plan) return;
    setLoadingWelcome(true);
    try {
      const planNameMap: Record<string, string> = {
        pro: "专业版",
        enterprise: "企业版",
      };
      const result = await welcomeMutation.mutateAsync({
        planName: planNameMap[plan as string] || (plan as string),
        userName: user?.name || undefined,
      });
      setWelcomeMsg(result.message);
    } catch (err) {
      console.error("Failed to generate welcome message:", err);
    } finally {
      setLoadingWelcome(false);
    }
  };

  const isSubscription = !!plan;

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF]">
      <div className="flex-grow flex justify-center items-center px-8 py-10">
        <div className="w-full max-w-md flex flex-col items-center">
          {/* Success Icon */}
          <div className="w-24 h-24 rounded-full bg-green-500/10 flex items-center justify-center mb-6">
            <CheckCircle2 size={64} className="text-green-500" />
          </div>

          <h1 className="text-3xl font-extrabold text-gray-100 mb-2">
            {isSubscription ? "欢迎加入！" : "付款成功！"}
          </h1>
          <p className="text-base text-gray-400 text-center leading-relaxed">
            {isSubscription
              ? `您已成功升级为${plan === "enterprise" ? "企业版" : "专业版"}会员`
              : "您的付款已成功处理。Credits 将在几秒内到帐。"}
          </p>

          {/* Welcome Message Section */}
          {isSubscription && (
            <div className="w-full mt-6">
              {loadingWelcome ? (
                <div className="flex flex-row items-center justify-center gap-2.5 py-5">
                  <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                  <span className="text-gray-400 text-sm">正在为您生成专属欢迎语...</span>
                </div>
              ) : welcomeMsg ? (
                <div className="bg-[#1A1A1D] rounded-2xl p-5 border border-yellow-500/20 space-y-3">
                  <div className="flex flex-row items-center gap-2">
                    <Sparkles size={18} className="text-yellow-400" />
                    <span className="text-sm font-semibold text-yellow-400">来自 AI 助手的欢迎</span>
                  </div>
                  <p className="text-base text-gray-100 leading-loose">{welcomeMsg}</p>
                </div>
              ) : null}
            </div>
          )}

          {/* Plan Benefits */}
          {isSubscription && (
            <div className="w-full mt-5 bg-[#1A1A1D] rounded-2xl p-5 border border-white/10">
              <h2 className="text-base font-bold text-gray-100 mb-3">
                {plan === "enterprise" ? "企业版" : "专业版"}专属权益
              </h2>
              <div className="space-y-2.5">
                <BenefitRow icon={<InfinityIcon size={18} className="text-green-500" />} text="无限视频 PK 评分 & 偶像生成" />
                <BenefitRow icon={<Eye size={18} className="text-green-500" />} text="偶像图片转 3D" />
                <BenefitRow icon={<Film size={18} className="text-green-500" />} text="无限分镜脚本生成" />
                <BenefitRow icon={<CreditCard size={18} className="text-green-500" />} text={`每月 ${plan === "enterprise" ? "2000" : "500"} Credits`} />
                {plan === "enterprise" && (
                  <>
                    <BenefitRow icon={<Users size={18} className="text-green-500" />} text="团队席位管理" />
                    <BenefitRow icon={<Code size={18} className="text-green-500" />} text="API 访问 & 白标授权" />
                  </>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="mt-8 w-full space-y-3">
            {isSubscription ? (
              <>
                <button
                  onClick={() => setLocation("/")}
                  className="w-full bg-orange-600 hover:bg-orange-700 transition-colors rounded-xl py-4 flex items-center justify-center gap-2"
                >
                  <Rocket size={20} className="text-white" />
                  <span className="text-white text-base font-bold">开始创作</span>
                </button>
                <button
                  onClick={() => setLocation("/credits-dashboard")}
                  className="w-full border border-white/10 hover:bg-white/5 transition-colors rounded-xl py-4 flex items-center justify-center"
                >
                  <span className="text-gray-400 text-base font-semibold">查看 Credits 余额</span>
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setLocation("/credits-dashboard")}
                  className="w-full bg-orange-600 hover:bg-orange-700 transition-colors rounded-xl py-4 flex items-center justify-center"
                >
                  <span className="text-white text-base font-bold">查看 Credits</span>
                </button>
                <button
                  onClick={() => setLocation("/")}
                  className="w-full border border-white/10 hover:bg-white/5 transition-colors rounded-xl py-4 flex items-center justify-center"
                >
                  <span className="text-gray-400 text-base font-semibold">返回首页</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BenefitRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-row items-center gap-2.5">
      {icon}
      <span className="text-sm text-gray-100">{text}</span>
    </div>
  );
}
