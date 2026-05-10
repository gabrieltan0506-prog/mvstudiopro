/**
 * 決策智庫解鎖前試讀：靜態演示截圖 + 英文/品牌資訊區域打碼（不涉及真實用戶數據）。
 */

import type { ReactElement } from "react";

export interface DecisionIntelLockedDemoPreviewProps {
  /** 覆蓋在底下的輔助說明（例如已可預演算時） */
  footnote?: string;
}

/**
 * 演示圖置於 `client/public/migrated/decision-intelligence-demo-sample.png`，
 * 遮罩位置按常見橫版報告「頂欄產品英文 + 底部英文腳注」對齊，可依換圖微調百分比。
 */
export function DecisionIntelLockedDemoPreview({
  footnote,
}: DecisionIntelLockedDemoPreviewProps): ReactElement {
  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-white/10 bg-[#0B0F19] shadow-[0_12px_48px_rgba(0,0,0,0.35)]">
      <div className="pointer-events-none absolute left-2 top-2 z-10 md:left-3 md:top-3">
        <span className="inline-flex items-center rounded-md border border-amber-400/45 bg-[#1a1408]/92 px-2 py-1 text-[9px] font-semibold text-amber-100 shadow-sm backdrop-blur-sm md:text-[10px]">
          演示試讀 · 樣本已脫敏
        </span>
      </div>

      <div className="relative">
        <img
          src="/migrated/decision-intelligence-demo-sample.png"
          alt="決策智庫報告示意（演示樣本）"
          className="block w-full max-h-[min(480px,78vh)] object-contain object-top md:max-h-[min(560px,82vh)]"
          loading="lazy"
          decoding="async"
        />

        {/* 頂部：常含產品英文名、副標等 — 條帶打碼 */}
        <div
          className="pointer-events-none absolute left-0 top-0 z-[1] h-[13%] min-h-[36px] w-full bg-[#0b0f19]/88 backdrop-blur-[3px]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute right-0 top-0 z-[1] h-[16%] min-h-[40px] w-[48%] bg-[#0b0f19]/90 backdrop-blur-[4px]"
          aria-hidden
        />

        {/* 底部：常含英文生成說明 / 平台署名 — 條帶打碼 */}
        <div
          className="pointer-events-none absolute bottom-0 left-0 right-0 z-[1] h-[9%] min-h-[28px] bg-[#0b0f19]/91 backdrop-blur-[4px]"
          aria-hidden
        />

        {/* 右下角小塊：部分截圖在此區域有英文字串時加強遮擋 */}
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
