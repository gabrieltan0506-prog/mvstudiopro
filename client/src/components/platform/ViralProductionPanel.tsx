import { useId, useState } from "react";
import type { PlatformGraphicNotePage } from "@shared/platformTopicShortlist";
import type { PlatformStoryboardCell } from "@shared/platformStoryboardCells";
import { xhsCreationPackageSchema } from "@shared/xhsCreationPackage";
import PlatformStoryboardCellsTable from "./PlatformStoryboardCellsTable";

type Props = {
  format: string;
  packageValue: unknown;
  pages?: PlatformGraphicNotePage[];
  cells?: PlatformStoryboardCell[];
  coverUrl?: string;
  coverCost: number;
  sheetCost: number;
  sheetLabel: string;
  gridVariant: "2x4" | "3x4";
  onGridChange: (value: "2x4" | "3x4") => void;
  disabled: boolean;
  coverBusy: boolean;
  sheetBusy: boolean;
  onCover: () => void;
  onSheet: () => void;
};

/** 读取同一执行卡的真实分页、分镜与封面方案；按钮复用原计费及后台任务。 */
export function ViralProductionPanel(props: Props) {
  const panelId = useId();
  const [pageIndex, setPageIndex] = useState(0);
  const parsed = xhsCreationPackageSchema.safeParse(props.packageValue);
  const cover = parsed.success ? parsed.data.cover : null;
  const graphic = /图文|小红书/.test(props.format);
  const pages = props.pages ?? [];
  const activeIndex = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const page = pages[activeIndex];
  return <section className="viral-production-panel" aria-label="封面与内容制作">
    <div className="viral-production-heading"><span className="creation-eyebrow">03 · 把稿件变成可发布内容</span><h3>封面与内容制作</h3><p>先检查文案与画面安排，再按需生成图片。点击后确认费用。</p></div>
    <div className="viral-cover-block">
      <div className="viral-cover-preview">
        {props.coverUrl ? <img src={props.coverUrl} alt="已生成的稿件封面"/> : <><span>封面文字预览 · 图片尚未生成</span><strong>{cover?.headline || "尚无封面方案"}</strong><p>{cover?.subline}</p></>}
      </div>
      <div className="viral-cover-description"><span className="creation-eyebrow">封面生成</span><h4>先让读者看懂这一篇</h4>{cover ? <><p>{cover.visual}</p><p><b>排版：</b>{cover.layout}</p><p><b>系列连续性：</b>{cover.continuity}</p></> : <p>当前稿件缺少完整封面方案，请检查原稿。</p>}<button type="button" className="creation-primary" disabled={props.disabled || props.coverBusy} onClick={props.onCover}>{props.coverBusy ? "封面生成中…" : `${props.coverUrl ? "重新生成封面" : "生成封面"} · ${props.coverCost} 点`}</button></div>
    </div>
    <div className="viral-content-production">
      <div className="viral-content-heading"><div><span className="creation-eyebrow">{graphic ? "图文笔记" : "视频文案"}</span><h4>{graphic ? `图文分页 · ${pages.length} 页` : `视频导演表 · ${props.cells?.length ?? 0} 镜`}</h4></div><button type="button" className="creation-primary" disabled={props.disabled || props.sheetBusy} onClick={props.onSheet}>{props.sheetBusy ? "配图生成中…" : `${graphic ? "生成图文配图" : "生成导演分镜图"} · ${props.sheetCost} 点`}</button></div>
      <div className="viral-page-tabs" role="group" aria-label="配图布局"><button type="button" aria-pressed={props.gridVariant === "2x4"} disabled={props.disabled || props.sheetBusy} onClick={() => props.onGridChange("2x4")}>4列 × 2行 · 8格</button><button type="button" aria-pressed={props.gridVariant === "3x4"} disabled={props.disabled || props.sheetBusy} onClick={() => props.onGridChange("3x4")}>4列 × 3行 · 12格</button></div>
      <p className="creation-secondary-note">{graphic ? "逐页检查标题和正文；下方分页切换不计费。" : "逐镜检查台词、场景、动作、景别、运镜与剪辑；可复制整张表。"} 图片输出沿用{props.sheetLabel}。</p>
      {graphic ? page ? <>
        <div className="viral-page-tabs" role="tablist" aria-label="图文页码">{pages.map((p, i) => <button key={p.pageIndex} type="button" role="tab" aria-selected={i === activeIndex} aria-controls={panelId} onClick={() => setPageIndex(i)}>第 {p.pageIndex} 页</button>)}</div>
        <article className="viral-page-content" role="tabpanel" id={panelId}><span>第 {page.pageIndex} / {pages.length} 页</span><h4>{page.headline}</h4><p>{page.body}</p></article>
        <div className="viral-page-navigation"><button type="button" disabled={activeIndex === 0} onClick={() => setPageIndex(activeIndex - 1)}>← 上一页</button><span>{activeIndex + 1} / {pages.length}</span><button type="button" disabled={activeIndex === pages.length - 1} onClick={() => setPageIndex(activeIndex + 1)}>下一页 →</button></div>
      </> : <p role="status">这份稿件没有有效图文分页，请检查原稿。</p> : props.cells?.length ? <div className="viral-director-table"><PlatformStoryboardCellsTable cells={props.cells}/></div> : <p role="status">这份稿件没有有效导演表，请检查原稿。</p>}
    </div>
  </section>;
}
