import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { Coins, PlusCircle, Star, X } from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { CREDIT_COSTS } from "@/lib/credits";
import { toast } from "sonner";

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action?: keyof typeof CREDIT_COSTS;
  currentBalance?: number;
}

export function UpgradeModal({ open, onOpenChange, action, currentBalance = 0 }: UpgradeModalProps) {
  const [, navigate] = useLocation();
  const [loading, setLoading] = useState(false);
  const checkoutMutation = trpc.stripe.createCheckoutSession.useMutation();

  const cost = action ? CREDIT_COSTS[action] : 0;

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const result = await checkoutMutation.mutateAsync({ plan: "pro", interval: "monthly" });
      if (result.url) {
        window.open(result.url, "_blank");
      }
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "无法创建付款页面");
    } finally {
      setLoading(false);
    }
  };

  const handleBuyCredits = () => {
    onOpenChange(false);
    navigate("/pricing");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#1A1A1D] border-[#2A2A2D] text-white max-w-md p-7">
        <DialogHeader className="items-center text-center">
          <div className="w-18 h-18 rounded-full bg-[#FF6B35]/10 flex items-center justify-center mb-4">
            <Coins size={40} className="text-[#FF6B35]" />
          </div>
          <DialogTitle className="text-2xl font-extrabold text-[#ECEDEE] mb-2">Credits 不足</DialogTitle>
          <DialogDescription className="text-sm text-[#9BA1A6] leading-5 mb-2">
            {action ? `此操作需要 ${cost} Credits，您目前有 ${currentBalance} Credits` : "您需要更多 Credits 才能使用此功能"}
          </DialogDescription>
        </DialogHeader>

        <div className="w-full flex flex-col gap-3 pt-4">
          {/* Upgrade to Pro */}
          <button onClick={handleUpgrade} className="bg-[#FF6B35] rounded-xl p-4 flex flex-col items-center w-full disabled:opacity-50" disabled={loading}>
            <div className="flex items-center gap-2">
              <Star size={20} color="#fff" />
              <span className="text-white text-base font-bold">升级专业版</span>
            </div>
            <span className="text-white/70 text-xs mt-1">¥108/月 · 200 Credits</span>
          </button>

          {/* Buy Credits */}
          <button onClick={handleBuyCredits} className="border border-[#FF6B35]/30 rounded-xl p-4 flex flex-col items-center w-full">
            <div className="flex items-center gap-2">
              <PlusCircle size={20} className="text-[#FF6B35]" />
              <span className="text-[#FF6B35] text-[15px] font-semibold">购买 Credits 加值包</span>
            </div>
            <span className="text-[#9BA1A6] text-xs mt-1">50 Credits ¥35 起</span>
          </button>
        </div>

        <DialogClose className="absolute top-4 right-4 text-[#9BA1A6] hover:text-white">
          <X size={24} />
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
