/**
 * 仅供浏览器测试：把真实 OmniCanvas 传给 ManhuaScriptWorkbench 的 props 暴露到 window。
 * 通过 esbuild alias 顶替，壳内仍渲染真实组件——页面行为不变。
 *
 * 这样测试就能调**真实页面**的 onPreviewClipOutbound / onConfirmClipOutbound，
 * 而不是自己重写一遍确认流程。
 */
import React from "react";
import Real from "../../components/ManhuaScriptWorkbench";
// 该模块还有具名导出被页面直接引用，必须原样透传，否则 alias 会打断真实依赖
export * from "../../components/ManhuaScriptWorkbench";

type Props = React.ComponentProps<typeof Real>;

declare global {
  interface Window {
    __wbProps?: Props;
  }
}

export default function ManhuaScriptWorkbenchProbe(props: Props) {
  window.__wbProps = props;
  return <Real {...props} />;
}
