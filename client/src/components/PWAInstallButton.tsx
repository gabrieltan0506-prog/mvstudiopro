import React, { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function getStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOSDevice(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

function isWeChat(): boolean {
  return /MicroMessenger/i.test(navigator.userAgent);
}

function isMobileUa(): boolean {
  const ua = navigator.userAgent;
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * PWA 安装：Android Chrome 会触发 beforeinstallprompt；iOS / 微信内不会，
 * 需引导用户使用系统「添加到主屏幕」。桌面 Chrome 也可能触发 beforeinstallprompt。
 */
export function PWAInstallButton() {
  const [standalone, setStandalone] = useState(getStandalone);
  const [deferredPrompt, setDeferredPrompt] = useState<unknown>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    const onChange = () => setStandalone(getStandalone());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (standalone) return;
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, [standalone]);

  const runDeferredInstall = useCallback(async () => {
    const ev = deferredPrompt as null | { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
    if (!ev) return;
    ev.prompt();
    const { outcome } = await ev.userChoice;
    if (outcome === "accepted") setDeferredPrompt(null);
  }, [deferredPrompt]);

  const onFabClick = useCallback(async () => {
    if (deferredPrompt) {
      await runDeferredInstall();
      return;
    }
    setHelpOpen(true);
  }, [deferredPrompt, runDeferredInstall]);

  if (standalone) return null;

  const showFab = isMobileUa() || !!deferredPrompt;
  if (!showFab) return null;

  const ios = isIOSDevice();
  const wechat = isWeChat();

  return (
    <>
      <div className="fixed bottom-6 right-6 z-[100] max-w-[calc(100vw-3rem)]">
        <Button
          type="button"
          onClick={onFabClick}
          className="rounded-full shadow-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-500 hover:to-indigo-500 border border-white/20 transition-transform hover:scale-105"
        >
          <Download className="mr-2 h-4 w-4 shrink-0" />
          新增到手机桌面
        </Button>
      </div>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>添加到主屏幕</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-4 text-left text-sm text-muted-foreground">
                {wechat ? (
                  <p>
                    微信内置浏览器<strong>无法</strong>像独立 App
                    一样安装。请先点右上角 <strong>「···」</strong>，选择
                    <strong>「在浏览器中打开」</strong>，用系统 Safari 或 Chrome
                    打开本站后，再使用下面的方式添加。
                  </p>
                ) : null}

                {ios ? (
                  <ol className="list-decimal space-y-2 pl-4">
                    <li>
                      {wechat
                        ? "在系统 Safari 中打开本页后："
                        : "请使用 Safari 打开本站（iPhone 上的 Chrome 添加主屏幕同样使用系统 WebKit）。"}
                    </li>
                    <li>点击浏览器底部中间的<strong>分享</strong>按钮（方框与向上箭头）。</li>
                    <li>
                      在菜单中选择<strong>「添加到主屏幕」</strong>或<strong>Add to Home Screen</strong>。
                    </li>
                  </ol>
                ) : null}

                {!ios ? (
                  <ol className="list-decimal space-y-2 pl-4">
                    <li>
                      请用系统里的 <strong>Chrome</strong>（或 Edge）打开本站；华为/小米等自带浏览器常<strong>没有</strong>「安装应用」能力。
                    </li>
                    <li>
                      点浏览器右上角 <strong>「⋮」</strong>，看是否有 <strong>「安装应用」</strong>、<strong>「添加到主屏幕」</strong> 或 <strong>「Install app」</strong>。
                    </li>
                    <li>
                      若首页右下角有 <strong>「新增到手机桌面」</strong> 按钮：Chrome 已支持安装时，点按钮会弹出系统安装对话框；若未弹出，多半是之前不满足图标要求——本站已配置 192/512 PNG，部署后请<strong>完全关闭浏览器再开</strong>或清除本站数据后重试。
                    </li>
                  </ol>
                ) : null}
              </div>
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}
