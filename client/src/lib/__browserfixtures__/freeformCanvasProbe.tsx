/**
 * 仅供浏览器测试：把真实 OmniCanvas 传给 FreeformCanvas 的 props 暴露到 window。
 *
 * 通过 esbuild alias 顶替 "@/components/canvas/FreeformCanvas"，
 * 再把真实组件按真实路径引回来渲染——所以页面行为不变，
 * 测试拿到的 prepareManhuaClipRun / resolveManhuaOutboundGate
 * 是**真实页面函数本身**，不是手写的同形实现。
 */
import React from "react";
import Real from "../../components/canvas/FreeformCanvas";

type Props = React.ComponentProps<typeof Real>;

declare global {
  interface Window {
    __ffcProps?: Props;
    /** 每次收到新的 prepareManhuaClipRun 身份就自增，用来观察重新渲染后是否换了函数 */
    __ffcPrepareIdentityCount?: number;
    __ffcLastPrepare?: unknown;
  }
}

export default function FreeformCanvasProbe(props: Props) {
  window.__ffcProps = props;
  if (window.__ffcLastPrepare !== props.prepareManhuaClipRun) {
    window.__ffcLastPrepare = props.prepareManhuaClipRun;
    window.__ffcPrepareIdentityCount = (window.__ffcPrepareIdentityCount ?? 0) + 1;
  }
  return <Real {...props} />;
}
