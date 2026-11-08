/**
 * 共用采用 hook（StockFootagePanel 与 StockFootageDrawer 共用）。
 * 保持 PR #1753 已修好的行为：
 * - 本机待办同步落盘：先读盘→改→写盘→setState，组件随后被卸载也不会留下「待继续」残影；
 * - 先落待办再发请求：回包丢失也能用原编号续做，服务端幂等不重复入库；
 * - 成功/明确失败（failed、CONFLICT、BAD_REQUEST）清除待办，网络中断保留；
 * - 刚发起（2 分钟内）的待办不查询状态，避免与占位抢跑误报。
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { StockFootageAssetView, StockFootageCandidate, StockFootageOrientation, StockFootagePurpose, StockFootageUsage } from "@shared/stockFootage";
import type { StockTrim } from "@shared/stockFootageTrim";
import { isFreshPending, newRequestId, readPending, writePending, type PendingAdoption, type StockFootageContext } from "./stockFootageModel";

export type { PendingAdoption } from "./stockFootageModel";

export type UseStockFootageAdoptionOptions = {
  purpose: StockFootagePurpose;
  /** 只查询并展示与当前位置相关的待办；默认按 purpose 过滤。 */
  filterPending?: (p: PendingAdoption) => boolean;
};

export function useStockFootageAdoption(options: UseStockFootageAdoptionOptions) {
  const { purpose, filterPending } = options;
  const [pending, setPending] = useState<PendingAdoption[]>(() => (typeof window === "undefined" ? [] : readPending()));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<Record<string, string>>({});
  const utils = trpc.useUtils();
  const adopt = trpc.stockFootage.adopt.useMutation();

  const myPending = pending.filter(p => (filterPending ? filterPending(p) : p.purpose === purpose));

  // 本机待办必须同步落盘：采用成功后业务方常会立即关闭面板（卸载），
  // 若把写入放在 setState 更新函数里，卸载后更新被丢弃，已完成的采用会一直显示「待继续」。
  const updatePending = useCallback((fn: (list: PendingAdoption[]) => PendingAdoption[]) => {
    const next = fn(readPending());
    writePending(next);
    setPending(next);
  }, []);

  const removePending = useCallback((requestId: string) => updatePending(list => list.filter(p => p.requestId !== requestId)), [updatePending]);

  /** 用待办里的编号发起/续做采用；成功返回资产，其余情况返回 null（已提示用户）。 */
  const runAdopt = useCallback(
    async (item: PendingAdoption): Promise<StockFootageAssetView | null> => {
      setBusyId(item.requestId);
      try {
        const res = await adopt.mutateAsync({
          requestId: item.requestId,
          provider: "pexels",
          providerAssetId: item.providerAssetId,
          kind: item.kind,
          purpose: item.purpose,
          usage: item.usage,
          ...(item.orientation ? { orientation: item.orientation } : {}),
          context: item.context,
        });
        if (res.status === "succeeded" && res.asset) {
          removePending(item.requestId);
          void utils.stockFootage.listAdoptions.invalidate();
          toast.success("素材已采用");
          return res.asset;
        }
        if (res.status === "failed") {
          removePending(item.requestId);
          toast.error(res.message || "素材未能采用");
        } else {
          toast.message(res.message || "素材还在处理，可稍后点「继续」");
        }
        return null;
      } catch (error) {
        // 网络中断：保留待办，同一编号可继续；参数冲突/未启用等明确错误才移除。
        const message = (error as { message?: string })?.message || "素材服务暂不可用";
        const code = (error as { data?: { code?: string } })?.data?.code;
        if (code === "CONFLICT" || code === "BAD_REQUEST") removePending(item.requestId);
        toast.error(message);
        return null;
      } finally {
        setBusyId(null);
      }
    },
    [adopt, removePending, utils]
  );

  /** 为候选新建编号：先落本机待办，再发请求。 */
  const startAdoption = useCallback(
    (
      candidate: Pick<StockFootageCandidate, "providerAssetId" | "kind" | "previewImageUrl">,
      opts: { usage: StockFootageUsage; orientation?: StockFootageOrientation; context?: StockFootageContext; trim?: StockTrim }
    ): Promise<StockFootageAssetView | null> => {
      const item: PendingAdoption = {
        requestId: newRequestId(),
        providerAssetId: candidate.providerAssetId,
        kind: candidate.kind,
        purpose,
        usage: opts.usage,
        orientation: opts.orientation,
        context: opts.context ?? {},
        previewImageUrl: candidate.previewImageUrl,
        ...(opts.trim ? { trim: opts.trim } : {}),
        startedAt: Date.now(),
      };
      updatePending(list => [...list, item]);
      return runAdopt(item);
    },
    [purpose, runAdopt, updatePending]
  );

  // 刷新后查询未完成待办在服务端的真实状态（只查询，不自动绑定到当前编辑位置）。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const p of myPending) {
        if (isFreshPending(p)) continue;
        try {
          const res = await utils.stockFootage.getAdoption.fetch({ requestId: p.requestId });
          if (!cancelled) setPendingStatus(s => ({ ...s, [p.requestId]: res.status }));
        } catch {
          if (!cancelled) setPendingStatus(s => ({ ...s, [p.requestId]: "unknown" }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // 仅在挂载与待办数量变化时核对
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPending.length]);

  return {
    pending: myPending,
    pendingStatus,
    busyId,
    isAdopting: adopt.isPending,
    startAdoption,
    resumeAdoption: runAdopt,
    removePending,
  };
}

export default useStockFootageAdoption;
