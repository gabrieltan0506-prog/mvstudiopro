import React from "react";

type Props = {
  stickyCta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

/** 平台趋势独立路径壳：中栏配置+结果，右栏费用与主 CTA */
export function PlatformTrendWorkbench({ stickyCta, children, className = "" }: Props) {
  return (
    <div
      className={`mx-auto grid max-w-[1600px] gap-4 lg:grid-cols-[minmax(0,1fr)_16rem] xl:grid-cols-[minmax(0,1fr)_17rem] ${className}`}
    >
      <div className="min-w-0 space-y-4 pb-24 lg:pb-0">{children}</div>
      {stickyCta ? <div className="hidden lg:block">{stickyCta}</div> : null}
    </div>
  );
}
