import { Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  balance: number;
  required: number;
};

/**
 * Agent 场景派发前：本地余额不足时拦截，避免无意义请求。
 */
export default function AgentInsufficientCreditsDialog({ open, onOpenChange, balance, required }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#1a1612] border border-[rgba(168,118,27,0.35)] text-[rgba(245,235,210,0.92)] max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#d6a861] text-lg font-black">积分不足</DialogTitle>
          <DialogDescription className="text-[rgba(160,140,90,0.9)] text-sm leading-relaxed pt-2">
            当前账户余额为 <span className="text-[#f5c842] font-bold tabular-nums">{balance}</span> 点，派发本任务需要{" "}
            <span className="text-[#f5c842] font-bold tabular-nums">{required}</span> 点。请先充值后再试。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 pt-2">
          <Link href="/pricing">
            <a
              className="flex items-center justify-center rounded-lg py-3 px-4 font-bold text-sm bg-gradient-to-r from-[#a8761b] to-[#7a5410] text-[#fff7df] border border-[rgba(168,118,27,0.55)] no-underline"
              onClick={() => onOpenChange(false)}
            >
              前往充值
            </a>
          </Link>
          <button
            type="button"
            className="rounded-lg py-2.5 text-xs font-semibold text-[rgba(160,140,90,0.85)] border border-[rgba(168,118,27,0.25)] bg-transparent cursor-pointer"
            onClick={() => onOpenChange(false)}
          >
            关闭
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
