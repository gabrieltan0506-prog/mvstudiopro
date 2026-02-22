import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TimerOff, Hourglass, Repeat, Lock, ArrowRight, GraduationCap, Calendar } from "lucide-react";
import { useLocation } from "wouter";

export interface QuotaExhaustedModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  isTrial?: boolean;
  planName?: string;
  featureName?: string;
  style?: React.CSSProperties;
  visible?: boolean;
  [key: string]: any;
}

export function QuotaExhaustedModal({
  visible,
  featureName,
  isTrial = false,
  trialExpired = false,
  planName,
  onClose,
}: QuotaExhaustedModalProps) {
  const [, navigate] = useLocation();

  const isTrialExpired = isTrial && trialExpired;
  const isTrialQuotaUsed = isTrial && !trialExpired;
  const isPaidPlan =
    !isTrial &&
    (planName?.includes("student_6months") ||
      planName?.includes("student_1year"));

  const getTitle = () => {
    if (isTrialExpired) return "试用已到期";
    if (isTrialQuotaUsed) return "试用额度已用完";
    if (isPaidPlan) return "本月额度已用完";
    return "入門版額度已用完";
  };

  const getMessage = () => {
    if (isTrialExpired) {
      return `您的 2 天體驗期已結束。\n\n您已生成的作品仍可查看，但無法新建作品。\n\n訂閱學生方案即可繼續使用「${featureName}」等所有功能，半年僅需 $20。`;
    }
    if (isTrialQuotaUsed) {
      return `您在试用期内的「${featureName}」次数已用完。\n\n升级到付费方案可获得更多额度，解锁全部功能。`;
    }
    if (isPaidPlan) {
      return `您本月的「${featureName}」额度已用完。\n\n额度将在下月 1 日自动重置，请耐心等待。\n\n如需更多额度，可升级到更高方案。`;
    }
    return `您的「${featureName}」入門版額度已用完。\n\n購買套餐或申請學生優惠即可繼續使用。`;
  };

  const getIcon = () => {
    if (isTrialExpired) return <TimerOff size={32} className="text-red-500" />;
    if (isTrialQuotaUsed) return <Hourglass size={32} className="text-yellow-500" />;
    if (isPaidPlan) return <Repeat size={32} className="text-blue-500" />;
    return <Lock size={32} className="text-gray-400" />;
  };

  const getIconBgClass = () => {
    if (isTrialExpired) return "bg-red-500/10";
    if (isTrialQuotaUsed) return "bg-yellow-500/10";
    if (isPaidPlan) return "bg-blue-500/10";
    return "bg-gray-500/10";
  };

  const getPrimaryAction = () => {
    if (isTrialExpired || isTrialQuotaUsed) {
      return {
        label: "立即订阅",
        icon: <ArrowRight className="h-4 w-4" />,
        onClick: () => {
          onClose?.();
          navigate("/student-verification");
        },
      };
    }
    if (isPaidPlan) {
      if (planName?.includes("6months")) {
        return {
          label: "升级一年版",
          icon: <ArrowRight className="h-4 w-4" />,
          onClick: () => {
            onClose?.();
            navigate("/student-verification");
          },
        };
      }
      return null; // 1-year plan, just wait for reset
    }
    return {
      label: "查看方案",
      icon: <ArrowRight className="h-4 w-4" />,
      onClick: () => {
        onClose?.();
        navigate("/pricing");
      },
    };
  };

  const primaryAction = getPrimaryAction();

  return (
    <Dialog open={visible} onOpenChange={(isOpen) => !isOpen && onClose?.()}>
      <DialogContent className="sm:max-w-sm bg-[#0A0A0C] border-gray-800 text-[#F7F4EF]">
        <DialogHeader className="items-center text-center">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center ${getIconBgClass()} mb-4`}>
            {getIcon()}
          </div>
          <DialogTitle className="text-xl font-bold">{getTitle()}</DialogTitle>
          <DialogDescription className="text-sm text-gray-400 whitespace-pre-wrap pt-2">
            {getMessage()}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {isPaidPlan && (
            <div className="rounded-lg p-3 flex items-center bg-blue-500/10">
              <Calendar className="h-4 w-4 text-blue-400" />
              <span className="text-xs ml-2 text-gray-300">
                下次重置：每月 1 日 00:00（UTC+8）
              </span>
            </div>
          )}
          <div className="flex flex-col gap-3">
            {primaryAction && (
              <Button onClick={primaryAction.onClick} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                {primaryAction.label}
                {primaryAction.icon}
              </Button>
            )}
            {!isTrial && !isPaidPlan && (
              <Button
                variant="outline"
                onClick={() => {
                  onClose?.();
                  navigate("/student-verification");
                }}
                className="w-full border-green-600/50 bg-green-500/10 text-green-400 hover:bg-green-500/20 hover:text-green-300"
              >
                <GraduationCap className="h-4 w-4 mr-2" />
                学生？申请教育优惠
              </Button>
            )}
            <Button variant="ghost" onClick={onClose} className="w-full text-gray-400 hover:bg-gray-800 hover:text-gray-300">
              {isPaidPlan && planName?.includes("1year") ? "我知道了" : "稍后再说"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
