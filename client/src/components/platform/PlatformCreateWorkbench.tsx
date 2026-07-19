import React from "react";

type Props = {
  stepRail: React.ReactNode;
  /** 桌面端右栏 sticky CTA；移动端可传 null（改用底栏） */
  stickyCta?: React.ReactNode;
  mobileStepRail?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

/** 内容创作三栏壳：左步骤 / 中表单 / 右 CTA（移动端单列） */
export function PlatformCreateWorkbench({
  stepRail,
  stickyCta,
  mobileStepRail,
  children,
  className = "",
}: Props) {
  return (
    <div
      className={`mx-auto grid max-w-[1600px] gap-4 lg:grid-cols-[13rem_minmax(0,1fr)_16rem] xl:grid-cols-[14rem_minmax(0,1fr)_17rem] ${className}`}
    >
      <div className="hidden lg:block">{stepRail}</div>
      {mobileStepRail ? <div className="lg:hidden">{mobileStepRail}</div> : null}
      <div className="min-w-0 pb-24 lg:pb-0">{children}</div>
      {stickyCta ? <div className="hidden lg:block">{stickyCta}</div> : null}
    </div>
  );
}
