import { useId } from "react";

type SourceChoice = "original" | "upscale" | "restore";
type Props = {
  originalReady: boolean;
  upscaleReady: boolean;
  restoreReady: boolean;
  upscaleBusy: boolean;
  restoreBusy: boolean;
  animationStatus: string;
  choices: Record<"upscale" | "restore" | "animate", SourceChoice>;
  locked: boolean;
  onReuse: (tool: "restore" | "animate", source: "upscale" | "restore") => void;
};

const sourceNames: Record<SourceChoice, string> = {
  original: "上传原图", upscale: "放大结果", restore: "上色结果",
};

// 借鉴 diagram-design 的架构图规则：分层、正交连线、单一焦点；状态来自现有工具。
export default function HomePhotoFlow(props: Props) {
  const prefix = `photo-flow-${useId().replace(/:/g, "")}`;
  const sources = [
    { key: "original", name: "上传原图", ready: props.originalReady, status: props.originalReady ? "始终保留" : "等待上传" },
    { key: "upscale", name: "放大结果", ready: props.upscaleReady, status: props.upscaleBusy ? (props.upscaleReady ? "已有结果 · 更新中" : "正在放大") : props.upscaleReady ? "可以继续使用" : "生成后可选" },
    { key: "restore", name: "上色结果", ready: props.restoreReady, status: props.restoreBusy ? (props.restoreReady ? "已有结果 · 更新中" : "正在修复") : props.restoreReady ? "可以继续使用" : "生成后可选" },
  ];
  const tools = [
    { key: "upscale" as const, name: "高清放大", href: "#photo-tools-upscale" },
    { key: "restore" as const, name: "修复上色", href: "#photo-tools-restore" },
    { key: "animate" as const, name: "照片动起来", href: "#photo-tools-animate" },
  ];
  function selectedName(tool: typeof tools[number]["key"]) {
    const selected = props.choices[tool];
    const available = selected === "upscale" ? props.upscaleReady : selected === "restore" ? props.restoreReady : props.originalReady;
    return available ? sourceNames[selected] : props.originalReady ? sourceNames.original : "请先上传照片";
  }

  return (
    <figure className="home-photo-flow" aria-labelledby={`${prefix}-caption`} data-photo-flow>
      <figcaption id={`${prefix}-caption`} className="home-photo-flow-caption">
        <span>一张照片，可以这样接着用</span>
        <p>三种工具独立使用。原图始终保留，已有结果也能选作输入。</p>
      </figcaption>
      <div className="home-photo-flow-map">
        <svg className="home-photo-flow-lines home-photo-flow-lines-wide" viewBox="0 0 1000 248" preserveAspectRatio="none" aria-hidden="true">
          <defs><marker id={`${prefix}-wide-arrow`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1L7 4L1 7" /></marker></defs>
          <g fill="none" markerEnd={`url(#${prefix}-wide-arrow)`}>
            <path d="M232 40H284Q292 40 292 48V100Q292 108 300 108H380" />
            <path strokeDasharray="4 4" d="M232 124H380" />
            <path strokeDasharray="4 4" d="M232 208H316Q324 208 324 200V148Q324 140 332 140H380" />
            <path d="M620 108H700Q708 108 708 100V48Q708 40 716 40H768" />
            <path d="M620 124H768" />
            <path d="M620 140H668Q676 140 676 148V200Q676 208 684 208H768" />
          </g>
        </svg>
        <svg className="home-photo-flow-lines home-photo-flow-lines-narrow" viewBox="0 0 336 320" preserveAspectRatio="none" aria-hidden="true">
          <defs><marker id={`${prefix}-narrow-arrow`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1L7 4L1 7" /></marker></defs>
          <g fill="none" markerEnd={`url(#${prefix}-narrow-arrow)`}>
            <path d="M52 72V88Q52 96 60 96H140Q148 96 148 104V128" />
            <path strokeDasharray="4 4" d="M168 72V128" />
            <path strokeDasharray="4 4" d="M284 72V88Q284 96 276 96H196Q188 96 188 104V128" />
            <path d="M148 192V216Q148 224 140 224H60Q52 224 52 232V256" />
            <path d="M168 192V256" />
            <path d="M188 192V216Q188 224 196 224H276Q284 224 284 232V256" />
          </g>
        </svg>
        <div className="home-photo-flow-sources">
          {sources.map(source => <div key={source.key} className="home-photo-flow-node" data-flow-source={source.key} data-ready={source.ready}>
            <strong>{source.name}</strong><span>{source.status}</span>
          </div>)}
        </div>
        <div className="home-photo-flow-choice"><strong>选择输入照片</strong><span>由你决定用哪一张</span></div>
        <div className="home-photo-flow-tools">
          {tools.map(tool => <a key={tool.key} href={tool.href} className="home-photo-flow-node" data-flow-tool={tool.key}>
            <strong>{tool.name}<span aria-hidden="true"> ↗</span></strong>
            <span>{selectedName(tool.key)}</span>
            {tool.key === "animate" && props.animationStatus && <span className="home-photo-flow-task">{props.animationStatus}</span>}
          </a>)}
        </div>
      </div>
      {(props.upscaleReady || props.restoreReady) && <div className="home-photo-flow-reuse">
        {props.upscaleReady && <button type="button" disabled={props.locked} onClick={() => props.onReuse("restore", "upscale")}>用放大结果修复 <span aria-hidden="true">→</span></button>}
        {props.restoreReady && <button type="button" disabled={props.locked} onClick={() => props.onReuse("animate", "restore")}>用上色结果制作动画 <span aria-hidden="true">→</span></button>}
      </div>}
    </figure>
  );
}
