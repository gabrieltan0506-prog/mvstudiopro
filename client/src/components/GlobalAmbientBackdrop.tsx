import React from "react";
import { useAmbientScene } from "@/components/AmbientSceneProvider";
import "@/components/work-ambient-scene.css";

/**
 * 全站固定底图轮播：与 AmbientSceneProvider、WorkAmbientPanel 共用 Context；
 * 时段 × 天气图集约 30s 交叉淡入淡出。使用 fixed 保证所有路由滚动时底图仍在视窗层。
 */
export default function GlobalAmbientBackdrop() {
  const { ambientUrls, bgIdx, motionOk } = useAmbientScene();

  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed inset-0 z-0 overflow-hidden ${motionOk ? "ambient-motion-ok" : ""}`}
    >
      {ambientUrls.map((url, i) => (
        <div
          key={`global-bg-${url.slice(-32)}-${i}`}
          className="absolute inset-0 bg-cover bg-center transition-opacity duration-[1.25s] ease-out"
          style={{ backgroundImage: `url(${url})`, opacity: i === bgIdx ? 1 : 0 }}
        />
      ))}
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_top_center,rgba(255,79,179,0.12),transparent_38%),radial-gradient(circle_at_0%_0%,rgba(139,92,246,0.14),transparent_32%),radial-gradient(circle_at_100%_40%,rgba(59,130,246,0.10),transparent_28%),linear-gradient(180deg,rgba(10,8,20,0.55)_0%,rgba(8,9,20,0.62)_45%,rgba(9,9,21,0.68)_100%)]"
        aria-hidden
      />
    </div>
  );
}
