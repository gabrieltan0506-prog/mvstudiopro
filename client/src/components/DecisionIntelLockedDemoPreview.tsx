/**
 * 决策智库解锁前试读：静态演示截图 + 英文/品牌资讯区域打码（不涉及真实用户数据）。
 */

import type { ReactElement } from "react";

export interface DecisionIntelLockedDemoPreviewProps {
  /** 覆盖在底下的辅助说明（例如已可预演算时） */
  footnote?: string;
}

/**
 * 演示图置于 `client/public/migrated/decision-intelligence-demo-sample.png`，
 * 遮罩位置按常见横版报告「顶栏产品英文 + 底部英文脚注」对齐，可依换图微调百分比。
 */
export function DecisionIntelLockedDemoPreview({
  footnote,
}: DecisionIntelLockedDemoPreviewProps): ReactElement {
  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-white/10 bg-[#0B0F19] shadow-[0_12px_48px_rgba(0,0,0,0.35)]">
      <div className="pointer-events-none absolute left-2 top-2 z-10 md:left-3 md:top-3">
        <span className="inline-flex items-center rounded-md border border-amber-400/45 bg-[#1a1408]/92 px-2 py-1 text-[9px] font-semibold text-amber-100 shadow-sm backdrop-blur-sm md:text-[10px]">
          演示试读 · 样本已脱敏
        </span>
      </div>

      <div className="relative">
        <img
          src="/migrated/decision-intelligence-demo-sample.png"
          alt="决策智库报告示意（演示样本）"
          className="block w-full max-h-[min(480px,78vh)] object-contain object-top md:max-h-[min(560px,82vh)]"
          loading="lazy"
          decoding="async"
        />

        {/* 顶部：常含产品英文名、副标等 — 条带打码 */}
        <div
          className="pointer-events-none absolute left-0 top-0 z-[1] h-[13%] min-h-[36px] w-full bg-[#0b0f19]/88 backdrop-blur-[3px]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute right-0 top-0 z-[1] h-[16%] min-h-[40px] w-[48%] bg-[#0b0f19]/90 backdrop-blur-[4px]"
          aria-hidden
        />

        {/* 底部：常含英文生成说明 / 平台署名 — 条带打码 */}
        <div
          className="pointer-events-none absolute bottom-0 left-0 right-0 z-[1] h-[9%] min-h-[28px] bg-[#0b0f19]/91 backdrop-blur-[4px]"
          aria-hidden
        />

        {/* 右下角小块：部分截图在此区域有英文字串时加强遮挡 */}
        <div
          className="pointer-events-none absolute bottom-[6%] right-0 z-[1] h-[14%] w-[36%] bg-[#0b0f19]/85 backdrop-blur-[2px]"
          aria-hidden
        />
      </div>

      {footnote ? (
        <p className="border-t border-white/10 bg-black/35 px-3 py-2 text-center text-[10px] leading-snug text-[#b7add8] md:text-[11px]">
          {footnote}
        </p>
      ) : null}
    </div>
  );
}

export default DecisionIntelLockedDemoPreview;
