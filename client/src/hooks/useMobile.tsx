import * as React from "react";

const MOBILE_BREAKPOINT = 768;
// 与 Tailwind 的 xl: 断点一致（1280px），用于在 < xl 时切到汉堡菜单
const XL_BREAKPOINT = 1280;

function useIsBelowBreakpoint(breakpoint: number) {
  const [below, setBelow] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => {
      setBelow(window.innerWidth < breakpoint);
    };
    mql.addEventListener("change", onChange);
    setBelow(window.innerWidth < breakpoint);
    return () => mql.removeEventListener("change", onChange);
  }, [breakpoint]);

  return !!below;
}

export function useIsMobile() {
  return useIsBelowBreakpoint(MOBILE_BREAKPOINT);
}

// < 1280px 时返回 true（含 iPhone / iPad 全档 / 1024 iPad Pro 竖屏）
export function useIsBelowXl() {
  return useIsBelowBreakpoint(XL_BREAKPOINT);
}
