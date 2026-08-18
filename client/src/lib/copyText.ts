/**
 * 客户端「写剪贴板」的统一入口——除明确冻结的 GodViewPage 历史入口外，
 * 生产代码一律经此函数写剪贴板（由 copyTextGuard.test.ts 守门）。
 *
 * 立规背景（P0-2，2026-08-12）：拆片表「复制表格」在剪贴板写入失败时
 * `catch(() => {})` 静默吞错，用户以为复制成功、粘贴才发现是空的——
 * 失败伪装成功比直接报错更伤信任。此后全站口径：
 *   复制只有真成功才准报成功；两条通道都失败必须让用户看见。
 *
 * 本文件收口三处历史实现（manhuaCharacterGalleryStorage.copyText、
 * PlatformStoryboardCellsTable.copyTextWithFallback、以及各页面的裸调用），
 * 避免同一件事有多套实现各自漂移。
 */

import { toast } from "sonner";

/**
 * 写入剪贴板，返回是否真的成功。调用方必须按返回值决定提示，不得无条件报成功。
 *
 * 通道一：`navigator.clipboard.writeText`。在文档失焦、权限被拒、
 * 非安全上下文、旧版 WebView（部分安卓内置浏览器）下会 reject。
 * 通道二：临时 textarea + `document.execCommand("copy")`。
 *
 * ⚠️ 两条通道都要求调用发生在用户手势的同步链路里。若在 `await` 网络请求
 * 之后才调用，浏览器的临时用户激活已过期，两条通道都会失败——那种场景
 * 应改成「先把文本展示出来，再让用户点一次复制」，而不是指望本函数硬扛。
 */
export async function copyText(text: string): Promise<boolean> {
  // 只用 trim 判空，复制的是**原文**：SRT、Markdown 表格、日志、提示词的首尾
  // 换行与缩进都是内容的一部分，公共函数无权替调用方删。
  const value = String(text ?? "");
  if (!value.trim()) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // 落到通道二，绝不在这里 return true
  }

  let ta: HTMLTextAreaElement | null = null;
  let selection: Selection | null = null;
  let previousActive: HTMLElement | null = null;
  const previousRanges: Range[] = [];

  try {
    // 先存好用户原有的焦点与选区（选区可能是多段），再动 DOM
    previousActive =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    selection = window.getSelection();
    if (selection) {
      for (let i = 0; i < selection.rangeCount; i += 1) {
        previousRanges.push(selection.getRangeAt(i));
      }
    }

    ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    // 不能用 display:none / visibility:hidden——隐藏元素无法选中，execCommand 会失败
    ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:0;padding:0;";
    document.body.appendChild(ta);

    // 顺序有讲究，改动前先看这段：
    // 1) 先聚焦。只做 Range 选区而不聚焦时，Chrome 实测 execCommand 会返回 true，
    //    但 activeElement 仍是 BODY、没有活动选区——又一次假成功。
    //    preventScroll 避免这个 1px 隐形元素把页面滚走。
    ta.focus({ preventScroll: true });

    // 2) 再放 iOS Safari 的 Range 兜底（其 readonly textarea 的 select() 不生效）。
    //    必须放在 select() 之前——反过来会把下一步选好的内容清掉（实测 0..0）。
    const range = document.createRange();
    range.selectNodeContents(ta);
    selection?.removeAllRanges();
    selection?.addRange(range);

    // 3) 最后做 textarea 自身的选中，让它成为 execCommand 执行那一刻的活动选区。
    ta.select();
    ta.setSelectionRange(0, value.length);

    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    // 成功、失败、抛异常三条路都必须走到这里：临时节点不许留在 DOM，
    // 用户原本的焦点与选中文字不许被我们弄丢。
    try {
      if (ta?.parentNode) ta.parentNode.removeChild(ta);
    } catch {
      // 摘不掉也不能影响复制结果的返回
    }
    if (selection) {
      try {
        selection.removeAllRanges();
        for (const previous of previousRanges) selection.addRange(previous);
      } catch {
        // 选区还原失败同样不影响复制结果
      }
    }
    try {
      previousActive?.focus({ preventScroll: true });
    } catch {
      // 焦点还原失败同样不影响复制结果
    }
  }
}

/**
 * 带提示的复制：成功才 toast.success，失败一律 toast.error 并告诉用户怎么手动来。
 * 返回值同 `copyText`，调用方仍可据此做按钮态（如「已复制 ✓」）。
 */
export async function copyTextWithToast(
  text: string,
  options?: {
    /** 成功提示，默认「已复制」 */
    successZh?: string;
    /** 失败提示，默认「复制没成功」 */
    errorZh?: string;
    /** 失败提示的补充说明，告诉用户手动怎么办 */
    errorDescriptionZh?: string;
  },
): Promise<boolean> {
  const ok = await copyText(text);
  if (ok) {
    toast.success(options?.successZh ?? "已复制");
  } else {
    toast.error(options?.errorZh ?? "复制没成功", {
      description: options?.errorDescriptionZh ?? "请手动选中文本复制。",
    });
  }
  return ok;
}
