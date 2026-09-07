import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

type AssetConfirmation = {
  title: string;
  description: string;
  details: string;
};
type PendingConfirmation = AssetConfirmation & {
  scope: unknown;
  resolve: (accepted: boolean) => void;
};

/** 仅资产编辑类操作使用；确认前不调用生成，取消和卸载均按拒绝处理。 */
export function useManhuaAssetConfirmation(scope: unknown) {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const current = useRef<PendingConfirmation | null>(null);
  const mounted = useRef(true);
  const latestScope = useRef(scope);
  latestScope.current = scope;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const request = current.current;
      current.current = null;
      request?.resolve(false);
    };
  }, []);
  const confirmAssetAction = useCallback(
    (options: AssetConfirmation): Promise<boolean> => {
      if (!mounted.current || current.current) return Promise.resolve(false);
      return new Promise(resolve => {
        const request = { ...options, scope: latestScope.current, resolve };
        current.current = request;
        setPending(request);
      });
    },
    []
  );
  const settle = useCallback(
    (request: PendingConfirmation, accepted: boolean) => {
      // 旧弹层的迟到点击不能确认下一项操作。
      if (current.current !== request) return;
      current.current = null;
      if (mounted.current) setPending(null);
      request.resolve(accepted && request.scope === latestScope.current);
    },
    []
  );
  useEffect(() => {
    const request = current.current;
    if (request && request.scope !== scope) settle(request, false);
  }, [scope, settle]);
  const assetConfirmationDialog = pending ? (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) settle(pending, false);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="z-[100] max-h-[85dvh] overflow-y-auto border-white/15 bg-[#141418] text-white"
      >
        <DialogTitle>{pending.title}</DialogTitle>
        <DialogDescription className="whitespace-pre-line">
          {pending.description}
        </DialogDescription>
        <p className="whitespace-pre-wrap break-words text-sm text-white/80">
          {pending.details}
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            autoFocus
            onClick={() => settle(pending, false)}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => settle(pending, true)}
            className="rounded-lg bg-violet-600 px-3 py-2"
          >
            确认费用并生成
          </button>
        </div>
      </DialogContent>
    </Dialog>
  ) : null;
  return { confirmAssetAction, assetConfirmationDialog };
}
