import React, { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

export interface ModelViewerProps {
  modelUrl?: string;
  src?: string;
  glbUrl?: string;
  objUrl?: string;
  format?: string;
  width?: string | number;
  height?: string | number;
  autoRotate?: boolean;
  showWireframe?: boolean;
  backgroundColor?: string;
  [key: string]: any;
}

function generateModelViewerHTML(props: {
  modelUrl: string;
  thumbnailUrl?: string | null;
  autoRotate: boolean;
  backgroundColor: string;
}): string {
  const { modelUrl, thumbnailUrl, autoRotate, backgroundColor } = props;

  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>3D Model Viewer</title>
  <script>
    window.ModelViewerElement = {
      dracoDecoderLocation: '/vendor/model-viewer/draco/',
      ktx2TranscoderLocation: '/vendor/model-viewer/ktx2/'
    };
  <\/script>
  <script type="module" src="/vendor/model-viewer.min.js"><\/script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: ${backgroundColor}; }
    model-viewer {
      width: 100%;
      height: 100%;
      --poster-color: ;
    }
    model-viewer::part(default-progress-bar) {
      background: linear-gradient(90deg, #64D2FF, #FF6B6B);
      height: 4px;
    }
    .controls {
      position: absolute;
      bottom: 12px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 8px;
      z-index: 10;
    }
    .controls button {
      background: rgba(30, 32, 34, 0.85);
      border: 1px solid rgba(100, 210, 255, 0.3);
      color: #64D2FF;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 12px;
      cursor: pointer;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      transition: all 0.2s;
    }
    .controls button:hover {
      background: rgba(100, 210, 255, 0.15);
      border-color: #64D2FF;
    }
    .hint {
      position: absolute;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(30, 32, 34, 0.75);
      color: rgba(255, 255, 255, 0.7);
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 11px;
      pointer-events: none;
      backdrop-filter: blur(8px);
      white-space: nowrap;
      opacity: 1;
      transition: opacity 1s;
    }
    .hint.hidden { opacity: 0; }
  </style>
</head>
<body>
  <model-viewer
    id="viewer"
    src="${modelUrl}"
    ${thumbnailUrl ? `poster="${thumbnailUrl}"` : ""}
    ${autoRotate ? 'auto-rotate auto-rotate-delay="0"' : ""}
    camera-controls
    touch-action="pan-y"
    interaction-prompt="auto"
    shadow-intensity="1"
    shadow-softness="0.8"
    exposure="1.2"
    environment-image="neutral"
    loading="eager"
    reveal="auto"
    style="background-color: ${backgroundColor};"
  ></model-viewer>
  <div class="hint" id="hint">拖拽旋转 · 滚轮缩放 · 右键平移</div>
  <div class="controls">
    <button onclick="resetCamera()">↺ 重置视角</button>
    <button onclick="toggleRotate()" id="rotateBtn">${autoRotate ? "⏸ 停止旋转" : "▶ 自动旋转"}</button>
    <button onclick="toggleWireframe()" id="wireBtn">◇ 线框</button>
  </div>
  <script>
    const viewer = document.getElementById('viewer');
    const hint = document.getElementById('hint');
    let isRotating = ${autoRotate};
    let wireframeOn = false;
    setTimeout(() => hint.classList.add('hidden'), 3000);
    function resetCamera() {
      viewer.cameraOrbit = 'auto auto auto';
      viewer.cameraTarget = 'auto auto auto';
      viewer.fieldOfView = 'auto';
      viewer.jumpCameraToGoal();
    }
    function toggleRotate() {
      isRotating = !isRotating;
      viewer.autoRotate = isRotating;
      document.getElementById('rotateBtn').textContent = isRotating ? '⏸ 停止旋转' : '▶ 自动旋转';
    }
    function toggleWireframe() {
      wireframeOn = !wireframeOn;
      const model = viewer.model;
      if (model && model.materials) {
        model.materials.forEach(mat => { mat.setWireframe(wireframeOn); });
      }
      document.getElementById('wireBtn').textContent = wireframeOn ? '◆ 实体' : '◇ 线框';
    }
  <\/script>
</body>
</html>`;
}

export function ModelViewer({
  glbUrl,
  objUrl,
  thumbnailUrl,
  textureUrl,
  height = 320,
  autoRotate = true,
  backgroundColor = "#1a1a2e",
}: ModelViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const modelUrl = glbUrl || null;
  const canShowViewer = !!modelUrl;

  const iframeHtml = useMemo(() => {
    if (!modelUrl) return "";
    return generateModelViewerHTML({ modelUrl, thumbnailUrl, autoRotate, backgroundColor });
  }, [modelUrl, thumbnailUrl, autoRotate, backgroundColor]);

  if (canShowViewer) {
    return (
      <div className="w-full relative rounded-xl overflow-hidden" style={{ height, backgroundColor }}>
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10" style={{ backgroundColor }}>
            <Loader2 className="h-8 w-8 text-cyan-400 animate-spin" />
            <span className="mt-2 text-sm text-white/60">加载 3D 模型中...</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10" style={{ backgroundColor }}>
            <span className="text-3xl">⚠️</span>
            <span className="mt-2 text-sm text-red-400">3D 模型加载失败</span>
          </div>
        )}
        <iframe
          srcDoc={iframeHtml}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            borderRadius: 12,
            opacity: loading ? 0 : 1,
            transition: "opacity 0.3s",
          }}
          onLoad={() => setLoading(false)}
          onError={() => { setError(true); setLoading(false); }}
          allow="autoplay; fullscreen; xr-spatial-tracking"
          sandbox="allow-scripts allow-same-origin"
          title="3D Model Viewer"
        />
      </div>
    );
  }

  const hasObjOnly = !glbUrl && !!objUrl;

  return (
    <div className="w-full relative rounded-xl overflow-hidden flex items-center justify-center" style={{ height, backgroundColor }}>
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt="3D Preview" className="max-w-full max-h-full object-contain" />
      ) : (
        <div className="flex items-center justify-center" style={{ color: "rgba(100,210,255,0.5)" }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3L2 7l10 4 10-4-10-4z"/>
            <path d="M2 17l10 4 10-4"/>
            <path d="M2 12l10 4 10-4"/>
          </svg>
        </div>
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
        <span className="text-3xl">🔄</span>
        <span className="mt-2 text-sm text-white/70 text-center leading-5">
          {hasObjOnly
            ? "OBJ 格式暂不支持在线预览\n请下载后在 3D 软件中查看"
            : "模型加载中..."
          }
        </span>
        {hasObjOnly && objUrl && (
          <a
            href={objUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 bg-cyan-400 text-black px-4 py-2 rounded-lg text-sm font-semibold hover:bg-cyan-300 transition-colors"
          >
            下载 OBJ 文件
          </a>
        )}
      </div>
    </div>
  );
}

export default ModelViewer;
