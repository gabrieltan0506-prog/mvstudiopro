import React from "react";

type Props = {
  stepRail: React.ReactNode;
  stickyCta?: React.ReactNode;
  mobileStepRail?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

/** 主操作与内容同区，不再用左右侧栏挤压选题和稿件。 */
export function PlatformCreateWorkbench({ stepRail, children, className = "" }: Props) {
  return <div className={`platform-create-workbench ${className}`}>
    <div className="creation-workbench-nav">{stepRail}</div>
    <div className="min-w-0 pb-12">{children}</div>
  </div>;
}
